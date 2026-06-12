#!/usr/bin/env python3
"""뚝딱툴 디버깅 에이전트 — CLI 진입점"""

import argparse
import sys
import signal

from adapters.ddukddak import VercelLogParser
from agents.analyzer import ErrorAnalyzer
from agents.suggester import FixSuggester
from agents.runner import TestRunner


def handle_sigint(sig, frame):
    print("\n\n[중단] 디버깅 에이전트를 종료합니다.")
    sys.exit(0)


signal.signal(signal.SIGINT, handle_sigint)


def mode_live():
    """Vercel 실시간 로그 감시 모드"""
    parser = VercelLogParser()
    analyzer = ErrorAnalyzer()
    suggester = FixSuggester()

    print("=" * 60)
    print("  뚝딱툴 디버거 — 실시간 로그 감시 모드")
    print("  Ctrl+C로 종료")
    print("=" * 60)

    for raw_line in parser.stream_live():
        parsed = parser.parse_line(raw_line)
        if not parsed:
            continue

        error = analyzer.classify(parsed)
        if not error:
            continue

        print(f"\n{'─' * 50}")
        print(f"[{error['category']}] {error['summary']}")
        print(f"  시간: {error['timestamp']}")
        print(f"  소스: {error['source']}")

        fix = suggester.suggest(error)
        if fix:
            print(f"\n  💡 수정 제안:")
            print(f"  {fix['explanation']}")
            if fix.get("diff"):
                print(f"\n{fix['diff']}")
            suggester.log_to_file(error, fix)


def mode_paste():
    """로그 직접 붙여넣기 분석 모드"""
    analyzer = ErrorAnalyzer()
    suggester = FixSuggester()
    parser = VercelLogParser()

    print("=" * 60)
    print("  뚝딱툴 디버거 — 로그 붙여넣기 분석 모드")
    print("  로그를 붙여넣고 빈 줄 2번으로 분석 시작")
    print("  'quit' 입력 시 종료")
    print("=" * 60)

    while True:
        print("\n로그를 붙여넣으세요:")
        lines = []
        empty_count = 0

        while True:
            try:
                line = input()
            except EOFError:
                break

            if line.strip() == "quit":
                print("\n[종료] 디버깅 에이전트를 종료합니다.")
                return

            if line.strip() == "":
                empty_count += 1
                if empty_count >= 2:
                    break
            else:
                empty_count = 0
                lines.append(line)

        if not lines:
            continue

        raw_log = "\n".join(lines)
        errors = []

        # 줄 단위 파싱
        for line in lines:
            parsed = parser.parse_line(line)
            if parsed:
                error = analyzer.classify(parsed)
                if error:
                    errors.append(error)

        # 줄 단위로 못 잡으면 전체 블록 분석
        if not errors:
            block_parsed = parser.parse_block(raw_log)
            if block_parsed:
                error = analyzer.classify(block_parsed)
                if error:
                    errors.append(error)

        if not errors:
            print("\n[정상] 에러가 감지되지 않았습니다.")
            continue

        print(f"\n[감지] 에러 {len(errors)}건 발견")

        for i, error in enumerate(errors, 1):
            print(f"\n{'─' * 50}")
            print(f"#{i} [{error['category']}] {error['summary']}")
            if error.get("timestamp"):
                print(f"  시간: {error['timestamp']}")
            if error.get("source"):
                print(f"  소스: {error['source']}")

            fix = suggester.suggest(error)
            if fix:
                print(f"\n  수정 제안: {fix['explanation']}")
                if fix.get("diff"):
                    print(f"\n{fix['diff']}")
                suggester.log_to_file(error, fix)


def mode_scan():
    """코드 정적 분석 모드"""
    analyzer = ErrorAnalyzer()
    suggester = FixSuggester()
    runner = TestRunner()

    print("=" * 60)
    print("  뚝딱툴 디버거 — 코드 정적 분석 모드")
    print("=" * 60)

    issues = runner.scan_project()

    if not issues:
        print("\n[정상] 코드에서 잠재적 문제가 발견되지 않았습니다.")
        return

    print(f"\n[스캔] 잠재적 문제 {len(issues)}건 발견")

    for i, issue in enumerate(issues, 1):
        print(f"\n{'─' * 50}")
        print(f"#{i} [{issue['category']}] {issue['summary']}")
        print(f"  파일: {issue['source']}")
        if issue.get("line"):
            print(f"  라인: {issue['line']}")

        fix = suggester.suggest(issue)
        if fix:
            print(f"\n  수정 제안: {fix['explanation']}")
            if fix.get("diff"):
                print(f"\n{fix['diff']}")
            suggester.log_to_file(issue, fix)


def main():
    parser = argparse.ArgumentParser(
        description="뚝딱툴 디버깅 에이전트",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
사용 예시:
  python debugger/main.py --mode live    # Vercel 실시간 로그 감시
  python debugger/main.py --mode paste   # 로그 붙여넣기 분석
  python debugger/main.py --mode scan    # 코드 정적 분석
        """,
    )
    parser.add_argument(
        "--mode",
        choices=["live", "paste", "scan"],
        default="paste",
        help="실행 모드 (기본: paste)",
    )

    args = parser.parse_args()

    modes = {
        "live": mode_live,
        "paste": mode_paste,
        "scan": mode_scan,
    }

    modes[args.mode]()


if __name__ == "__main__":
    main()
