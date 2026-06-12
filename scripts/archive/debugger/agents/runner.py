"""테스트 실행 & 코드 정적 분석 에이전트"""

import os
import re
from pathlib import Path

# 프로젝트 루트
PROJECT_ROOT = Path(__file__).parent.parent.parent

# 스캔 대상 API 파일
API_FILES = [
    "api/generate.js",
    "api/titles.js",
    "api/blog-image.js",
    "api/blog-image-pro.js",
    "api/threads.js",
    "api/auth.js",
]

# 스캔 대상 HTML (핵심만)
HTML_FILES = [
    "blog-writer.html",
    "blog-image.html",
    "blog-image-pro.html",
]

# 정적 분석 규칙
SCAN_RULES = [
    {
        "id": "hardcoded-key",
        "category": "API_ERROR",
        "pattern": re.compile(
            r"""(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{10,}['"]""",
            re.I,
        ),
        "summary": "하드코딩된 API 키/시크릿 감지",
        "exclude": re.compile(r"(ADMIN_KEY|8524|example|placeholder|test)", re.I),
    },
    {
        "id": "console-log",
        "category": "BUILD",
        "pattern": re.compile(r"console\.(log|debug)\("),
        "summary": "프로덕션 console.log 잔존",
        "severity": "warn",
    },
    {
        "id": "env-missing-check",
        "category": "API_ERROR",
        "pattern": re.compile(
            r"process\.env\.(ANTHROPIC_API_KEY|FAL_KEY|OPENAI_API_KEY|KV_REST_API_URL)"
        ),
        "check_fn": "_check_env_validation",
        "summary": "환경변수 누락 체크 없이 직접 사용",
    },
    {
        "id": "cors-missing",
        "category": "IMAGE_GEN",
        "pattern": re.compile(r"new\s+Image\(\)"),
        "check_fn": "_check_cors_attribute",
        "summary": "new Image()에 crossOrigin 미설정 가능성",
    },
    {
        "id": "unhandled-promise",
        "category": "BUILD",
        "pattern": re.compile(r"\.then\(.*\)\s*(?!\s*\.catch)"),
        "summary": ".catch() 없는 Promise 체인",
        "severity": "warn",
    },
    {
        "id": "marker-limit",
        "category": "IMAGE_GEN",
        "pattern": re.compile(r"markers?\b"),
        "check_fn": "_check_marker_limit",
        "summary": "마커 배열 8장 제한 미적용 가능성",
    },
]


class TestRunner:
    """코드 정적 분석 및 테스트 실행"""

    def scan_project(self) -> list[dict]:
        """프로젝트 전체 정적 분석"""
        issues = []

        # API 파일 스캔
        for rel_path in API_FILES:
            filepath = PROJECT_ROOT / rel_path
            if filepath.exists():
                file_issues = self._scan_file(filepath, rel_path)
                issues.extend(file_issues)

        # HTML 파일 스캔
        for rel_path in HTML_FILES:
            filepath = PROJECT_ROOT / rel_path
            if filepath.exists():
                file_issues = self._scan_file(filepath, rel_path)
                issues.extend(file_issues)

        # 환경변수 체크
        env_issues = self._check_env_vars()
        issues.extend(env_issues)

        # 중복 제거 (같은 파일, 같은 규칙)
        seen = set()
        unique_issues = []
        for issue in issues:
            key = (issue["source"], issue.get("rule_id", ""))
            if key not in seen:
                seen.add(key)
                unique_issues.append(issue)

        return unique_issues

    def _scan_file(self, filepath: Path, rel_path: str) -> list[dict]:
        """단일 파일 정적 분석"""
        issues = []

        try:
            content = filepath.read_text(encoding="utf-8")
        except Exception:
            return issues

        lines = content.split("\n")

        for rule in SCAN_RULES:
            for line_num, line in enumerate(lines, 1):
                match = rule["pattern"].search(line)
                if not match:
                    continue

                # 제외 패턴 체크
                if rule.get("exclude") and rule["exclude"].search(line):
                    continue

                # 커스텀 체크 함수
                if rule.get("check_fn"):
                    check_method = getattr(self, rule["check_fn"], None)
                    if check_method and not check_method(content, line_num, lines):
                        continue

                # warn 레벨은 API 파일에서만 보고
                if rule.get("severity") == "warn" and not rel_path.startswith("api/"):
                    continue

                issues.append({
                    "category": rule["category"],
                    "summary": rule["summary"],
                    "source": rel_path,
                    "line": line_num,
                    "message": line.strip()[:100],
                    "rule_id": rule["id"],
                    "raw": line.strip(),
                })

        return issues

    def _check_env_validation(self, content: str, line_num: int, lines: list) -> bool:
        """환경변수가 검증 없이 바로 사용되는지 체크"""
        # 주변 20줄 안에 if(!process.env) 또는 유사 검증이 있으면 OK
        start = max(0, line_num - 20)
        end = min(len(lines), line_num + 5)
        context = "\n".join(lines[start:end])

        if re.search(r"if\s*\(\s*!?\s*process\.env", context):
            return False
        if re.search(r"process\.env\.\w+\s*\|\|", lines[line_num - 1]):
            return False

        return True

    def _check_cors_attribute(self, content: str, line_num: int, lines: list) -> bool:
        """new Image() 이후 crossOrigin 설정이 있는지 체크"""
        # 아래 5줄 안에 crossOrigin이 있으면 OK
        end = min(len(lines), line_num + 5)
        following = "\n".join(lines[line_num:end])

        if "crossOrigin" in following:
            return False

        return True

    def _check_marker_limit(self, content: str, line_num: int, lines: list) -> bool:
        """마커 배열에 slice(0, 8) 제한이 적용되어 있는지 체크"""
        if "slice(0, 8)" in content or "slice(0,8)" in content:
            return False
        if ".length > 8" in content or ".length >= 8" in content:
            return False

        # markers 변수가 단순 참조면 무시
        line = lines[line_num - 1]
        if re.search(r"markers?\s*\.", line) and not re.search(r"markers?\s*=", line):
            return False

        return True

    def _check_env_vars(self) -> list[dict]:
        """필수 환경변수 설정 여부 체크"""
        issues = []
        required_vars = [
            "ANTHROPIC_API_KEY",
            "FAL_KEY",
            "OPENAI_API_KEY",
            "KV_REST_API_URL",
            "KV_REST_API_TOKEN",
        ]

        for var in required_vars:
            if not os.environ.get(var):
                issues.append({
                    "category": "API_ERROR",
                    "summary": f"환경변수 {var} 미설정 (로컬 환경)",
                    "source": ".env",
                    "message": f"{var}이(가) 현재 환경에 설정되어 있지 않습니다",
                    "rule_id": "env-missing",
                    "raw": f"os.environ['{var}'] = None",
                })

        return issues
