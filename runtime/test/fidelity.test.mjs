import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { enrichFeed, segmentText } from '../lib/enrich.mjs';
import { renderDigestHtml, renderNotificationHtml } from '../lib/render.mjs';
import { notify, render } from '../lib/pipeline.mjs';
import { redactForStdout } from '../lib/util.mjs';

const DAY = fileURLToPath(new URL('./fixtures/day-2026-11-17/', import.meta.url));
const HISTORICAL = fileURLToPath(new URL('./fixtures/historical-2026-04-22/feed-podcasts.json', import.meta.url));
const NOW = '2026-11-16T16:30:00.000Z';

function mockFetch(routes) {
  return async url => {
    const hit = routes[url];
    if (!hit) return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(hit),
      json: async () => hit
    };
  };
}

test('historical podcast transcript stays in separate blocks', async () => {
  const feed = JSON.parse(await readFile(HISTORICAL, 'utf8'));
  const transcript = feed.podcasts[0].transcript;
  const segments = segmentText(transcript);
  assert.ok(segments.length >= 150, `expected the April 2026 sample to keep its blank-line breaks, got ${segments.length}`);
  const html = renderDigestHtml({
    date: '2026-04-22',
    timezone: 'Asia/Shanghai',
    language: 'en',
    generatedAt: '2026-04-22T00:00:00.000Z',
    stats: { xBuilders: 0, totalTweets: 0, podcastEpisodes: 1, blogPosts: 0, rssItems: 0 },
    highlights: [],
    builders: [],
    podcasts: [{
      name: feed.podcasts[0].name,
      title: feed.podcasts[0].title,
      url: feed.podcasts[0].url,
      segments,
      zhSegments: []
    }],
    blogs: [],
    rss: []
  });
  const blocks = [...html.matchAll(/class="fb-segment"[^>]*>([\s\S]*?)<\/div>/g)];
  assert.equal(blocks.length, segments.length);
  assert.match(blocks[0][1], /Speaker|[^<]{8}/);
  assert.notEqual(blocks[0][1].replace(/<br>/g, '\n').trim(), blocks[1][1].replace(/<br>/g, '\n').trim());
});

test('syndication media renders avatars, quote media, and video without using the historical text feed', async () => {
  const raw = {
    user: {
      name: 'Fixture Builder',
      screen_name: 'fixture_builder',
      profile_image_url_https: 'https://example.invalid/avatar_normal.jpg'
    },
    text: 'FIXTURE first line\nFIXTURE second line',
    mediaDetails: [{
      type: 'video',
      media_url_https: 'https://example.invalid/poster.jpg',
      video_info: { variants: [{ url: 'https://example.invalid/clip.mp4', bitrate: 320000, content_type: 'video/mp4' }] }
    }],
    quoted_tweet: {
      id_str: '4242',
      text: 'FIXTURE quoted body',
      user: {
        name: 'Quoted Fixture',
        screen_name: 'quoted_fix',
        profile_image_url_https: 'https://example.invalid/quote_normal.png'
      },
      photos: [{ url: 'https://example.invalid/quote-photo.jpg' }]
    }
  };
  const feed = await enrichFeed({
    x: [{
      name: 'Fixture Builder',
      handle: 'fixture_builder',
      bio: 'FIXTURE biography stays the identity line',
      tweets: [{
        id: '2122184794209714368',
        text: 'short',
        url: 'https://example.invalid/fixture/tweet-1',
        createdAt: '2026-11-16T00:00:00.000Z',
        likes: 1,
        retweets: 0,
        replies: 0,
        isQuote: true
      }]
    }],
    podcasts: [],
    blogs: [],
    rss: []
  }, {
    fetchImpl: mockFetch({
      'https://cdn.syndication.twimg.com/tweet-result?id=2122184794209714368&token=public&d=1': raw
    })
  });
  const html = renderDigestHtml({
    date: '2026-11-17',
    timezone: 'Asia/Shanghai',
    language: 'bilingual',
    generatedAt: NOW,
    stats: { xBuilders: 1, totalTweets: 1, podcastEpisodes: 0, blogPosts: 0, rssItems: 0 },
    highlights: [],
    builders: feed.x.map(builder => ({
      ...builder,
      tweets: builder.tweets.map(tweet => ({ ...tweet, text: tweet.enriched.resolvedText, textZh: '夹具这条推文的译文' }))
    })),
    podcasts: [],
    blogs: [],
    rss: []
  });
  assert.match(html, /https:\/\/example\.invalid\/avatar_400x400\.jpg/);
  assert.match(html, /https:\/\/example\.invalid\/quote_400x400\.png/);
  assert.match(html, /https:\/\/example\.invalid\/quote-photo\.jpg/);
  assert.match(html, /<video /);
  assert.match(html, /https:\/\/example\.invalid\/clip\.mp4/);
  assert.match(html, />Quoting</);
  assert.match(html, /FIXTURE quoted body/);
  assert.match(html, /FIXTURE first line<br>FIXTURE second line/);
  assert.match(html, /夹具这条推文的译文/);
  assert.match(html, /FIXTURE biography stays the identity line/);
  const bioAt = html.indexOf('fb-bio');
  const translationAt = html.indexOf('夹具这条推文的译文');
  assert.ok(bioAt > 0 && translationAt > bioAt);
  assert.equal(html.slice(bioAt, bioAt + 400).includes('夹具这条推文的译文'), false);
});

