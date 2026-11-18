import sys, re
def show(fn, maxlines=200):
    lines = open(fn, encoding='utf-8').read().split('\n')
    out=[]
    for ln in lines:
        # keep tag, id, text, src, hint
        m = re.match(r'^(\s*)<', ln)
        if not m: continue
        indent = m.group(1)
        tagm = re.match(r'\s*</?([\w.$]+)', ln); tag = tagm.group(1).split('.')[-1] if tagm else '?'; tag = ('/' if '/<'[::-1][:0] or ln.strip().startswith('</') else '')+tag
        idm = re.search(r'@(\+id/[\w]+|id/[\w]+)', ln)
        txt = re.search(r'\{(default|fa|en):([^;{}]*)', ln)
        src = re.search(r'@(drawable|mipmap)/([\w]+)', ln)
        vis = re.search(r'android:visibility="(\d)"', ln)
        parts=[tag]
        if idm: parts.append("#"+idm.group(1).split('/')[-1])
        if txt: parts.append('"'+txt.group(2).strip()[:40]+'"')
        if src: parts.append("img:"+src.group(2))
        if vis: parts.append("vis=%s"%vis.group(1))
        out.append(indent+" "+" ".join(parts))
    print('\n'.join(out[:maxlines]))
for f in sys.argv[1:]:
    print("="*30, f); show("analysis/ui/"+f)
