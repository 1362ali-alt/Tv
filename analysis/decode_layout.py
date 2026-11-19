import sys, os, re, json, functools
from loguru import logger as lg; lg.remove()
from androguard.core.apk import APK
from androguard.core.axml import AXMLPrinter

apk = APK("google_drive/iptv3_2.7.1.71_20251223_10.21.0.10_name_PARDIK_SMART_IPTV.apk")
arsc = apk.get_android_resources()
pkg = arsc.get_packages_names()[0]
pub = arsc.get_public_resources(pkg)
if isinstance(pub, bytes): pub = pub.decode()
idmap = {}
for t,n,i in re.findall(r'<public\s+type="([^"]+)"\s+name="([^"]+)"\s+id="(0x[0-9a-f]+)"', pub):
    idmap[int(i,16)] = (t,n)
resfiles = json.load(open("analysis/res_decoded/res_files.json"))
LOCALE = os.environ.get("LOC", "")

@functools.lru_cache(maxsize=None)
def resolve(rid):
    t,n = idmap.get(rid, (None,None))
    if not t: return "@0x%08x" % rid
    if t in ("string","color","dimen","bool","integer"):
        try:
            for c,v in arsc.get_resolved_res_configs(rid):
                cs = str(c)
                if LOCALE and ("'%s'"%LOCALE) in cs: return "%s=%s" % (n, v)
            confs = arsc.get_resolved_res_configs(rid)
            for c,v in confs:
                if str(c).strip("= ") in ("''","(0, 0, 0, 0, 0, 0, 0, 0, 0)"): return "%s=%s" % (n,v)
            return "%s=%s" % (n, confs[0][1] if confs else "?")
        except Exception: return "%s/%s" % (t,n)
    if t == "drawable":
        return "@drawable/%s" % n
    if t == "layout":
        return "@layout/%s" % n
    if t == "id": return "@+id/%s" % n
    if t == "style": return "@style/%s" % n
    if t == "array": return "@array/%s" % n
    if t == "mipmap": return "@mipmap/%s" % n
    return "@%s/%s" % (t,n)

def decode(data):
    xml = AXMLPrinter(data).get_xml().decode("utf-8","replace")
    def rep(m):
        return '"' + resolve(int(m.group(1),16)) + '"'
    xml = re.sub(r'"@([0-9A-Fa-f]{8})"', rep, xml)
    xml = re.sub(r'\sxmlns:\w+="[^"]*"', '', xml)
    # pretty print
    out=[]; ind=0
    for line in re.sub(r'>\s*<', '>\n<', xml).split('\n'):
        line=line.strip()
        if not line: continue
        if line.startswith('</'): ind-=1
        out.append('  '*max(0,ind)+line)
        if line.startswith('<') and not line.startswith('</') and not line.endswith('/>') and not line.startswith('<?'): ind+=1
    return '\n'.join(out)

name2file = {}
for t,d in resfiles.items():
    for n, paths in d.items():
        for p in paths: name2file[(t,n)] = p

for arg in sys.argv[1:]:
    if arg.startswith("res/"):
        data = apk.get_file(arg)
    else:
        t,n = (arg.split("/",1)+[""])[:2] if "/" in arg else ("layout", arg)
        f = name2file.get((t,n))
        if not f: print("!! not found", arg); continue
        data = apk.get_file(f)
    print("#"*30, arg)
    print(decode(data))