test('2026-11-17 handle summaries are not painted onto bios, and the transcript stays segmented', async () => {
  const stateDir = await mkdtemp(path.join(tmpdir(), 'fb-day-'));
  const runDir = path.join(stateDir, 'runs', '2026-11-17');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'prepare.json'), await readFile(path.join(DAY, 'prepare.json')));
  const rendered = await render({
    stateDir,
    now: NOW,
    summaryPath: path.join(DAY, 'summary.json'),
    enrich: false
  });
  assert.equal(rendered.action, 'rendered');
  assert.ok(rendered.warnings.some(item => item.includes('not a per-tweet translation')));
  assert.ok(rendered.warnings.some(item => item.includes('not split into the same paragraphs')));
  const html = await readFile(rendered.paths.digest, 'utf8');
  assert.match(html, /Codex &amp; ChatGPT @OpenAI/);
  assert.equal(html.includes('反复出现、让用户很烦'), false);
  assert.match(html, /model at capacity/);
  assert.match(html, /class="fb-segment"/);
  assert.match(html, /Speaker 1 \| 00:00 - 00:07<br>Prediction markets/);
  assert.match(html, /Speaker 2 \| 00:07 - 00:11<br>What is your reaction/);
  const mashed = 'odds.Speaker 2';
  assert.equal(html.includes(mashed), false);
  const noted = await notify({
    stateDir,
    now: NOW,
    fetchImpl: async url => {
      if (url === 'https://lkangd.github.io/ai-builders-digest/2026-11-17/') {
        return { ok: true, status: 200, text: async () => '<title>AI Builders Digest — 2026-11-17</title>', json: async () => ({}) };
      }
      return { ok: false, status: 404, text: async () => 'missing', json: async () => ({}) };
    },
    env: { FB_NOTIFY_TO: 'fixture-recipient@example.invalid', FB_NOTIFY_FROM: 'fixture-from@example.invalid' }
  });
  assert.match(noted.html, /class="mobile-shell"/);
  assert.match(noted.html, /#ff385c/);
  assert.match(noted.html, /Your AI builders digest is ready/);
  assert.match(noted.html, /Open today's digest →/);
  assert.match(noted.html, /11 builders {2}· {2}19 posts {2}· {2}1 podcast/);
  assert.equal(/<img\b/.test(noted.html), false);
  assert.equal(/<video\b/.test(noted.html), false);
  assert.match(noted.text, /https:\/\/lkangd\.github\.io\/ai-builders-digest\/2026-11-17\//);
  assert.match(noted.resend.html, /Open today's digest →/);
  const shown = redactForStdout(noted);
  assert.match(shown.html, /mobile-shell/);
  assert.match(shown.resend.html, /Highlights/);
  assert.equal(JSON.stringify(shown).includes('fixture-recipient@example.invalid'), false);
  const direct = renderNotificationHtml({
    pageUrl: noted.pageUrl,
    date: '2026-11-17',
    highlightsHtml: '<ul><li>FIXTURE highlight<br>夹具亮点</li></ul>',
    counts: { xBuilders: 11, totalTweets: 19, podcastEpisodes: 1 }
  });
  assert.match(direct, /Today's Digest/);
  assert.match(direct, /linear-gradient\(90deg,#ff385c,#ff5470\)/);
});
