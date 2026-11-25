#!/bin/bash
# アプリから作られた Issue（ラベル from-app）を拾って、Claude に開発させ、プルリクエストを出してマージする。
# launchd（com.kazuya83.minna-issue-worker）から 10 分おきに呼ばれる。install.sh が入れる。
#
#   1) gh で「まだ誰も着手していない from-app の Issue」を探す（Claude は使わないのでトークン 0）
#   2) 無ければ終わる。あれば 1 件だけ「claude-working」ラベルを付けて着手の印にする
#      開発の前に、受付係の Claude（道具なし）が提案を判定し、攻撃・リポジトリへの操作・アプリの削除などは
#      「claude-rejected」を付けて閉じる
#   3) 作業用のリポジトリ（内蔵ディスク）を main の最新にして、claude -p に開発させる（ファイルの変更まで）
#   4) このスクリプトが確認（npm run check、変えてはいけない場所）→ コミット → プッシュ → PR 作成
#   5) Issue のラベルを「claude-pr-created」か「claude-failed」に変える
#   6) 自動マージ：CI が通り、別の Claude のレビュー（読むだけ）が APPROVE なら、スクリプトがマージする
#      （マージすると本番にデプロイされる）。条件を満たさなければ PR を残して人に任せる
#
# 開発・レビューをする Claude には gh・git push・マージを許可しない。マージするのはこのスクリプトだけ。
set -u
export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
[ -f "$HOME/.claude_token_env" ] && { set -a; . "$HOME/.claude_token_env"; set +a; }
export LANG=ja_JP.UTF-8

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
. "$HERE/config.sh"   # REPO, WORK_DIR, DAILY_LIMIT, CLAUDE_TIMEOUT を決める（install.sh が作る）

SOURCE_LABEL="from-app"
WORKING_LABEL="claude-working"
DONE_LABEL="claude-pr-created"
FAILED_LABEL="claude-failed"
REJECTED_LABEL="claude-rejected"   # 受け付けない提案として閉じた印
HOLD_LABEL="claude-needs-review"   # PR に付ける。自動マージしなかった印

STATE="$HERE/state"
LOGS="$HERE/logs"
mkdir -p "$STATE" "$LOGS"
LOG="$LOGS/$(date +%F).log"
say() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

# --- 二重起動を防ぐ（開発は 10 分を超えることがある。3 時間より古いロックは止まった跡として消す） ---
LOCK="$STATE/.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +180 2>/dev/null)" ]; then rm -rf "$LOCK"; mkdir "$LOCK" || exit 1
  else exit 0; fi
fi
trap 'rm -rf "$LOCK"' EXIT

# 作業場所は内蔵ディスク（launchd から動くプログラムは、許可なしに外付けディスクを読めないため）。
# 空きが少ないときは、Issue に印を付ける前にやめる（次の回にまた試す）
FREE_MB=$(df -m "$HOME" | awk 'NR==2{print $4}')
if [ "${FREE_MB:-0}" -lt "$MIN_FREE_MB" ]; then say "ディスクの空きが ${FREE_MB}MB しかないので、着手しません"; exit 0; fi
if [ ! -d "$WORK_DIR/.git" ]; then
  say "作業用のリポジトリを $WORK_DIR に作ります"
  git clone -q "https://github.com/$REPO.git" "$WORK_DIR" >> "$LOG" 2>&1 || { say "clone に失敗"; rm -rf "$WORK_DIR"; exit 0; }
fi
git -C "$WORK_DIR" fetch -q origin main >> "$LOG" 2>&1 || { say "git fetch に失敗（着手しません）"; exit 0; }

# --- 1 日の上限 ---
TODAY_COUNT_FILE="$STATE/count-$(date +%F)"
COUNT=$(cat "$TODAY_COUNT_FILE" 2>/dev/null || echo 0)
[ "$COUNT" -ge "$DAILY_LIMIT" ] && exit 0
find "$STATE" -name 'count-*' -mtime +7 -delete 2>/dev/null

