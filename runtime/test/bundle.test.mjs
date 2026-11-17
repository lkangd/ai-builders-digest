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
  await cp(RUNTIME, path.join(pack, 'runtime'), {
    recursive: true,
    filter: src => !src.split(path.sep).includes('node_modules')
  });
  await cp(source, path.join(pack, 'runbook.md'));
  const tarPath = path.join(pack, 'follow-builders-cloud-runtime.tar.gz');
  await execFileAsync('tar', ['-C', pack, '-czf', tarPath, 'runtime', 'runbook.md']);
  const packed = await execFileAsync('tar', ['-tzf', tarPath]);
  assert.equal(packed.stdout.includes('node_modules/'), false);
  assert.equal(packed.stdout.includes('runtime/package-lock.json'), true);

  const extracted = await mkdtemp(path.join(tmpdir(), 'fb-ship-'));
  await execFileAsync('tar', ['-C', extracted, '-xzf', tarPath]);
  assert.equal(existsSync(path.join(extracted, 'runtime', 'bin', 'fb.mjs')), true);
  assert.equal(existsSync(path.join(extracted, 'runtime', 'node_modules')), false);
  assert.equal(existsSync(path.join(extracted, 'runbook.md')), true);
  assert.equal(existsSync(path.join(extracted, 'docs')), false);
  const runbook = await readFile(path.join(extracted, 'runbook.md'), 'utf8');
  assert.equal(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(runbook), false);

  const cwd = path.join(extracted, 'runtime');
  const install = await execFileAsync('npm', ['ci', '--ignore-scripts'], {
    cwd,
    env: { ...process.env, NODE_ENV: 'development' }
  });
  assert.equal(install.stderr?.includes('npm error') || false, false);
  assert.equal(existsSync(path.join(cwd, 'node_modules', 'parse5', 'package.json')), true);
  const tap = await runExtractedTests(process.execPath, cwd, 'tap');
  assert.equal(tap.code, 0, tap.stderr || tap.stdout);
  const summary = parseTapSummary(tap.stdout);
  assert.equal(summary.fail, 0);
  assert.ok(summary.pass >= 7);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.tests, summary.pass + summary.fail + summary.skipped + summary.cancelled + summary.todo);
  assert.match(tap.stdout, /extracted bundle passes its own tests in the shipped layout # SKIP/);

  const spec = await runExtractedTests(process.execPath, cwd, 'spec');
  assert.equal(spec.code, 0, spec.stderr || spec.stdout);
});

function runExtractedTests(nodeBin, cwd, reporter) {
  const env = { ...process.env, FB_INSIDE_BUNDLE: '1' };
  for (const key of Object.keys(env)) {
    if (key === 'NODE_CHANNEL_FD' || key.startsWith('NODE_TEST')) delete env[key];
  }
  return new Promise(resolve => {
    execFile(nodeBin, [
      '--test',
      '--test-reporter', reporter,
      '--test-reporter-destination', 'stdout'
    ], {
      cwd,
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
}

function parseTapSummary(stdout) {
  const summary = {};
  for (const line of String(stdout).split('\n')) {
    const match = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)\s*$/.exec(line);
    if (match) summary[match[1]] = Number(match[2]);
  }
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    if (!Number.isInteger(summary[key])) {
      throw new Error(`TAP summary missing ${key}\n${stdout}`);
    }
  }
  return summary;
}
