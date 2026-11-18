import sys, json, re
from loguru import logger as lg; lg.remove()
from androguard.core.apk import APK
apk = APK("google_drive/iptv3_2.7.1.71_20251223_10.21.0.10_name_PARDIK_SMART_IPTV.apk")
arsc = apk.get_android_resources()
pkg = arsc.get_packages_names()[0]
pub = arsc.get_public_resources(pkg)
if isinstance(pub, bytes): pub = pub.decode()
idmap = {}
for t,n,i in re.findall(r'<public\s+type="([^"]+)"\s+name="([^"]+)"\s+id="(0x[0-9a-f]+)"', pub):
    idmap[int(i,16)] = (t,n)
json.dump({str(k):list(v) for k,v in idmap.items()}, open("analysis/res_decoded/idmap.json","w"))
for arg in sys.argv[1:]:
    rid = int(arg,0)
    t,n = idmap.get(rid, ("?","?"))
    val = ""
    if t == "string":
        try:
            confs = arsc.get_resolved_res_configs(rid)
            val = " | ".join("%s=%s" % (str(c).strip() or "def", v) for c,v in confs[:4])
        except Exception as e: val = repr(e)
    print(f"0x{rid:08x} {rid} {t}/{n}  {val}")
