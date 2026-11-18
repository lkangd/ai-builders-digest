import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const RUNTIME = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function runbookSource() {
  const candidates = [
    path.join(path.dirname(RUNTIME), 'docs', 'trending-runbook.md'),
    path.join(path.dirname(RUNTIME), 'runbook.md')
  ];
  return candidates.find(file => existsSync(file)) || '';
}

async function filesIn(dir) {
  const found = [];
  async function walk(current) {
    for (const name of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, name.name);
      if (name.isDirectory()) {
        if (name.name === 'node_modules') continue;
        await walk(full);
      } else found.push(full);
    }
  }
  await walk(dir);
  return found;
}

test('extracted bundle passes its own tests without private mail or node_modules', { skip: process.env.GT_INSIDE_BUNDLE === '1' }, async () => {
  const source = runbookSource();
  assert.ok(source, 'trending runbook must sit in docs/ or beside the runtime');
  const pack = await mkdtemp(path.join(tmpdir(), 'gt-pack-'));
  await cp(RUNTIME, path.join(pack, 'runtime'), {
    recursive: true,
    filter: src => !src.split(path.sep).includes('node_modules') && !src.split(path.sep).includes('state')
  });
  await cp(source, path.join(pack, 'runbook.md'));
  const tarPath = path.join(pack, 'github-trending-digest-runtime.tar.gz');
  await execFileAsync('tar', ['-C', pack, '-czf', tarPath, 'runtime', 'runbook.md']);
  const packed = await execFileAsync('tar', ['-tzf', tarPath]);
  assert.equal(packed.stdout.includes('node_modules/'), false);
  assert.equal(packed.stdout.includes('runtime/state/'), false);
  assert.equal(packed.stdout.includes('runtime/package-lock.json'), true);
  assert.equal(packed.stdout.includes('runtime/bin/gt.mjs'), true);

  const extracted = await mkdtemp(path.join(tmpdir(), 'gt-ship-'));
  await execFileAsync('tar', ['-C', extracted, '-xzf', tarPath]);
  const runbook = await readFile(path.join(extracted, 'runbook.md'), 'utf8');
  assert.equal(EMAIL_RE.test(runbook), false);
  for (const file of await filesIn(path.join(extracted, 'runtime'))) {
    const text = await readFile(file, 'utf8');
    const emails = text.match(EMAIL_RE) || [];
    for (const email of emails) assert.equal(email.endsWith('@example.invalid'), true, `${file} has ${email}`);
  }

  const cwd = path.join(extracted, 'runtime');
  const install = await execFileAsync('npm', ['ci', '--ignore-scripts'], {
    cwd,
    env: { ...process.env, NODE_ENV: 'development' }
  });
  assert.equal(install.stderr?.includes('npm error') || false, false);
  const tap = await runExtractedTests(cwd);
  assert.equal(tap.code, 0, tap.stderr || tap.stdout);
  const summary = parseTapSummary(tap.stdout);
  assert.equal(summary.fail, 0);
  assert.equal(summary.skipped, 2);
  assert.ok(summary.pass >= 8);
  assert.equal(summary.tests, summary.pass + summary.fail + summary.skipped + summary.cancelled + summary.todo);
});

function runExtractedTests(cwd) {
  const env = { ...process.env, GT_INSIDE_BUNDLE: '1' };
  for (const key of Object.keys(env)) {
    if (key === 'NODE_CHANNEL_FD' || key.startsWith('NODE_TEST')) delete env[key];
  }
  return new Promise(resolve => {
    execFile(process.execPath, ['--test', '--test-reporter', 'tap', '--test-reporter-destination', 'stdout'], {
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
    if (!Number.isInteger(summary[key])) throw new Error(`TAP summary missing ${key}\n${stdout}`);
  }
  return summary;
}
