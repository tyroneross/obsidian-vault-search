// ---------------------------------------------------------------------------
// Semantic mode — shells out to vault_vector.py via child_process.
// Desktop-only; gracefully degrades on iOS or if child_process is unavailable.
// ---------------------------------------------------------------------------

import { Notice } from 'obsidian';

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

let childProcessAvailable: boolean | null = null;

// Lazily check if child_process is available (not available on iOS/mobile)
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

export function isSemanticAvailable(): boolean {
  return getChildProcess() !== null;
}

/**
 * Parse vault_vector.py search stdout.
 * Each result block is:
 *   "N. [0.823] page-id § heading\n   path\n   preview...\n"
 */
export function parseSemanticOutput(stdout: string): SemanticResult[] {
  const results: SemanticResult[] = [];
  // Match lines like: "1. [0.823] page-id § Some Heading"
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
      // Next non-empty line is the path
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
 * Run vault_vector.py search and return parsed results.
 * Uses in-memory cache (TTL=30s, max 5 entries).
 */
export function runSemanticSearch(
  query: string,
  vectorScriptPath: string,
  topK: number,
): Promise<SemanticResult[]> {
  return new Promise((resolve) => {
    // Cache check
    const cached = semanticCache.get(query);
    if (cached && cached.expiresAt > Date.now()) {
      resolve(cached.results);
      return;
    }

    const cp = getChildProcess();
    if (!cp) {
      new Notice('Semantic mode requires desktop Obsidian + vault_vector.py');
      resolve([]);
      return;
    }

    // Expand ~ in path
    const expandedPath = vectorScriptPath.replace(/^~/, process.env.HOME ?? '');
    const cmd = `python3 "${expandedPath}" search "${query.replace(/"/g, '\\"')}" -k ${topK} --walk-graph`;

    cp.exec(cmd, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        console.warn('[vault-search] semantic error:', err.message, stderr);
        new Notice(`Semantic search failed: ${err.message.slice(0, 80)}`);
        resolve([]);
        return;
      }

      const results = parseSemanticOutput(stdout);

      // Evict oldest entry if at capacity
      if (semanticCache.size >= MAX_CACHE_SIZE) {
        const firstKey = semanticCache.keys().next().value;
        if (firstKey !== undefined) semanticCache.delete(firstKey);
      }
      semanticCache.set(query, { results, expiresAt: Date.now() + CACHE_TTL_MS });

      resolve(results);
    });
  });
}

/** Clear the semantic cache (e.g. when the user rebuilds the index). */
export function clearSemanticCache(): void {
  semanticCache.clear();
}
