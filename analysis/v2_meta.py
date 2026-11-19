import sys, collections
from loguru import logger as _lg
_lg.remove()
from androguard.misc import AnalyzeAPK

def dump(apk, tag):
    a, d, dx = AnalyzeAPK(apk)
    out = []
    out.append(f"### {tag}: {apk}")
    out.append(f"package={a.get_package()} versionName={a.get_androidversion_name()} versionCode={a.get_androidversion_code()}")
    out.append(f"minSdk={a.get_min_sdk_version()} targetSdk={a.get_target_sdk_version()} maxSdk={a.get_max_sdk_version()}")
    out.append(f"app_name={a.get_app_name()}")
    out.append("permissions=" + ", ".join(sorted(a.get_permissions())))
    out.append("features=" + ", ".join(sorted(a.get_features())))
    comps = [("activity", a.get_activities()), ("service", a.get_services()),
             ("receiver", a.get_receivers()), ("provider", a.get_providers())]
    for kind, items in comps:
        out.append(f"--- {kind} ({len(items)}) ---")
        for i in sorted(items): out.append(f"  {i}")
    out.append(f"launcher={a.get_main_activity()}")
    # class inventory by top package
    cnt = collections.Counter()
    names = collections.defaultdict(list)
    for dd in d:
        for c in dd.get_classes():
            n = c.get_name()[1:-1].replace('/', '.')
            top = '.'.join(n.split('.')[:3])
            cnt[top] += 1
            names[top].append(n)
    out.append("--- class packages ---")
    for k, v in cnt.most_common(60): out.append(f"  {v:5d}  {k}")
    txt = "\n".join(out)
    open(f"analysis/out/{tag}_meta.txt", "w").write(txt + "\n")
    import json
    json.dump({k: sorted(v) for k, v in names.items()}, open(f"analysis/out/{tag}_classes_by_pkg.json", "w"))
    print(txt[:4000])

dump(sys.argv[1], sys.argv[2])
