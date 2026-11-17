import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { applySummary, fingerprintOf, normalizeFeeds } from '../lib/feed.mjs';
import { mark, notify, plan, prepare, render, stage, status, withLock } from '../lib/pipeline.mjs';
import { renderDigestHtml } from '../lib/render.mjs';
import { latestDateFromRoot, redactForStdout, zonedParts } from '../lib/util.mjs';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const FEEDS = path.join(FIXTURES, 'feeds');
const SUMMARY = path.join(FIXTURES, 'summary.json');
const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DOCS = path.resolve(fileURLToPath(new URL('../../docs/', import.meta.url)));
const NOW = '2026-11-16T16:30:00.000Z';
const DATE = '2026-11-17';

function mockFetch(routes) {
  return async url => {
    const hit = routes[url];
    if (!hit) {
      return { ok: false, status: 404, text: async () => 'missing', json: async () => ({}) };
    }
    return {
      ok: hit.status >= 200 && hit.status < 300,
      status: hit.status,
      text: async () => hit.text || '',
      json: async () => hit.json
    };
  };
}

async function workspace() {
  return mkdtemp(path.join(tmpdir(), 'fb-digest-'));
}

test('Shanghai date crosses midnight UTC and keeps weekends', () => {
  assert.deepEqual(zonedParts(new Date('2026-11-16T15:59:00.000Z'), 'Asia/Shanghai'), {
    date: '2026-11-16',
    time: '23:59',
    weekday: 'Mon'
  });
  assert.equal(zonedParts(new Date('2026-11-16T16:00:00.000Z'), 'Asia/Shanghai').date, '2026-11-17');
  assert.equal(zonedParts(new Date('2026-11-16T16:00:00.000Z'), 'Asia/Shanghai').time, '00:00');
  const saturday = zonedParts(new Date('2026-11-13T16:30:00.000Z'), 'Asia/Shanghai');
  assert.equal(saturday.date, '2026-11-14');
  assert.equal(saturday.weekday, 'Sat');
});

test('fingerprint ignores engagement counts and drops items without urls', () => {
  const warnings = [];
  const limits = { tweetsPerBuilder: 8, podcasts: 1, transcriptChars: 20, blogChars: 20, rssChars: 20 };
  const base = {
    x: {
      x: [{
        handle: 'fixture_builder',
        name: 'Fixture Builder',
        bio: 'FIXTURE',
        tweets: [
          { text: 'FIXTURE tweet', url: 'https://example.invalid/fixture/tweet-1', likes: 1 },
          { text: 'FIXTURE_DROPPED_TWEET', likes: 9 }
        ]
      }]
    },
    podcasts: { podcasts: [] },
    blogs: { blogs: [] }
  };
  const first = normalizeFeeds(base, limits, warnings);
  const second = normalizeFeeds(JSON.parse(JSON.stringify(base).replace('"likes": 1', '"likes": 40')), limits, []);
  assert.equal(first.x[0].tweets.length, 1);
  assert.equal(fingerprintOf(first), fingerprintOf(second));
  assert.ok(warnings.some(item => item.includes('without an http(s) url')));
});

