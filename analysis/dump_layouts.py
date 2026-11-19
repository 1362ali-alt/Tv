import os
from loguru import logger as lg; lg.remove()
from androguard.core.apk import APK
from androguard.core.axml import AXMLPrinter
apk = APK("google_drive/iptv3_2.7.1.71_20251223_10.21.0.10_name_PARDIK_SMART_IPTV.apk")
os.makedirs("analysis/layouts", exist_ok=True)
count = 0
for fn in apk.get_files():
    if fn.startswith("res/") and fn.endswith(".xml"):
        try:
            txt = AXMLPrinter(apk.get_file(fn)).get_xml().decode("utf-8", "replace")
        except Exception as e:
            txt = "<!-- error %r -->" % (e,)
        open("analysis/layouts/" + fn.replace("/", "__"), "w", encoding="utf-8").write(txt)
        count += 1
print("decoded:", count)
