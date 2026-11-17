import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const RUNTIME = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

function runbookSource() {
  const candidates = [
    path.join(path.dirname(RUNTIME), 'docs', 'runbook.md'),
    path.join(path.dirname(RUNTIME), 'runbook.md')
  ];
  return candidates.find(file => existsSync(file)) || '';
}

test('extracted bundle passes its own tests in the shipped layout', { skip: process.env.FB_INSIDE_BUNDLE === '1' }, async () => {
  const source = runbookSource();
  assert.ok(source, 'a runbook must sit beside the runtime or in docs/');
  const pack = await mkdtemp(path.join(tmpdir(), 'fb-pack-'));
  await cp(RUNTIME, path.join(pack, 'runtime'), { recursive: true });
  await cp(source, path.join(pack, 'runbook.md'));
  const tarPath = path.join(pack, 'follow-builders-cloud-runtime.tar.gz');
  await execFileAsync('tar', ['-C', pack, '-czf', tarPath, 'runtime', 'runbook.md']);

  const extracted = await mkdtemp(path.join(tmpdir(), 'fb-ship-'));
  await execFileAsync('tar', ['-C', extracted, '-xzf', tarPath]);
  assert.equal(existsSync(path.join(extracted, 'runtime', 'bin', 'fb.mjs')), true);
  assert.equal(existsSync(path.join(extracted, 'runbook.md')), true);
  assert.equal(existsSync(path.join(extracted, 'docs')), false);
  const runbook = await readFile(path.join(extracted, 'runbook.md'), 'utf8');
  assert.equal(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(runbook), false);

  const env = { ...process.env, FB_INSIDE_BUNDLE: '1' };
  for (const key of Object.keys(env)) {
    if (key === 'NODE_CHANNEL_FD' || key.startsWith('NODE_TEST')) delete env[key];
  }
  const result = await new Promise(resolve => {
    execFile(process.execPath, ['--test'], {
      cwd: path.join(extracted, 'runtime'),
      env,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      resolve({
        code: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
        stdout: stdout || '',
        stderr: stderr || ''
      });
    });
  });
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /# fail 0/);
});
