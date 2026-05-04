// ---------------------------------------------------------------------------
// Semantic mode — three execution paths, one fallback chain:
//
//   Path 1 (CLI)       — desktop + Ollama running: child_process → vault_vector.py
//   Path 2 (on-device) — iOS or Mac without Ollama: transformers.js ONNX in WebView
//   Path 3 (degenerate) — no .vector/embeddings.json: show build notice
//
// Backend selection is governed by VaultSearchSettings.semanticBackend:
//   'auto'       — CLI if available, else on-device
//   'cli'        — CLI only (desktop; returns [] on iOS)
//   'ondevice'   — on-device only
// ---------------------------------------------------------------------------

import { Notice, Plugin } from 'obsidian';
import {
  semanticSearchOnDevice,
  OnDeviceResult,
} from './ondevice';

export interface SemanticResult {
  pageId: string;
  path: string;
  score: string;
  heading: string;
  preview: string;
}

// Simple in-memory cache: query -> { results, expiresAt }
interface CacheEntry {
  results: SemanticResult[];
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;
const MAX_CACHE_SIZE = 5;

const semanticCache = new Map<string, CacheEntry>();

// ---------------------------------------------------------------------------
// CLI path (existing desktop implementation)
// ---------------------------------------------------------------------------

let childProcessAvailable: boolean | null = null;

function getChildProcess(): typeof import('child_process') | null {
  if (childProcessAvailable === false) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cp = require('child_process') as typeof import('child_process');
    childProcessAvailable = true;
    return cp;
  } catch {
    childProcessAvailable = false;
    return null;
  }
}

/** True if child_process is available (i.e. we're on desktop Obsidian). */
export function isCliAvailable(): boolean {
  return getChildProcess() !== null;
}

/**
 * @deprecated Use isCliAvailable() — kept for backwards compat with modal.ts
 */
export function isSemanticAvailable(): boolean {
  return isCliAvailable();
}

/** Check Ollama reachability. Cached for the session after first check. */
let ollamaAvailable: boolean | null = null;

