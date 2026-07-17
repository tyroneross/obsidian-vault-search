// ---------------------------------------------------------------------------
// On-device semantic search via transformers.js + nomic-embed-text-v1.5 ONNX
//
// Execution path:
//   1. Loads ONNX weights from .obsidian/plugins/vault-search/models/ (if present)
//   2. Falls back to lazy HuggingFace download on first use (cached locally forever)
//   3. Scores query against the .vector/ binary store using cosine similarity
//
// Store format (nvec1, written by tools/scripts/vault_vector.py):
//   .vector/embeddings.manifest.json — UTF-8 JSON metadata + per-row chunk fields
//     (no embedding inline): chunk_id, page_id, page_path, title?, heading,
//     content_preview, content_hash, ... plus top-level dimension/count/encoding/model.
//   .vector/embeddings.vec — raw little-endian bytes, row-major, count x dimension.
//     encoding "f32": IEEE-754 float32 LE, row i = bytes [i*dim*4, (i+1)*dim*4).
//     encoding "int8": signed int8, decode f = q / 127 (near-unit vectors).
//   Row i of embeddings.vec corresponds to chunks[i] of the manifest.
//   Legacy fallback: .vector/embeddings.json (v0.1, full JSON with embedding
//   inlined as number[] per chunk) is read only if the binary pair is missing.
// ---------------------------------------------------------------------------

import { Notice, Plugin } from 'obsidian';
import type { env as TransformersEnv, pipeline as TransformersPipeline } from '@xenova/transformers';
import { selectTopK } from './semantic-protocol';

// ---------------------------------------------------------------------------
// Model configuration
// ---------------------------------------------------------------------------

// nomic-ai's official ONNX export. The local package is created by
// scripts/fetch-model.sh; a missing local package can use the Hugging Face fallback.
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
  embedding: Float32Array | number[];
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
      // Use the official nomic release, which exposes transformers.js-compatible ONNX assets.
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
 * nomic-embed-text-v1.5 requires asymmetric instruction prefixes:
 *   - "search_query: " for retrieval queries
 *   - "search_document: " for indexed passages
 * tools/scripts/vault_vector.py embeds the corpus WITH the "search_document: "
 * prefix already applied, so we only need to prepend the query prefix here to
 * get correct asymmetric retrieval.
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

interface EmbeddingsManifest {
  version: string;
  format?: string;
  provider: string;
  model: string;
  dimension: number;
  count: number;
  encoding: 'f32' | 'int8';
  quant?: { scheme: string; scale: number } | null;
  prefix_scheme?: string;
  updated?: string;
  chunks: Omit<CorpusChunk, 'embedding'>[];
}

const MANIFEST_PATH = '.vector/embeddings.manifest.json';
const VEC_PATH = '.vector/embeddings.vec';
const LEGACY_JSON_PATH = '.vector/embeddings.json';

let corpusCache: EmbeddingsCorpus | null = null;
let corpusCachePath: string | null = null;

/** Decode a binary manifest+vec pair into an EmbeddingsCorpus with zero-copy (f32) or dequantized (int8) row embeddings. */
async function loadBinaryCorpus(plugin: Plugin): Promise<EmbeddingsCorpus> {
  const manifestRaw = await plugin.app.vault.adapter.read(MANIFEST_PATH);
  const manifest = JSON.parse(manifestRaw) as EmbeddingsManifest;
  const buf = await plugin.app.vault.adapter.readBinary(VEC_PATH);

  const { dimension, count, encoding } = manifest;
  const expectedBytes = count * dimension * (encoding === 'int8' ? 1 : 4);
  if (buf.byteLength !== expectedBytes) {
    throw new Error(
      `Vector store is corrupt or out of date (embeddings.vec is ${buf.byteLength} bytes, expected ${expectedBytes} for count=${count} dim=${dimension} encoding=${encoding}). ` +
      'Re-run `python3 tools/scripts/vault_vector.py embed --force` to rebuild the index.'
    );
  }

  const chunks: CorpusChunk[] = new Array(count);
  if (encoding === 'f32') {
    const f = new Float32Array(buf);
    for (let i = 0; i < count; i++) {
      chunks[i] = {
        ...manifest.chunks[i],
        embedding: f.subarray(i * dimension, (i + 1) * dimension),
      };
    }
  } else {
    const q = new Int8Array(buf);
    for (let i = 0; i < count; i++) {
      const row = new Float32Array(dimension);
      const base = i * dimension;
      for (let j = 0; j < dimension; j++) {
        row[j] = q[base + j] / 127;
      }
      chunks[i] = {
        ...manifest.chunks[i],
        embedding: row,
      };
    }
  }

  return {
    version: manifest.version,
    provider: manifest.provider,
    model: manifest.model,
    dimension,
    chunks,
  };
}

/** Legacy fallback: full-JSON v0.1 store with embeddings inlined per chunk. */
async function loadLegacyJsonCorpus(plugin: Plugin): Promise<EmbeddingsCorpus> {
  const raw = await plugin.app.vault.adapter.read(LEGACY_JSON_PATH);
  return JSON.parse(raw) as EmbeddingsCorpus;
}

export async function loadCorpus(plugin: Plugin): Promise<EmbeddingsCorpus> {
  if (corpusCache && corpusCachePath === MANIFEST_PATH) return corpusCache;

  try {
    corpusCache = await loadBinaryCorpus(plugin);
    corpusCachePath = MANIFEST_PATH;
    return corpusCache;
  } catch (binaryErr) {
    // Only fall back to legacy JSON when the binary pair itself is missing;
    // a corrupt/mismatched binary store should surface its own clear error.
    const msg = binaryErr instanceof Error ? binaryErr.message : String(binaryErr);
    if (msg.includes('Vector store is corrupt')) throw binaryErr;

    try {
      corpusCache = await loadLegacyJsonCorpus(plugin);
      corpusCachePath = MANIFEST_PATH;
      return corpusCache;
    } catch {
      throw new Error(
        'No vector store found. Run `python3 tools/scripts/vault_vector.py embed` to build the semantic index.'
      );
    }
  }
}

/** Invalidate corpus cache (e.g. after re-embedding). */
export function clearCorpusCache(): void {
  corpusCache = null;
  corpusCachePath = null;
}

// ---------------------------------------------------------------------------
// Cosine similarity (pure JS — no WASM, no numpy)
// ---------------------------------------------------------------------------

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
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

  if (corpus.dimension !== qvec.length) {
    new Notice(
      `On-device semantic index is incompatible (${corpus.dimension} dimensions; model returned ${qvec.length}). Rebuild the vector index with nomic-embed-text.`,
      8000,
    );
    return [];
  }

  // Scan once and retain only k rows; this avoids sorting every corpus chunk on iOS.
  return selectTopK(corpus.chunks, (chunk) => {
    if (chunk.embedding.length !== qvec.length) return Number.NaN;
    return cosine(qvec, chunk.embedding);
  }, k).map((chunk) => ({
    chunkId: chunk.chunk_id,
    pageId: chunk.page_id,
    path: chunk.page_path,
    heading: chunk.heading,
    preview: chunk.content_preview,
    score: cosine(qvec, chunk.embedding),
  }));
}

export { MODEL_ID_HF };
