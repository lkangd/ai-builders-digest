import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mark, mergeConfig, notify, prepare, render, stage, status } from '../lib/pipeline.mjs';
import { renderPage } from '../lib/render-page.mjs';
import { redactForStdout } from '../lib/util.mjs';
import { officialIssue } from './official-shape.mjs';

const execFileAsync = promisify(execFile);
const BIN = path.resolve(fileURLToPath(new URL('../bin/gt.mjs', import.meta.url)));
const EXAMPLE = path.resolve(fileURLToPath(new URL('./fixtures/example/issue.json', import.meta.url)));

async function tempDir(prefix) {
  return mkdtemp(path.join(tmpdir(), prefix));
}

function pagesFetch(body, status = 200) {
  return async () => ({ ok: status === 200, status, text: async () => body });
}

test('prepare does not fetch, and an empty state treats every date as new', async () => {
  const stateDir = await tempDir('gt-prepare-');
  const ready = await prepare({ stateDir, now: '2099-01-05T13:00:00Z' });
  assert.equal(ready.action, 'intake');
  assert.equal(ready.timezone, 'America/New_York');
  assert.equal(ready.includeWeekends, true);
  assert.equal(ready.emailSuppressed, false);
  assert.equal(ready.doesNot.includes('fetch-trending'), true);
  assert.equal(ready.doesNot.includes('call-llm'), true);
  assert.equal(ready.allowedPublishPaths.includes('index.html'), false);
  const historical = await prepare({ stateDir, now: '2026-11-17T13:04:00Z' });
  assert.equal(historical.date, '2026-11-17');
  assert.equal(historical.action, 'intake');
  assert.equal(historical.emailSuppressed, false);
  const empty = await status({ stateDir, now: '2099-01-05T13:00:00Z' });
  assert.deepEqual(empty.recordedSends, []);
  assert.equal(empty.day, null);
  assert.equal(Object.hasOwn(empty, 'migration'), false);
});

test('private config keys and a state directory inside the package are refused', async () => {
  assert.throws(() => mergeConfig({ email: 'person@example.invalid' }), /GT_NOTIFY_TO/);
  assert.throws(() => mergeConfig({ resend_api_key: 'secret' }), /Credentials/);
  assert.throws(() => mergeConfig({ timezone: 'Asia/Shanghai' }), /America\/New_York/);
  const inside = path.resolve(fileURLToPath(new URL('..', import.meta.url)), 'state');
  await assert.rejects(status({ stateDir: inside }), /runtime package/);
});

test('Gmail sent-state blocks only that date; previews never send; a new date still can', async () => {
  const stateDir = await tempDir('gt-mail-');
  const env = { GT_NOTIFY_TO: 'person@example.invalid', GT_NOTIFY_FROM: 'desk@example.invalid' };
  let fetched = false;
  const boom = async () => {
    fetched = true;
    throw new Error('notify must not fetch once Gmail has recorded this date');
  };
  const before = await notify({ stateDir, date: '2026-11-17', env, fetchImpl: boom });
  assert.equal(before.shouldSend, false);
  assert.equal(before.reason, 'not-rendered');
  assert.equal(fetched, false);

  const recorded = await mark({ stateDir, date: '2026-11-17', recordGmailSent: true });
  assert.equal(recorded.day.channel, 'gmail');
  assert.equal(recorded.day.sendResult, 'sent');
  assert.equal(recorded.day.notified, true);
  const again = await mark({ stateDir, date: '2026-11-17', recordGmailSent: true });
  assert.equal(again.reason, 'already-recorded');
  const blockedPrepare = await prepare({ stateDir, now: '2026-11-17T13:04:00Z' });
  assert.equal(blockedPrepare.action, 'skip');
  assert.equal(blockedPrepare.reason, 'already-sent-gmail');
  const openDay = await prepare({ stateDir, now: '2099-01-05T13:00:00Z' });
  assert.equal(openDay.action, 'intake');
  assert.equal(openDay.emailSuppressed, false);

  const payload = await notify({ stateDir, date: '2026-11-17', env, fetchImpl: boom });
  assert.equal(fetched, false);
  assert.equal(payload.shouldSend, false);
  assert.equal(payload.reason, 'already-sent-gmail');
  assert.equal(payload.resend, null);
  assert.equal(payload.idempotencyKey, 'gt-daily-2026-11-17');
  assert.equal(JSON.stringify(redactForStdout(payload)).includes('example.invalid'), false);
  const marked = await mark({ stateDir, date: '2026-11-17', notified: true, published: true, fetchImpl: boom });
  assert.equal(fetched, false);
  assert.equal(marked.reason, 'already-sent-gmail');

  const listed = await status({ stateDir, now: '2099-01-05T13:00:00Z' });
  assert.deepEqual(listed.recordedSends.map(item => item.date), ['2026-11-17']);
  assert.equal(listed.recordedSends[0].channel, 'gmail');

  const fresh = officialIssue();
  const page = renderPage(fresh);
  await render({ stateDir, issue: fresh });
  const ready = await notify({ stateDir, date: '2099-01-05', env, fetchImpl: pagesFetch(page) });
  assert.equal(ready.shouldSend, true);
  assert.equal(ready.reason, 'ready');

  const example = JSON.parse(await readFile(EXAMPLE, 'utf8'));
  await render({ stateDir, issue: example });
  const preview = await notify({ stateDir, date: '2000-01-01', env, fetchImpl: pagesFetch('<html></html>') });
  assert.equal(preview.shouldSend, false);
  assert.equal(preview.reason, 'not-an-official-issue');
  assert.equal(preview.resend, null);
});

