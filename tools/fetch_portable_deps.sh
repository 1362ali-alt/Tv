#!/usr/bin/env bash
# Fetches EVERY runtime dependency of the portable build into vendor/, so the
# PORTABLE zip needs zero internet on the target machine:
#
#   vendor/python/     Windows embeddable CPython 3.12.8 (mirror repo on GitHub)
#   vendor/ffmpeg.exe  static FFmpeg build from the imageio-ffmpeg PyPI wheel
#   vendor/vlc/        portable VLC (PortableApps mirror repo on GitHub),
#                      locales pruned to fa*/en* to keep the zip < 100 MB
#
# Supply chain: OFFICIAL sources are tried first (python.org embeddable zip,
# get.videolan.org win64 zip, PyPI wheel verified against the PyPI JSON
# sha256). The GitHub mirrors are the FALLBACK for build sandboxes whose
# network only allows github.com - mirror commits are pinned below and every
# fetched binary's sha256 lands in vendor/PROVENANCE.txt, which ships inside
# the portable zip so anyone can verify what was bundled. Re-runs are cheap:
# existing vendor parts are kept. NEVER commit vendor/ (see .gitignore).
PY_MIRROR_COMMIT="${PY_MIRROR_COMMIT:-9d36aea98fb98f803a6b3166b9d6fbff8c9e4bbf}"
VLC_MIRROR_COMMIT="${VLC_MIRROR_COMMIT:-7025703ef18c7a4bacb5b6ad588d367b86223607}"
set -e
cd "$(dirname "$0")/.."
mkdir -p vendor/src

# --- 1. Python 3.12.8 embeddable (Windows x64) -----------------------------
if [ ! -f vendor/python/python.exe ]; then
    off=vendor/src/python-3.12.8-embed-amd64.zip
    curl -sfL -o "$off" "https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip" || rm -f "$off"
    if [ -f "$off" ]; then
        echo "python: official python.org embeddable"
        mkdir -p vendor/python
        unzip -qo "$off" -d vendor/python
    else
        echo "python: official unreachable -> GitHub mirror @ $PY_MIRROR_COMMIT"
        if [ ! -d vendor/src/pym ]; then
            git clone -q https://github.com/dm1495122-dot/python-3.12.8-embeddable-amd64 vendor/src/pym
            (cd vendor/src/pym && git checkout -q "$PY_MIRROR_COMMIT" 2>/dev/null || true)
        fi
        mkdir -p vendor/python
        (cd vendor/src/pym && tar cf - --exclude=.git --exclude=.gitignore \
            --exclude=.gitattributes .) | (cd vendor/python && tar xf -)
    fi
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
        read -r url want < <(curl -s "https://pypi.org/pypi/imageio-ffmpeg/${FFWHEEL_VER}/json" |
              python3 -c "import json,sys; f=[f for f in json.load(sys.stdin)['urls'] if 'win_amd64' in f['filename']][0]; print(f['url'], f['digests']['sha256'])")
        echo "downloading $url"
        curl -sL -o "$whl" "$url"
        got=$(sha256sum "$whl" | cut -d' ' -f1)
        if [ "$got" != "$want" ]; then
            echo "FATAL: imageio-ffmpeg wheel sha256 mismatch: got $got want $want" >&2
            rm -f "$whl"; exit 1
        fi
        echo "wheel sha256 verified against PyPI JSON"
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
    offv=vendor/src/vlc-3.0.21-win64.zip
    curl -sfL -o "$offv" "https://get.videolan.org/vlc/3.0.21/win64/vlc-3.0.21-win64.zip" || rm -f "$offv"
    if [ -f "$offv" ]; then
        echo "vlc: official get.videolan.org win64 zip"
        mkdir -p vendor/vlc
        unzip -qo "$offv" -d vendor/vlc
    else
        echo "vlc: official unreachable -> GitHub mirror @ $VLC_MIRROR_COMMIT"
        if [ ! -d vendor/src/vlc ]; then
            git clone -q https://github.com/Daniel-Paschoalinoto/vlc-portable vendor/src/vlc
            (cd vendor/src/vlc && git checkout -q "$VLC_MIRROR_COMMIT" 2>/dev/null || true)
        fi
        mkdir -p vendor/vlc
        cp -r vendor/src/vlc/App/vlc/. vendor/vlc/
    fi
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
# --- provenance: what exactly was bundled, from where, with which hash -----
{
    echo "PARDIK IPTV portable - bundled dependency provenance"
    echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo
    echo "python:  Windows embeddable CPython 3.12.8"
    if [ -f vendor/src/python-3.12.8-embed-amd64.zip ]; then
        echo "  source: https://www.python.org/ftp/python/3.12.8/python-3.12.8-embed-amd64.zip"
        echo "  zip sha256: $(sha256sum vendor/src/python-3.12.8-embed-amd64.zip | cut -d' ' -f1)"
    else
        echo "  source: mirror github.com/dm1495122-dot/python-3.12.8-embeddable-amd64"
        echo "  mirror commit: $(git -C vendor/src/pym rev-parse HEAD 2>/dev/null || echo unknown)"
    fi
    echo "  python.exe sha256: $(sha256sum vendor/python/python.exe | cut -d' ' -f1)"
    echo
    echo "ffmpeg:  static build from imageio-ffmpeg ${FFWHEEL_VER} PyPI wheel"
    echo "  wheel sha256 verified against the PyPI JSON API at fetch time"
    echo "  ffmpeg.exe sha256: $(sha256sum vendor/ffmpeg.exe | cut -d' ' -f1)"
    echo
    echo "vlc:     portable VLC"
    if [ -f vendor/src/vlc-3.0.21-win64.zip ]; then
        echo "  source: https://get.videolan.org/vlc/3.0.21/win64/vlc-3.0.21-win64.zip"
        echo "  zip sha256: $(sha256sum vendor/src/vlc-3.0.21-win64.zip | cut -d' ' -f1)"
    else
        echo "  source: mirror github.com/Daniel-Paschoalinoto/vlc-portable (PortableApps layout)"
        echo "  mirror commit: $(git -C vendor/src/vlc rev-parse HEAD 2>/dev/null || echo unknown)"
    fi
    echo "  vlc.exe sha256: $(sha256sum vendor/vlc/vlc.exe | cut -d' ' -f1)"
} > vendor/PROVENANCE.txt
cat vendor/PROVENANCE.txt
echo "fetch_portable_deps: done"
