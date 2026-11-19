import sys, difflib, os
a='analysis/java_src'; b='analysis/java_src_v2'
for cls in sys.argv[1:]:
    pa=os.path.join(a, cls+'.java'); pb=os.path.join(b, cls+'.java')
    if not os.path.exists(pa) or not os.path.exists(pb):
        print(f"### {cls}: MISSING (v1={os.path.exists(pa)} v2={os.path.exists(pb)})"); continue
    la=open(pa,encoding='utf-8',errors='replace').read().splitlines()[1:]
    lb=open(pb,encoding='utf-8',errors='replace').read().splitlines()[1:]
    if la==lb:
        print(f"### {cls}: IDENTICAL"); continue
    print(f"### {cls}: DIFF ({len(la)} -> {len(lb)} lines)")
    for line in difflib.unified_diff(la, lb, 'v1/'+cls, 'v2/'+cls, lineterm='', n=2):
        print(line)
    print()
