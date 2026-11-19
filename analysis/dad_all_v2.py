import os, zipfile, time
from loguru import logger as _lg
_lg.remove()
from androguard.core.dex import DEX
from androguard.core.analysis.analysis import Analysis
from androguard.decompiler.decompiler import DecompilerDAD

APK = "google_drive/iptv3_2.7.2.06PARDIK_SMART_IPTV.apk"
PREFIX = ("com.dexin.wanchuan",)
OUT = "analysis/java_src_v2"
os.makedirs(OUT, exist_ok=True)
z = zipfile.ZipFile(APK)
names = [n for n in z.namelist() if n.startswith("classes") and n.endswith(".dex")]
names.sort()
t0 = time.time(); ok = fail = 0
for n in names:
    raw = z.read(n)
    d = DEX(raw)
    vmx = Analysis(); vmx.add(d); vmx.create_xref()
    d.set_decompiler(DecompilerDAD(d, vmx))
    print("loaded", n, "%.1fs" % (time.time()-t0), flush=True)
    for c in d.get_classes():
        name = c.get_name()[1:-1].replace('/', '.')
        if not name.startswith(PREFIX):
            continue
        out = os.path.join(OUT, name + ".java")
        try:
            src = c.get_source(); ok += 1
        except Exception as e:
            src = "// DECOMPILE FAILED: %r\n" % (e,); fail += 1
        with open(out, "w", encoding="utf-8") as f:
            f.write("// %s (%s)\n" % (name, n)); f.write(src)
    print("done", n, "ok=%d fail=%d %.1fs" % (ok, fail, time.time()-t0), flush=True)
print("TOTAL ok=%d fail=%d" % (ok, fail), flush=True)
