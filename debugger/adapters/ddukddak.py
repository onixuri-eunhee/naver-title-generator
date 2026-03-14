"""Vercel 로그 파싱 어댑터 — 뚝딱툴 전용"""

import re
import subprocess
import sys
from datetime import datetime


# 에러 패턴 (카테고리별)
ERROR_PATTERNS = {
    "API_ERROR": [
        re.compile(r"(claude|anthropic).*?(error|fail|timeout|429|500|503)", re.I),
        re.compile(r"(flux|fal\.ai|fal_key).*?(error|fail|timeout|429|500)", re.I),
        re.compile(r"(gpt.?image|openai|dall-?e).*?(error|fail|timeout|429|500)", re.I),
        re.compile(r"(haiku|sonnet|opus).*?(error|fail|timeout)", re.I),
        re.compile(r"API.*?(rate.?limit|quota|insufficient|unauthorized)", re.I),
        re.compile(r"(ANTHROPIC|FAL|OPENAI)_API_KEY.*?(missing|invalid|undefined)", re.I),
    ],
    "IMAGE_GEN": [
        re.compile(r"image.*?(timeout|generation.*?fail|credit)", re.I),
        re.compile(r"(nano.?banana|flux.?realism).*?(error|fail|timeout)", re.I),
        re.compile(r"(fal\.ai|fal_key).*?(credit|balance|insufficient)", re.I),
        re.compile(r"marker.*?(exceed|limit|overflow)", re.I),
        re.compile(r"canvas.*?(taint|cors|security)", re.I),
    ],
    "ADSENSE": [
        re.compile(r"ads\.txt", re.I),
        re.compile(r"(adsense|adsbygoogle).*?(error|fail|block)", re.I),
        re.compile(r"ad.*?slot.*?(empty|unfilled|error)", re.I),
    ],
    "THREADS": [
        re.compile(r"(threads|meta|instagram).*?(api|auth|token).*?(error|fail|expired|invalid)", re.I),
        re.compile(r"threads.*?(publish|post|create).*?(fail|error)", re.I),
    ],
    "BUILD": [
        re.compile(r"(vercel|build|deploy).*?(fail|error|crash)", re.I),
        re.compile(r"(module|import|require).*?(not.?found|missing|resolve)", re.I),
        re.compile(r"(serverless|function).*?(timeout|crash|oom)", re.I),
        re.compile(r"FUNCTION_INVOCATION_TIMEOUT", re.I),
    ],
}

# Vercel 로그 라인 포맷
VERCEL_LOG_RE = re.compile(
    r"(?P<timestamp>\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\s+"
    r"(?P<level>info|warn|error|debug)?\s*"
    r"(?P<message>.*)",
    re.I,
)

# 간단한 에러 키워드 (블록 파싱용)
BLOCK_ERROR_RE = re.compile(
    r"(Error|error|ERROR|FATAL|fatal|Exception|exception|"
    r"TypeError|ReferenceError|SyntaxError|"
    r"ECONNREFUSED|ETIMEDOUT|ENOTFOUND|"
    r"status.?(?:4\d{2}|5\d{2})|"
    r"UnhandledPromiseRejection|"
    r"Cannot read propert|"
    r"undefined is not)",
    re.I,
)


class VercelLogParser:
    """Vercel 로그를 파싱하여 구조화된 에러 데이터로 변환"""

    def parse_line(self, line: str) -> dict | None:
        """단일 로그 라인을 파싱"""
        line = line.strip()
        if not line:
            return None

        # 에러 키워드가 포함되어 있는지 빠른 체크
        if not BLOCK_ERROR_RE.search(line):
            return None

        result = {
            "raw": line,
            "timestamp": None,
            "level": None,
            "message": line,
            "source": None,
        }

        # Vercel 포맷 매칭 시도
        m = VERCEL_LOG_RE.match(line)
        if m:
            result["timestamp"] = m.group("timestamp")
            result["level"] = m.group("level")
            result["message"] = m.group("message").strip()

        # 소스 파일 추출
        file_match = re.search(r"(api/[\w\-]+\.js|[\w\-]+\.html)(?::(\d+))?", line)
        if file_match:
            result["source"] = file_match.group(1)
            if file_match.group(2):
                result["line"] = int(file_match.group(2))

        return result

    def parse_block(self, block: str) -> dict | None:
        """여러 줄의 로그 블록을 하나의 에러로 파싱"""
        if not block.strip():
            return None

        if not BLOCK_ERROR_RE.search(block):
            return None

        # 첫 번째 에러 라인 찾기
        error_line = None
        for line in block.split("\n"):
            if BLOCK_ERROR_RE.search(line):
                error_line = line.strip()
                break

        result = {
            "raw": block,
            "timestamp": datetime.now().isoformat(),
            "level": "error",
            "message": error_line or block[:200],
            "source": None,
        }

        # 소스 파일 추출
        file_match = re.search(r"(api/[\w\-]+\.js|[\w\-]+\.html)(?::(\d+))?", block)
        if file_match:
            result["source"] = file_match.group(1)
            if file_match.group(2):
                result["line"] = int(file_match.group(2))

        return result

    def stream_live(self):
        """Vercel 실시간 로그 스트리밍 (vercel logs --follow 래핑)"""
        print("[시작] Vercel 실시간 로그 감시 중...")
        print("  명령어: vercel logs --follow")

        try:
            proc = subprocess.Popen(
                ["vercel", "logs", "--follow"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError:
            print("[오류] Vercel CLI가 설치되어 있지 않습니다.")
            print("  설치: npm i -g vercel")
            sys.exit(1)

        try:
            for line in proc.stdout:
                yield line.strip()
        except KeyboardInterrupt:
            proc.terminate()
            raise
        finally:
            proc.terminate()
