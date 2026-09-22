# tigorc - reproducible AI compiler (v0.1)

Model: Qwen3.8-27B-FP8
Inference engine: vLLM v0.29.0
Host port: 8000
Wall time budget for compilation: 30 minutes

## How to use (instruction for a human)

1) Download model
2) Start engine
3) Run tigorc via command below (intentionally kept as compact as possible)

```bash
podman run --rm -v "./README.md:/README.md:ro" nixos/nix sh -c '
    nix shell nixpkgs#jq -c sh -c '"'"'
      jq -Rs "{seed:42,messages:[{role:\"user\",content:.}]}" /readme.md |
      curl -s http://host.containers.internal:8000/v1/chat/completions \
        -H "Content-Type: application/json" -d @- |
      jq -r ".choices[0].message.content" | bash
    '"'"'
  '
```

## Instruction for AI (prompt zero)

If you reading this, your human ran command above, this is harness zero. Your end goal is deterministic offline-friendly compiler that translates markdown to entire projects worth of code and can compile itself.

1) Make harness one: output very defensive, compact and extensible bash hypervisor
2) Write a prompt one: take some ideas from specification and implement them
3) Iterate to two, three and repeat until done, respect time budget

## Compiler specification

Tool calls support, looping with retries and timeouts, extensibility and simplicity. Need describe in details how tool calls need to be structured, and what compiler architecture need to be.

- We store not implementation, but compressed version of a code
- Intelligence is a compression, we intentionally skip boilerplate
- Prompt as a source allows you change underlying tech easily
- It makes shuffling architectual frameworks and patterns delightful to explore
- Codebase do not rots in a traditional sense, from compatibility layers
- When spec is semantic enough, switching programming language not an issue
