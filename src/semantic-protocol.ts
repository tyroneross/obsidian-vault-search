export interface SemanticResult {
  pageId: string;
  path: string;
  score: string;
  heading: string;
  preview: string;
}

interface VectorSearchResponse {
  results?: Array<{
    page_id?: unknown;
    page_path?: unknown;
    heading?: unknown;
    preview?: unknown;
    scores?: { final?: unknown; cos?: unknown };
  }>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function displayScore(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(4)
    : '0.0000';
}

/** Arguments for the canonical, machine-readable vault search contract. */
export function buildCliSearchArgs(scriptPath: string, query: string, topK: number): string[] {
  return [scriptPath, 'search', query, '-k', String(topK), '--walk-graph', '--json'];
}

/** Cache entries must not cross a corpus, result-count, or query boundary. */
export function semanticCacheKey(scriptPath: string, query: string, topK: number): string {
  return JSON.stringify([scriptPath, query, topK]);
}

/**
 * Adapt the JSON emitted by vault_vector.py into the modal's small result shape.
 * Returns an empty array for malformed output so Auto mode can fall back locally.
 */
export function parseSemanticJson(stdout: string): SemanticResult[] {
  let payload: VectorSearchResponse;
  try {
    payload = JSON.parse(stdout) as VectorSearchResponse;
  } catch {
    return [];
  }

  if (!Array.isArray(payload.results)) return [];

  return payload.results
    .map((result) => ({
      pageId: asString(result.page_id),
      path: asString(result.page_path),
      score: displayScore(result.scores?.final ?? result.scores?.cos),
      heading: asString(result.heading),
      preview: asString(result.preview),
    }))
    .filter((result) => result.pageId.length > 0 && result.path.length > 0);
}

/**
 * Keep only the best results without allocating and sorting the whole corpus.
 * The small result list is maintained in ascending score order while scanning.
 */
export function selectTopK<T>(items: Iterable<T>, scoreOf: (item: T) => number, k: number): T[] {
  if (k <= 0) return [];

  const top: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const score = scoreOf(item);
    if (!Number.isFinite(score)) continue;
    if (top.length === k && score <= top[0].score) continue;

    let index = top.length;
    while (index > 0 && score < top[index - 1].score) index--;
    top.splice(index, 0, { item, score });
    if (top.length > k) top.shift();
  }

  return top.reverse().map(({ item }) => item);
}
