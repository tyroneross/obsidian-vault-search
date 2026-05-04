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

### Semantic (`?` prefix, Mac desktop only)

Type `?your question` to run a vector similarity search via the local `vault_vector.py` CLI.
Results show the ranked page slug, cosine score, section heading, and a preview snippet.

Requires:
- Desktop Obsidian (not iOS)
- Ollama running with `nomic-embed-text` pulled, OR `OPENAI_API_KEY` set
- Embeddings indexed via `python3 tools/scripts/vault_vector.py embed`

The plugin caches the last 5 queries for 30 seconds to avoid re-shelling on repeated presses.
On iOS or if `child_process` is unavailable, `?` mode is silently disabled — Quick and Facet still work.

---

## Install

```bash
# Clone and build
git clone https://github.com/tyroneross/obsidian-vault-search
cd obsidian-vault-search
npm install
npm run build

# Copy artifacts to vault plugin folder
mkdir -p ~/ObsidianVault/.obsidian/plugins/vault-search
cp main.js manifest.json styles.css ~/ObsidianVault/.obsidian/plugins/vault-search/
```

Then in Obsidian: Settings → Community plugins → enable **Vault Search**.

During development, `npm run dev` watches for changes and rebuilds automatically.
Re-copy the three artifacts after each rebuild, or symlink the plugin folder to the repo root.

---

## Settings

Settings → Vault Search:

- **Rebuild index** — re-scan all vault files. Useful if results feel stale after bulk edits.
- **Max results** — slider 10–100 (default 30).
- **Semantic mode** — toggle. Auto-disabled on iOS regardless of this setting.
- **vault_vector.py path** — override if your script lives elsewhere.

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
  semantic.ts  — child_process shell-out, cache, output parser
  ranking.ts   — Tier-based rank function
  settings.ts  — PluginSettingTab subclass
```

No runtime dependencies. Build-time only: `esbuild`, `typescript`, `obsidian` types, `@types/node`.
