import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { enrichFeed, segmentText } from '../lib/enrich.mjs';
import { renderDigestHtml, renderNotificationHtml } from '../lib/render.mjs';
import { notify, render } from '../lib/pipeline.mjs';
import { redactForStdout } from '../lib/util.mjs';
import {
  elementsByClass,
  hasTag,
  parseHtml,
  textOf,
  treeOrder,
  withIllegalQuoteRow,
  withIllegalSegmentRows
} from '../testing/html5-dom.mjs';

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

const PAIRED_NEEDLES = [
  'FIXTURE Episode Title',
  'Alpha paragraph.',
  '发言人1 甲段',
  'Beta paragraph.',
  '发言人2 乙段',
  'Gamma paragraph.',
  '发言人1 丙段'
];

function pairedModel() {
  return {
    date: '2026-11-17',
    timezone: 'Asia/Shanghai',
    language: 'bilingual',
    generatedAt: NOW,
    stats: { xBuilders: 1, totalTweets: 1, podcastEpisodes: 1, blogPosts: 0, rssItems: 0 },
    highlights: [],
    builders: [{
      name: 'Fixture Builder',
      handle: 'fixture_builder',
      bio: 'Fixture identity bio',
      tweets: [{
        id: '100',
        url: 'https://x.com/fixture_builder/status/100',
        text: 'PARENT tweet body stays outside the quote.',
        textZh: '父推正文译文',
        quoteTextZh: '引用正文译文',
        createdAt: NOW,
        likes: 1,
        retweets: 0,
        replies: 0,
        enriched: {
          quotedTweet: {
            text: 'QUOTED source body',
            url: 'https://x.com/quoted/status/200',
            author: { name: 'Quoted Person', screenName: 'quoted' }
          }
        }
      }]
    }],
    podcasts: [{
      name: 'No Priors',
      title: 'FIXTURE Episode Title',
      url: 'https://example.invalid/fixture/podcast',
      segments: ['Speaker 1 | 00:00\nAlpha paragraph.', 'Speaker 2 | 00:07\nBeta paragraph.', 'Speaker 1 | 00:11\nGamma paragraph.'],
      zhSegments: ['发言人1 甲段', '发言人2 乙段', '发言人1 丙段']
    }],
    blogs: [],
    rss: []
  };
}

test('HTML5 tree keeps each English paragraph and its Chinese inside one segment', () => {
  const html = renderDigestHtml(pairedModel());
  const document = parseHtml(html);
  assert.deepEqual(treeOrder(document, PAIRED_NEEDLES), PAIRED_NEEDLES);
  const pairs = [
    ['Alpha paragraph.', '发言人1 甲段'],
    ['Beta paragraph.', '发言人2 乙段'],
    ['Gamma paragraph.', '发言人1 丙段']
  ];
  const segments = elementsByClass(document, 'fb-segment');
  assert.equal(segments.length, 3);
  segments.forEach((segment, index) => {
    const [english, chinese] = pairs[index];
    const englishNode = elementsByClass(segment, 'fb-segment-en');
    const chineseNode = elementsByClass(segment, 'fb-translation');
    assert.equal(englishNode.length, 1);
    assert.equal(chineseNode.length, 1);
    assert.equal(englishNode[0].parentNode, segment);
    assert.equal(chineseNode[0].parentNode, segment);
    assert.equal(textOf(englishNode[0]).includes(english), true);
    assert.equal(textOf(chineseNode[0]).includes(chinese), true);
    assert.equal(hasTag(segment, 'tr'), false);
    pairs.forEach((pair, other) => {
      if (other !== index) assert.equal(textOf(segment).includes(pair[0]), false);
    });
  });
  const quote = elementsByClass(document, 'fb-quote');
  assert.equal(quote.length, 1);
  assert.equal(textOf(quote[0]).includes('引用正文译文'), true);
  assert.equal(textOf(quote[0]).includes('父推正文译文'), false);
  assert.equal(elementsByClass(quote[0], 'fb-translation').length, 1);
  assert.equal(hasTag(quote[0], 'tr'), false);
});

test('HTML5 tree moves later English before the title when a translation row is inside the cell', () => {
  const html = withIllegalSegmentRows(renderDigestHtml(pairedModel()));
  assert.ok(html.indexOf('FIXTURE Episode Title') < html.indexOf('Beta paragraph.'));
  assert.equal(html.includes('<tr><td class="fb-translation">'), true);
  const order = treeOrder(parseHtml(html), PAIRED_NEEDLES);
  assert.ok(order.indexOf('Beta paragraph.') < order.indexOf('FIXTURE Episode Title'));
  assert.ok(order.indexOf('Gamma paragraph.') < order.indexOf('FIXTURE Episode Title'));
  assert.ok(order.indexOf('Alpha paragraph.') < order.indexOf('发言人1 甲段'));
  const segments = elementsByClass(parseHtml(html), 'fb-segment');
  const beta = segments.find(segment => textOf(segment).includes('Beta paragraph.'));
  assert.ok(beta);
  assert.equal(textOf(beta).includes('发言人2 乙段'), false);
  assert.equal(elementsByClass(beta, 'fb-translation').length, 0);
});

