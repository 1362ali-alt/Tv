"""Decode a named resource of the v2 APK (2.7.2.06) with every ID resolved.

The v2 build is obfuscated with AndResGuard: res/*.xml files have short random
names, so the layout for e.g. `activity_ping_server` has to be found through the
resource table (id -> value = file path) instead of by filename.

    python3 analysis/decode_v2.py layout/activity_ping_server layout/activity_welcome
    LOC=fa python3 analysis/decode_v2.py layout/activity_welcome_style_other
    python3 analysis/decode_v2.py --idmap          # dump id -> (type,name)
"""
import sys, os, re, json, functools
from loguru import logger as lg; lg.remove()
from androguard.core.apk import APK
from androguard.core.axml import AXMLPrinter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(HERE, "res_decoded_v2")
APK_PATH = os.environ.get(
    "APK2", os.path.join(ROOT, "google_drive", "iptv3_2.7.2.06PARDIK_SMART_IPTV.apk"))
apk = APK(APK_PATH)
arsc = apk.get_android_resources()
pkg = arsc.get_packages_names()[0]
pub = arsc.get_public_resources(pkg)
if isinstance(pub, bytes):
    pub = pub.decode()
idmap = {}                                  # id -> (type, name)
named = {}                                  # (type, name) -> id
for t, n, i in re.findall(r'<public\s+type="([^"]+)"\s+name="([^"]+)"\s+id="(0x[0-9a-f]+)"', pub):
    idmap[int(i, 16)] = (t, n)
    named[(t, n)] = int(i, 16)
LOCALE = os.environ.get("LOC", "")


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


def value_of(rid):
    """First configured value of a resource id (used to find a layout's file)."""
    try:
        confs = arsc.get_resolved_res_configs(rid)
        for c, v in confs:
            if isinstance(v, str) and v.startswith("res"):
                return v
        return confs[0][1] if confs else None
    except Exception:
        return None


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
        if line.startswith('<') and not line.startswith('</') and not line.endswith('/>') \
                and not line.startswith('<?'):
            ind += 1
    return '\n'.join(out)


def dump_idmap():
    os.makedirs(OUT, exist_ok=True)
    json.dump({str(k): list(v) for k, v in idmap.items()},
              open(os.path.join(OUT, "idmap.json"), "w"))
    json.dump({"%s/%s" % k: v for k, v in named.items()},
              open(os.path.join(OUT, "named.json"), "w"))
    print("idmap:", len(idmap), "->", OUT)


def main(argv):
    for arg in argv:
        if arg.startswith("res/"):
            path = arg
        else:
            t, n = (arg.split("/", 1) + [None])[:2]
            rid = named.get((t, n))
            if not rid:
                print("!! no such resource:", arg)
                continue
            path = value_of(rid)
            if not path:
                print("!! no file for", arg)
                continue
        print("#" * 25, arg, "->", path)
        try:
            print(decode(apk.get_file(path)))
        except Exception as e:
            print("<!-- error %r -->" % (e,))


if __name__ == "__main__":
    a = sys.argv[1:]
    if not a or a[0] == "--idmap":
        dump_idmap()
        main(a[1:])
    else:
        main(a)
