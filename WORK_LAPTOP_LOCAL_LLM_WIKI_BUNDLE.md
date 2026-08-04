# Work Laptop Local LLM Wiki Install Bundle

## Bottom Line

Package this as a local-first Markdown wiki with a CLI retrieval layer. Obsidian
should be optional UI, not the dependency that makes the wiki work.

The install bundle should contain:

1. A fresh wiki folder structure for work-approved content.
2. The local retrieval scripts from the current LLMwiki stack.
3. A local ingestion runner that uses Ollama or another approved local LLM.
4. Local embedding and answer models, or scripts to install them inside the
   work laptop boundary.
5. Optional Obsidian plugin artifacts for `Cmd+K` search.
6. Verification scripts that prove no cloud provider is required.

Do not bundle the personal vault content or the existing personal `.vector/`
stores unless the explicit goal is to move that data. For a work laptop, the
right default is a separate empty wiki scaffold plus the tools.

## Assumptions

- Target machine is a macOS work laptop.
- The wiki must run locally and must not depend on OpenAI, Anthropic, hosted
  vector databases, cloud sync, or cloud document processing.
- Work policy allows local model runtimes and local document indexing.
- Obsidian may or may not be allowed. The core should work with any Markdown
  editor and a terminal.
- Existing source of truth for the current system is split between this repo
  and the paired vault scripts:
  - `obsidian-vault-search`: Obsidian search plugin.
  - `/Users/tyroneross/ObsidianVault/tools/scripts`: CLI query, retrieval,
    graph, SQLite, and ingestion-support scripts.

## Recommended Package Shape

Build one portable archive:

```text
work-local-llm-wiki-kit/
  README.md
  install.sh
  bundle-manifest.json
  SHA256SUMS.txt

  wiki-template/
    _system/
      index.md
      TAXONOMY.md
      log.md
    brain/
      rules.md
      voice.md
    wiki/
      concepts/
      entities/
        companies/
        people/
        projects/
        tools/
      sources/
      work/
    raw/
      ingest/
      work/
      research/
      engineering/
      other/
      access-log.md
    outputs/
    templates/
    tools/
      scripts/
    .vector/
      .gitkeep

  tools/
    scripts/
      llmwiki
      llmwiki.py
      llmwiki_answer.py
      llmwiki_intent.py
      llmwiki_logging.py
      vault_vector.py
      vault_graph.py
      wiki_index.py
      vault_retrieval_eval.py
      local_ingest.py
      lib/
        extract_doc.py
        pdf_vision_ocr.swift
      evals/
        llmwiki_eval_cases.json
        vault_retrieval_eval_cases.json
      docs/
        LLMWIKI_ACCESS.md
        LLMWIKI_ARCHITECTURE.md
        SCRIPT_CATALOG.md

  models/
    ollama/
      README.md
      model-list.txt
    onnx/
      nomic-ai/nomic-embed-text-v1.5/

  python/
    requirements.txt
    wheelhouse/

  obsidian-plugin/
    vault-search/
      main.js
      manifest.json
      styles.css
      models/
      dist/
        ort-wasm*.wasm

  checks/
    smoke_test.sh
    offline_check.sh
    retrieval_eval.sh
```

## Package Variants

### Variant A: Core CLI Wiki

Use this if Obsidian is not allowed.

Bundle:

- `wiki-template/`
- `tools/scripts/`
- `models/ollama/model-list.txt`
- `install.sh`
- `checks/`

Runtime:

- Markdown files are edited with any editor.
- Search and question-answering run through `tools/scripts/llmwiki`.
- Retrieval state lives in `.vector/embeddings.json` and `.vector/wiki.db`.

### Variant B: Obsidian UI Wiki

Use this if Obsidian is allowed.

Bundle everything in Variant A plus:

- `obsidian-plugin/vault-search/main.js`
- `obsidian-plugin/vault-search/manifest.json`
- `obsidian-plugin/vault-search/styles.css`
- `obsidian-plugin/vault-search/models/`
- `obsidian-plugin/vault-search/dist/ort-wasm*.wasm`

Runtime:

- Obsidian is only the UI.
- The CLI remains the source of truth for local retrieval and ingestion.
- The plugin enables quick, facet, and semantic search inside Obsidian.

### Variant C: Fully Offline Install