export async function canUseCli(vectorScriptPath: string): Promise<boolean> {
  if (!isCliAvailable()) return false;
  if (ollamaAvailable !== null) return ollamaAvailable;

  // Check if vault_vector.py script exists
  try {
    const fs = require('fs') as typeof import('fs');
    const expandedPath = vectorScriptPath.replace(/^~/, process.env.HOME ?? '');
    if (!fs.existsSync(expandedPath)) {
      ollamaAvailable = false;
      return false;
    }
  } catch {
    ollamaAvailable = false;
    return false;
  }

  // Check Ollama health
  try {
    const http = require('http') as typeof import('http');
    await new Promise<void>((resolve, reject) => {
      const req = http.get('http://127.0.0.1:11434/api/tags', { timeout: 2000 }, (res) => {
        res.resume(); // consume response
        if (res.statusCode && res.statusCode < 400) resolve();
        else reject(new Error(`status ${res.statusCode}`));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
    ollamaAvailable = true;
  } catch {
    ollamaAvailable = false;
  }
  return ollamaAvailable;
}

/** Reset Ollama availability cache (call after settings change). */
export function resetCliAvailabilityCache(): void {
  ollamaAvailable = null;
}

/**
 * Parse vault_vector.py search stdout.
 * Each result block is:
 *   "N. [0.823] page-id § heading\n   path\n   preview...\n"
 */
export function parseSemanticOutput(stdout: string): SemanticResult[] {
  const results: SemanticResult[] = [];
  const LINE_RE = /^\d+\.\s+\[([0-9.]+)\]\s+(\S+)\s+§\s+(.*)$/;

  const lines = stdout.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const m = LINE_RE.exec(line);
    if (m) {
      const score = m[1];
      const pageId = m[2];
      const heading = m[3].trim();
      let path = '';
      let preview = '';
      i++;
      while (i < lines.length && lines[i].trim() === '') i++;
      if (i < lines.length) {
        path = lines[i].trim();
        i++;
      }
      while (i < lines.length && lines[i].trim() === '') i++;
      if (i < lines.length && !LINE_RE.exec(lines[i].trim())) {
        preview = lines[i].trim().replace(/\.\.\.$/, '').trim();
        i++;
      }
      results.push({ pageId, path, score, heading, preview });
    } else {
      i++;
    }
  }
  return results;
}

/**
 * Run vault_vector.py search via child_process (CLI path).
 * Uses in-memory cache (TTL=30s, max 5 entries).
 */
function runCliSearch(
  query: string,
  vectorScriptPath: string,
  topK: number,
): Promise<SemanticResult[]> {
  return new Promise((resolve) => {
    const cached = semanticCache.get(query);
    if (cached && cached.expiresAt > Date.now()) {
      resolve(cached.results);
      return;
    }

    const cp = getChildProcess();
    if (!cp) {
      resolve([]);
      return;
    }

    const expandedPath = vectorScriptPath.replace(/^~/, process.env.HOME ?? '');
    const cmd = `python3 "${expandedPath}" search "${query.replace(/"/g, '\\"')}" -k ${topK} --walk-graph`;

    cp.exec(cmd, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        console.warn('[vault-search] CLI semantic error:', err.message, stderr);
        resolve([]); // caller handles fallback
        return;
      }

      const results = parseSemanticOutput(stdout);

      if (semanticCache.size >= MAX_CACHE_SIZE) {
        const firstKey = semanticCache.keys().next().value;
        if (firstKey !== undefined) semanticCache.delete(firstKey);
      }
      semanticCache.set(query, { results, expiresAt: Date.now() + CACHE_TTL_MS });

      resolve(results);
    });
  });
}

// ---------------------------------------------------------------------------
// On-device result adapter — maps OnDeviceResult to SemanticResult
// ---------------------------------------------------------------------------

function adaptOnDeviceResults(results: OnDeviceResult[]): SemanticResult[] {
  return results.map(r => ({
    pageId: r.pageId,
    path: r.path,
    score: r.score.toFixed(4),
    heading: r.heading,
    preview: r.preview,
  }));
}

// ---------------------------------------------------------------------------
// Public entry point: runSemanticSearch
// ---------------------------------------------------------------------------

/**
 * Run semantic search using the appropriate backend.
 *
 * @param query     Raw query (without the leading '?' — strip it before calling)
 * @param settings  Plugin settings (provides backend preference + script path)
 * @param plugin    Plugin instance (needed for on-device path)
 */
export async function runSemanticSearch(
  query: string,
  vectorScriptPath: string,
  topK: number,
  plugin?: Plugin,
  backend?: 'auto' | 'cli' | 'ondevice',
): Promise<SemanticResult[]> {
  const mode = backend ?? 'auto';
  const isMobile = plugin ? !!(plugin.app as any).isMobile : false;

  // --- CLI path ---
  if (mode === 'cli') {
    if (!isCliAvailable()) {
      new Notice('CLI backend not available on iOS. Switch to "Auto" or "On-device" in settings.');
      return [];
    }
    return runCliSearch(query, vectorScriptPath, topK);
  }

  // --- On-device path ---
  if (mode === 'ondevice') {
    if (!plugin) {
      console.warn('[vault-search] on-device mode requires plugin instance');
      return [];
    }
    return adaptOnDeviceResults(await semanticSearchOnDevice(plugin, query, topK));
  }

  // --- Auto path ---
  // Prefer CLI on desktop when Ollama is running; fall back to on-device
  if (!isMobile && isCliAvailable()) {
    try {
      const cliOk = await canUseCli(vectorScriptPath);
      if (cliOk) {
        const results = await runCliSearch(query, vectorScriptPath, topK);
        if (results.length > 0) return results;
        // CLI ran but returned nothing (empty corpus, cold Ollama, etc.) — fall through
      }
    } catch (err) {
      console.warn('[vault-search] CLI failed, falling back to on-device:', err);
    }
  }

  // On-device fallback (iOS or Mac without Ollama)
  if (!plugin) {
    new Notice('Semantic search: no plugin reference available for on-device mode.');
    return [];
  }
  return adaptOnDeviceResults(await semanticSearchOnDevice(plugin, query, topK));
}

/** Clear the semantic cache (e.g. when the user rebuilds the index). */
export function clearSemanticCache(): void {
  semanticCache.clear();
}
