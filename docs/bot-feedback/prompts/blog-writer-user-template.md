---
type: user-message-template
source: blog-writer.html (assembleUserMessage)
updated: 2026-04-10
---

# 블로그 글 유저 메시지 템플릿

`/api/generate` 호출 시 `messages` 배열의 유저 메시지는 아래 순서로 조립합니다. 뚝딱툴 웹사이트도 완전히 동일한 형식을 씁니다.

## 조립 순서

```
★ 글쓴이: "{industry}" — 이 입장에 충실하게, 본인이 직접 경험한 1인칭 글을 쓰세요.
대상(예상 독자): {target}
지역: {location}                        ← 선택 (비어있으면 이 줄 생략)
오늘의 소재: {topic}
마무리 CTA: {ctaText}
나의 경험/요청사항: {memo}
톤: {selectedTone}

{toneGuideFullText}                      ← blog-writer-tones.md에서 선택한 톤 가이드 전체
```

## 필드 설명

| 필드 | 예시 | 설명 |
|------|------|------|
| `industry` | `"14년차 웨딩컨설팅 사업가"` | 글쓴이의 정체성. 1인칭 관점의 기반. |
| `target` | `"예비 신부, 30~35세"` | 예상 독자. |
| `location` | `"서울 강남구"` | 지역 기반 글이면 넣고, 아니면 생략. |
| `topic` | `"스드메 견적서 볼 때 꼭 확인해야 할 3가지"` | 오늘의 소재. 구체적일수록 좋음. |
| `ctaText` | `"무료 상담 문의"` 또는 `"자연스러운 마무리"` | CTA 방향. 명확하지 않으면 "자연스러운 마무리". |
| `memo` | `"최근 고객 사례: 견적서에 포함된 줄 알았던 본식 스냅이 추가 요금이었음"` | 운영자의 실제 경험/에피소드. **글의 신뢰도를 만드는 핵심**. |
| `selectedTone` | `"친근한 구어체"` | 톤 4종 중 택1. |
| `toneGuideFullText` | (blog-writer-tones.md의 해당 섹션) | 톤 가이드 전체 텍스트 복붙. |

## 완전한 예시

```
★ 글쓴이: "14년차 웨딩컨설팅 사업가" — 이 입장에 충실하게, 본인이 직접 경험한 1인칭 글을 쓰세요.
대상(예상 독자): 예비 신부, 30~35세
지역: 서울 강남구
오늘의 소재: 스드메 견적서 볼 때 꼭 확인해야 할 3가지
마무리 CTA: 무료 상담 문의
나의 경험/요청사항: 최근 고객 사례: 견적서에 포함된 줄 알았던 본식 스냅이 추가 요금이었음. 총 80만원 추가 지출.
톤: 친근한 구어체

【톤 가이드라인: 친근한 구어체】
- 말투: "~거든요", "~했어요", "~인 거죠", "~더라고요", "~잖아요", "~인데요", "~거 아시죠?" 등 실제 대화체
...(이하 blog-writer-tones.md의 친근한 구어체 섹션 전체)
```

## 호출 전체 예시 (Python)

```python
import httpx

# 1. 파일 로드
with open("docs/bot-feedback/prompts/blog-writer-naver-seo.md") as f:
    system_full = f.read()
    # frontmatter와 설명 부분 제거하고 "---" 구분자 이후의 프롬프트 본문만 추출
    system_prompt = system_full.split("---\n\n", 1)[1] if "---\n\n" in system_full else system_full

with open("docs/bot-feedback/prompts/blog-writer-tones.md") as f:
    tones_md = f.read()
    # "## 1. 친근한 구어체" 섹션의 코드 블록 내용을 추출
    # (구현은 적절히)

# 2. 유저 메시지 조립
user_msg = f"""★ 글쓴이: "{industry}" — 이 입장에 충실하게, 본인이 직접 경험한 1인칭 글을 쓰세요.
대상(예상 독자): {target}
오늘의 소재: {topic}
마무리 CTA: {cta_text}
나의 경험/요청사항: {memo}
톤: {selected_tone}

{tone_guide_text}"""

# 3. API 호출
response = httpx.post(
    "https://ddukddaktool.co.kr/api/generate",
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    },
    json={
        "model": "claude-sonnet-4-20250514",
        "max_tokens": 8192,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_msg}]
    },
    timeout=120
)

# 4. 응답 파싱 (Claude API 응답 구조)
data = response.json()
content_text = data["content"][0]["text"]

# 5. JSON 파싱 (시스템 프롬프트가 JSON으로 출력하라고 지시함)
import json, re
# Claude 응답 안에서 JSON 블록 추출 (균형 매칭)
json_match = re.search(r'\{[\s\S]*\}', content_text)
blog_data = json.loads(json_match.group(0))

# 6. 결과 활용
title = blog_data["title"]
hook = blog_data["hook"]
body = blog_data["body"]       # ← (사진: ...) 마커 8개 포함
cta = blog_data["cta"]
tags = blog_data["tags"]

# 7. 이미지 생성을 위해 body 전체를 /api/blog-image-pro로 전달
full_blog_text = f"{hook}\n\n{body}\n\n{cta}"
image_response = httpx.post(
    "https://ddukddaktool.co.kr/api/blog-image-pro",
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    json={
        "mode": "parse",
        "blogText": full_blog_text,
        "thumbnailText": "썸네일용 짧은 문구"
    },
    timeout=300
)
# → 8장의 이미지 URL이 응답에 포함됨
```

## 주의사항

1. **시스템 프롬프트는 그대로**: frontmatter 부분(`---`로 둘러싸인 메타데이터)을 제거하고 본문만 `system`에 넣으세요. 파일 안의 `# 제목`, `아래 내용...`, `---` 같은 설명 문구는 제거해도 되지만, 그대로 둬도 Claude가 무시합니다.

2. **톤 가이드는 유저 메시지 끝에**: 시스템 프롬프트가 아니라 **유저 메시지**의 마지막에 붙입니다. 뚝딱툴 웹도 동일.

3. **model**: 반드시 `claude-sonnet-4-20250514` 사용. 다른 모델은 품질이 떨어집니다.

4. **max_tokens**: `8192`. 글이 2500자 넘으니 8000+ 필요합니다.

5. **결과의 body를 그대로 /api/blog-image-pro로**: body에 이미지 마커 8개가 포함되어 있어 parse 모드가 정상 작동합니다. 별도로 `markers` 배열을 만들지 마세요.
