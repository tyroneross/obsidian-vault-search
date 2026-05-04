import { IndexEntry } from './index';

// ---------------------------------------------------------------------------
// Facet parser — parses "key:value key2:value2 plain text" syntax
// ---------------------------------------------------------------------------

export interface ParsedFacets {
  filters: Array<{ key: string; value: string }>;
  text: string;  // remaining non-key:val tokens
}

/**
 * Splits the query into facet tokens (key:value) and plain text tokens.
 * A facet token is any word matching /^[a-zA-Z_]+:[^\s]+$/.
 */
export function parseFacets(query: string): ParsedFacets {
  const FACET_RE = /^([a-zA-Z_]+):(\S+)$/;
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const filters: Array<{ key: string; value: string }> = [];
  const textTokens: string[] = [];

  for (const token of tokens) {
    const m = FACET_RE.exec(token);
    if (m) {
      filters.push({ key: m[1].toLowerCase(), value: m[2].toLowerCase() });
    } else {
      textTokens.push(token);
    }
  }

  return { filters, text: textTokens.join(' ') };
}

// ---------------------------------------------------------------------------
// Boolean normalisation helpers
// ---------------------------------------------------------------------------

function boolMatch(value: string, field: boolean | undefined): boolean {
  if (field === undefined) return false;
  const v = value.toLowerCase();
  const want = v === 'true' || v === 't' || v === 'yes' || v === '1';
  const wantFalse = v === 'false' || v === 'f' || v === 'no' || v === '0';
  if (want) return field === true;
  if (wantFalse) return field === false;
  return false;
}

// ---------------------------------------------------------------------------
// applyFacets — returns true if entry passes ALL facet filters
// ---------------------------------------------------------------------------

export function applyFacets(entry: IndexEntry, filters: Array<{ key: string; value: string }>): boolean {
  for (const { key, value } of filters) {
    if (!matchFacet(entry, key, value)) return false;
  }
  return true;
}

function matchFacet(entry: IndexEntry, key: string, value: string): boolean {
  switch (key) {
    case 'type':
      return (entry.type?.toLowerCase() ?? '') === value;

    case 'entity_type':
      return (entry.entity_type?.toLowerCase() ?? '') === value;

    case 'concept_type':
      return (entry.concept_type?.toLowerCase() ?? '') === value;

    case 'tool_type':
      return (entry.tool_type?.toLowerCase() ?? '') === value;

    case 'capability_kind':
      return (entry.capability_kind?.toLowerCase() ?? '') === value;

    case 'lab_role':
    case 'role':
      return (entry.lab_role?.toLowerCase() ?? '') === value;

    case 'model_lifecycle':
      return (entry.model_lifecycle?.toLowerCase() ?? '') === value;

    case 'current_default':
      return boolMatch(value, entry.current_default);

    case 'decision_bearing':
      return boolMatch(value, entry.decision_bearing);

    case 'status':
      return (entry.status?.toLowerCase() ?? '') === value;

    case 'tag': {
      // Matches any tag value; supports prefix strip of "domain/"
      const bare = value.includes('/') ? value : value;
      return entry.tags.some(t => {
        const tl = t.toLowerCase();
        // exact match or strip-prefix match
        return tl === bare || tl === `domain/${bare}` || tl.endsWith(`/${bare}`);
      });
    }

    case 'capability':
      return entry.provides_capability.some(c => c.toLowerCase().includes(value));

    case 'stack':
      return (
        entry.member_of.some(m => m.toLowerCase().includes(value)) ||
        (entry.tech_stack?.toLowerCase().includes(value) ?? false)
      );

    case 'lab':
      return (entry.parent_company?.toLowerCase().includes(value) ?? false);

    default:
      // Unknown facet key — skip (don't silently fail the whole filter)
      return true;
  }
}