test('HTML5 tree moves a quote translation row out of the quote card', () => {
  const html = withIllegalQuoteRow(renderDigestHtml(pairedModel()));
  const quoteStart = html.indexOf('class="fb-quote"');
  const quoteEnd = html.indexOf('</td>', quoteStart);
  assert.ok(quoteStart >= 0 && html.slice(quoteStart, quoteEnd).includes('引用正文译文'));
  const quote = elementsByClass(parseHtml(html), 'fb-quote');
  assert.equal(quote.length, 1);
  assert.equal(textOf(quote[0]).includes('引用正文译文'), false);
  assert.equal(textOf(quote[0]).includes('QUOTED source body'), true);
});

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
      tweets: builder.tweets.map(tweet => ({
        ...tweet,
        text: tweet.enriched.resolvedText,
        textZh: '父推译文专用',
        quoteTextZh: '引用译文专用'
      }))
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
  assert.match(html, /父推译文专用/);
  assert.match(html, /引用译文专用/);
  const quoteStart = html.indexOf('class="fb-quote"');
  const quote = html.slice(quoteStart, html.indexOf('View on X', quoteStart));
  assert.match(quote, /引用译文专用/);
  assert.equal(quote.includes('父推译文专用'), false);
  assert.match(html, /FIXTURE biography stays the identity line/);
  const bioAt = html.indexOf('fb-bio');
  const translationAt = html.indexOf('父推译文专用');
  assert.ok(bioAt > 0 && translationAt > bioAt);
  assert.equal(html.slice(bioAt, bioAt + 400).includes('父推译文专用'), false);
});

test('each of the 19 tweet translations stays on its own post and 14 audio paragraphs pair', async () => {
  const prepared = JSON.parse(await readFile(path.join(DAY, 'prepare.json'), 'utf8'));
  const tweets = prepared.x.flatMap(builder => builder.tweets);
  assert.equal(tweets.length, 19);
  const segments = segmentText(prepared.podcasts[0].transcript);
  assert.equal(segments.length, 14);
  const summary = {
    highlights: tweets.slice(0, 3).map((tweet, index) => ({
      text: `Highlight ${index}`,
      textZh: `亮点 ${index}`,
      url: tweet.url
    })),
    entries: [
      ...tweets.map(tweet => ({ id: tweet.id, url: tweet.url, textZh: `正文译文 ${tweet.id}`, quoteTextZh: tweet.isQuote ? `引用译文 ${tweet.quotedTweetId}` : '' })),
      {
        url: prepared.podcasts[0].url,
        summary: prepared.podcasts[0].transcript,
        summaryZh: segments.map((segment, index) => `音频段 ${index + 1}:${segment.slice(0, 24)}`).join('\n\n')
      }
    ]
  };
  const stateDir = await mkdtemp(path.join(tmpdir(), 'fb-complete-'));
  const runDir = path.join(stateDir, 'runs', '2026-11-17');
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, 'prepare.json'), JSON.stringify(prepared));
  const summaryPath = path.join(stateDir, 'summary.json');
  await writeFile(summaryPath, JSON.stringify(summary));
  const rendered = await render({ stateDir, now: NOW, summaryPath, enrich: false });
  assert.equal(rendered.status, 'ok');
  assert.equal(rendered.action, 'rendered');
  const html = await readFile(rendered.paths.digest, 'utf8');
  let cursor = 0;
  for (const tweet of tweets) {
    const marker = `正文译文 ${tweet.id}`;
    const at = html.indexOf(marker, cursor);
    assert.ok(at > cursor, marker);
    const between = html.slice(cursor, at);
    const raw = tweet.text.split('\n')[0].slice(0, 40);
    const snippet = raw
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(between, new RegExp(snippet));
    assert.equal(between.includes('音频段'), false);
    cursor = at + marker.length;
  }
  assert.equal((html.match(/class="fb-segment"/g) || []).length, 14);
  for (let index = 0; index < 14; index += 1) {
    assert.match(html, new RegExp(`音频段 ${index + 1}:`));
  }
  const swapped = html.indexOf(`正文译文 ${tweets[0].id}`);
  const second = html.indexOf(`正文译文 ${tweets[1].id}`);
  assert.ok(swapped < second);
  assert.equal(html.slice(swapped, second).includes(tweets[1].id) && html.slice(swapped, second).includes(`正文译文 ${tweets[1].id}`), false);
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
  assert.equal(rendered.status, 'error');
  assert.equal(rendered.action, 'incomplete');
  assert.equal(rendered.reason, 'translation-incomplete');
  assert.equal(rendered.gaps.filter(item => item.startsWith('missing textZh')).length, 19);
  assert.ok(rendered.gaps.some(item => item.includes('podcast paragraph mismatch') && item.includes('0/14')));
  assert.ok(rendered.warnings.some(item => item.includes('not a per-tweet translation')));
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
  assert.equal(noted.shouldSend, false);
  assert.equal(noted.reason, 'translation-incomplete');
  assert.equal(noted.resend, null);
  const shown = redactForStdout({ ...noted, resend: { to: ['fixture-recipient@example.invalid'], from: 'fixture-from@example.invalid', html: noted.html, text: noted.text } });
  assert.match(shown.html, /mobile-shell/);
  assert.match(shown.resend.html, /Open today's digest/);
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
