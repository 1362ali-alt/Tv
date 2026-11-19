#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Extract the head-end address embedded in a Pardik IPTV APK.

The vendor bakes the factory head-end into `IptvConfig`
(DEFAULT_SERVER_IP / DEFAULT_SERVER_PORT / DEFAULT_RTSP_PORT); a re-packaged
per-building APK would carry the building's address in the same place. This
tool scans the raw DEX / resource / asset blobs of an APK for IPv4 literals
(and IP:port pairs), ranks them, and reports the private-range candidate that
the APK uses as its default - i.e. the address the Android box dials when no
setting and no UDP 27777 announcement overrides it.

Usage:
    python3 tools/extract_headend.py path/to/app.apk
    python3 tools/extract_headend.py path/to/app.apk --write windows_app/headend.txt

`headend.txt` is read by install\\launch.ps1 (line 1 = ip, line 2 = port) and
handed to the backend as IPTV_SERVER_IP / IPTV_SERVER_PORT, so a deployment can
bake its building address into the install without touching code.
"""
import collections
import re
import sys
import zipfile

IP = re.compile(rb"(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?(?![\d.])")

# addresses that ship with the vendor's own SDKs / debug builds and are never a
# deployment head-end (Baidu map CDNs, multicast groups, loopback, ...).
NOISE = ("127.0.0.1", "0.0.0.0", "239.255.", "224.0.", "255.255.", "182.61.",
         "119.75.", "180.97.", "180.76.", "223.5.", "115.239.")


def is_private(ip):
    return ip.startswith(("10.", "192.168.")) or any(
        ip.startswith("172.%d." % n) for n in range(16, 32))


def scan_apk(path):
    counts = collections.Counter()
    where = collections.defaultdict(set)
    with zipfile.ZipFile(path) as z:
        for name in z.namelist():
            if not (name.endswith((".dex", ".arsc", ".bin"))
                    or name.startswith(("assets/", "lib/", "okhttp3/"))
                    or name == "AndroidManifest.xml"):
                continue
            try:
                blob = z.read(name)
            except Exception:
                continue
            for m in IP.findall(blob):
                txt = m.decode("latin-1")
                ip = txt.split(":")[0]
                if any(ip.startswith(n) for n in NOISE):
                    continue
                if not all(0 <= int(p) <= 255 for p in ip.split(".")):
                    continue
                counts[txt] += 1
                where[txt].add(name)
    return counts, where


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    path = argv[1]
    write = argv[2] if len(argv) > 2 and argv[2] == "--write" else None
    counts, where = scan_apk(path)
    print("IPv4 literals inside %s (noise filtered):" % path)
    for txt, n in counts.most_common(12):
        ip = txt.split(":")[0]
        tag = "  <- private range (head-end candidate)" if is_private(ip) else ""
        print("  %-22s x%d  in: %s%s" % (txt, n, ",".join(sorted(where[txt]))[:60], tag))
    priv = [(t, n) for t, n in counts.items() if is_private(t.split(":")[0])]
    if not priv:
        print("\nno private-range address embedded; the APK relies on the UDP "
              "27777 announcement only.")
        return 1

    def score(item):
        txt, n = item
        ip, _, port = txt.partition(":")
        sc = n
        sc += 2 if len(where[txt]) > 1 else 0        # in several dex files = a constant
        sc += 1 if port in ("", "8030", "554") else -3  # vendor test URLs use odd ports
        return -sc
    priv.sort(key=score)
    best = priv[0][0]
    ip, _, port = best.partition(":")
    port = port or "8030"
    print("\nembedded default head-end: %s : %s  (RTSP 554)" % (ip, port))
    if write:
        with open(write, "w", encoding="utf-8") as f:
            f.write("%s\n%s\n" % (ip, port))
        print("written to %s (launch.ps1 feeds it to the backend)" % write)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
