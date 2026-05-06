// ---------------------------------------------------------------------------
// On-device semantic search via transformers.js + nomic-embed-text-v1.5 ONNX
//
// Execution path:
//   1. Loads ONNX weights from .obsidian/plugins/vault-search/models/ (if present)
//   2. Falls back to lazy HuggingFace download on first use (cached locally forever)
//   3. Scores query against .vector/embeddings.json using cosine similarity
//
// Field mapping for embeddings.json v0.1 schema:
//   chunk_id      → unique ID for the chunk
//   page_id       → wiki page ID
//   page_path     → vault-relative file path
//   heading       → section heading
//   content_preview → text snippet for display
//   embedding     → float array, 768-dim, nomic-embed-text
// ---------------------------------------------------------------------------

import { Notice, Plugin } from 'obsidian';
import type { env as TransformersEnv, pipeline as TransformersPipeline } from '@xenova/transformers';

// ---------------------------------------------------------------------------
// Model configuration
// ---------------------------------------------------------------------------

// nomic-ai's official ONNX export — public, no auth required, has both
// quantized (~30MB) and full (~140MB) models under /onnx/. We previously
// targeted Xenova/nomic-embed-text-v1.5 but that mirror is now gated.
const MODEL_ID_HF = 'nomic-ai/nomic-embed-text-v1.5';
const MODELS_SUBPATH = 'models';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddingsCorpus {
  version: string;
  provider: string;
  model: string;
  dimension: number;
  chunks: CorpusChunk[];
}

export interface CorpusChunk {
  chunk_id: string;
  page_id: string;
  page_path: string;
  title?: string;
  heading: string;
  content_preview: string;
  embedding: number[];
}

export interface OnDeviceResult {
  chunkId: string;
  pageId: string;
  path: string;
  heading: string;
  preview: string;
  score: number;
}

// ---------------------------------------------------------------------------
// Singleton embedder with warm/cold state tracking
// ---------------------------------------------------------------------------

type TransformersModule = {
  pipeline: typeof TransformersPipeline;
  env: typeof TransformersEnv;
};

type EmbedderPipeline = Awaited<ReturnType<typeof TransformersPipeline>>;

let extractor: EmbedderPipeline | null = null;
let warmState: 'cold' | 'warming' | 'ready' | 'error' = 'cold';
let warmError: string | null = null;
let warmPromise: Promise<EmbedderPipeline> | null = null;
let transformersModulePromise: Promise<TransformersModule> | null = null;

export function getOnDeviceModelState(): { state: typeof warmState; error: string | null } {
  return { state: warmState, error: warmError };
}

/**
 * Configure transformers.js model paths.
 * Called before first pipeline() invocation so env is set before ONNX loads.
 */
async function withoutNodeProcess<T>(fn: () => Promise<T>): Promise<T> {
  const globalRef = globalThis as { process?: unknown };
  const hadProcess = Object.prototype.hasOwnProperty.call(globalRef, 'process');
  const originalProcess = globalRef.process;

  try {
    // Obsidian desktop exposes Node globals, but the bundled plugin does not
    // ship onnxruntime-node's native binary. Hide process while transformers.js
    // and ONNX initialize so they select onnxruntime-web/WASM instead.
    globalRef.process = undefined;
    return await fn();
  } finally {
    if (hadProcess) {
      globalRef.process = originalProcess;
    } else {
      delete globalRef.process;
    }
  }
}

function normalizeTransformersModule(raw: unknown): TransformersModule {
  const candidates = [
    raw,
    (raw as { default?: unknown } | null)?.default,
  ];

  for (const candidate of candidates) {
    const mod = candidate as Partial<TransformersModule> | null | undefined;
    if (typeof mod?.pipeline === 'function' && mod.env) {
      return { pipeline: mod.pipeline, env: mod.env };
    }
  }

  const keys = raw && typeof raw === 'object'
    ? Object.keys(raw).slice(0, 20).join(', ')
    : typeof raw;
  throw new Error(`transformers.js loaded without pipeline/env exports (${keys})`);
}

async function importTransformersRaw(): Promise<unknown> {
  return withoutNodeProcess(() => import('@xenova/transformers'));
}

