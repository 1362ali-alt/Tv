import sys, os, zipfile, time
from loguru import logger as _lg
_lg.remove()
from androguard.core.dex import DEX
from androguard.core.analysis.analysis import Analysis
from androguard.decompiler.decompiler import DecompilerDAD

APK = "google_drive/iptv3_2.7.1.71_20251223_10.21.0.10_name_PARDIK_SMART_IPTV.apk"
PREFIX = tuple(p.strip() for p in open("analysis/prefixes.txt") if p.strip())
OUT = "analysis/java_src"
z = zipfile.ZipFile(APK)
t0 = time.time()
ok = fail = 0
for n in ["classes.dex","classes2.dex","classes3.dex"]:
    d = DEX(z.read(n))
    vmx = Analysis(); vmx.add(d); vmx.create_xref()
    dec = DecompilerDAD(d, vmx); d.set_decompiler(dec)
    print("loaded", n, "%.1fs"%(time.time()-t0), flush=True)
    for c in d.get_classes():
        name = c.get_name()[1:-1].replace('/', '.')
        if not name.startswith(PREFIX): continue
        out = os.path.join(OUT, name + ".java")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        try:
            src = c.get_source(); ok += 1
        except Exception as e:
            src = "// DECOMPILE FAILED: %r\n" % (e,); fail += 1
        with open(out, "w", encoding="utf-8") as f:
            f.write("// %s (%s)\n" % (name, n)); f.write(src)
    print("done", n, "ok=%d fail=%d %.1fs"%(ok,fail,time.time()-t0), flush=True)
print("TOTAL ok=%d fail=%d"%(ok,fail))
