import esbuild from 'esbuild';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));
const prod = process.argv[2] === 'production';

// ---------------------------------------------------------------------------
// esbuild config for v0.2.0 — transformers.js + nomic-embed-text-v1.5 ONNX
//
// Key decisions:
//   - @xenova/transformers is BUNDLED (not external) so it ships in main.js
//   - onnxruntime-web WASM binaries are separate assets — transformers.js loads
//     them at runtime from a CDN or a local path. They do NOT get bundled into
//     main.js (100MB limit would break GitHub).
//   - Model weights (.onnx, tokenizer.json etc.) live in
//     .obsidian/plugins/vault-search/models/ and are NOT part of the bundle.
//   - 'http' is marked external because semantic.ts uses it for Ollama health
//     check on desktop (available via Node); on iOS the code-path is never hit.
// ---------------------------------------------------------------------------

const ctx = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: [
    'obsidian',
    'electron',
    'child_process',
    'fs',
    'os',
    'path',
    'util',
    'http',
    'https',
    '@codemirror/*',
  ],
  format: 'cjs',
  target: 'es2020',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  minify: prod,
  // transformers.js references process.env.NODE_ENV to gate debug paths
  define: {
    'process.env.NODE_ENV': prod ? '"production"' : '"development"',
  },
  // Allow @xenova/transformers to be fully traversed and bundled.
  // Its internal require() calls for onnxruntime-web are dynamic — esbuild
  // will warn about them but they resolve fine at runtime via the
  // CDN fallback path built into transformers.js.
  logLevel: 'warning',
});

if (prod) {
  await ctx.rebuild();
  process.exit(0);
} else {
  await ctx.watch();
}
