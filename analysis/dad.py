import sys, os, zipfile, logging, time
logging.disable(logging.CRITICAL)
from androguard.core.dex import DEX
from androguard.core.analysis.analysis import Analysis
from loguru import logger as _lg
_lg.remove()
from androguard.decompiler.decompiler import DecompilerDAD

APK = "google_drive/iptv3_2.7.1.71_20251223_10.21.0.10_name_PARDIK_SMART_IPTV.apk"
targets = sys.argv[1:]
z = zipfile.ZipFile(APK)
t0=time.time()
for n in ["classes.dex","classes2.dex","classes3.dex"]:
    raw = z.read(n)
    d = DEX(raw)
    vmx = Analysis()
    vmx.add(d)
    vmx.create_xref()
    dec = DecompilerDAD(d, vmx)
    d.set_decompiler(dec)
    print("loaded", n, "%.1fs"%(time.time()-t0), file=sys.stderr)
    for c in d.get_classes():
        name = c.get_name()[1:-1].replace('/', '.')
        if not any(name == t or name.startswith(t + '$') or name.startswith(t + '.') for t in targets):
            continue
        out = os.path.join("analysis/java_src", name + ".java")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        try:
            src = c.get_source()
        except Exception as e:
            src = "// decompile failed: %r\n" % (e,)
        with open(out, "w", encoding="utf-8") as f:
            f.write("// %s (%s)\n" % (name, n))
            f.write(src)
        print("wrote", out, len(src))
