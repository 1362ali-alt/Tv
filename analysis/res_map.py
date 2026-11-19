import os, json, re
from loguru import logger as lg; lg.remove()
from androguard.core.apk import APK
apk = APK("google_drive/iptv3_2.7.1.71_20251223_10.21.0.10_name_PARDIK_SMART_IPTV.apk")
arsc = apk.get_android_resources()
pkg = arsc.get_packages_names()[0]
print("packages dict keys:", list(arsc.packages[pkg].keys()))
# find the id->name mapping
for k in arsc.packages[pkg]:
    v = arsc.packages[pkg][k]
    print(" ", k, type(v).__name__, (len(v) if hasattr(v,'__len__') else ''))
