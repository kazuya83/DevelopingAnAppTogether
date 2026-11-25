#!/bin/bash
# Issue を拾う仕組みを止めて、launchd の登録を消す（ログと作業用 worktree は残す）。
LABEL="com.kazuya83.minna-issue-worker"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "止めました: $LABEL"
