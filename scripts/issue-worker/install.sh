#!/bin/bash
# Issue を拾う仕組みを、この Mac に入れる（入れ直すときも同じコマンド）。
#   scripts/issue-worker/install.sh
# worker.sh などを ~/.local/share/minna-issue-worker にコピーし、launchd に 10 分おきの実行を登録する。
# リポジトリの scripts/issue-worker を変えたら、もう一度実行してコピーを新しくすること。
set -eu
export PATH="/opt/homebrew/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC_REPO_DIR="$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir | sed 's#/\.git$##')"
REPO="${REPO:-kazuya83/DevelopingAnAppTogether}"
INSTALL_DIR="$HOME/.local/share/minna-issue-worker"
LABEL="com.kazuya83.minna-issue-worker"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
INTERVAL="${INTERVAL:-600}"          # 秒。10 分おき
DAILY_LIMIT="${DAILY_LIMIT:-3}"      # 1 日に着手する Issue の上限
CLAUDE_TIMEOUT="${CLAUDE_TIMEOUT:-3600}"  # 1 件の開発にかけてよい秒数

mkdir -p "$INSTALL_DIR"
cp "$HERE/worker.sh" "$HERE/prompt.md" "$HERE/render-prompt.mjs" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/worker.sh"
cat > "$INSTALL_DIR/config.sh" <<CONF
REPO="$REPO"
SRC_REPO_DIR="$SRC_REPO_DIR"
WORK_DIR="$SRC_REPO_DIR.issue-worker"
DAILY_LIMIT=$DAILY_LIMIT
CLAUDE_TIMEOUT=$CLAUDE_TIMEOUT
CONF

# ラベル（既にあれば何もしない）
gh label create claude-working    -R "$REPO" --color FBCA04 --description "Mac の Claude が開発中" 2>/dev/null || true
gh label create claude-pr-created -R "$REPO" --color 0E8A16 --description "Mac の Claude が PR を作った" 2>/dev/null || true
gh label create claude-failed     -R "$REPO" --color 5319E7 --description "Mac の Claude が開発できなかった（人が確認）" 2>/dev/null || true

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
