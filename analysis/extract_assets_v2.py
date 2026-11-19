import os, re, json, zipfile, hashlib
from loguru import logger as lg; lg.remove()
from androguard.core.apk import APK

APK2 = "google_drive/iptv3_2.7.2.06PARDIK_SMART_IPTV.apk"
OUT = "windows_app/app_assets/img"
IDX = "windows_app/app_assets/img_index.json"
os.makedirs(OUT, exist_ok=True)

def rnames(rclass):
    p = f"analysis/java_src_v2/com.dexin.wanchuan.iptv3.R${rclass}.java"
    t = open(p, encoding='utf-8', errors='replace').read()
    return sorted(set(re.findall(r'\bint\s+(\w+)\s*=', t)))

apk = APK(APK2)
arsc = apk.get_android_resources()
pkg = arsc.get_packages_names()[0]
z = zipfile.ZipFile(APK2)
old = json.load(open(IDX)) if os.path.exists(IDX) else {}
new_index = {}
stats = {'extracted': 0, 'unchanged': 0, 'changed': 0, 'new': 0, 'skipped': 0}
report = []
for rclass in ('mipmap', 'drawable'):
    for name in rnames(rclass):
        try:
            rid = arsc.get_res_id_by_key(pkg, rclass, name)
        except Exception:
            rid = None
        if not rid:
            stats['skipped'] += 1; continue
        try:
            confs = arsc.get_resolved_res_configs(rid)
        except Exception:
            confs = []
        # prefer default/no-dpi, else highest dpi
        best = None
        for cfg, path in confs:
            s = str(cfg)
            if best is None:
                best = (cfg, path)
            if 'xxhdpi' in s or 'anydpi' in s:
                best = (cfg, path)
        if not best:
            stats['skipped'] += 1; continue
        cfg, path = best
        if not path.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
            stats['skipped'] += 1; continue
        key = f"{rclass}/{name}"
        ext = os.path.splitext(path)[1].lower()
        dest = os.path.join(OUT, f"{rclass}__{name}{ext}")
        try:
            data = z.read(path)
        except KeyError:
            stats['skipped'] += 1; continue
        prev = None
        if os.path.exists(dest):
            prev = open(dest, 'rb').read()
        if prev == data:
            stats['unchanged'] += 1
        else:
            open(dest, 'wb').write(data)
            stats['extracted'] += 1
            if prev is None:
                stats['new'] += 1; report.append(f"NEW   {key} -> {os.path.basename(dest)} ({len(data)} B)")
            else:
                stats['changed'] += 1; report.append(f"CHG   {key} -> {os.path.basename(dest)} ({len(prev)} -> {len(data)} B)")
        new_index[key] = f"app_assets/img/{os.path.basename(dest)}"
# keep v1-only entries whose files still exist (do not lose art the UI may reference)
kept = 0
for k, v in old.items():
    if k not in new_index:
        p = os.path.join('windows_app', v)
        if os.path.exists(p):
            new_index[k] = v; kept += 1
json.dump(new_index, open(IDX, 'w'), ensure_ascii=False, indent=1, sort_keys=True)
print("stats:", stats, "index entries:", len(new_index), "v1-only kept:", kept)
print("\n".join(report))
