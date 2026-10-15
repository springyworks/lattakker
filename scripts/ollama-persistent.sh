#!/bin/sh
# Keeps ONE Ollama model (qwen3.6) loaded and ready, always at the same context size, so nothing reloads it.
# Why it reloaded before: Ollama reloads a model when a request asks for another context size (num_ctx) than the one
# loaded, and a second model competes for RAM. This makes every client (this page, VS Code, curl) get the same size,
# allows one loaded model only, and loads the model again after every "ollama serve" start.
# 256k requires a model that supports it and enough RAM for weights, cache and runtime. Use CTX=65536 for 64k.
#
# Run once:  sudo sh scripts/ollama-persistent.sh      Undo:  sudo rm /etc/systemd/system/ollama.service.d/persistent.conf && sudo systemctl daemon-reload && sudo systemctl restart ollama
set -e
MODEL="${MODEL:-qwen3.6:latest}"
CTX="${CTX:-262144}"
case "$CTX" in
  4096|8192|16384|32768|65536|131072|262144) ;;
  *) echo "Unsupported CTX: choose 4096, 8192, 16384, 32768, 65536, 131072 or 262144 tokens." >&2; exit 1 ;;
esac
case "$MODEL" in
  ''|*[!a-zA-Z0-9._:/-]*) echo "MODEL must be an Ollama model name." >&2; exit 1 ;;
esac
DIR=/etc/systemd/system/ollama.service.d
mkdir -p "$DIR"
cat > "$DIR/persistent.conf" <<EOF
[Service]
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_CONTEXT_LENGTH=$CTX"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_FLASH_ATTENTION=1"
TimeoutStartSec=25min
ExecStartPost=/usr/bin/curl --fail --show-error --silent --max-time 1200 --retry 60 --retry-delay 1 --retry-connrefused --retry-max-time 1200 http://127.0.0.1:11434/api/generate -H "Content-Type: application/json" -d '{"model":"$MODEL","prompt":"","stream":false,"keep_alive":-1,"options":{"num_ctx":$CTX}}'
EOF
systemctl daemon-reload
systemctl restart ollama
echo "Done: $MODEL stays loaded at $CTX tokens. Check with: ollama ps"