# --- 1) 未着手の Issue を探す（古い順に 1 件） ---
NUMBER=$(gh issue list -R "$REPO" --state open --label "$SOURCE_LABEL" --limit 50 \
  --json number,labels,createdAt \
  --jq "[.[] | select([.labels[].name] | (index(\"$WORKING_LABEL\") or index(\"$DONE_LABEL\") or index(\"$FAILED_LABEL\") or index(\"$REJECTED_LABEL\")) | not)] | sort_by(.createdAt) | .[0].number // empty" 2>>"$LOG")
[ -z "$NUMBER" ] && exit 0

say "=== Issue #$NUMBER に着手します"
echo $((COUNT + 1)) > "$TODAY_COUNT_FILE"
gh issue edit "$NUMBER" -R "$REPO" --add-label "$WORKING_LABEL" >> "$LOG" 2>&1

fail() {
  say "失敗: $1"
  gh issue edit "$NUMBER" -R "$REPO" --remove-label "$WORKING_LABEL" --add-label "$FAILED_LABEL" >> "$LOG" 2>&1
  gh issue comment "$NUMBER" -R "$REPO" --body "Mac の Claude が自動で開発しようとしましたが、うまくいきませんでした（$1）。人が確認します。" >> "$LOG" 2>&1
  exit 1
}

# --- 受付：開発に回してよい提案か、道具を持たない Claude に判定させる ---
gh issue view "$NUMBER" -R "$REPO" --json title,body > "$STATE/issue.json" 2>>"$LOG" || fail "Issue を読めない"
SPROMPT=$(node "$HERE/render-prompt.mjs" "$HERE/screen-prompt.md" "$STATE/issue.json" "$NUMBER") || fail "受付の指示を作れない"
say "受付の Claude を起動します"
caffeinate -i timeout 600 claude -p "$SPROMPT" \
  --permission-mode dontAsk \
  --allowedTools "" \
  --disallowedTools "Bash,Read,Edit,Write,Glob,Grep,WebFetch,WebSearch" \
  --setting-sources project \
  --strict-mcp-config \
  --output-format json \
  > "$STATE/screen-out.json" 2>>"$LOG" || fail "受付の判定が途中で終わりました"
SCREEN=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.result??""))}catch{}' "$STATE/screen-out.json")
echo "$SCREEN" >> "$LOG"
SFIRST=$(printf '%s\n' "$SCREEN" | grep -v '^```' | sed -n '/[^[:space:]]/{p;q;}')
if [ "$SFIRST" != "OK" ]; then
  REASON="${SFIRST#REJECT:}"
  [ -n "$REASON" ] && [ "$REASON" != "$SFIRST" ] || REASON=" 受け付けられない内容と判定しました"
  say "受け付けない提案として閉じます:$REASON"
  gh issue edit "$NUMBER" -R "$REPO" --remove-label "$WORKING_LABEL" --add-label "$REJECTED_LABEL" >> "$LOG" 2>&1
  gh issue comment "$NUMBER" -R "$REPO" --body "この提案は開発しません。理由:$REASON
（リポジトリの設定やルールを変えるもの、攻撃につながるもの、アプリやデータを消すものなどは受け付けていません。判定が間違っている場合は、管理者がラベル claude-rejected を外して開き直してください）" >> "$LOG" 2>&1
  gh issue close "$NUMBER" -R "$REPO" --reason "not planned" >> "$LOG" 2>&1
  exit 0
fi

# --- 2) 作業用のリポジトリを main の最新にする ---
BRANCH="issue/$NUMBER"
cd "$WORK_DIR" || fail "作業フォルダに入れない"
git reset -q --hard && git clean -qfd >> "$LOG" 2>&1
git checkout -q -B "$BRANCH" origin/main >> "$LOG" 2>&1 || fail "ブランチの作成に失敗"

