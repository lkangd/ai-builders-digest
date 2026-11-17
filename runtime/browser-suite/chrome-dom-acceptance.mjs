import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { renderDigestHtml } from '../lib/render.mjs';
import { withIllegalSegmentRows } from '../testing/html5-dom.mjs';

const execFileAsync = promisify(execFile);
const NOW = '2026-11-16T16:30:00.000Z';

function pairedHtml() {
  return renderDigestHtml({
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
  });
}

async function browserDom(html) {
  const dir = await mkdtemp(path.join(tmpdir(), 'fb-chrome-dom-'));
  const file = path.join(dir, 'page.html');
  await writeFile(file, html);
  const { stdout } = await execFileAsync('google-chrome', [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--user-data-dir=${path.join(dir, 'profile')}`,
    '--virtual-time-budget=1500',
    '--timeout=8000',
    '--dump-dom',
    `file://${file}`
  ], { maxBuffer: 20 * 1024 * 1024, timeout: 30000 });
  if (!stdout.includes('FIXTURE Episode Title') && !stdout.includes('Beta paragraph.')) {
    throw new Error('Chrome dump-dom returned no page text');
  }
  return stdout;
}

const NEEDLES = [
  'FIXTURE Episode Title',
  'Alpha paragraph.',
  '发言人1 甲段',
  'Beta paragraph.',
  '发言人2 乙段',
  'Gamma paragraph.',
  '发言人1 丙段'
];

test('cloud Chrome keeps English and Chinese paired after parsing the table', async () => {
  const html = pairedHtml();
  const dumped = await browserDom(html);
  const positions = NEEDLES.map(needle => dumped.indexOf(needle));
  assert.ok(positions.every(index => index >= 0));
  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(positions[index - 1] < positions[index]);
  }
  assert.ok(dumped.indexOf('引用正文译文') < dumped.indexOf('FIXTURE Episode Title'));
  const quoteAt = dumped.indexOf('class="fb-quote"');
  const quoteEnd = dumped.indexOf('父推正文译文', quoteAt);
  assert.equal(quoteEnd, -1);
});

test('cloud Chrome moves later English before the title when a translation row sits in the cell', async () => {
  const html = withIllegalSegmentRows(pairedHtml());
  assert.ok(html.indexOf('FIXTURE Episode Title') < html.indexOf('Beta paragraph.'));
  const dumped = await browserDom(html);
  assert.ok(dumped.indexOf('Beta paragraph.') < dumped.indexOf('FIXTURE Episode Title'));
  assert.ok(dumped.indexOf('Gamma paragraph.') < dumped.indexOf('FIXTURE Episode Title'));
});