Use this if the work laptop cannot download dependencies during setup.

Bundle everything in Variant B plus:

- Ollama installer approved by IT, or the approved local LLM runtime installer.
- Preloaded local model files or an internal model mirror procedure.
- Python wheels for non-stdlib dependencies.
- Node.js installer only if the plugin must be rebuilt on the laptop.
- Prebuilt plugin artifacts so `npm install` is not required on the laptop.

## Runtime Dependencies

### Required

- Python 3.11 or newer.
- Python `sqlite3` with FTS5 enabled.
- Ollama or an approved local LLM runtime exposing equivalent local generation
  and embedding APIs.
- Local embedding model:
  - Current default: `nomic-embed-text`.
  - Higher-quality local option already supported by the current script:
    `mxbai-embed-large`.
- Local answer and intent model:
  - Current script default: `llama3.2:3b`.
  - Configure with `LLMWIKI_ANSWER_MODEL` and `LLMWIKI_INTENT_MODEL`.

### Required for Current Graph Retrieval

- `networkx`

Package this in a local `requirements.txt` or vendored wheelhouse:

```text
networkx
```

### Optional for Local Document Ingestion

- `pdftotext` for text-heavy PDFs.
- Swift toolchain for Apple Vision OCR on scanned PDFs.
- Node.js 20 or newer plus `omniparse` for PDF, PPTX, XLSX, XLS, CSV, TSV,
  ODS, XLSB, and code-file extraction.

### Optional for Web Snapshot Ingestion

Use only if approved for work content. This is not required for a no-cloud,
local-document-only wiki.

```text
httpx
beautifulsoup4
readability-lxml
```

If web snapshot ingestion is enabled, also bundle:

```text
link_ingest.py
lib/extract_html.py
```

## Files to Vendor From the Current Stack

From this repo:

```text
main.js
manifest.json
styles.css
models/
scripts/fetch-model.sh
package.json
package-lock.json
src/
```

For a work-laptop runtime package, prefer shipping the built plugin artifacts
instead of requiring `npm install`.

From `/Users/tyroneross/ObsidianVault/tools/scripts`:

```text
llmwiki
llmwiki.py
llmwiki_answer.py
llmwiki_intent.py
llmwiki_logging.py
vault_vector.py
vault_graph.py
wiki_index.py
vault_retrieval_eval.py
llmwiki_eval.py
llmwiki_eval_cases.json
llmwiki_eval_long_cases.json
llmwiki_eval_variation_cases.json
vault_retrieval_eval_cases.json
LLMWIKI_ACCESS.md
LLMWIKI_ARCHITECTURE.md
SCRIPT_CATALOG.md
lib/extract_doc.py
lib/pdf_vision_ocr.swift
```

Do not blindly copy `__pycache__/`, `.vector/`, personal raw files, personal
wiki pages, logs, or saved outputs.

## Bundle Manifest

`bundle-manifest.json` should make the package auditable before it is installed.

Minimum fields:

```json
{
  "name": "work-local-llm-wiki-kit",
  "created": "YYYY-MM-DD",
  "target": "local-only work wiki",
  "includes_personal_content": false,
  "cloud_dependencies_required": false,
  "required_models": {
    "embedding": ["nomic-embed-text"],
    "answer": ["llama3.2:3b"],
    "intent": ["llama3.2:3b"]
  },
  "optional_components": {
    "obsidian_plugin": true,
    "web_snapshot_ingestion": false,
    "apple_vision_ocr": true
  },
  "source_paths": [
    "obsidian-vault-search",
    "/Users/tyroneross/ObsidianVault/tools/scripts"
  ],
  "excluded": [
    "personal vault pages",
    ".vector stores",
    "api keys",
    "cloud sync configs",
    "raw personal documents"
  ]
}
```

## Local LLM Ingestion Requirement

The current wiki has strong ingestion instructions, but a work-laptop package
should include a runnable local ingestion CLI so the process does not depend on
a cloud coding agent.

Add this package file before using the bundle operationally:

```text
tools/scripts/local_ingest.py
```

Minimum contract:

```bash
python3 tools/scripts/local_ingest.py raw/ingest/<file-or-folder> \
  --model llama3.2:3b \
  --embed-model nomic-embed-text
```

The script should:

1. Read a file or folder from `raw/ingest/`.
2. Extract local text when the source is PDF, spreadsheet, deck, CSV, HTML, or
   plain Markdown.
3. Ask the local LLM to classify the source into the wiki taxonomy.
4. Ask the local LLM to draft a compact wiki page with frontmatter.
5. Move or copy the raw source into the right `raw/<domain>/` folder.
6. Write the wiki page as `status: seedling`.
7. Update `_system/index.md` and `raw/access-log.md`.
8. Run validators for frontmatter, `raw_ref`, phantom wikilinks, and unresolved
   paths.
9. Refresh retrieval with:

```bash
python3 tools/scripts/vault_vector.py embed --provider ollama
python3 tools/scripts/wiki_index.py status
```

The local LLM should draft and classify, but deterministic code should enforce
paths, frontmatter, raw references, write boundaries, and validation.

## Local-Only Policy

For the work laptop package, cloud fallback should be disabled by policy and by
the installer.

Installer checks:

```bash
python3 -c "import sqlite3; print(sqlite3.sqlite_version)"
ollama list
python3 tools/scripts/vault_vector.py status --check
```

Recommended local-only guardrails:

- Do not set `OPENAI_API_KEY`.
- Do not document OpenAI provider usage in the work-laptop README.
- Make `install.sh` fail if a cloud provider is selected in config.
- Make `local_ingest.py` accept only local model backends unless an explicit
  internal policy file allows otherwise.
- Keep `.vector/`, model files, raw sources, and generated wiki pages on local
  disk.
- Use internal device backup only if approved by work policy.

## Install Flow

Expected installer behavior:

```bash
./install.sh --target "$HOME/WorkLLMWiki" --with-obsidian false
```

Installer should:

1. Create the target wiki folder from `wiki-template/`.
2. Copy `tools/scripts/` into the target.
3. Create `.vector/`.
4. Verify Python, SQLite FTS5, Ollama, and required models.
5. Install local Python wheels if needed.
6. Create a shell alias or symlink:

```bash
mkdir -p "$HOME/.local/bin"
ln -sf "$HOME/WorkLLMWiki/tools/scripts/llmwiki" "$HOME/.local/bin/llmwiki"
```

7. If Obsidian is enabled, copy plugin artifacts to:

```text
$HOME/WorkLLMWiki/.obsidian/plugins/vault-search/
```

8. Build the first retrieval store:

```bash
cd "$HOME/WorkLLMWiki"
python3 tools/scripts/vault_vector.py embed --provider ollama
python3 tools/scripts/wiki_index.py status
```

9. Run smoke checks.

## Smoke Checks

```bash
cd "$HOME/WorkLLMWiki"

python3 -c "import sqlite3; con=sqlite3.connect(':memory:'); con.execute('create virtual table x using fts5(y)'); print('fts5 ok')"
ollama list
python3 tools/scripts/vault_vector.py status --check
python3 tools/scripts/wiki_index.py status
./tools/scripts/llmwiki status
./tools/scripts/llmwiki "what content is in this wiki?"
```

For ingestion:

```bash
cp /path/to/approved-test-file.md raw/ingest/
python3 tools/scripts/local_ingest.py raw/ingest/approved-test-file.md
python3 tools/scripts/vault_vector.py search "approved test file" -k 3
```

For Obsidian:

1. Open the target folder as a vault.
2. Enable the `Vault Search` community plugin manually.
3. Run `Cmd+K`.
4. Run `?approved test file`.

## What Not to Bundle

- Personal vault content.
- Existing personal `.vector/embeddings.json`, `.vector/wiki.db`, or
  `.vector/tracker.json`.
- API keys.
- `.env` files.
- Cloud sync configs.
- `node_modules/` unless IT explicitly wants a fully vendored Node build tree.
- `__pycache__/` and generated bytecode.
- Old raw ingest files that have not been reviewed for work-laptop use.

## Recommended Next Build Step

Create a real package directory named `work-local-llm-wiki-kit/` with:

1. `install.sh`
2. `tools/scripts/local_ingest.py`
3. `checks/smoke_test.sh`
4. `bundle-manifest.json`
5. A clean `wiki-template/`

The key missing implementation is `local_ingest.py`. The current system has
the retrieval stack and the ingest protocol, but a separate local-only work
wiki should not rely on a cloud agent to perform ingestion.
