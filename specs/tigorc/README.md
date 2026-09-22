# tigorc - reproducible AI compiler (v0.3)

Model: Qwen3.8-27B-FP8
Engine: vLLM v0.29.0, host port 8000
Budget: 30 minutes wall clock, 3 attempts
Crown Jewel: minimalism, determinism, readability

## Human: how to run

Engine running on port 8000. Run from this directory only:

```bash
podman run --rm -w /work \
  -e 'NIX_CONFIG=extra-experimental-features = nix-command flakes' \
  -v "$(pwd):/work" \
  nixos/nix nix shell nixpkgs#jq -c bash -c '
    set -uo pipefail
    ask() {  # prompt on stdin -> assistant content on stdout
      jq -Rs "{\"seed\":42,\"messages\":[{\"role\":\"user\",\"content\":.}]}" |
        curl -sm 1700 http://host.containers.internal:8000/v1/chat/completions \
          -H "Content-Type: application/json" -d @- |
        jq -r ".choices[0].message.content"
    }
    cp /work/README.md /work/prompt.md
    for attempt in 1 2 3; do
      echo "tigorc: attempt $attempt"
      ask < /work/prompt.md > /work/harness.sh || exit 1
      rm -rf bin src prompts projects tools tests logs tigorc
      if bash /work/harness.sh 2>&1 | tee /work/run.log; then
        echo "tigorc: OK after attempt $attempt"; exit 0
      fi
      {
        cat /work/README.md
        printf "\n# PREVIOUS ATTEMPT %s FAILED - fix the reported errors.\n\n" "$attempt"
        cat /work/harness.sh
        printf "\n# Output of that run\n\n"
        tail -c 4000 /work/run.log
      } > /work/prompt.md
    done
    echo "tigorc: failed after 3 attempts"; exit 1
  '
```

## Prompt zero (for the AI reading this)

Your human ran the command above. You are harness zero: from this single
markdown file, produce a complete bash compiler that builds itself.

1. Output ONE complete bash script (harness one). No markdown fences,
   no explanation.
2. The script creates the tree below in the current directory, self-compiles,
   self-tests, and exits non-zero on any failure.
3. If your prompt contains a PREVIOUS ATTEMPT block, that script failed:
   read the run output, fix those bugs, output the corrected full script.

## Contract (what harness one must produce)

Tree in the current directory:

```
bin/ src/ prompts/ projects/ tools/ tests/ logs/
tigorc            # entry script, mode 0755
prompts/prompt_one.md
```

Rules:

- First run must succeed from a FRESH root where none of the directories
  above exist. A fresh root is not a broken state - never roll back a
  first build.
- Rollback: keep a snapshot of the last-good tree; on failed self-compile,
  restore it and exit non-zero.
- Watchdog: TIGORC_WALL_TIME wall-clock budget kills runaway runs; every
  tool call has a timeout and TIGORC_RETRIES retries.
- Tool calls: `tigorc tool <name> [args...]`; plugins are
  `tools/<name>.sh` defining `tool_<name>`.
- Deterministic: LC_ALL=C, TZ=UTC, seed 42, no network, no timestamps in
  generated files, atomic writes only.
- Self-test: `tigorc test` runs `tests/test.sh` and it must pass.

## Specification

Tool-call support, looping with retries and timeouts, extensibility, simplicity.
Describe in detail how tool calls are structured and what the compiler
architecture is - in prompt one.

- We store not implementation, but a compressed version of code
- Intelligence is compression; we deliberately skip boilerplate
- Prompt as source lets you change the underlying tech easily
- Shuffling architectural frameworks and patterns becomes easy to explore
- Codebases do not rot the traditional way (no compatibility layers)
- When a spec is semantic enough, switching languages is not an issue
