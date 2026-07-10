import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCliSearchArgs,
  parseSemanticJson,
  selectTopK,
  semanticCacheKey,
} from '../src/semantic-protocol';
import { parseFacets } from '../src/facet';

test('buildCliSearchArgs preserves a query as one subprocess argument', () => {
  const query = 'AI $(touch /tmp/not-run) "strategy"';
  assert.deepEqual(buildCliSearchArgs('/vault/vector.py', query, 12), [
    '/vault/vector.py', 'search', query, '-k', '12', '--walk-graph', '--json',
  ]);
});

test('parseSemanticJson adapts the canonical vector response', () => {
  const results = parseSemanticJson(JSON.stringify({
    results: [{
      page_id: 'source-example',
      page_path: 'wiki/sources/example.md',
      heading: 'Bottom line',
      preview: 'A short preview',
      scores: { final: 0.81234 },
    }],
  }));

  assert.deepEqual(results, [{
    pageId: 'source-example',
    path: 'wiki/sources/example.md',
    heading: 'Bottom line',
    preview: 'A short preview',
    score: '0.8123',
  }]);
});

test('parseSemanticJson rejects malformed responses', () => {
  assert.deepEqual(parseSemanticJson('not json'), []);
  assert.deepEqual(parseSemanticJson(JSON.stringify({ results: [{}] })), []);
});

test('semanticCacheKey isolates corpus and result-count changes', () => {
  assert.notEqual(
    semanticCacheKey('/vault/a.py', 'career strategy', 10),
    semanticCacheKey('/vault/b.py', 'career strategy', 10),
  );
  assert.notEqual(
    semanticCacheKey('/vault/a.py', 'career strategy', 10),
    semanticCacheKey('/vault/a.py', 'career strategy', 20),
  );
});

test('selectTopK returns descending finite scores without a full sort', () => {
  const items = [
    { id: 'low', score: 0.1 },
    { id: 'invalid', score: Number.NaN },
    { id: 'high', score: 0.9 },
    { id: 'mid', score: 0.5 },
  ];
  assert.deepEqual(selectTopK(items, (item) => item.score, 2).map((item) => item.id), ['high', 'mid']);
});

test('parseFacets treats unknown keys as text instead of broadening the result set', () => {
  assert.deepEqual(parseFacets('statuz:active'), { filters: [], text: 'statuz:active' });
  assert.deepEqual(parseFacets('status:active statuz:current'), {
    filters: [{ key: 'status', value: 'active' }],
    text: 'statuz:current',
  });
});
