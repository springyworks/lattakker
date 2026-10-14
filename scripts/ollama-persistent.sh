#!/bin/sh
# Keeps ONE Ollama model (qwen3.6) loaded and ready, always at the same context size, so nothing reloads it.
# Why it reloaded before: Ollama reloads a model when a request asks for another context size (num_ctx) than the one
# loaded, and a second model competes for RAM. This makes every client (this page, VS Code, curl) get the same size,
# allows one loaded model only, and loads the model again after every "ollama serve" start.
#
# Run once:  sudo sh scripts/ollama-persistent.sh      Undo:  sudo rm /etc/systemd/system/ollama.service.d/persistent.conf && sudo systemctl daemon-reload && sudo systemctl restart ollama
set -e
MODEL="${MODEL:-qwen3.6:latest}"
CTX="${CTX:-32768}"
DIR=/etc/systemd/system/ollama.service.d
mkdir -p "$DIR"
cat > "$DIR/persistent.conf" <<EOF
[Service]
Environment="OLLAMA_KEEP_ALIVE=-1"
Environment="OLLAMA_CONTEXT_LENGTH=$CTX"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_NUM_PARALLEL=1"
Environment="OLLAMA_FLASH_ATTENTION=1"
ExecStartPost=/bin/sh -c 'curl -s --retry 60 --retry-delay 1 --retry-connrefused http://127.0.0.1:11434/api/generate -d "{\\"model\\":\\"$MODEL\\",\\"prompt\\":\\"\\",\\"keep_alive\\":-1,\\"options\\":{\\"num_ctx\\":$CTX}}" >/dev/null 2>&1 &'
EOF
systemctl daemon-reload
systemctl restart ollama
echo "Done: $MODEL stays loaded at $CTX tokens. Check with: ollama ps"
