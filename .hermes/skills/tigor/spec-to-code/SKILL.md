---
name: spec-to-code
category: software-development
description: Generate executable code from markdown specs using LLM bootstrap — polyglot files, validation pipelines, recursion guards.
tags:
  - llm-code-generation
  - polyglot
  - spec-compiler
  - bootstrap
---

# spec-to-code: LLM-assisted code generation from specs

Generate executable code from markdown specifications, either as pure skeletons (no LLM) or with LLM bootstrap (sends each task to LLM for implementation).

## When to use

- User wants a markdown spec that compiles to working code
- Need LLM to generate implementations from task descriptions
- Building self-documenting, self-compiling projects
- Want polyglot files that work as both docs and code

## Polyglot bash/python pattern

```bash
#!/usr/bin/env bash
''''true
# bash code here
export SOME_VAR="value"
exec python3 "$0" "$@"
exit 0
'''
import sys  # Python code starts here — imports BEFORE from __future__
# ...
```

Key: `''''true` ends the Python triple-quote string AND runs bash `true`. `'''` on the next bash line closes the string. Python sees `'''...'''` as a docstring.

## Architecture: two-stage pipeline

### Stage 0: LLM bootstrap
1. Parse spec (frontmatter + `##` headings as tasks)
2. For each task, prompt LLM to generate a `run_<name>()` function
3. Extract the generated function with regex (discard hallucinated extras)
4. Validate syntax with `compile(code, "<name>", "exec")`
5. On syntax error, replace with stub returning `{"status": "syntax_error"}`
6. Collect imports from full LLM response before any stripping
7. Assemble into a Python module with `main()` entry point

### Stage 2: Pure compiler
1. Parse spec, extract tasks
2. Generate stub `run_<name>()` functions with TODO comments
3. Assemble `main()` that calls all tasks, collecting results as dict
4. Output valid Python that runs without LLM

## LLM prompt pattern

```
Write ONLY a Python function `def {fname}(_this_file="") -> dict:` that implements:

Context: {spec_description}
Task: {task_name}
Details:
{task_body}

Rules:
- Pure function, no network, no filesystem writes beyond reading
- Only stdlib imports
- Return dict with results
- Handle errors gracefully with try/except
- If loading files from __compiled/, SKIP the file at _this_file to avoid recursion
- Output ONLY the function and its imports, nothing else
```

## Recursion guard

When compiled code can load other compiled modules (e.g., a `run_run()` that loads `__compiled/*.py`), pass `_this_file` to each task function so it can skip itself:

```python
# Module-level guard
if not globals().get("_main_guard", False):
    globals()["_main_guard"] = True
else:
    raise RuntimeError("Recursive main() call detected")

def main():
    _this_file = __file__ if "__file__" in globals() else ""
    for _fn in [...]:
        results[_fn] = globals()[_fn](_this_file)
```

The task function itself should check `_this_file`:

```python
def run_run(_this_file="") -> dict:
    skip_file = os.path.basename(_this_file) if _this_file else ""
    for filename in os.listdir("__compiled"):
        if filename == skip_file:
            continue
        # load and run this file
```

## LLM output processing

LLM output is unreliable. Process in this order:

1. Strip code fences: `re.sub(r"^```python\s*", "", code)` and `re.sub(r"```\s*$", "", code)`
2. Strip inner fences: `re.sub(r"```\w*\n", "", code)` (LLM sometimes wraps nested code)
3. Extract ONLY the target function: regex `(def target_fn.*?)(?=\ndef |if __name__|\Z)` with `re.DOTALL`
4. Collect imports from the FULL response before stripping: scan for lines starting with `import ` or `from `
5. Validate syntax: `compile(code, "<name>", "exec")` — on SyntaxError, replace with stub
6. Add stub for any task the LLM completely skipped

## Generated module structure

```python
"""<name> — compiled by tigorc at <timestamp>"""
import json
import os      # collected from LLM output
import re      # collected from LLM output
DESCRIPTION = '<spec description>'

def run_task_a(_this_file="") -> dict:
    ...

def run_task_b(_this_file="") -> dict:
    ...

# Recursion guard
if not globals().get("_main_guard", False):
    globals()["_main_guard"] = True
else:
    raise RuntimeError("Recursive main() call detected")

def main() -> dict:
    results = {}
    _this_file = __file__ if "__file__" in globals() else ""
    for _fn in ['run_task_a', 'run_task_b']:
        results[_fn] = globals()[_fn](_this_file)
    return results

if __name__ == "__main__":
    main()
```

## Pitfalls

- **Infinite recursion**: `run_run()` loads `__compiled/self.py` which calls `run_run()` again. Always pass `_this_file` and skip matching filename.
- **LLM syntax errors**: Common — LLM generates unterminated strings, mismatched braces. Always validate with `compile()` before including.
- **`from __future__` imports**: Must be at file start. Polyglot bash code comes first, so `from __future__` won't work. Use `from typing import ...` instead.
- **Duplicate imports**: LLM may emit imports for each function. Collect unique imports with a `set[str]`.
- **LLM output is non-deterministic**: Same prompt → different code each run. Embed seed/temperature in config but expect variance.
- **LLM hallucinates `main()` and `if __name__`**: Extract only the target `run_*` function; discard everything else.

## Session detail

tigorc was rewritten 2026-09-22 (v0.3, commit e59803c on tigor-ai main) from the 438-line polyglot compiler to a **prompt-bootstrap**: specs/tigorc/README.md is now a 92-line prompt whose human-facing podman command sends the whole file to vLLM and pipes the LLM's bash harness output into `bash`. Key fixes found by piece-wise testing: `nix shell` in nixos/nix needs `NIX_CONFIG="extra-experimental-features = nix-command flakes"`; jq filter needs quoted keys `{"seed":42,...}`; Qwen3.8 is a thinking model (content=null on small max_tokens — budget for ~10min per 15-18KB generation). The README has a 3-attempt retry loop that feeds failed run output back into the next prompt; attempt 1 typically has ~1 bug (first run succeeded on attempt 2). Contract requires: fresh-root first-run success, snapshot rollback, watchdog/tool-timeout/retries, deterministic, `tigorc test` passing. Old 438-line version at git history `1fb6eae`. See `references/tigorc-session.md`.