test('official notify waits for the real page, then refuses a second or unknown send', async () => {
  const stateDir = await tempDir('gt-send-');
  const dest = await tempDir('gt-send-dest-');
  const issue = officialIssue();
  const rendered = await render({ stateDir, dest, issue });
  assert.equal(rendered.wrote.includes('trending/2099-01-05/index.html'), true);
  assert.equal(existsSync(path.join(dest, 'index.html')), false);
  const env = { GT_NOTIFY_TO: 'person@example.invalid', GT_NOTIFY_FROM: 'desk@example.invalid' };
  const offline = await notify({ stateDir, date: '2099-01-05', env, fetchImpl: pagesFetch('', 404) });
  assert.equal(offline.shouldSend, false);
  assert.equal(offline.reason, 'page-not-live');
  const page = await readFile(path.join(dest, 'trending', '2099-01-05', 'index.html'), 'utf8');
  const stale = page.replace('gt-edition" content="official"', 'gt-edition" content="sample"');
  const notOfficial = await notify({ stateDir, date: '2099-01-05', env, fetchImpl: pagesFetch(stale) });
  assert.equal(notOfficial.reason, 'page-not-official');
  const ready = await notify({ stateDir, date: '2099-01-05', env, fetchImpl: pagesFetch(page) });
  assert.equal(ready.shouldSend, true);
  assert.equal(ready.resend.idempotencyKey, 'gt-daily-2099-01-05');
  assert.equal(ready.resend.html.includes(issue.emailHighlights[0].text), true);
  assert.equal(ready.resend.text.includes(issue.emailHighlights[0].text), true);
  const again = await notify({ stateDir, date: '2099-01-05', env, fetchImpl: pagesFetch(page) });
  assert.equal(again.idempotencyKey, ready.idempotencyKey);
  const published = await mark({
    stateDir,
    date: '2099-01-05',
    published: true,
    notified: true,
    fetchImpl: pagesFetch(page)
  });
  assert.equal(published.day.channel, 'resend');
  const duplicate = await notify({ stateDir, date: '2099-01-05', env, fetchImpl: pagesFetch(page) });
  assert.equal(duplicate.shouldSend, false);
  assert.equal(duplicate.reason, 'already-notified');

  const other = await tempDir('gt-unknown-');
  await render({ stateDir: other, issue });
  await mark({ stateDir: other, date: '2099-01-05', sendUnknown: true });
  const unknown = await notify({ stateDir: other, date: '2099-01-05', env, fetchImpl: pagesFetch(renderPage(issue)) });
  assert.equal(unknown.shouldSend, false);
  assert.equal(unknown.reason, 'send-result-unknown');
});

test('stage only writes the trending namespace and will not overwrite an archive', async () => {
  const stateDir = await tempDir('gt-stage-');
  const dest = await tempDir('gt-stage-dest-');
  const sentinel = '<!DOCTYPE html><title>builders-root</title>';
  await writeFile(path.join(dest, 'index.html'), sentinel);
  const issue = officialIssue();
  await render({ stateDir, issue });
  const staged = await stage({ stateDir, date: '2099-01-05', dest });
  assert.deepEqual(staged.wrote, ['trending/2099-01-05/index.html', 'trending/index.html']);
  assert.equal(await readFile(path.join(dest, 'index.html'), 'utf8'), sentinel);
  const second = await stage({ stateDir, date: '2099-01-05', dest });
  assert.equal(second.reason, 'archive-exists');
  assert.deepEqual(second.wrote, []);
  const sampleState = await tempDir('gt-stage-sample-');
  const example = JSON.parse(await readFile(EXAMPLE, 'utf8'));
  await render({ stateDir: sampleState, issue: example });
  const refused = await stage({ stateDir: sampleState, date: '2000-01-01', dest });
  assert.equal(refused.reason, 'not-publishable');
  assert.equal(existsSync(path.join(dest, 'trending', '2000-01-01', 'index.html')), false);
});

test('the cli validate and notify commands stay local', async () => {
  const stateDir = await tempDir('gt-cli-');
  const valid = await execFileAsync(process.execPath, [BIN, 'validate', '--state', stateDir, '--issue', EXAMPLE]);
  const parsed = JSON.parse(valid.stdout);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.publishable, false);
  const noted = await execFileAsync(process.execPath, [BIN, 'notify', '--state', stateDir, '--date', '2026-11-17'], {
    env: { ...process.env, GT_NOTIFY_TO: '', GT_NOTIFY_FROM: '' }
  });
  const payload = JSON.parse(noted.stdout);
  assert.equal(payload.shouldSend, false);
  assert.equal(payload.reason, 'not-rendered');
  assert.equal(payload.resend, null);
  const recorded = await execFileAsync(process.execPath, [
    BIN, 'mark', '--state', stateDir, '--date', '2026-11-17', '--record-gmail-sent'
  ]);
  assert.equal(JSON.parse(recorded.stdout).day.channel, 'gmail');
  const blocked = await execFileAsync(process.execPath, [BIN, 'notify', '--state', stateDir, '--date', '2026-11-17'], {
    env: { ...process.env, GT_NOTIFY_TO: '', GT_NOTIFY_FROM: '' }
  });
  const after = JSON.parse(blocked.stdout);
  assert.equal(after.shouldSend, false);
  assert.equal(after.reason, 'already-sent-gmail');
});
