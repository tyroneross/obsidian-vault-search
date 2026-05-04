import { App, TFile } from 'obsidian';

// ---------------------------------------------------------------------------
// IndexEntry — the in-memory record for each vault markdown file
// ---------------------------------------------------------------------------

export interface IndexEntry {
  path: string;              // vault-relative path
  basename: string;          // filename without ext
  title: string;             // frontmatter title or basename
  aliases: string[];
  type?: string;
  entity_type?: string;
  concept_type?: string;
  tool_type?: string;
  capability_kind?: string;
  lab_role?: string;
  model_lifecycle?: string;
  status?: string;
  current_default?: boolean;
  decision_bearing?: boolean;
  tags: string[];            // domain tags, prefix preserved
  provides_capability: string[];
  member_of: string[];
  tech_stack?: string;
  parent_company?: string;
}

// ---------------------------------------------------------------------------
// Minimal frontmatter parser — top-level scalars + inline lists only.
// No js-yaml. Matches the same shape as snapshot_preferences.py:26-60.
// ---------------------------------------------------------------------------

const FM_RE = /^---\s*\n([\s\S]*?)\n---/;
const KEY_VAL_RE = /^([a-zA-Z_][\w]*)\s*:\s*(.*)$/;
const INLINE_LIST_RE = /^\[(.*)\]$/;

function parseFrontmatter(text: string): Record<string, unknown> {
  const m = FM_RE.exec(text);
  if (!m) return {};
  const body = m[1];
  const fm: Record<string, unknown> = {};

  for (const line of body.split('\n')) {
    const kv = KEY_VAL_RE.exec(line);
    if (!kv) continue;
    const key = kv[1];
    let raw = kv[2].trim();

    // Strip surrounding quotes
    if (raw.length >= 2 && raw[0] === raw[raw.length - 1] && (raw[0] === '"' || raw[0] === "'")) {
      raw = raw.slice(1, -1);
    }

    // Boolean
    if (raw.toLowerCase() === 'true') { fm[key] = true; continue; }
    if (raw.toLowerCase() === 'false') { fm[key] = false; continue; }

    // Inline list  [a, b, c]
    const lm = INLINE_LIST_RE.exec(raw);
    if (lm) {
      const inside = lm[1].trim();
      if (!inside) { fm[key] = []; continue; }
      fm[key] = inside.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      continue;
    }

    fm[key] = raw;
  }
  return fm;
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string') return v || undefined;
  return undefined;
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return (v as unknown[]).map(x => String(x));
  if (typeof v === 'string' && v) return [v];
  return [];
}

function asBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase();
    if (s === 'true' || s === 't' || s === 'yes') return true;
    if (s === 'false' || s === 'f' || s === 'no') return false;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// buildEntry — construct one IndexEntry from a TFile
// ---------------------------------------------------------------------------

export async function buildEntry(app: App, file: TFile): Promise<IndexEntry> {
  const basename = file.basename;

  // Prefer metadataCache; fall back to manual parse
  let fm: Record<string, unknown> = {};
  const cached = app.metadataCache.getFileCache(file);
  if (cached?.frontmatter) {
    fm = cached.frontmatter as Record<string, unknown>;
  } else {
    try {
      const text = await app.vault.cachedRead(file);
      fm = parseFrontmatter(text);
    } catch {
      // file may be gone — leave fm empty
    }
  }

  const title = asString(fm['title']) ?? basename;
  const rawAliases = fm['aliases'];
  // aliases can be inline list or YAML block list (metadataCache normalises to array)
  const aliases = asStringArray(rawAliases);

  return {
    path: file.path,
    basename,
    title,
    aliases,
    type: asString(fm['type']),
    entity_type: asString(fm['entity_type']),
    concept_type: asString(fm['concept_type']),
    tool_type: asString(fm['tool_type']),
    capability_kind: asString(fm['capability_kind']),
    lab_role: asString(fm['lab_role']),
    model_lifecycle: asString(fm['model_lifecycle']),
    status: asString(fm['status']),
    current_default: asBool(fm['current_default']),
    decision_bearing: asBool(fm['decision_bearing']),
    tags: asStringArray(fm['tags']),
    provides_capability: asStringArray(fm['provides_capability']),
    member_of: asStringArray(fm['member_of']),
    tech_stack: asString(fm['tech_stack']),
    parent_company: asString(fm['parent_company']),
  };
}

// ---------------------------------------------------------------------------
// VaultIndex — in-memory map + lifecycle helpers
// ---------------------------------------------------------------------------

export class VaultIndex {
  private entries = new Map<string, IndexEntry>();

  get size(): number { return this.entries.size; }

  set(path: string, entry: IndexEntry): void {
    this.entries.set(path, entry);
  }

  delete(path: string): void {
    this.entries.delete(path);
  }

  get(path: string): IndexEntry | undefined {
    return this.entries.get(path);
  }

  all(): IndexEntry[] {
    return Array.from(this.entries.values());
  }

  async rebuild(app: App): Promise<void> {
    this.entries.clear();
    const files = app.vault.getMarkdownFiles();
    await Promise.all(files.map(async (f) => {
      const entry = await buildEntry(app, f);
      this.entries.set(f.path, entry);
    }));
  }
}
