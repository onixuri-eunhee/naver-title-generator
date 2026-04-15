#!/usr/bin/env python3
"""
Phase A-bis worker polling — detect new commits + signal dependent workers.

Runs every 30 min via launchd (see scripts/LAUNCHD_INSTALL.md).
Silent unless escalation conditions trigger macOS notification.

State: .claude/polling-state.json
Log:   .claude/polling.log
Signal: .worktrees/<worker>/.claude/INBOX.md (append-only)
"""

import json
import re
import subprocess
import sys
import time
from pathlib import Path

REPO_ROOT = Path("/Users/gong-eunhui/Desktop/naver-title-generator")
STATE_FILE = REPO_ROOT / ".claude" / "polling-state.json"
LOG_FILE = REPO_ROOT / ".claude" / "polling.log"

WORKERS = [
    "phase-a-bis-lib",
    "phase-a-bis-api",
    "phase-a-bis-remotion",
    "phase-a-bis-tests",
]

# filename pattern → list of workers that depend on it
FILE_DEPENDENCY_MAP = {
    r"lib/shortform/settings\.js$": [
        "phase-a-bis-api",
        "phase-a-bis-remotion",
        "phase-a-bis-tests",
    ],
    r"lib/shortform/cta-variants\.js$": [
        "phase-a-bis-remotion",
        "phase-a-bis-tests",
    ],
    r"lib/shortform/scene-timing\.js$": [
        "phase-a-bis-remotion",
    ],
    r"lib/shortform/prompt\.js$": [
        "phase-a-bis-tests",
    ],
    r"lib/shortform/error-messages\.js$": [
        "phase-a-bis-remotion",
        "phase-a-bis-tests",
    ],
    r"lib/shortform/parse-claude-json\.js$": [
        "phase-a-bis-tests",
    ],
    r"lib/shortform/reasoning-copy\.js$": [
        "phase-a-bis-api",
        "phase-a-bis-tests",
    ],
    r"lib/credit-service\.js$": [
        "phase-a-bis-tests",
    ],
}

SILENT_THRESHOLD_SECONDS = 30 * 60  # 30 minutes per user requirement


def log(msg):
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with open(LOG_FILE, "a") as f:
        f.write(f"[{ts}] {msg}\n")


def notify(title, msg):
    """macOS notification — only for escalation conditions."""
    log(f"NOTIFY: {title} — {msg}")
    safe_msg = msg.replace('"', '\\"')
    safe_title = title.replace('"', '\\"')
    try:
        subprocess.run(
            [
                "osascript",
                "-e",
                f'display notification "{safe_msg}" with title "A-bis Poll: {safe_title}"',
            ],
            check=False,
            timeout=5,
        )
    except Exception as e:
        log(f"Notify failed: {e}")


def git(worker, *args):
    """Run git command in worker worktree."""
    wt = REPO_ROOT / ".worktrees" / worker
    result = subprocess.run(
        ["git", *args],
        cwd=wt,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def load_state():
    if STATE_FILE.exists():
        try:
            with open(STATE_FILE) as f:
                return json.load(f)
        except Exception as e:
            log(f"State file corrupt, starting fresh: {e}")
            return {}
    return {}


def save_state(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)


def get_worker_state(worker):
    head = git(worker, "rev-parse", "HEAD")
    commit_time = int(git(worker, "log", "-1", "--format=%ct"))
    return {"head": head, "commit_time": commit_time}


def get_new_commits(worker, from_head, to_head):
    output = git(
        worker, "log", "--format=%H|%s", f"{from_head}..{to_head}"
    )
    if not output:
        return []
    commits = []
    for line in output.split("\n"):
        parts = line.split("|", 1)
        if len(parts) == 2:
            commits.append({"hash": parts[0], "subject": parts[1]})
    return commits


def get_commit_files(worker, commit_hash):
    output = git(worker, "show", "--name-only", "--format=", commit_hash)
    return [f for f in output.split("\n") if f.strip()]


def signal_dependent_workers(source_worker, commit_hash, files):
    """Append signal lines to .claude/INBOX.md of each dependent worker."""
    already_signaled = set()  # (dep_worker, file) dedup within one commit
    for file in files:
        for pattern, deps in FILE_DEPENDENCY_MAP.items():
            if re.search(pattern, file):
                for dep_worker in deps:
                    if dep_worker == source_worker:
                        continue
                    key = (dep_worker, file)
                    if key in already_signaled:
                        continue
                    already_signaled.add(key)
                    inbox = (
                        REPO_ROOT
                        / ".worktrees"
                        / dep_worker
                        / ".claude"
                        / "INBOX.md"
                    )
                    inbox.parent.mkdir(parents=True, exist_ok=True)
                    ts = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
                    signal = (
                        f"- [{ts}] 의존성 `{file}` ({commit_hash[:7]}) ready "
                        f"— 다음 작업 진행 가능 (from {source_worker})\n"
                    )
                    # Create file with header if new
                    if not inbox.exists():
                        with open(inbox, "w") as f:
                            f.write(
                                "# Worker INBOX\n\n"
                                "Polling auto-generated dependency signals. "
                                "Worker reads this file at prompt start.\n\n"
                            )
                    with open(inbox, "a") as f:
                        f.write(signal)
                    log(
                        f"SIGNAL → {dep_worker}: {file} "
                        f"from {source_worker}@{commit_hash[:7]}"
                    )


def check_escalations(state):
    """Notify user if any escalation condition triggers."""
    now = int(time.time())

    # (1) Worker silent > 30 min
    silent = []
    for worker, s in state.items():
        elapsed = now - s["commit_time"]
        if elapsed > SILENT_THRESHOLD_SECONDS:
            silent.append((worker, elapsed))
    if silent:
        parts = [f"{w.replace('phase-a-bis-', '#')}: {e // 60}min" for w, e in silent]
        notify("Silent worker(s)", ", ".join(parts))

    # (2) Deadlock — all workers have made zero new commits this poll
    # Only flag if 2+ consecutive polls show zero activity everywhere
    # (Requires state file tracking; simple version: flag if all 4 are silent >30min)
    if len(silent) == len(WORKERS):
        notify("Deadlock suspected", "All 4 workers silent > 30min")

    # (3) deny rule fire — heuristic: check git reflog for deny-related errors
    # Hard to detect automatically without worker-side logging. Skip for now.
    # Worker's Claude Code session will show deny errors to the user directly.

    # (4) spec ambiguity — requires worker-initiated flag. Skip autodetect.


def main():
    prev_state = load_state()
    new_state = {}
    new_commits_per_worker = {}

    for worker in WORKERS:
        try:
            current = get_worker_state(worker)
        except Exception as e:
            log(f"ERROR polling {worker}: {e}")
            continue

        new_state[worker] = current
        new_commits_per_worker[worker] = []

        prev = prev_state.get(worker)
        if prev and prev["head"] != current["head"]:
            try:
                commits = get_new_commits(worker, prev["head"], current["head"])
                new_commits_per_worker[worker] = commits
                log(
                    f"[{worker}] {len(commits)} new commits "
                    f"since {prev['head'][:7]}"
                )
                for commit in commits:
                    files = get_commit_files(worker, commit["hash"])
                    signal_dependent_workers(worker, commit["hash"], files)
            except Exception as e:
                log(f"ERROR processing commits for {worker}: {e}")

    save_state(new_state)
    check_escalations(new_state)

    total_new = sum(len(c) for c in new_commits_per_worker.values())
    log(f"Poll complete — {total_new} new commits processed")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        log(f"FATAL: {e}")
        notify("Poll script crashed", str(e)[:200])
        sys.exit(1)
