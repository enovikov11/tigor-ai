# Qwen3.8-Flash-Next NVFP4 — single 96GB Blackwell

Decision (2026-08): for 1× RTX PRO 6000 96GB + stock vLLM, use **`primitive-ai/Qwen3.8-Flash-Next-NVFP4`**, not RadixArk's.

| | primitive-ai | RadixArk |
|---|---|---|
| Disk size | ~186 GB | ~135 GB |
| PLE/n-gram 51.2B | BF16 in host RAM | FP8 — stock vLLM CPU-offload path broken |
| Validated on | single RTX PRO 6000 Blackwell | SGLang, GB300/B300 |
| single-GPU vLLM | works (~74.4 tok/s 1-stream, ~484 tok/s @ cc32) | PLE issues reported |

Quant layout (not blanket 4-bit): routed experts 120.8B → NVFP4 W4A4; PLE/n-gram 51.2B → BF16 on CPU (~95–100 GB RAM); attention/GDN/shared experts/MTP/vision/norms → BF16. GPU footprint <89 GiB.

## Download (outside metered VPN)

```bash
model="primitive-ai/Qwen3.8-Flash-Next-NVFP4"
hf download "$model" --local-dir "/data/$model"   # hf CLI = huggingface_hub >= 0.34
```

## Run (recommended by authors)

```bash
docker run --gpus all --ipc=host -p 8000:8000 \
  -e VLLM_PLE_CPU_OFFLOAD=1 \
  -e VLLM_PLE_OFFLOAD_READY_TIMEOUT=1800 \
  vllm/vllm-openai:qwen38-flash-next \
  --model primitive-ai/Qwen3.8-Flash-Next-NVFP4 \
  --distributed-executor-backend mp \
  --gpu-memory-utilization 0.92 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --reasoning-parser qwen3
```

Pitfalls:

- `--distributed-executor-backend mp` is NOT decorative — without it the single-GPU executor doesn't start the PLE-offload worker and the first forward can hang.
- `VLLM_PLE_OFFLOAD_READY_TIMEOUT=1800` needed: CPU worker loads a ~95 GB table.
- `--ipc=host` required for CPU offload.

## MTP (optional, tested in this quant)

```
--speculative-config '{"method":"mtp","num_speculative_tokens":3}'
```
