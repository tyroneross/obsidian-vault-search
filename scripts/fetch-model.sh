#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# fetch-model.sh — Download Xenova/nomic-embed-text-v1.5 ONNX weights
#
# Pulls the quantized model (~30MB) and tokenizer files from Hugging Face into
# ./models/Xenova/nomic-embed-text-v1.5/ so transformers.js can load locally
# without ever touching the network at runtime.
#
# Run this once on desktop after `npm install`. On iOS, the vault sync
# carries the model files into the plugin folder automatically.
#
# Usage:
#   ./scripts/fetch-model.sh           # default: int8-quantized (~137MB)
#   ./scripts/fetch-model.sh --full    # also fetch full-precision fp32 (~550MB)
# ----------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
DEST="$ROOT/models/nomic-ai/nomic-embed-text-v1.5"
HF_BASE="https://huggingface.co/nomic-ai/nomic-embed-text-v1.5/resolve/main"

FETCH_FULL=0
if [[ "${1:-}" == "--full" ]]; then
  FETCH_FULL=1
fi

echo "Fetching nomic-embed-text-v1.5 ONNX weights into:"
echo "  $DEST"
echo ""

mkdir -p "$DEST/onnx"

fetch() {
  local url="$1"
  local out="$2"
  if [[ -f "$out" ]]; then
    echo "  [skip] $(basename "$out") already present"
    return
  fi
  echo "  [get]  $(basename "$out")"
  # -L follows the HF CDN redirects; -f fails on HTTP errors (no silent empty files)
  curl -fL "$url" -o "$out" --progress-bar
}

# Tokenizer + config files (always required, ~2MB total)
fetch "$HF_BASE/config.json"             "$DEST/config.json"
fetch "$HF_BASE/tokenizer.json"          "$DEST/tokenizer.json"
fetch "$HF_BASE/tokenizer_config.json"   "$DEST/tokenizer_config.json"
fetch "$HF_BASE/special_tokens_map.json" "$DEST/special_tokens_map.json"

# Quantized ONNX (default, ~30MB) — what transformers.js loads with quantized:true
fetch "$HF_BASE/onnx/model_quantized.onnx" "$DEST/onnx/model_quantized.onnx"

# Full-precision ONNX (optional, ~140MB)
if [[ $FETCH_FULL -eq 1 ]]; then
  fetch "$HF_BASE/onnx/model.onnx" "$DEST/onnx/model.onnx"
fi

echo ""
echo "Done. Model is ready at:"
echo "  $DEST"
echo ""
echo "Next steps:"
echo "  1. npm run build"
echo "  2. cp -r main.js manifest.json styles.css models ~/ObsidianVault/.obsidian/plugins/vault-search/"
echo "  3. Reload Obsidian → Cmd+K → ?your query"
