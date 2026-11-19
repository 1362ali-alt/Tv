#!/usr/bin/env bash
# Fetches EVERY runtime dependency of the portable build into vendor/, so the
# PORTABLE zip needs zero internet on the target machine:
#
#   vendor/python/     Windows embeddable CPython 3.12.8 (mirror repo on GitHub)
#   vendor/ffmpeg.exe  static FFmpeg build from the imageio-ffmpeg PyPI wheel
#   vendor/vlc/        portable VLC (PortableApps mirror repo on GitHub),
#                      locales pruned to fa*/en* to keep the zip < 100 MB
#
# All sources are reachable from the build sandbox's allowlist (github.com,
# pypi.org/files.pythonhosted.org). Re-runs are cheap: existing vendor parts
# are kept. NEVER commit vendor/ (see .gitignore) - it is ~250 MB of binaries.
set -e
cd "$(dirname "$0")/.."
mkdir -p vendor/src

# --- 1. Python 3.12.8 embeddable (Windows x64) -----------------------------
if [ ! -f vendor/python/python.exe ]; then
    if [ ! -d vendor/src/pym ]; then
        git clone -q --depth 1 \
            https://github.com/dm1495122-dot/python-3.12.8-embeddable-amd64 \
            vendor/src/pym
    fi
    mkdir -p vendor/python
    (cd vendor/src/pym && tar cf - --exclude=.git --exclude=.gitignore \
        --exclude=.gitattributes .) | (cd vendor/python && tar xf -)
    # drop stdlib parts a pure-stdlib backend never imports (~400 KB)
    python3 - <<'TRIM'
import zipfile
src = "vendor/python/python312.zip"
drop = ("test/", "lib2to3/", "pydoc_data/", "idlelib/", "tkinter/",
        "ensurepip/", "venv/")
zin = zipfile.ZipFile(src)
keep = [i for i in zin.infolist()
        if not any(i.filename.startswith(d) for d in drop)]
with zipfile.ZipFile(src + ".new", "w", zipfile.ZIP_DEFLATED) as zout:
    for i in keep:
        zout.writestr(i, zin.read(i.filename))
zin.close()
import os, shutil
shutil.move(src + ".new", src)
print("python312.zip trimmed to", os.path.getsize(src))
TRIM
    echo "vendor/python ready: $(du -sh vendor/python | cut -f1)"
fi

# --- 2. FFmpeg static exe (imageio-ffmpeg wheel; URL resolved from PyPI) ---
# 0.4.9 (ffmpeg 4.4) is used instead of the newest wheel: same RTSP/H.264/
# HEVC/AAC/TS support the app needs, 22 MB compressed instead of 39 MB - the
# difference keeps the fully-bundled portable zip under the 100 MB limits.
FFWHEEL_VER="${FFWHEEL_VER:-0.4.9}"
if [ ! -f vendor/ffmpeg.exe ]; then
    whl="vendor/src/imageio_ffmpeg-${FFWHEEL_VER}-py3-none-win_amd64.whl"
    if [ ! -f "$whl" ]; then
        url=$(curl -s "https://pypi.org/pypi/imageio-ffmpeg/${FFWHEEL_VER}/json" |
              python3 -c "import json,sys; print([f['url'] for f in json.load(sys.stdin)['urls'] if 'win_amd64' in f['filename']][0])")
        echo "downloading $url"
        curl -sL -o "$whl" "$url"
    fi
    python3 - "$whl" <<'PY'
import sys, zipfile, shutil, os
z = zipfile.ZipFile(sys.argv[1])
exe = [n for n in z.namelist() if n.endswith(".exe")][0]
with z.open(exe) as src, open("vendor/ffmpeg.exe", "wb") as dst:
    shutil.copyfileobj(src, dst)
print("vendor/ffmpeg.exe from", exe, os.path.getsize("vendor/ffmpeg.exe"))
PY
fi

# --- 3. Portable VLC --------------------------------------------------------
if [ ! -f vendor/vlc/vlc.exe ]; then
    if [ ! -d vendor/src/vlc ]; then
        git clone -q --depth 1 \
            https://github.com/Daniel-Paschoalinoto/vlc-portable vendor/src/vlc
    fi
    mkdir -p vendor/vlc
    cp -r vendor/src/vlc/App/vlc/. vendor/vlc/
    # prune translations except Persian/English (41 MB -> ~2 MB)
    find vendor/vlc/locale -mindepth 1 -maxdepth 1 -type d \
        ! -name 'fa*' ! -name 'en*' -exec rm -rf {} +
    # prune playback-irrelevant plugin groups (~17 MB): streaming OUTPUT,
    # service discovery, visualizations, skins, muxers, lua extensions.
    # Everything the player needs stays: codec, access (rtsp/udp/http),
    # demux, packetizer, stream_filter (hls), video_output, audio_*, gui/qt.
    rm -rf vendor/vlc/plugins/access_output vendor/vlc/plugins/stream_out \
           vendor/vlc/plugins/services_discovery vendor/vlc/plugins/visualization \
           vendor/vlc/plugins/mux vendor/vlc/plugins/lua \
           vendor/vlc/plugins/gui/libskins2_plugin.dll \
           vendor/vlc/lua vendor/vlc/hrtfs
    echo "vendor/vlc ready: $(du -sh vendor/vlc | cut -f1)"
fi
echo "fetch_portable_deps: done"