async function loadTransformers(): Promise<TransformersModule> {
  transformersModulePromise ??= importTransformersRaw().then(normalizeTransformersModule);
  try {
    return await transformersModulePromise;
  } catch (err) {
    transformersModulePromise = null;
    throw err;
  }
}

async function configureEnv(plugin: Plugin, env: TransformersModule['env']): Promise<void> {
  const basePath = (plugin.app.vault.adapter as any).basePath as string;
  const pluginDir = `${basePath}/.obsidian/plugins/vault-search`;
  const pluginModelsDir = `${pluginDir}/${MODELS_SUBPATH}/`;

  // Try local models dir first; if model not found there, allow HuggingFace fallback
  // (one-time download, cached locally). After download allowRemoteModels is set false
  // on subsequent loads via the cached path.
  env.localModelPath = pluginModelsDir;
  env.allowLocalModels = true;

  // We allow remote on first run for the lazy-fetch flow (Option B).
  // The download goes to localModelPath cache, so it's a one-time network touch.
  // All subsequent loads are local-only (env.allowRemoteModels toggled after load).
  env.allowRemoteModels = true;

  const wasm = env.backends?.onnx?.wasm;
  if (wasm) {
    // Obsidian's renderer-process CSP blocks fetch() against file:// URLs, so
    // ORT cannot pull its WASM via the obvious `wasmPaths = file://...` path.
    // Workaround: read the WASM bytes via the vault adapter (works on desktop
    // AND iOS, no Node APIs), wrap them in Blobs, and hand ORT blob: URLs.
    // Blob URLs are CSP-allowed in the Electron renderer.
    //
    // ORT 1.14 (pinned via @xenova/transformers ^2.17) exposes only
    // `wasm.wasmPaths` — there's no `wasmBinary` field on its env. Verified
    // against node_modules/onnxruntime-common/dist/lib/env.d.ts.
    const wasmRel = '.obsidian/plugins/vault-search/dist/ort-wasm.wasm';
    const simdRel = '.obsidian/plugins/vault-search/dist/ort-wasm-simd.wasm';
    try {
      const [wasmBuf, simdBuf] = await Promise.all([
        plugin.app.vault.adapter.readBinary(wasmRel),
        plugin.app.vault.adapter.readBinary(simdRel),
      ]);
      const wasmBlobUrl = URL.createObjectURL(
        new Blob([wasmBuf], { type: 'application/wasm' }),
      );
      const simdBlobUrl = URL.createObjectURL(
        new Blob([simdBuf], { type: 'application/wasm' }),
      );
      wasm.wasmPaths = {
        'ort-wasm.wasm': wasmBlobUrl,
        'ort-wasm-simd.wasm': simdBlobUrl,
      };
      wasm.numThreads = 1;
    } catch (err) {
      // Adapter read failed (e.g. files missing from install). Fall back to
      // file:// URLs so we surface the real ORT error rather than masking
      // missing assets behind a load-time exception here.
      console.warn(
        '[vault-search] failed to load WASM via vault adapter, falling back to file:// URLs:',
        err,
      );
      const wasmBaseUrl = `file://${pluginDir}/dist/`;
      wasm.wasmPaths = {
        'ort-wasm.wasm': `${wasmBaseUrl}ort-wasm.wasm`,
        'ort-wasm-simd.wasm': `${wasmBaseUrl}ort-wasm-simd.wasm`,
      };
      wasm.numThreads = 1;
    }
  }

  // Prefer WebGPU (iOS 26 / macOS Safari); auto-falls back to WASM SIMD
  // transformers.js handles this automatically — no explicit device override needed
}

/**
 * Warm the on-device embedder. Safe to call multiple times; returns the same
 * promise if warming is already in flight.
 */
