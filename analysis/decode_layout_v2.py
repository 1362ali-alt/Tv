"""Decode res/*.xml of the v2 APK (2.7.2.06) with resource IDs resolved to
names/values, the same way analysis/decode_layout.py does for v1.

    python3 analysis/decode_layout_v2.py layout/activity_ping_server ...

Used to convert the tower software's own template (welcome / main / menu)
pixel-faithfully into the Windows port.
"""
import sys, os, re, json, functools
from loguru import logger as lg; lg.remove()
from androguard.core.apk import APK
from androguard.core.axml import AXMLPrinter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
APK_PATH = os.path.join(ROOT, "google_drive", "iptv3_2.7.2.06PARDIK_SMART_IPTV.apk")
apk = APK(APK_PATH)
arsc = apk.get_android_resources()
pkg = arsc.get_packages_names()[0]
pub = arsc.get_public_resources(pkg)
if isinstance(pub, bytes):
    pub = pub.decode()
idmap = {}
for t, n, i in re.findall(r'<public\s+type="([^"]+)"\s+name="([^"]+)"\s+id="(0x[0-9a-f]+)"', pub):
    idmap[int(i, 16)] = (t, n)
LOCALE = os.environ.get("LOC", "")

# resource name -> file path inside the apk
name2file = {}
for fn in apk.get_files():
    m = re.match(r"res/([^/]+)/([^/.]+)\.xml$", fn)
    if m:
        name2file.setdefault((m.group(1).split("-")[0], m.group(2)), []).append(fn)


@functools.lru_cache(maxsize=None)
def resolve(rid):
    t, n = idmap.get(rid, (None, None))
    if not t:
        return "@0x%08x" % rid
    if t in ("string", "color", "dimen", "bool", "integer"):
        try:
            confs = arsc.get_resolved_res_configs(rid)
            if LOCALE:
                for c, v in confs:
                    if ("'%s'" % LOCALE) in str(c):
                        return "%s=%s" % (n, v)
            for c, v in confs:
                if str(c).strip("= ") in ("''", "(0, 0, 0, 0, 0, 0, 0, 0, 0)"):
                    return "%s=%s" % (n, v)
            return "%s=%s" % (n, confs[0][1] if confs else "?")
        except Exception:
            return "%s/%s" % (t, n)
    return "@%s/%s" % (t, n)


def decode(data):
    xml = AXMLPrinter(data).get_xml().decode("utf-8", "replace")
    xml = re.sub(r'"@([0-9A-Fa-f]{8})"', lambda m: '"' + resolve(int(m.group(1), 16)) + '"', xml)
    xml = re.sub(r'\sxmlns:\w+="[^"]*"', '', xml)
    out, ind = [], 0
    for line in re.sub(r'>\s*<', '>\n<', xml).split('\n'):
        line = line.strip()
        if not line:
            continue
        if line.startswith('</'):
            ind -= 1
        out.append('  ' * max(0, ind) + line)
        if line.startswith('<') and not line.startswith('</') and not line.endswith('/>') and not line.startswith('<?'):
            ind += 1
    return '\n'.join(out)


def main(argv):
    if not argv:
        json.dump({str(k): list(v) for k, v in idmap.items()},
                  open(os.path.join(HERE, "res_decoded_v2", "idmap.json"), "w"))
        print("idmap written:", len(idmap))
        return
    for arg in argv:
        if arg.startswith("res/"):
            files = [arg]
        else:
            t, n = (arg.split("/", 1) + [""])[:2] if "/" in arg else ("layout", arg)
            files = name2file.get((t, n)) or []
            if not files:
                print("!! not found", arg)
                continue
        for f in files:
            print("#" * 30, f)
            try:
                print(decode(apk.get_file(f)))
            except Exception as e:
                print("<!-- error %r -->" % (e,))


if __name__ == "__main__":
    main(sys.argv[1:])
