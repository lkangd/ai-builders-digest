import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizePublicSample, sha256 } from '../lib/normalize-public-sample.mjs';
import { renderEmailHtml, renderEmailText } from '../lib/render-email.mjs';
import { renderPage } from '../lib/render-page.mjs';
import { render } from '../lib/pipeline.mjs';
import { validateIssue } from '../lib/validate.mjs';
import { attr, byClass, byId, byTag, parseHtml, textOf } from './dom.mjs';

const FIXTURE = path.resolve(fileURLToPath(new URL('./fixtures/sample-2026-11-17/', import.meta.url)));
const RUNTIME = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

async function sampleIssue() {
  const bytes = await readFile(path.join(FIXTURE, 'source.public.json'));
  const source = JSON.parse(bytes.toString('utf8'));
  const highlights = JSON.parse(await readFile(path.join(FIXTURE, 'highlights.json'), 'utf8'));
  return normalizePublicSample(source, highlights, { sourceSha256: sha256(bytes) });
}

function hrefs(root) {
  return byTag(root, 'a').map(node => attr(node, 'href'));
}

test('renderer source does not fetch or execute repository code', async () => {
  for (const file of ['render-page.mjs', 'render-email.mjs', 'render-index.mjs', 'validate.mjs', 'normalize-public-sample.mjs']) {
    const source = await readFile(path.join(RUNTIME, 'lib', file), 'utf8');
    assert.equal(/fetch\s*\(/.test(source), false, file);
    assert.equal(source.includes('child_process'), false, file);
  }
});

test('sample page parses, escapes nothing it should invent, and keeps recorded metrics', async () => {
  const issue = await sampleIssue();
  const html = renderPage(issue, { archiveHref: '../../index.html' });
  const doc = parseHtml(html);
  assert.equal(byTag(doc, 'script').length, 0);
  assert.equal(attr(byTag(doc, 'html')[0], 'lang'), 'zh-CN');
  const metas = Object.fromEntries(byTag(doc, 'meta').map(node => [attr(node, 'name'), attr(node, 'content')]));
  assert.equal(metas['gt-edition'], 'sample');
  assert.equal(metas['gt-date'], '2026-11-17');
  assert.equal(metas.robots, 'noindex');
  const title = textOf(byTag(doc, 'title')[0]);
  assert.match(title, /不是正式刊/);
  assert.match(title, /2026-11-17/);
  const text = textOf(doc);
  assert.match(text, /America\/New_York/);
  assert.match(text, /2026-11-17 08:04/);
  assert.match(text, /EST/);
  assert.match(text, /不是 GitHub 官方界面/);
  assert.match(text, /热度不等于成熟度/);
  for (const pick of issue.picks) {
    assert.match(text, new RegExp(pick.metrics.asRecorded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(text, new RegExp(pick.metrics.stars.toLocaleString('en-US')));
    assert.match(text, new RegExp(`\\+${pick.metrics.starsToday.toLocaleString('en-US')}`));
  }
  for (const item of issue.mentions) {
    assert.equal(text.includes(item.note), true);
  }
  assert.equal(byClass(doc, 'pick').length, 6);
  assert.equal(byClass(doc, 'mention').length, 9);
  const links = hrefs(doc);
  assert.equal(links.every(href => href.startsWith('https://') || href.startsWith('./') || href.startsWith('../') || href.startsWith('#')), true);
  assert.equal(links.some(href => href.includes('javascript:')), false);
  assert.equal(links.some(href => href.includes('/trending/2026-11-17')), false);
  assert.equal(links.includes('../../index.html'), true);
  assert.equal(text.includes('person@'), false);
});

test('html is escaped and a missing metric is omitted', async () => {
  const issue = JSON.parse(await readFile(new URL('./fixtures/example/issue.json', import.meta.url), 'utf8'));
  const html = renderPage(issue, { archiveHref: '../../index.html' });
  const doc = parseHtml(html);
  const pick = byId(doc, 'pick-1');
  const labels = byTag(pick, 'dt').map(node => textOf(node));
  assert.deepEqual(labels, ['语言', 'Star 总数']);
  assert.equal(byClass(pick, 'license').length, 0);
  assert.equal(textOf(pick).includes('未知'), false);
  assert.equal(textOf(pick).includes('N/A'), false);
  const hostile = structuredClone(issue);
  hostile.picks[0].purpose = '安全 <script>alert(1)</script> & "引号"';
  const rejected = validateIssue(hostile);
  assert.equal(rejected.ok, false);
  const escaped = parseHtml(renderPage(hostile, { archiveHref: '../../index.html' }));
  assert.equal(byTag(escaped, 'script').length, 0);
  assert.match(textOf(escaped), /<script>alert\(1\)<\/script>/);
  assert.match(textOf(escaped), /& "引号"|引号/);
});

test('email is a 680px table with the same highlights as the text part', async () => {
  const issue = await sampleIssue();
  const html = renderEmailHtml(issue, { pageHref: './index.html' });
  const text = renderEmailText(issue, { pageHref: './index.html' });
  const doc = parseHtml(html);
  assert.equal(byTag(doc, 'script').length, 0);
  assert.equal(byTag(doc, 'img').length, 0);
  const tables = byTag(doc, 'table');
  assert.equal(tables.some(table => attr(table, 'width') === '680'), true);
  assert.match(html, /width:680px/);
  assert.match(html, /max-width:680px/);
  assert.equal(issue.emailHighlights.length >= 3 && issue.emailHighlights.length <= 5, true);
  for (const item of issue.emailHighlights) {
    assert.equal(textOf(doc).includes(item.text), true);
    assert.equal(text.includes(item.text), true);
    assert.equal(text.includes(item.url), true);
    assert.equal(html.includes(item.url), true);
  }
  assert.match(text, /不会通过 Resend 或 Gmail 发送/);
  assert.match(html, /不会通过 Resend 或 Gmail 发送/);
  assert.equal(hrefs(doc).includes('./index.html'), true);
  assert.equal(html.includes('/trending/2026-11-17/'), false);
});

test('rendering the sample never creates a dated archive directory', async () => {
  const issue = await sampleIssue();
  const dest = await mkdtemp(path.join(tmpdir(), 'gt-preview-'));
  const stateDir = await mkdtemp(path.join(tmpdir(), 'gt-state-'));
  const result = await render({ stateDir, dest, issue });
  assert.equal(result.status, 'ok');
  assert.equal(result.shouldSend, false);
  assert.equal(result.publishable, false);
  assert.equal(result.idempotencyKey, 'gt-daily-2026-11-17');
  assert.deepEqual(result.wrote, [
    'trending/preview/sample-2026-11-17/index.html',
    'trending/preview/sample-2026-11-17/email.html',
    'trending/preview/sample-2026-11-17/email.txt',
    'trending/index.html'
  ]);
  await assert.rejects(readFile(path.join(dest, 'trending', '2026-11-17', 'index.html'), 'utf8'));
  const blocked = await render({ stateDir, dest, issue, previewSlug: '2026-11-17' });
  assert.equal(blocked.status, 'error');
  assert.equal(blocked.reason, 'bad-preview-slug');
});