# 依存パッケージは package-lock.json が変わったときだけ入れ直す
LOCK_HASH=$(shasum package-lock.json | cut -d' ' -f1)
if [ "$(cat "$STATE/npm-lock-hash" 2>/dev/null)" != "$LOCK_HASH" ] || [ ! -d node_modules ]; then
  say "npm ci を実行します"
  npm ci >> "$LOG" 2>&1 || fail "npm ci に失敗"
  echo "$LOCK_HASH" > "$STATE/npm-lock-hash"
fi

# --- 3) Claude に開発させる ---
PROMPT=$(node "$HERE/render-prompt.mjs" "$HERE/prompt.md" "$STATE/issue.json" "$NUMBER") || fail "プロンプトを作れない"

ALLOWED="Read,Edit,Write,Glob,Grep,Bash(npm run check),Bash(npm run typecheck),Bash(git status),Bash(git diff:*),Bash(git log:*)"
say "Claude を起動します"
caffeinate -i timeout "$CLAUDE_TIMEOUT" claude -p "$PROMPT" \
  --permission-mode dontAsk \
  --allowedTools "$ALLOWED" \
  --disallowedTools "WebFetch,WebSearch,Bash(gh:*),Bash(git push:*),Bash(curl:*)" \
  --setting-sources project \
  --strict-mcp-config \
  --output-format json \
  > "$STATE/claude-out.json" 2>>"$LOG"
RC=$?
say "Claude が終わりました（code $RC）"
RESULT=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.result??""))}catch{}' "$STATE/claude-out.json")
echo "$RESULT" >> "$LOG"
[ $RC -eq 0 ] || fail "Claude が途中で終わりました（code $RC）"

FIRST=$(printf '%s\n' "$RESULT" | sed -n '/[^[:space:]]/{p;q;}' | sed 's/^```.*//')
case "$FIRST" in
  SKIP:*)
    say "Claude は変更しませんでした: $FIRST"
    gh issue edit "$NUMBER" -R "$REPO" --remove-label "$WORKING_LABEL" --add-label "$FAILED_LABEL" >> "$LOG" 2>&1
    gh issue comment "$NUMBER" -R "$REPO" --body "Mac の Claude は、この提案ではコードを変えませんでした。理由: ${FIRST#SKIP:}" >> "$LOG" 2>&1
    exit 0 ;;
esac

# --- 4) 確認してから、コミット・プッシュ・PR ---
git add -A
CHANGED=$(git diff --cached --name-only)
[ -n "$CHANGED" ] || fail "変更がありませんでした"
FORBIDDEN=$(printf '%s\n' "$CHANGED" | grep -E '^(\.github/|scripts/|ios/|wrangler\.jsonc$|package(-lock)?\.json$|\.dev\.vars)' || true)
[ -z "$FORBIDDEN" ] || fail "変えてはいけないファイルが変わっていました: $(echo $FORBIDDEN)"
npm run check >> "$LOG" 2>&1 || fail "npm run check が通りませんでした"

