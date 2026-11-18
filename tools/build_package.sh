#!/usr/bin/env bash
# Build the Windows distribution zip.
#
# Default build is Pardik's residential IPTV client for the Ronika Palace
# complex in Kahak (MODE=residential). MODE=hotel builds the same code with the
# hospitality platform switched on - only mode.txt and the file name differ.
set -e
cd "$(dirname "$0")/.."
VER="2.7.2.06"
MODE="${MODE:-residential}"
case "$MODE" in
  residential) OUT="dist/PARDIK-IPTV-RonikaPalace-Kohak-Win10-x64-${VER}.zip" ;;
  hotel)       OUT="dist/PARDIK-SMART-IPTV-Win10-x64-${VER}.zip" ;;
  *) echo "unknown MODE=$MODE (residential|hotel)" >&2; exit 1 ;;
esac
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
# launch.ps1 reads mode.txt to pick the deployment flavour (IPTV_MODE)
printf '%s\r\n' "$MODE" > "$STAGE/PARDIK-SMART-IPTV/mode.txt"
rm -rf "$STAGE/PARDIK-SMART-IPTV/app/_userdata"
find "$STAGE" -name "__pycache__" -type d -exec rm -rf {} +
cd "$STAGE"
zip -qr "/home/user/Tv/$OUT" PARDIK-SMART-IPTV
cd /home/user/Tv
rm -rf "$STAGE"
ls -la "$OUT"
python3 - "$OUT" <<'PY'
import hashlib, sys, zipfile
p = sys.argv[1]
b = open(p, "rb").read()
print("entries =", len(zipfile.ZipFile(p).namelist()), "| bytes =", len(b))
print("sha256  =", hashlib.sha256(b).hexdigest())
PY
