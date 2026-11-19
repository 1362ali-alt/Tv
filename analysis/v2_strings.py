import json, zipfile, collections, xml.etree.ElementTree as ET, os
from loguru import logger as _lg
_lg.remove()
from androguard.core.axml import ARSCParser

APKS = {
    'v1': "google_drive/iptv3_2.7.1.71_20251223_10.21.0.10_name_PARDIK_SMART_IPTV.apk",
    'v2': "google_drive/iptv3_2.7.2.06PARDIK_SMART_IPTV.apk",
}

def dump(apk):
    z = zipfile.ZipFile(apk)
    arsc = ARSCParser(z.read("resources.arsc"))
    pkg = arsc.get_packages_names()[0]
    per_locale = {}
    for loc in arsc.get_locales(pkg):
        key = 'default' if loc in ('\x00\x00', '') else loc
        xml = arsc.get_string_resources(pkg, loc)
        if not xml:
            continue
        try:
            root = ET.fromstring(xml)
        except Exception:
            continue
        d = {}
        for s in root.findall('string'):
            n = s.get('name')
            if n is not None:
                d[n] = (s.text or '')
        if d:
            per_locale[key] = d
    return per_locale

data = {}
for tag, apk in APKS.items():
    data[tag] = dump(apk)
    tot = sum(len(v) for v in data[tag].values())
    print(tag, 'locales=', len(data[tag]), 'strings total=', tot, 'default=', len(data[tag].get('default', {})))
os.makedirs('analysis/res_decoded_v2', exist_ok=True)
json.dump(data['v2'], open('analysis/res_decoded_v2/strings_by_locale.json', 'w'), ensure_ascii=False, indent=1)
json.dump(data['v1'], open('analysis/res_decoded_v2/strings_by_locale_v1.json', 'w'), ensure_ascii=False, indent=1)

# ---- diff ----
lines = []
for loc in ['default', 'fa', 'en', 'zh', 'zh-rTW', 'ar']:
    a = data['v1'].get(loc, {}); b = data['v2'].get(loc, {})
    if not a and not b:
        continue
    new = sorted(set(b) - set(a)); rem = sorted(set(a) - set(b))
    chg = sorted(k for k in set(a) & set(b) if a[k] != b[k])
    lines.append(f"=== locale {loc}: v1={len(a)} v2={len(b)} | new={len(new)} removed={len(rem)} changed={len(chg)} ===")
    for k in new: lines.append(f"  + {k} = {b[k]!r}")
    for k in rem: lines.append(f"  - {k} = {a[k]!r}")
    for k in chg: lines.append(f"  ~ {k}: {a[k]!r} -> {b[k]!r}")
    lines.append("")
open('analysis/out/v2_strings_diff.txt', 'w').write("\n".join(lines))
print("\n".join(lines[:80]))
