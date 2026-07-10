import { build } from 'esbuild';
import { spawnSync } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const outdir = await mkdtemp(join(tmpdir(), 'vault-search-tests-'));
const outfile = join(outdir, 'semantic-protocol.test.cjs');

try {
  await build({
    entryPoints: ['tests/semantic-protocol.test.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile,
  });
  const result = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(outdir, { recursive: true, force: true });
}
