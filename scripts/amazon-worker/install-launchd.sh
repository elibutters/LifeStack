#!/usr/bin/env bash
# Installs a LaunchAgent that runs the snapshot every 15 minutes while you are logged in.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="com.lifestack.amazon-sync"
DEST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
mkdir -p "${HOME}/Library/LaunchAgents"
chmod +x "${HERE}/run.sh" "${HERE}/start-chrome.sh"
cat > "$DEST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${HERE}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${HERE}/run.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>900</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${HERE}/sync.log</string>
  <key>StandardErrorPath</key>
  <string>${HERE}/sync.log</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)" "$DEST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "installed ${DEST}"
echo "leave start-chrome.sh running, signed in to Amazon"
