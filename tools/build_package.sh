#!/usr/bin/env bash
# Build the Windows distribution zip.
set -e
cd "$(dirname "$0")/.."
VER="2.7.1.71"
OUT="dist/PARDIK-SMART-IPTV-Win10-x64-${VER}.zip"
rm -f "$OUT"
mkdir -p dist
# stage a clean copy
STAGE=$(mktemp -d)
mkdir -p "$STAGE/PARDIK-SMART-IPTV"
cp -r windows_app/app "$STAGE/PARDIK-SMART-IPTV/app"
cp -r windows_app/app_assets "$STAGE/PARDIK-SMART-IPTV/app_assets"
cp -r windows_app/install "$STAGE/PARDIK-SMART-IPTV/install"
cp -r windows_app/tools "$STAGE/PARDIK-SMART-IPTV/tools"
cp windows_app/PARDIK-SMART-IPTV.bat windows_app/PARDIK-SMART-IPTV-silent.vbs \
   windows_app/README-FA.md windows_app/README-EN.md "$STAGE/PARDIK-SMART-IPTV/"
rm -rf "$STAGE/PARDIK-SMART-IPTV/app/_userdata"
find "$STAGE" -name "__pycache__" -type d -exec rm -rf {} +
cd "$STAGE"
zip -qr "/home/user/Tv/$OUT" PARDIK-SMART-IPTV
cd /home/user/Tv
rm -rf "$STAGE"
ls -la "$OUT"
du -h "$OUT"
