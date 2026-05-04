# Vault Search — Custom Obsidian Plugin

Tailored search for the LLM Wiki vault. Three modes in a single `Cmd+K` modal,
designed for deep structured frontmatter: `entity_type`, `concept_type`, `tool_type`,
`provides_capability`, `current_default`, `aliases`, and more.

Replaces reliance on Omnisearch for frontmatter-aware queries.

---

## Modes

### Quick (default — no prefix)

Type anything. Matches against filename and every alias in frontmatter.

Ranking order: exact filename > exact alias > prefix filename > prefix alias > substring filename > substring alias.

Returns up to 30 results. Each row shows title, type chips, a star if `current_default: true`,
and the vault-relative path.

### Facet (`key:value` tokens)

Type one or more `key:value` tokens. Multiple tokens are AND-combined.
Any plain text after the facets narrows results by filename/alias.

**Supported keys:**

| Key | Matches |
|---|---|
| `type` | frontmatter `type:` |
| `entity_type` | `entity_type:` |
| `concept_type` | `concept_type:` |
| `tool_type` | `tool_type:` |
| `capability_kind` | `capability_kind:` |
| `lab_role` / `role` | `lab_role:` |
| `model_lifecycle` | `model_lifecycle:` |
| `current_default` | `current_default: true/false` (also accepts `t`, `yes`) |
| `decision_bearing` | `decision_bearing: true/false` |
| `status` | `status:` |
| `tag` | any value in `tags:` (strips `domain/` prefix) |
| `capability` | any value in `provides_capability:` |
| `stack` | `member_of:` or `tech_stack:` |
| `lab` | `parent_company:` |

**Example queries:**

```
type:entity entity_type:lab role:host
current_default:true type:tool
concept_type:framework
capability:embedding
tag:ai capability:frontier-text
type:entity entity_type:model model_lifecycle:active
```

### Semantic (`?` prefix — Mac and iOS)

Type `?your question` to run a vector similarity search.
Results show the ranked page slug, cosine score, section heading, and a preview snippet.

**Three execution paths**, picked by the `Backend` setting:

| Backend | Where it runs | When it's used |
|---|---|---|
| **Auto** (default) | CLI on desktop if Ollama is up, on-device otherwise | Recommended |
| **CLI** | Shells out to `vault_vector.py` | Desktop + Ollama only |
| **On-device** | transformers.js + nomic-embed-text-v1.5 ONNX in the WebView | Mac and iOS — works offline |

**Requirements:**
- `.vector/embeddings.json` produced by `python3 tools/scripts/vault_vector.py embed` (run once on desktop, then synced to iOS via your vault sync of choice).
- For CLI: Ollama running with `nomic-embed-text` pulled.
- For on-device: ONNX weights — fetched once via `scripts/fetch-model.sh` (~137 MB quantized).

The plugin caches CLI queries for 30 seconds (last 5). The on-device pipeline keeps the model warm between queries; first warm takes 2–5 s.

---

## Privacy

**No third-party APIs. Ever.** This plugin never calls OpenAI, Anthropic, Voyage, Cohere, or any other cloud embedding service. Two things may touch the network:

1. **One-time model fetch from Hugging Face** — `scripts/fetch-model.sh` downloads the public `Xenova/nomic-embed-text-v1.5` ONNX weights (~137 MB) into `models/`. After this, the model is fully local. The download is the model itself, not your data.
2. **CLI backend on desktop** — when enabled, shells out to `vault_vector.py`, which talks to your **local** Ollama (`http://127.0.0.1:11434`). Ollama is a local service; nothing leaves your machine.

The on-device backend only ever talks to the local files in `.vector/embeddings.json` and the bundled ONNX model. Vault content is read-only from disk; nothing is uploaded.

If you want zero network at any point: run `scripts/fetch-model.sh` on desktop with your network on, then disable network — the plugin will continue working forever.

---

## Install

```bash
# 1. Clone and build
git clone https://github.com/tyroneross/obsidian-vault-search
cd obsidian-vault-search
npm install
npm run build

# 2. Fetch ONNX model weights (one-time, ~137 MB)
./scripts/fetch-model.sh

# 3. Copy artifacts + model to vault plugin folder
mkdir -p ~/ObsidianVault/.obsidian/plugins/vault-search
cp main.js manifest.json styles.css ~/ObsidianVault/.obsidian/plugins/vault-search/
cp -R models ~/ObsidianVault/.obsidian/plugins/vault-search/
```

Then in Obsidian: Settings → Community plugins → enable **Vault Search**.

For iOS: ensure your vault sync (Obsidian Sync, iCloud, Syncthing, etc.) carries `.obsidian/plugins/vault-search/models/` to the device. The model files travel with the plugin folder.

During development, `npm run dev` watches for changes and rebuilds automatically.

---

## Settings

Settings → Vault Search:

- **Rebuild index** — re-scan all vault files. Useful if results feel stale after bulk edits.
- **Max results** — slider 10–100 (default 30).
- **Semantic mode** — toggle the `?` prefix on/off.
- **Semantic backend** — Auto, CLI, or On-device.
- **vault_vector.py path** — override for the CLI backend.
- **Pre-warm on-device model** — load the ONNX model now so the first `?` query is fast.
- **Show diagnostics** — print backend selection, model state, and embeddings.json stats to the console + a Notice.

---

## Hotkey

`Cmd+K` (Mac) / `Ctrl+K` (Windows/Linux). Registered as `Mod+K` in the plugin command.

To change: Settings → Hotkeys → search "Open Vault Search".

---

## File structure

```
src/
  main.ts      — Plugin class, lifecycle, command registration
  modal.ts     — VaultSearchModal (SuggestModal subclass)
  index.ts     — IndexEntry type, VaultIndex, frontmatter parser
  search.ts    — Mode router (Quick / Facet / Semantic)
  facet.ts     — parseFacets, applyFacets
  ranking.ts   — Tier-based rank function
  semantic.ts  — Backend router (CLI vs on-device), CLI shell-out, output parser
  ondevice.ts  — transformers.js pipeline, query embedding, cosine scoring
  settings.ts  — PluginSettingTab with backend selector + model controls
scripts/
  fetch-model.sh — One-time ONNX weight downloader (Hugging Face → models/)
models/        — ONNX weights (gitignored; populated by fetch-model.sh)
```

Runtime dependency: `@xenova/transformers` (~3 MB bundled). No other runtime deps.
