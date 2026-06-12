"""수정안 제안 에이전트 — Claude API로 수정 코드 생성"""

import json
import os
from datetime import datetime
from pathlib import Path

try:
    import anthropic
except ImportError:
    anthropic = None


DEBUG_LOG_PATH = Path(__file__).parent.parent / "debug_log.md"

# 카테고리별 시스템 프롬프트 템플릿
PROMPT_TEMPLATES = {
    "API_ERROR": """당신은 뚝딱툴(naver-title-generator)의 API 디버깅 전문가입니다.

이 프로젝트는:
- Vercel Serverless Functions (Node.js)
- Claude API (Anthropic), FLUX (fal.ai), GPT Image 1 (OpenAI) 사용
- @upstash/redis로 세션/레이트리밋 관리

API 에러가 발생했습니다. 다음을 분석하고 수정안을 제시하세요:
1. 에러의 근본 원인
2. 구체적 수정 코드 (diff 형식)
3. 재발 방지를 위한 권장사항

주요 API 파일: api/generate.js, api/titles.js, api/blog-image.js, api/blog-image-pro.js, api/threads.js
환경변수: ANTHROPIC_API_KEY, FAL_KEY, OPENAI_API_KEY, KV_REST_API_URL, KV_REST_API_TOKEN""",

    "IMAGE_GEN": """당신은 뚝딱툴의 이미지 생성 파이프라인 디버깅 전문가입니다.

이미지 생성 구조:
- blog-image.js: FLUX Schnell (사진 전용, fal.ai)
- blog-image-pro.js: FLUX Realism (사진), GPT Image 1 high (데이터 차트), Nano Banana 2 (흐름도/포스터)
- Haiku가 블로그 글 맥락으로 영어 프롬프트 작성 → 이미지 API 호출
- 마커 최대 8장 제한 (프론트+백엔드)
- 썸네일: Canvas 오버레이 (crossOrigin='anonymous' 필수)

에러를 분석하고 수정 코드를 diff 형식으로 제시하세요.""",

    "ADSENSE": """당신은 웹사이트 광고(AdSense) 디버깅 전문가입니다.

뚝딱툴은 정적 HTML 사이트로 Google AdSense를 사용합니다.
- ads.txt는 루트에 위치
- 각 HTML 페이지에 adsbygoogle 스크립트 포함
- Vercel에서 정적 파일로 서빙

AdSense 관련 에러를 분석하고 해결방안을 제시하세요.""",

    "THREADS": """당신은 Meta Threads API 디버깅 전문가입니다.

뚝딱툴의 Threads 연동:
- api/threads.js: Meta Graph API를 통한 스레드 글 발행
- OAuth 인증 토큰 사용
- 텍스트 + 이미지 첨부 지원

Threads API 에러를 분석하고 수정안을 제시하세요.""",

    "BUILD": """당신은 Vercel 배포 디버깅 전문가입니다.

뚝딱툴 배포 환경:
- Vercel (Hobby/Pro plan)
- Serverless Functions: api/ 디렉토리
- 정적 파일: HTML, CSS, JS (루트)
- Node.js 런타임
- 환경변수: Vercel 대시보드에서 관리

빌드/배포 에러를 분석하고 수정안을 제시하세요.""",

    "UNKNOWN": """당신은 뚝딱툴(naver-title-generator) 풀스택 디버깅 전문가입니다.

프로젝트 구조:
- 프론트엔드: 정적 HTML (50+ 페이지), 라이트 테마
- 백엔드: Vercel Serverless Functions (api/ 디렉토리)
- DB: Upstash Redis (세션, 레이트리밋, 사용자 데이터)
- AI: Claude Sonnet 4 (글), FLUX (이미지), GPT Image 1 (프리미엄 이미지)

에러를 분석하고 가능한 원인과 수정안을 제시하세요.""",
}

USER_PROMPT_TEMPLATE = """다음 에러를 분석하고 수정안을 제시하세요.

**카테고리:** {category} ({category_desc})
**요약:** {summary}
**소스 파일:** {source}
**타임스탬프:** {timestamp}

**에러 메시지:**
```
{message}
```

**원본 로그:**
```
{raw}
```

수정안을 다음 JSON 형식으로 응답하세요:
{{
  "root_cause": "근본 원인 설명",
  "explanation": "수정 방법 요약 (한국어, 1-2문장)",
  "diff": "--- a/파일경로\\n+++ b/파일경로\\n@@ ... @@\\n 수정 내용 diff",
  "prevention": "재발 방지 권장사항"
}}"""


