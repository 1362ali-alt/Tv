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
COMMIT=$(git -C /home/user/Tv rev-parse --short HEAD 2>/dev/null || echo unknown)
case "$MODE" in
  residential) OUT="dist/PARDIK-IPTV-RonikaPalace-Kohak-Win10-x64-${VER}-${COMMIT}.zip" ;;
  hotel)       OUT="dist/PARDIK-SMART-IPTV-Win10-x64-${VER}-${COMMIT}.zip" ;;
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
# every screenshot of the title bar must identify the exact build running
COMMIT=$(git -C /home/user/Tv rev-parse --short HEAD 2>/dev/null || echo unknown)
printf '{"commit": "%s", "date": "%s"}\n' "$COMMIT" "$(date -u +%Y%m%d-%H%M)" \
  > "$STAGE/PARDIK-SMART-IPTV/build_info.json"
# launch.ps1 reads mode.txt to pick the deployment flavour (IPTV_MODE)
printf '%s\r\n' "$MODE" > "$STAGE/PARDIK-SMART-IPTV/mode.txt"
if [ -f windows_app/headend.txt ]; then
    cp windows_app/headend.txt "$STAGE/PARDIK-SMART-IPTV/headend.txt"
fi
rm -rf "$STAGE/PARDIK-SMART-IPTV/app/_userdata"
find "$STAGE" -name "__pycache__" -type d -exec rm -rf {} +
cd "$STAGE"
zip -qr "/home/user/Tv/$OUT" PARDIK-SMART-IPTV
cd /home/user/Tv
rm -rf "$STAGE"
ls -la "$OUT"
python3 - "$OUT" "$MODE" "$COMMIT" <<'PY'
import hashlib, json, os, sys, zipfile
p, mode, commit = sys.argv[1], sys.argv[2], sys.argv[3]
b = open(p, "rb").read()
sha = hashlib.sha256(b).hexdigest()
print("entries =", len(zipfile.ZipFile(p).namelist()), "| bytes =", len(b))
print("sha256  =", sha)
# MANIFEST.json is what the in-app updater reads: one url, sha-verified swap
man_path = os.path.join(os.path.dirname(p) or ".", "MANIFEST.json")
man = {}
if os.path.exists(man_path):
    try:
        man = json.load(open(man_path, encoding="utf-8"))
    except Exception:
        man = {}
man[mode] = {"name": os.path.basename(p), "sha256": sha, "size": len(b),
             "commit": commit,
             "url": "https://raw.githubusercontent.com/1362ali-alt/Tv/"
                    "arena/8d696e12-tv/dist/" + os.path.basename(p)}
man["commit"] = commit
json.dump(man, open(man_path, "w", encoding="utf-8"), indent=1)
print("manifest updated:", man_path)
PY
