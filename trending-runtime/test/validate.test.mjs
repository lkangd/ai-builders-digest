import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateIssue } from '../lib/validate.mjs';
import { officialIssue } from './official-shape.mjs';

const exampleUrl = new URL('./fixtures/example/issue.json', import.meta.url);

function codes(result) {
  return result.errors.map(error => error.code);
}

test('explicit example fixture is valid and is not an official issue', async () => {
  const issue = JSON.parse(await readFile(exampleUrl, 'utf8'));
  const result = validateIssue(issue);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
  assert.equal(result.warnings.some(item => item.code === 'below-target'), true);
  assert.equal(issue.edition, 'example');
  assert.equal('starsToday' in issue.picks[0].metrics, false);
  assert.equal('license' in issue.picks[0].metrics, false);
});

test('schema file names the fields the validator requires', async () => {
  const schema = JSON.parse(await readFile(new URL('../schema/issue.schema.json', import.meta.url), 'utf8'));
  for (const key of ['edition', 'date', 'collectedAt', 'source', 'picks', 'emailHighlights']) {
    assert.equal(schema.required.includes(key), true);
  }
  assert.equal(schema.properties.picks.maxItems, 8);
  assert.equal(schema.properties.emailHighlights.minItems, 3);
  assert.equal(schema.properties.emailHighlights.maxItems, 5);
});

test('estimated metrics, raw html, javascript links, and mailboxes are rejected', () => {
  const issue = officialIssue();
  issue.picks[0].metrics.stars = '约1000';
  issue.picks[0].purpose = '带 <script>alert(1)</script> 的文本';
  issue.picks[0].url = 'javascript:alert(1)';
  issue.intro = '写给 person@example.invalid 的句子';
  const result = validateIssue(issue);
  assert.equal(result.ok, false);
  const found = codes(result);
  assert.equal(found.includes('metric-stars'), true);
  assert.equal(found.includes('raw-html'), true);
  assert.equal(found.includes('pick-url'), true);
  assert.equal(found.includes('email-address'), true);
});

test('a placeholder language is rejected and an omitted one is not invented', () => {
  const missing = officialIssue();
  delete missing.picks[0].metrics.language;
  missing.picks[0].metrics.asRecorded = 'MIT · 2 stars · 今日 +1';
  assert.equal(validateIssue(missing).ok, true);
  const placeholder = officialIssue();
  placeholder.picks[0].metrics.language = '未知';
  assert.equal(codes(validateIssue(placeholder)).includes('metric-language'), true);
});

test('the collected New York time has to match the issue date', () => {
  const issue = officialIssue('2099-01-05');
  issue.collectedAt = '2099-01-06T08:00:00-05:00';
  assert.equal(codes(validateIssue(issue)).includes('collected-at'), true);
});

test('an official issue cannot be disguised as the public sample', () => {
  const issue = officialIssue('2026-11-17');
  issue.collectedAt = '2026-11-17T08:04:00-05:00';
  issue.collectedAtLabel = '2026-11-17 08:04';
  issue.sample = { purpose: 'design-regression-only', notANewIssue: true, doNotPublishOrSend: true };
  const result = validateIssue(issue);
  assert.equal(result.ok, false);
  assert.equal(codes(result).includes('edition'), true);
});