TITLE=$(node -e '
  const r=process.argv[1].replace(/^\s*```[^\n]*\n/,"").replace(/\n```\s*$/,"");
  const m=r.match(/^\s*TITLE:\s*(.+)$/m); process.stdout.write((m?m[1].trim():"").slice(0,200));' "$RESULT")
BODY=$(node -e '
  const r=process.argv[1].replace(/^\s*```[^\n]*\n/,"").replace(/\n```\s*$/,"");
  process.stdout.write(r.replace(/^\s*TITLE:.*\n?/m,"").trim());' "$RESULT")
[ -n "$TITLE" ] || TITLE="Issue #$NUMBER の提案を実装"

git -c user.name="$GIT_NAME" -c user.email="$GIT_EMAIL" commit -q -m "$TITLE" -m "Issue #$NUMBER の提案を、Mac の Claude が自動で実装しました。" >> "$LOG" 2>&1 || fail "コミットに失敗"
git -c credential.helper= -c credential.helper='!gh auth git-credential' push -q -f origin "$BRANCH" >> "$LOG" 2>&1 || fail "プッシュに失敗"

PR_BODY="$BODY

---
Closes #$NUMBER

アプリの議論から作られた Issue を、Mac の Claude（scripts/issue-worker）が自動で実装しました。CI が通り、自動レビューで問題がなければ自動でマージします。"
PR_URL=$(gh pr create -R "$REPO" --base main --head "$BRANCH" --title "$TITLE" --body "$PR_BODY" 2>>"$LOG") || fail "PR の作成に失敗"
say "PR を作りました: $PR_URL"

# --- 5) Issue に印を付ける ---
gh issue edit "$NUMBER" -R "$REPO" --remove-label "$WORKING_LABEL" --add-label "$DONE_LABEL" >> "$LOG" 2>&1
gh issue comment "$NUMBER" -R "$REPO" --body "Mac の Claude が実装して、プルリクエストを作りました: $PR_URL" >> "$LOG" 2>&1

# --- 6) 自動マージ（条件を満たさなければ PR を残して人に任せる） ---
hold() {
  say "自動マージしません: $1"
  gh pr comment "$PR_URL" -R "$REPO" --body "自動マージはしませんでした（$1）。人が確認してマージしてください。" >> "$LOG" 2>&1
  gh pr edit "$PR_URL" -R "$REPO" --add-label "$HOLD_LABEL" >> "$LOG" 2>&1
  exit 0
}

# migrations/ はマージするとそのまま本番の DB に適用されるので、人が確認する
printf '%s\n' "$CHANGED" | grep -q '^migrations/' && hold "データベースの変更（migrations/）を含むため"

# CI（check）の結果を待つ。PR を作った直後はチェックがまだ登録されていないことがある
# （登録前は「no checks reported」で成功扱いになるので、check ジョブの行が出るまで待つ）
CHECK_FOUND=""
for _ in $(seq 1 30); do
  if gh pr checks "$PR_URL" -R "$REPO" 2>/dev/null | grep -q "^check"$'\t'; then CHECK_FOUND=1; break; fi
  sleep 20
done
[ -n "$CHECK_FOUND" ] || hold "CI が始まらなかったため"
timeout 1800 gh pr checks "$PR_URL" -R "$REPO" --watch --interval 20 --fail-fast >> "$LOG" 2>&1 || hold "CI が通らなかったため"

# 別の Claude に、読むだけの権限でレビューさせる
git diff origin/main...HEAD > "$STATE/pr.diff"
[ "$(wc -c < "$STATE/pr.diff")" -le 300000 ] || hold "差分が大きすぎて自動レビューできないため"
RPROMPT=$(node "$HERE/render-prompt.mjs" "$HERE/review-prompt.md" "$STATE/issue.json" "$NUMBER" "$STATE/pr.diff") || hold "レビューの指示を作れないため"
say "レビューの Claude を起動します"
caffeinate -i timeout 1200 claude -p "$RPROMPT" \
  --permission-mode dontAsk \
  --allowedTools "Read,Glob,Grep" \
  --disallowedTools "Bash,Edit,Write,WebFetch,WebSearch" \
  --setting-sources project \
  --strict-mcp-config \
  --output-format json \
  > "$STATE/review-out.json" 2>>"$LOG" || hold "自動レビューが途中で終わったため"
VERDICT=$(node -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j.result??""))}catch{}' "$STATE/review-out.json")
echo "$VERDICT" >> "$LOG"
VFIRST=$(printf '%s\n' "$VERDICT" | grep -v '^```' | sed -n '/[^[:space:]]/{p;q;}')
[ "$VFIRST" = "APPROVE" ] || hold "自動レビューが承認しなかったため: ${VFIRST#REJECT:}"

# レビューのあとに main やブランチが動いていたらやめる（レビューした差分と同じものだけをマージする）
HEAD_SHA=$(git rev-parse HEAD)
gh pr merge "$PR_URL" -R "$REPO" --merge --delete-branch --match-head-commit "$HEAD_SHA" >> "$LOG" 2>&1 || hold "マージできなかったため"
say "マージしました: $PR_URL"
exit 0