export async function getEmbedder(plugin: Plugin): Promise<EmbedderPipeline> {
  if (extractor) return extractor;
  if (warmPromise) return warmPromise;

  warmState = 'warming';
  warmError = null;
  warmPromise = (async () => {
    try {
      const { pipeline, env } = await loadTransformers();
      await configureEnv(plugin, env);
      // Use Xenova mirror — it has confirmed ONNX exports compatible with
      // transformers.js v2 and doesn't require git-lfs to obtain weights
      const p = await withoutNodeProcess(() =>
        pipeline('feature-extraction', MODEL_ID_HF, {
          quantized: true, // use quantized model (~30MB) for faster load; A19 Pro handles it fine
        })
      );
      extractor = p;
      warmState = 'ready';
      warmError = null;
      // After first load succeeds, disallow remote models — all subsequent loads
      // come from the local cache even if HuggingFace is unreachable
      env.allowRemoteModels = false;
      return extractor;
    } catch (err) {
      warmState = 'error';
      warmError = err instanceof Error ? err.message : String(err);
      warmPromise = null;
      throw err;
    }
  })();

  return warmPromise;
}

/** Reset embedder state (e.g. after plugin reload). */
export function resetEmbedder(): void {
  extractor = null;
  warmState = 'cold';
  warmError = null;
  warmPromise = null;
}

// ---------------------------------------------------------------------------
// Query embedding
// ---------------------------------------------------------------------------

/**
 * Embed a search query.
 * nomic-embed-text-v1.5 uses instruction prefixes:
 *   - "search_query: " for retrieval queries
 *   - "search_document: " for indexed passages
 * The existing .vector/embeddings.json was produced by Ollama's nomic-embed-text
 * which internally applies the document prefix. We apply the query prefix here
 * for correct asymmetric retrieval.
 */
export async function embedQuery(plugin: Plugin, query: string): Promise<number[]> {
  const ex = await getEmbedder(plugin);
  const prefixed = `search_query: ${query}`;
  const out = await (ex as any)(prefixed, { pooling: 'mean', normalize: true });
  // out.data is a Float32Array; convert to plain number[]
  return Array.from(out.data as Float32Array) as number[];
}

// ---------------------------------------------------------------------------
// Corpus loading
// ---------------------------------------------------------------------------

let corpusCache: EmbeddingsCorpus | null = null;
let corpusCachePath: string | null = null;

export async function loadCorpus(plugin: Plugin): Promise<EmbeddingsCorpus> {
  const path = '.vector/embeddings.json';
  if (corpusCache && corpusCachePath === path) return corpusCache;

  let raw: string;
  try {
    raw = await plugin.app.vault.adapter.read(path);
  } catch {
    throw new Error(
      'No .vector/embeddings.json found. Run `python3 tools/scripts/vault_vector.py embed` to build the semantic index.'
    );
  }

  corpusCache = JSON.parse(raw) as EmbeddingsCorpus;
  corpusCachePath = path;
  return corpusCache;
}

/** Invalidate corpus cache (e.g. after re-embedding). */
export function clearCorpusCache(): void {
  corpusCache = null;
  corpusCachePath = null;
}

// ---------------------------------------------------------------------------
// Cosine similarity (pure JS — no WASM, no numpy)
// ---------------------------------------------------------------------------

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

// ---------------------------------------------------------------------------
// Main on-device search function
// ---------------------------------------------------------------------------

export async function semanticSearchOnDevice(
  plugin: Plugin,
  query: string,
  k = 10,
): Promise<OnDeviceResult[]> {
  // Check embeddings.json exists
  let corpus: EmbeddingsCorpus;
  try {
    corpus = await loadCorpus(plugin);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    new Notice(msg, 8000);
    return [];
  }

  // Warm model with user feedback on first run
  const { state } = getOnDeviceModelState();
  if (state === 'cold' || state === 'warming') {
    new Notice('On-device model warming up (~5s on first run)…', 4000);
  }

  let qvec: number[];
  try {
    qvec = await embedQuery(plugin, query);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    new Notice(`On-device embedding failed: ${msg.slice(0, 100)}`, 6000);
    return [];
  }

  // Score all chunks
  const scored = corpus.chunks.map(c => ({
    chunkId: c.chunk_id,
    pageId: c.page_id,
    path: c.page_path,
    heading: c.heading,
    preview: c.content_preview,
    score: cosine(qvec, c.embedding),
  }));

  // Sort descending by score, return top k
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export { MODEL_ID_HF };
