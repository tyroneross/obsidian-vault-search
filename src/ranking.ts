import { IndexEntry } from './index';

// ---------------------------------------------------------------------------
// Ranking scores (lower = better rank)
// ---------------------------------------------------------------------------

export const enum MatchTier {
  ExactFilename  = 0,
  ExactAlias     = 1,
  PrefixFilename = 2,
  PrefixAlias    = 3,
  SubFilename    = 4,
  SubAlias       = 5,
}

export interface RankedEntry {
  entry: IndexEntry;
  tier: MatchTier;
}

/**
 * Returns a MatchTier for a single query against a single IndexEntry,
 * or null if there is no match.
 */
export function matchTier(query: string, entry: IndexEntry): MatchTier | null {
  const q = query.toLowerCase();

  const fn = entry.basename.toLowerCase();
  if (fn === q) return MatchTier.ExactFilename;
  if (fn.startsWith(q)) return MatchTier.PrefixFilename;

  for (const alias of entry.aliases) {
    const a = alias.toLowerCase();
    if (a === q) return MatchTier.ExactAlias;
  }
  for (const alias of entry.aliases) {
    const a = alias.toLowerCase();
    if (a.startsWith(q)) return MatchTier.PrefixAlias;
  }

  if (fn.includes(q)) return MatchTier.SubFilename;

  for (const alias of entry.aliases) {
    if (alias.toLowerCase().includes(q)) return MatchTier.SubAlias;
  }

  // Also check title for substring
  if (entry.title.toLowerCase().includes(q)) return MatchTier.SubFilename;

  return null;
}

/**
 * Rank a list of entries by their best tier for the query.
 * Returns at most maxResults entries sorted best-first.
 */
export function rankEntries(
  entries: IndexEntry[],
  query: string,
  maxResults: number,
): RankedEntry[] {
  if (!query) return [];

  const ranked: RankedEntry[] = [];
  for (const entry of entries) {
    const tier = matchTier(query, entry);
    if (tier !== null) {
      ranked.push({ entry, tier });
    }
  }

  ranked.sort((a, b) => a.tier - b.tier);
  return ranked.slice(0, maxResults);
}
