#!/bin/bash
# Issue を拾う仕組みを、この Mac に入れる（入れ直すときも同じコマンド）。
#   scripts/issue-worker/install.sh
# worker.sh などを ~/.local/share/minna-issue-worker にコピーし、launchd に 10 分おきの実行を登録する。
# リポジトリの scripts/issue-worker を変えたら、もう一度実行してコピーを新しくすること。
set -eu
export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${REPO:-kazuya83/DevelopingAnAppTogether}"
INSTALL_DIR="$HOME/.local/share/minna-issue-worker"
LABEL="com.kazuya83.minna-issue-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
INTERVAL="${INTERVAL:-600}"          # 秒。10 分おき
DAILY_LIMIT="${DAILY_LIMIT:-3}"      # 1 日に着手する Issue の上限
CLAUDE_TIMEOUT="${CLAUDE_TIMEOUT:-3600}"  # 1 件の開発にかけてよい秒数
# 作業用のリポジトリ。内蔵ディスクに置く（launchd から動くプログラムは、許可なしに外付けディスクを読めない）
WORK_DIR="${WORK_DIR:-$HOME/work/minna-issue-worker}"
MIN_FREE_MB="${MIN_FREE_MB:-1500}"     # 内蔵ディスクの空きがこれより少ないときは着手しない

# コミットの作者。このリポジトリの main の最新コミットの作者（GitHub の noreply アドレス）を使う
GIT_NAME="${GIT_NAME:-$(git -C "$HERE" log -1 --format=%an origin/main)}"
GIT_EMAIL="${GIT_EMAIL:-$(git -C "$HERE" log -1 --format=%ae origin/main)}"

mkdir -p "$INSTALL_DIR"
# 動いている最中の worker.sh を上書きすると、bash が途中から壊れた中身を読むので、別名でコピーしてから入れ替える
for f in worker.sh prompt.md review-prompt.md render-prompt.mjs; do
  cp "$HERE/$f" "$INSTALL_DIR/.$f.new" && mv -f "$INSTALL_DIR/.$f.new" "$INSTALL_DIR/$f"
done
chmod +x "$INSTALL_DIR/worker.sh"
cat > "$INSTALL_DIR/config.sh" <<CONF
REPO="$REPO"
WORK_DIR="$WORK_DIR"
MIN_FREE_MB=$MIN_FREE_MB
GIT_NAME="$GIT_NAME"
GIT_EMAIL="$GIT_EMAIL"
DAILY_LIMIT=$DAILY_LIMIT
CLAUDE_TIMEOUT=$CLAUDE_TIMEOUT
CONF

# ラベル（既にあれば何もしない）
gh label create claude-working    -R "$REPO" --color FBCA04 --description "Mac の Claude が開発中" 2>/dev/null || true
gh label create claude-pr-created -R "$REPO" --color 0E8A16 --description "Mac の Claude が PR を作った" 2>/dev/null || true
gh label create claude-failed     -R "$REPO" --color 5319E7 --description "Mac の Claude が開発できなかった（人が確認）" 2>/dev/null || true
gh label create claude-needs-review -R "$REPO" --color D93F0B --description "自動マージしなかった PR（人が確認）" 2>/dev/null || true

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$INSTALL_DIR/worker.sh</string></array>
  <key>StartInterval</key><integer>$INTERVAL</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$INSTALL_DIR/logs/launchd.out</string>
  <key>StandardErrorPath</key><string>$INSTALL_DIR/logs/launchd.err</string>
</dict>
</plist>
PL
mkdir -p "$INSTALL_DIR/logs"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "入れました: $LABEL（${INTERVAL} 秒おき、1 日 ${DAILY_LIMIT} 件まで）"
echo "ログ: $INSTALL_DIR/logs/"
