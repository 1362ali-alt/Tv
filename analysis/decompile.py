import sys, zipfile, os, logging
logging.disable(logging.CRITICAL)
from androguard.misc import AnalyzeAPK, AnalyzeDex
from androguard.core.dex import DEX

APK = "google_drive/iptv3_2.7.1.71_20251223_10.21.0.10_name_PARDIK_SMART_IPTV.apk"
targets = sys.argv[1:]

z = zipfile.ZipFile(APK)
dexes = []
for n in ["classes.dex","classes2.dex","classes3.dex"]:
    dexes.append((n, DEX(z.read(n))))

for n, d in dexes:
    for c in d.get_classes():
        name = c.get_name()[1:-1].replace('/', '.')
        if any(name == t or name.startswith(t + '$') or name.startswith(t+'.') for t in targets):
            out = os.path.join("analysis/java_src", name + ".java")
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out, "w", encoding="utf-8") as f:
                f.write("// class %s from %s\n" % (name, n))
                f.write(c.get_source())
            print("wrote", out)
