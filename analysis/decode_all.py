import os, re, json, functools, sys
from loguru import logger as lg; lg.remove()
from androguard.core.apk import APK
from androguard.core.axml import AXMLPrinter
apk = APK("google_drive/iptv3_2.7.1.71_20251223_10.21.0.10_name_PARDIK_SMART_IPTV.apk")
arsc = apk.get_android_resources(); pkg = arsc.get_packages_names()[0]
pub = arsc.get_public_resources(pkg)
if isinstance(pub, bytes): pub = pub.decode()
idmap = {}
for t,n,i in re.findall(r'<public\s+type="([^"]+)"\s+name="([^"]+)"\s+id="(0x[0-9a-f]+)"', pub):
    idmap[int(i,16)] = (t,n)
strings = json.load(open("analysis/res_decoded/strings_by_locale.json"))
LOCALES = ["default","en","fa"]
def sval(name):
    r=[]
    for L in LOCALES:
        v = strings.get(L,{}).get(name)
        if v: r.append("%s:%s"%(L,v))
    return "; ".join(r)
@functools.lru_cache(maxsize=None)
def resolve(rid):
    t,n = idmap.get(rid,(None,None))
    if not t: return "@0x%08x"%rid
    if t=="string": return "{%s}"%sval(n)
    if t in ("drawable","mipmap"): return "@%s/%s"%(t,n)
    return "@%s/%s"%(t,n)
def decode(data):
    xml = AXMLPrinter(data).get_xml().decode("utf-8","replace")
    xml = re.sub(r'"@([0-9A-Fa-f]{8})"', lambda m: '"'+resolve(int(m.group(1),16))+'"', xml)
    xml = re.sub(r'\sxmlns:\w+="[^"]*"','',xml)
    out=[];ind=0
    for line in re.sub(r'>\s*<','>\n<',xml).split('\n'):
        line=line.strip()
        if not line: continue
        if line.startswith('</'): ind-=1
        out.append('  '*max(0,ind)+line)
        if line.startswith('<') and not line.startswith('</') and not line.endswith('/>') and not line.startswith('<?'): ind+=1
    return '\n'.join(out)
resfiles = json.load(open("analysis/res_decoded/res_files.json"))
os.makedirs("analysis/ui", exist_ok=True)
n=0
for t in ("layout","xml","anim","animator"):
    for name, paths in resfiles.get(t,{}).items():
        if t=="layout" and name.startswith(("abc_","design_","mtrl_","material_","notification_","exo_","cast_","browser_","preference_","custom_dialog","ime_","indeterminate_","icon_content","m3_","search_","select_dialog","side_","support_","swipe_","test_","text_view_","chip_","hide_","show_","path_")):
            continue
        for p in paths[:1]:
            try: data = apk.get_file(p)
            except Exception: continue
            open("analysis/ui/%s__%s.xml"%(t,name),"w",encoding="utf-8").write(decode(data))
            n+=1
print("decoded UI files:", n)
