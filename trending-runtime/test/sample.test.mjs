import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizePublicSample, PUBLIC_SAMPLE_SHA256, sha256 } from '../lib/normalize-public-sample.mjs';
import { validateIssue } from '../lib/validate.mjs';

const FIXTURE = path.resolve(fileURLToPath(new URL('./fixtures/sample-2026-11-17/', import.meta.url)));

async function load() {
  const bytes = await readFile(path.join(FIXTURE, 'source.public.json'));
  const source = JSON.parse(bytes.toString('utf8'));
  const highlights = JSON.parse(await readFile(path.join(FIXTURE, 'highlights.json'), 'utf8'));
  return { bytes, source, highlights, issue: normalizePublicSample(source, highlights, { sourceSha256: sha256(bytes) }) };
}

test('public 2026-11-17 fixture keeps its sha256 and recorded counts', async () => {
  const { bytes, source, issue } = await load();
  assert.equal(sha256(bytes), PUBLIC_SAMPLE_SHA256);
  assert.equal(issue.edition, 'sample');
  assert.equal(issue.sample.notANewIssue, true);
  assert.equal(issue.sample.doNotPublishOrSend, true);
  assert.equal(issue.date, '2026-11-17');
  assert.equal(issue.picks.length, 6);
  assert.equal(issue.mentions.length, 9);
  assert.equal(issue.source.listedRepoCount, 15);
  assert.deepEqual(issue.picks.filter(pick => pick.featured).map(pick => pick.name), ['Cursor Plugins', 'Open Code Review']);
  source.picks.forEach((pick, index) => {
    assert.equal(issue.picks[index].metrics.stars, pick.metrics.stars);
    assert.equal(issue.picks[index].metrics.starsToday, pick.metrics.stars_today);
    assert.equal(issue.picks[index].metrics.language, pick.metrics.language);
    assert.equal(issue.picks[index].metrics.license, pick.metrics.license);
    assert.equal(issue.picks[index].metrics.asRecorded, pick.metrics.as_recorded);
  });
  source.other_listed.forEach((item, index) => {
    assert.equal(issue.mentions[index].stars, item.stars);
    assert.equal(issue.mentions[index].starsToday, item.stars_today);
    assert.equal(issue.mentions[index].note, item.note_as_recorded);
    assert.equal('language' in issue.mentions[index], false);
    assert.equal('license' in issue.mentions[index], false);
  });
  const result = validateIssue(issue);
  assert.equal(result.ok, true, JSON.stringify(result.errors, null, 2));
});

test('the sample adapter refuses to invent an official edition', async () => {
  const { source, highlights } = await load();
  const issue = normalizePublicSample(source, highlights, { sourceSha256: PUBLIC_SAMPLE_SHA256 });
  assert.notEqual(issue.edition, 'official');
  source.picks[0].metrics.stars = 1;
  assert.throws(() => normalizePublicSample(source, highlights, { sourceSha256: PUBLIC_SAMPLE_SHA256 }), /recorded line/);
});