test('prepare, render, stage, and notify stay idempotent on labelled fixtures', async () => {
  const stateDir = await workspace();
  const prepared = await prepare({ stateDir, now: NOW, feedsDir: FEEDS });
  assert.equal(prepared.status, 'ok');
  assert.equal(prepared.action, 'summarize');
  assert.equal(prepared.date, DATE);
  assert.equal(prepared.stats.totalTweets, 2);
  assert.equal(prepared.stats.podcastEpisodes, 1);
  assert.equal(prepared.stats.blogPosts, 1);
  assert.equal(prepared.config.timezone, 'Asia/Shanghai');
  assert.equal(prepared.config.includeWeekends, true);
  const prepareDoc = JSON.parse(await readFile(prepared.paths.prepare, 'utf8'));
  assert.match(prepareDoc.prompts.translate, /Mandarin Chinese/);
  assert.equal(JSON.stringify(prepareDoc).includes('FIXTURE_DROPPED_TWEET'), false);
  assert.equal(JSON.stringify(prepareDoc).includes('FIXTURE_DROPPED_BLOG'), false);
  assert.equal(JSON.stringify(prepareDoc).includes('FIXTURE_OLD_PODCAST'), false);
  assert.equal(prepareDoc.notification, undefined);

  const weekend = await prepare({
    stateDir: await workspace(),
    now: '2026-11-13T16:30:00.000Z',
    feedsDir: FEEDS
  });
  assert.equal(weekend.date, '2026-11-14');
  assert.equal(weekend.action, 'summarize');

  const rendered = await render({ stateDir, now: NOW, summaryPath: SUMMARY });
  assert.equal(rendered.action, 'rendered');
  assert.equal(rendered.highlightCount, 3);
  assert.ok(rendered.warnings.some(item => item.includes('not in the prepared feed')));
  const digest = await readFile(rendered.paths.digest, 'utf8');
  const root = await readFile(rendered.paths.root, 'utf8');
  assert.match(digest, /#ff385c/);
  assert.match(digest, /mobile-shell/);
  assert.match(digest, /Inter/);
  assert.match(digest, /Intelligence Summary/);
  assert.match(digest, /Today's Highlights/);
  assert.match(digest, /Generated 2026-11-17 00:30/);
  assert.match(digest, /2026-11-16 08:00/);
  assert.match(digest, /夹具译文一。&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.equal(digest.includes('<script>alert(1)</script>'), false);
  assert.match(digest, /FIXTURE builder summary/);
  assert.match(digest, /夹具播客译文/);
  assert.match(digest, /youtube\.com\/embed\/Fixture1/);
  assert.match(digest, /Quoted/);
  assert.match(digest, /https:\/\/x\.com\/i\/status\/999/);
  assert.equal(digest.includes('FIXTURE_TRANSCRIPT_BODY_DO_NOT_EMAIL'), false);
  assert.equal(digest.includes('FIXTURE invented'), false);
  assert.match(root, /rel="canonical" href="https:\/\/lkangd\.github\.io\/ai-builders-digest\/2026-11-17\/"/);
  assert.equal(latestDateFromRoot(root), DATE);

  const again = await prepare({ stateDir, now: NOW, feedsDir: FEEDS });
  assert.equal(again.action, 'render-ready');
  assert.equal(again.fingerprint, prepared.fingerprint);

  const absent = mockFetch({});
  const planned = await plan({ stateDir, now: NOW, fetchImpl: absent });
  assert.equal(planned.action, 'open-pr');
  assert.deepEqual(planned.guards.allowedPaths, [`${DATE}/index.html`, 'index.html']);
  assert.ok(planned.guards.deny.includes('push-to-main'));
  assert.ok(planned.guards.deny.includes('request-gh-token'));
  assert.equal(planned.files.some(file => file.path.includes('1999')), false);

  const dest = await workspace();
  await mkdir(path.join(dest, '1999-01-01'), { recursive: true });
  await writeFile(path.join(dest, '1999-01-01/index.html'), 'KEEP-OLD-ARCHIVE');
  await writeFile(path.join(dest, 'index.html'), root.replaceAll(DATE, '1999-01-01'));
  await writeFile(path.join(dest, '.nojekyll'), 'keep\n');
  const staged = await stage({ stateDir, now: NOW, dest, fetchImpl: absent });
  assert.equal(staged.action, 'staged');
  assert.deepEqual(staged.wrote.sort(), [`${DATE}/index.html`, 'index.html'].sort());
  assert.equal(await readFile(path.join(dest, '1999-01-01/index.html'), 'utf8'), 'KEEP-OLD-ARCHIVE');
  assert.equal(await readFile(path.join(dest, '.nojekyll'), 'utf8'), 'keep\n');
  assert.equal(latestDateFromRoot(await readFile(path.join(dest, 'index.html'), 'utf8')), DATE);
  const names = await readdir(dest);
  assert.deepEqual(names.sort(), ['.nojekyll', '1999-01-01', DATE, 'index.html'].sort());
  const firstDigest = await readFile(path.join(dest, DATE, 'index.html'));
  const second = await stage({ stateDir, now: NOW, dest, fetchImpl: absent });
  assert.equal(second.action, 'skip');
  assert.equal(second.reason, 'archive-exists-in-checkout');
  assert.deepEqual(await readFile(path.join(dest, DATE, 'index.html')), firstDigest);

  const blocked = await notify({
    stateDir,
    now: NOW,
    fetchImpl: absent,
    env: { FB_NOTIFY_TO: 'fixture-recipient@example.invalid', FB_NOTIFY_FROM: 'fixture-from@example.invalid' }
  });
  assert.equal(blocked.shouldSend, false);
  assert.equal(blocked.reason, 'page-not-live');
  assert.equal(blocked.html.includes('FIXTURE_TRANSCRIPT_BODY_DO_NOT_EMAIL'), false);
  assert.equal(blocked.html.includes('FIXTURE tweet two'), false);
  assert.match(blocked.html, /FIXTURE highlight one/);
  assert.match(blocked.text, new RegExp(`Full digest: https://lkangd.github.io/ai-builders-digest/${DATE}/`));

  const liveHtml = await readFile(rendered.paths.digest, 'utf8');
  const live = mockFetch({
    [planned.archive.dateUrl]: { status: 200, text: liveHtml },
    [planned.archive.rootUrl]: { status: 200, text: root }
  });
  const early = await mark({ stateDir, now: NOW, published: true, fetchImpl: absent });
  assert.equal(early.reason, 'page-not-live');
  const opened = await mark({ stateDir, now: NOW, pr: true });
  assert.equal(opened.day.prOpened, true);
  const skippedPlan = await plan({ stateDir, now: NOW, fetchImpl: absent });
  assert.equal(skippedPlan.reason, 'pr-already-open');
  assert.deepEqual(skippedPlan.files, []);

  const cleared = await mark({ stateDir, now: NOW, clearPr: true });
  assert.equal(cleared.day.prOpened, false);
  const ready = await notify({
    stateDir,
    now: NOW,
    fetchImpl: live,
    env: { FB_NOTIFY_TO: 'fixture-recipient@example.invalid', FB_NOTIFY_FROM: 'fixture-from@example.invalid' }
  });
  assert.equal(ready.shouldSend, true);
  assert.equal(ready.resend.to[0], 'fixture-recipient@example.invalid');
  assert.equal(ready.resend.idempotencyKey, `fb-digest-${DATE}-${prepared.fingerprint.slice(0, 16)}`);
  const saved = JSON.parse(await readFile(ready.paths.notification, 'utf8'));
  assert.equal(saved.resend.from, 'fixture-from@example.invalid');
  const missingRecipient = await notify({ stateDir, now: NOW, fetchImpl: live, env: {} });
  assert.equal(missingRecipient.shouldSend, false);
  assert.equal(missingRecipient.reason, 'recipient-unset');
  assert.equal(missingRecipient.to, null);

  const published = await mark({ stateDir, now: NOW, published: true, notified: true, fetchImpl: live });
  assert.equal(published.day.published, true);
  assert.equal(published.day.notified, true);
  const done = await prepare({
    stateDir,
    now: NOW,
    fetchImpl: () => {
      throw new Error('feed should not be fetched again');
    }
  });
  assert.equal(done.action, 'skip');
  assert.equal(done.reason, 'date-already-published');
  const duplicate = await notify({
    stateDir,
    now: NOW,
    fetchImpl: live,
    env: { FB_NOTIFY_TO: 'fixture-recipient@example.invalid', FB_NOTIFY_FROM: 'fixture-from@example.invalid' }
  });
  assert.equal(duplicate.shouldSend, false);
  assert.equal(duplicate.reason, 'already-notified');

  const backfill = await workspace();
  await writeFile(path.join(backfill, 'index.html'), root.replace(DATE, '2026-12-01'));
  const backfillState = await workspace();
  await prepare({ stateDir: backfillState, now: NOW, feedsDir: FEEDS });
  await render({ stateDir: backfillState, now: NOW, summaryPath: SUMMARY });
  const backfillPlan = await plan({
    stateDir: backfillState,
    now: NOW,
    fetchImpl: mockFetch({
      [`https://raw.githubusercontent.com/lkangd/ai-builders-digest/main/${DATE}/index.html`]: { status: 404, text: 'missing' },
      'https://raw.githubusercontent.com/lkangd/ai-builders-digest/main/index.html': {
        status: 200,
        text: (await readFile(path.join(backfill, 'index.html'), 'utf8')).replaceAll(DATE, '2026-12-01')
      }
    })
  });
  assert.equal(backfillPlan.action, 'open-pr');
  assert.equal(backfillPlan.updateRoot, false);
  assert.deepEqual(backfillPlan.files.map(file => file.path), [`${DATE}/index.html`]);
});

test('english pages omit the Chinese tile and six highlights truncate', () => {
  const warnings = [];
  const feed = normalizeFeeds({
    x: {
      x: [{
        handle: 'fixture_builder',
        name: 'Fixture Builder',
        tweets: Array.from({ length: 6 }, (_, index) => ({
          text: `FIXTURE ${index}`,
          url: `https://example.invalid/fixture/${index}`
        }))
      }]
    }
  }, { tweetsPerBuilder: 8, podcasts: 1, transcriptChars: 10, blogChars: 10, rssChars: 10 }, warnings);
  const applied = applySummary(feed, {
    highlights: feed.x[0].tweets.map((tweet, index) => ({ text: `H${index}`, textZh: `译${index}`, url: tweet.url }))
  }, 'en');
  assert.equal(applied.highlights.length, 5);
  assert.ok(applied.warnings.includes('truncated highlights to 5'));
  const html = renderDigestHtml({
    date: DATE,
    timezone: 'Asia/Shanghai',
    language: 'en',
    generatedAt: NOW,
    stats: { xBuilders: 1, totalTweets: 1, podcastEpisodes: 0, blogPosts: 0, rssItems: 0 },
    highlights: [{ text: 'FIXTURE only', textZh: '不应出现', url: 'https://example.invalid/fixture/0' }],
    builders: [],
    podcasts: [],
    blogs: [],
    rss: []
  });
  assert.equal(html.includes('译文'), false);
  assert.equal(html.includes('不应出现'), false);
});

test('private config rejects credential keys and the repo has no personal mailbox', async () => {
  const stateDir = await workspace();
  await writeFile(path.join(stateDir, 'config.json'), JSON.stringify({ token: 'fixture' }));
  await assert.rejects(prepare({ stateDir, now: NOW, feedsDir: FEEDS }), /Refusing config key/);
  const files = [...await walk(ROOT), ...await walk(DOCS)];
  const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  for (const file of files) {
    if (file.endsWith('.test.mjs')) continue;
    const text = await readFile(file, 'utf8');
    const hits = text.match(email) || [];
    assert.deepEqual(hits.filter(item => !item.endsWith('@example.invalid')), [], file);
    if (file.endsWith('.mjs') || file.endsWith('.json')) {
      assert.equal(text.includes('GH_TOKEN'), false, file);
      assert.equal(text.includes('/Users/'), false, file);
      assert.equal(text.includes('DEEPSEEK'), false, file);
      assert.equal(text.includes('RESEND_API_KEY'), false, file);
    }
  }
});

test('a second run cannot take the state lock', async () => {
  const stateDir = await workspace();
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const first = withLock(stateDir, () => gate);
  await new Promise(resolve => setTimeout(resolve, 30));
  await assert.rejects(withLock(stateDir, async () => 'second'), /state lock/);
  release();
  await first;
});

test('cli prepares fixtures without network and redacts the recipient', async () => {
  const stateDir = await workspace();
  const prep = await runCli([
    'prepare',
    '--state', stateDir,
    '--now', NOW,
    '--feeds-dir', FEEDS
  ]);
  assert.equal(prep.code, 0, prep.stderr);
  const summary = JSON.parse(prep.stdout);
  assert.equal(summary.date, DATE);
  const rendered = await runCli([
    'render',
    '--state', stateDir,
    '--now', NOW,
    '--summary', SUMMARY
  ]);
  assert.equal(rendered.code, 0, rendered.stderr);
  const redacted = redactForStdout({
    to: 'fixture-recipient@example.invalid',
    from: 'fixture-from@example.invalid',
    toStatus: 'configured',
    fromStatus: 'configured',
    html: '<p>fixture-recipient@example.invalid</p>',
    resend: { to: ['fixture-recipient@example.invalid'], idempotencyKey: 'fb-digest-fixture' },
    idempotencyKey: 'fb-digest-fixture'
  });
  assert.equal(JSON.stringify(redacted).includes('fixture-recipient@example.invalid'), false);
  assert.equal(redacted.to, 'configured');
  assert.equal(redacted.resend.ready, true);
  const current = await status({ stateDir, now: NOW });
  assert.equal(current.day.rendered, true);
});

async function walk(dir, found = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, found);
    else found.push(full);
  }
  return found;
}

function runCli(args, env = process.env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(ROOT, 'bin/fb.mjs'), ...args], {
      cwd: ROOT,
      env
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
