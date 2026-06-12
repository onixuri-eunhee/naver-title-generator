import os, re
from pathlib import Path

ROOT = Path(".")
PASS = "✅ PASS"; FAIL = "❌ FAIL"; WARN = "⚠️  WARN"
results = []; score = {"pass":0,"fail":0,"warn":0}

def check(label, cond, msg, level="fail"):
    s = PASS if cond else (FAIL if level=="fail" else WARN)
    results.append((s,label,msg))
    score["pass" if cond else level] += 1
    return cond

def rh(p):
    try: return open(p,encoding="utf-8").read()
    except: return ""

print("\n" + "="*55)
print("  뚝딱툴 애드센스 검수 리포트")
print("="*55)

print("\n[1] 필수 파일")
for f,m in [("ads.txt","ads.txt 없음"),("robots.txt","robots.txt 없음"),
            ("sitemap.xml","sitemap.xml 없음"),("privacy.html","privacy.html 없음"),
            ("terms.html","terms.html 없음"),("about.html","about.html 없음"),
            ("contact.html","contact.html 없음")]:
    check(f,(ROOT/f).exists(),m)

print("\n[2] ads.txt 내용")
a=rh(ROOT/"ads.txt")
check("퍼블리셔ID","ca-pub-4973804132466200" in a,"퍼블리셔ID 없음")
check("DIRECT","DIRECT" in a,"DIRECT 없음")

print("\n[3] 애드센스 코드")
PID="ca-pub-4973804132466200"
no_ads=[f.name for f in ROOT.glob("*.html") if PID not in rh(f) and "adsbygoogle" not in rh(f)]
check("index.html 코드",PID in rh(ROOT/"index.html") or "adsbygoogle" in rh(ROOT/"index.html"),"index.html 코드 없음")
print(f"    → 코드 없는 페이지 {len(no_ads)}개: {no_ads[:5]}")

print("\n[4] 칼럼")
cols=list(ROOT.glob("column-*.html"))
print(f"    칼럼 수: {len(cols)}개")
short=[f.name for f in cols if len(re.sub(r'<[^>]+>',' ',rh(f)))<1500]
check("칼럼 분량",len(short)==0,f"1500자 미만 {len(short)}개",level="warn")

print("\n[5] 내부 링크")
idx=rh(ROOT/"index.html")
check("column.html 링크","column.html" in idx,"index→칼럼 링크 없음",level="warn")
check("privacy 링크","privacy" in idx,"index→privacy 없음")

print("\n[6] 메타태그")
for p in ["index.html","column.html"]:
    c=rh(ROOT/p)
    if c: check(f"{p} description",'name="description"' in c,f"{p} description 없음")

print("\n" + "="*55)
for s,l,m in results:
    if "FAIL" in s or "WARN" in s: print(f"  {s} [{l}] {m}")
t=sum(score.values())
print(f"\n  통과 {score['pass']}/{t} | FAIL {score['fail']}개 | WARN {score['warn']}개")
print("="*55+"\n")