class FixSuggester:
    """에러에 대한 수정안을 Claude API로 생성"""

    def __init__(self):
        self.client = None
        if anthropic:
            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if api_key:
                self.client = anthropic.Anthropic(api_key=api_key)

    def suggest(self, error: dict) -> dict | None:
        """에러에 대한 수정안 생성"""
        category = error.get("category", "UNKNOWN")

        # Claude API 사용 가능하면 AI 수정안
        if self.client:
            return self._suggest_with_claude(error, category)

        # API 없으면 룰 기반 수정안
        return self._suggest_rule_based(error, category)

    def _suggest_with_claude(self, error: dict, category: str) -> dict | None:
        """Claude API로 수정안 생성"""
        system_prompt = PROMPT_TEMPLATES.get(category, PROMPT_TEMPLATES["UNKNOWN"])
        user_prompt = USER_PROMPT_TEMPLATE.format(
            category=category,
            category_desc=error.get("category_desc", ""),
            summary=error.get("summary", ""),
            source=error.get("source", "알 수 없음"),
            timestamp=error.get("timestamp", ""),
            message=error.get("message", ""),
            raw=error.get("raw", "")[:500],
        )

        try:
            response = self.client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=1024,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )

            text = response.content[0].text

            # JSON 추출
            json_match = None
            # ```json ... ``` 블록
            import re
            json_block = re.search(r"```json\s*(.*?)\s*```", text, re.S)
            if json_block:
                json_match = json_block.group(1)
            else:
                # { ... } 블록
                brace_match = re.search(r"\{.*\}", text, re.S)
                if brace_match:
                    json_match = brace_match.group(0)

            if json_match:
                result = json.loads(json_match)
                return {
                    "explanation": result.get("explanation", "수정안 생성 완료"),
                    "diff": result.get("diff"),
                    "root_cause": result.get("root_cause"),
                    "prevention": result.get("prevention"),
                    "source": "claude",
                }

            # JSON 파싱 실패 시 텍스트 그대로 반환
            return {
                "explanation": text[:200],
                "diff": None,
                "source": "claude",
            }

        except Exception as e:
            print(f"  [경고] Claude API 호출 실패: {e}")
            return self._suggest_rule_based(error, category)

    def _suggest_rule_based(self, error: dict, category: str) -> dict | None:
        """룰 기반 수정안 (API 없을 때 폴백)"""
        message = error.get("message", "").lower()
        summary = error.get("summary", "")

        rules = {
            "API_ERROR": {
                "rate": {
                    "keywords": ["rate limit", "429", "too many"],
                    "explanation": "API 요청 한도 초과. 재시도 로직(exponential backoff) 추가 또는 요청 간격 늘리기",
                },
                "key": {
                    "keywords": ["api_key", "key", "unauthorized", "401"],
                    "explanation": "API 키 확인 필요. Vercel 환경변수(ANTHROPIC_API_KEY, FAL_KEY, OPENAI_API_KEY) 설정 확인",
                },
                "timeout": {
                    "keywords": ["timeout", "etimedout"],
                    "explanation": "API 응답 타임아웃. Vercel Function maxDuration 설정 또는 API 호출 timeout 값 확인",
                },
            },
            "IMAGE_GEN": {
                "cors": {
                    "keywords": ["cors", "taint", "cross-origin"],
                    "explanation": "이미지 CORS 오류. img.crossOrigin='anonymous' 설정 또는 fetch blob 다운로드 방식 사용",
                },
                "marker": {
                    "keywords": ["marker", "exceed", "limit"],
                    "explanation": "마커 수 제한 초과. markers.slice(0, 8) 적용 확인 (프론트+백엔드 모두)",
                },
                "credit": {
                    "keywords": ["credit", "balance", "insufficient"],
                    "explanation": "이미지 API 크레딧 부족. fal.ai 또는 OpenAI 대시보드에서 잔액 확인",
                },
            },
            "ADSENSE": {
                "ads": {
                    "keywords": ["ads.txt", "adsense", "adsbygoogle"],
                    "explanation": "ads.txt 파일 확인 또는 AdSense 계정 상태 확인. Vercel 정적 파일 서빙 확인",
                },
            },
            "THREADS": {
                "auth": {
                    "keywords": ["auth", "token", "expired", "invalid"],
                    "explanation": "Meta API 토큰 만료. 토큰 재발급 후 환경변수 업데이트 필요",
                },
            },
            "BUILD": {
                "module": {
                    "keywords": ["module", "not found", "cannot find"],
                    "explanation": "의존성 누락. package.json 확인 후 npm install 재실행",
                },
                "timeout": {
                    "keywords": ["function_invocation_timeout", "timeout"],
                    "explanation": "Serverless Function 타임아웃. vercel.json에서 maxDuration 설정 확인 (최대 60초)",
                },
            },
        }

        category_rules = rules.get(category, {})
        for rule_name, rule in category_rules.items():
            for keyword in rule["keywords"]:
                if keyword in message:
                    return {
                        "explanation": rule["explanation"],
                        "diff": None,
                        "source": "rule",
                    }

        # 기본 폴백
        return {
            "explanation": f"[{category}] 에러가 감지되었습니다. 로그를 확인하고 해당 파일을 점검하세요.",
            "diff": None,
            "source": "fallback",
        }

    def log_to_file(self, error: dict, fix: dict):
        """debug_log.md에 에러 이력 기록"""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        entry = f"""
## [{error['category']}] {error.get('summary', 'N/A')}
- **시간:** {now}
- **소스:** {error.get('source', 'N/A')}
- **메시지:** `{error.get('message', '')[:100]}`
- **수정안:** {fix.get('explanation', 'N/A')}
"""
        if fix.get("diff"):
            entry += f"""- **Diff:**
```diff
{fix['diff']}
```
"""
        if fix.get("prevention"):
            entry += f"- **재발 방지:** {fix['prevention']}\n"

        entry += "---\n"

        # 파일이 없으면 헤더 생성
        if not DEBUG_LOG_PATH.exists():
            header = "# 뚝딱툴 디버그 로그\n\n> 자동 생성 — 디버깅 에이전트가 기록합니다.\n\n---\n"
            DEBUG_LOG_PATH.write_text(header, encoding="utf-8")

        with open(DEBUG_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(entry)

        print(f"  [기록] debug_log.md에 저장됨")
