// ---------------------------------------------------------------------------
// Search router — dispatches to Quick, Facet, or Semantic mode
// ---------------------------------------------------------------------------

import { Plugin } from 'obsidian';
import { IndexEntry, VaultIndex } from './index';
import { parseFacets, applyFacets } from './facet';
import { rankEntries, RankedEntry } from './ranking';
import { runSemanticSearch, SemanticResult } from './semantic';
import { VaultSearchSettings } from './settings';

export type SearchMode = 'quick' | 'facet' | 'semantic';

export interface QuickResult {
  mode: 'quick' | 'facet';
  entry: IndexEntry;
}

export interface SemanticSearchResult {
  mode: 'semantic';
  result: SemanticResult;
}

export type SearchResult = QuickResult | SemanticSearchResult;

/** Detect which mode based on the raw query string. */
export function detectMode(query: string): SearchMode {
  const trimmed = query.trim();
  if (trimmed.startsWith('?')) return 'semantic';
  // Facet if any token matches key:value
  if (/[a-zA-Z_]+:\S+/.test(trimmed)) return 'facet';
  return 'quick';
}

// ---------------------------------------------------------------------------
// Quick search
// ---------------------------------------------------------------------------

function quickSearch(
  index: VaultIndex,
  query: string,
  maxResults: number,
): QuickResult[] {
  if (!query.trim()) return [];
  const ranked: RankedEntry[] = rankEntries(index.all(), query, maxResults);
  return ranked.map(r => ({ mode: 'quick' as const, entry: r.entry }));
}

// ---------------------------------------------------------------------------
// Facet search
// ---------------------------------------------------------------------------

function facetSearch(
  index: VaultIndex,
  query: string,
  maxResults: number,
): QuickResult[] {
  const { filters, text } = parseFacets(query);
  let candidates = index.all().filter(e => applyFacets(e, filters));

  // If there's remaining plain text, apply Quick-mode ranking on top
  if (text.trim()) {
    const ranked = rankEntries(candidates, text.trim(), maxResults);
    return ranked.map(r => ({ mode: 'facet' as const, entry: r.entry }));
  }

  // No plain text — return all matching, sorted by title
  candidates = candidates
    .slice(0, maxResults)
    .sort((a, b) => a.title.localeCompare(b.title));

  return candidates.map(e => ({ mode: 'facet' as const, entry: e }));
}

// ---------------------------------------------------------------------------
// Semantic search
// ---------------------------------------------------------------------------

async function semanticSearch(
  rawQuery: string,
  settings: VaultSearchSettings,
  plugin?: Plugin,
): Promise<SemanticSearchResult[]> {
  if (!settings.semanticEnabled) {
    return [];
  }

  const query = rawQuery.replace(/^\?/, '').trim();
  if (!query) return [];

  const results = await runSemanticSearch(
    query,
    settings.vectorScriptPath,
    settings.maxResults,
    plugin,
    settings.semanticBackend,
  );
  return results.map(r => ({ mode: 'semantic' as const, result: r }));
}

// ---------------------------------------------------------------------------
// Top-level router
// ---------------------------------------------------------------------------

export async function search(
  index: VaultIndex,
  query: string,
  settings: VaultSearchSettings,
  plugin?: Plugin,
): Promise<SearchResult[]> {
  const mode = detectMode(query);

  switch (mode) {
    case 'semantic':
      return semanticSearch(query, settings, plugin);
    case 'facet':
      return facetSearch(index, query, settings.maxResults);
    case 'quick':
    default:
      return quickSearch(index, query, settings.maxResults);
  }
}
