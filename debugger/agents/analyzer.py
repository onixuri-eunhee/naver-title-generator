"""에러 분류 에이전트 — 로그를 카테고리별로 분류"""

import re
from datetime import datetime


# 카테고리 우선순위 (위가 높음)
CATEGORY_PRIORITY = [
    "API_ERROR",
    "IMAGE_GEN",
    "THREADS",
    "BUILD",
    "ADSENSE",
    "UNKNOWN",
]

# 카테고리별 한국어 설명
CATEGORY_DESC = {
    "API_ERROR": "API 호출 오류",
    "IMAGE_GEN": "이미지 생성 오류",
    "ADSENSE": "AdSense 로드 오류",
    "THREADS": "Threads API 오류",
    "BUILD": "빌드/배포 오류",
    "UNKNOWN": "미분류 오류",
}

# 카테고리별 패턴 (ddukddak.py의 ERROR_PATTERNS 재사용)
from adapters.ddukddak import ERROR_PATTERNS


class ErrorAnalyzer:
    """파싱된 로그를 에러 카테고리로 분류"""

    def classify(self, parsed: dict) -> dict | None:
        """파싱된 로그 데이터를 에러로 분류. 에러가 아니면 None 반환."""
        if not parsed or not parsed.get("message"):
            return None

        message = parsed["message"]
        raw = parsed.get("raw", message)

        # 카테고리 매칭
        matched_category = None
        matched_pattern = None

        for category in CATEGORY_PRIORITY:
            if category == "UNKNOWN":
                continue
            patterns = ERROR_PATTERNS.get(category, [])
            for pattern in patterns:
                if pattern.search(raw):
                    matched_category = category
                    matched_pattern = pattern.pattern
                    break
            if matched_category:
                break

        # 패턴에 안 걸렸지만 에러 레벨이면 UNKNOWN
        if not matched_category:
            if parsed.get("level") in ("error", "fatal"):
                matched_category = "UNKNOWN"
            else:
                return None

        # 요약 생성
        summary = self._make_summary(matched_category, message)

        return {
            "category": matched_category,
            "category_desc": CATEGORY_DESC.get(matched_category, "미분류"),
            "summary": summary,
            "message": message,
            "raw": raw,
            "timestamp": parsed.get("timestamp") or datetime.now().isoformat(),
            "source": parsed.get("source"),
            "line": parsed.get("line"),
            "matched_pattern": matched_pattern,
        }

    def _make_summary(self, category: str, message: str) -> str:
        """에러 메시지에서 핵심 요약 추출"""
        # HTTP 상태 코드
        status_match = re.search(r"(?:status|code)[:\s]*(\d{3})", message, re.I)
        status = status_match.group(1) if status_match else None

        # 타임아웃
        if re.search(r"timeout|ETIMEDOUT|FUNCTION_INVOCATION_TIMEOUT", message, re.I):
            return f"요청 타임아웃 발생" + (f" (HTTP {status})" if status else "")

        # API 키 누락
        if re.search(r"(API_KEY|key).*?(missing|undefined|invalid)", message, re.I):
            key_match = re.search(r"(ANTHROPIC|FAL|OPENAI|META)_?\w*KEY", message, re.I)
            key_name = key_match.group(0) if key_match else "API_KEY"
            return f"{key_name} 누락/무효"

        # Rate limit
        if re.search(r"rate.?limit|429|too.?many", message, re.I):
            return "API 요청 한도 초과 (Rate Limit)"

        # CORS
        if re.search(r"cors|cross.?origin|taint", message, re.I):
            return "CORS 정책 위반"

        # 모듈 미발견
        if re.search(r"(module|import|require).*?not.?found", message, re.I):
            mod_match = re.search(r"['\"]([^'\"]+)['\"]", message)
            mod_name = mod_match.group(1) if mod_match else "모듈"
            return f"모듈 '{mod_name}' 를 찾을 수 없음"

        # 기본: 메시지 앞부분 발췌
        clean = re.sub(r"\s+", " ", message).strip()
        if len(clean) > 80:
            clean = clean[:77] + "..."
        return clean
