#!/usr/bin/env python3
"""Weekly audit: check tigor-ai and tigor-no-ai repo health."""
import subprocess, json

repos = [
    ("tigor-ai", "/opt/git/tigor-ai"),
    ("tigor-no-ai", "/opt/git/tigor-no-ai"),
]

for name, path in repos:
    try:
        head = subprocess.check_output(["git", "-C", path, "log", "-1", "--format=%h %s"], text=True)
        remotes = subprocess.check_output(["git", "-C", path, "remote", "-v"], text=True).strip()
        status = subprocess.check_output(["git", "-C", path, "status", "--short"], text=True).strip() or "clean"
        wt = subprocess.check_output(["git", "-C", path, "worktree", "list", "--porcelain"], text=True).strip()
        print(f"=== {name} ({path}) ===")
        print(f"HEAD: {head}")
        print(f"Remotes:\n{remotes}")
        print(f"Status: {status}")
        print(f"Worktrees:\n{wt or 'none'}")
        print()
    except Exception as e:
        print(f"=== {name} ERROR: {e} ===")

