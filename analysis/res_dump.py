import os, sys, json, collections
from loguru import logger as lg; lg.remove()
from androguard.core.axml import ARSCParser
from androguard.core.apk import APK
apk = APK("google_drive/iptv3_2.7.1.71_20251223_10.21.0.10_name_PARDIK_SMART_IPTV.apk")
arsc = apk.get_android_resources()
os.makedirs("analysis/res_decoded", exist_ok=True)
# id -> name map
idmap = {}
for pkg in arsc.get_packages_names():
    for rid, (name, t, confs) in arsc.get_id(pkg).items():
        pass
resmap = collections.defaultdict(dict)
for pkg in arsc.get_packages_names():
    ids = arsc.get_id(pkg)
    for rid, entry in ids.items():
        name, rtype, configs = entry
        resmap[(rtype,name)] = configs
# dump string resources
out = {}
for (rtype, name), configs in resmap.items():
    if rtype != 'string': continue
    d = {}
    for conf in configs:
        try: val = arsc.get_string(pkg, name, conf)
        except Exception: val = None
        d[conf] = val
    out[name] = d
json.dump(out, open("analysis/res_decoded/strings.json","w",encoding="utf-8"), ensure_ascii=False, indent=1)
print("strings:", len(out))
# dump layouts as xml
cnt=0
for (rtype, name), configs in resmap.items():
    if rtype != 'layout': continue
    for conf in configs:
        try:
            xml = arsc.get_resolved_res_configs(arsc.get_id(pkg)[None][0]) if False else None
        except Exception: xml=None
print("layouts:", len([1 for (t,n) in resmap if t=='layout']))
# map resource id -> file for all types
files = {}
for (rtype, name), configs in resmap.items():
    for conf in configs:
        try:
            v = arsc.get_res_configs(arsc.get_id(pkg)[None][0]) if False else None
        except Exception: v=None
json.dump({"types": sorted(set(t for (t,n) in resmap)),
           "counts": {t: len([1 for (tt,nn) in resmap if tt==t]) for t in set(t for (t,n) in resmap)}},
          open("analysis/res_decoded/summary.json","w"), indent=1)
print(open("analysis/res_decoded/summary.json").read())
