import { mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichFeed, segmentText } from './enrich.mjs';
import { applySummary, fingerprintOf, normalizeFeeds, statsOf } from './feed.mjs';
import {
  highlightListHtml,
  renderDigestHtml,
  renderNotificationHtml,
  renderNotificationText,
  renderRootIndex
} from './render.mjs';
import {
  assertTimeZone,
  latestDateFromRoot,
  pageServesDate,
  pageUrlFor,
  parseMailbox,
  walkKeys,
  zonedParts
} from './util.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROMPT_FILES = [
  'summarize-podcast.md',
  'summarize-tweets.md',
  'summarize-blogs.md',
  'digest-intro.md',
  'translate.md'
];
const BANNED_CONFIG_KEYS = new Set([
  'gh_token',
  'github_token',
  'githubtoken',
  'resend_api_key',
  'resendapikey',
  'deepseek',
  'deep_seek',
  'deep_seek_api_key',
  'deep_seek_api_key_local',
  'x_bearer_token',
  'pod2txt_api_key',
  'api_key',
  'apikey',
  'token',
  'secret'
]);
const PRIVATE_ADDRESS_KEYS = new Set(['to', 'from', 'email', 'recipient', 'mailbox']);

export const DEFAULT_CONFIG = {
  language: 'bilingual',
  timezone: 'Asia/Shanghai',
  schedule: '08:00',
  includeWeekends: true,
  page: {
    repo: 'lkangd/ai-builders-digest',
    baseUrl: 'https://lkangd.github.io/ai-builders-digest',
    branch: 'main'
  },
  feeds: {
    x: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json',
    podcasts: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json',
    blogs: 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json'
  },
  limits: {
    tweetsPerBuilder: 8,
    podcasts: 1,
    transcriptChars: 4000,
    blogChars: 4000,
    rssChars: 4000
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function assertConfigSafe(config) {
  walkKeys(config, key => {
    const normalized = String(key).toLowerCase().replaceAll('-', '_');
    if (BANNED_CONFIG_KEYS.has(normalized)) {
      throw new Error(`Refusing config key "${key}". Credentials stay outside this runtime.`);
    }
    if (PRIVATE_ADDRESS_KEYS.has(normalized)) {
      throw new Error(`Refusing config key "${key}". Notification addresses come only from FB_NOTIFY_TO and FB_NOTIFY_FROM.`);
    }
  });
}

export function mergeConfig(override = {}) {
  assertConfigSafe(override);
  const config = clone(DEFAULT_CONFIG);
  if (override.language) config.language = override.language;
  if (override.timezone) config.timezone = override.timezone;
  if (override.schedule) config.schedule = override.schedule;
  if (typeof override.includeWeekends === 'boolean') config.includeWeekends = override.includeWeekends;
  config.page = { ...config.page, ...(override.page || {}) };
  config.feeds = { ...config.feeds, ...(override.feeds || {}) };
  if (override.feeds && Object.prototype.hasOwnProperty.call(override.feeds, 'rss')) {
    config.feeds.rss = override.feeds.rss;
  }
  config.limits = { ...config.limits, ...(override.limits || {}) };
  if (!['en', 'zh', 'bilingual'].includes(config.language)) config.language = 'bilingual';
  return config;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, file);
}

async function writeText(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, value);
  await rename(tmp, file);
}

function runPaths(stateDir, date) {
  const runDir = path.join(stateDir, 'runs', date);
  return {
    runDir,
    prepare: path.join(runDir, 'prepare.json'),
    summary: path.join(runDir, 'summary.json'),
    digest: path.join(runDir, 'digest.html'),
    root: path.join(runDir, 'root-index.html'),
    manifest: path.join(runDir, 'manifest.json'),
    notification: path.join(runDir, 'notification.json')
  };
}

async function loadState(stateDir) {
  const file = path.join(stateDir, 'state.json');
  if (!existsSync(file)) return { version: 1, days: {} };
  const parsed = await readJson(file);
  if (!parsed || typeof parsed !== 'object' || !parsed.days) return { version: 1, days: {} };
  return parsed;
}

async function saveState(stateDir, state) {
  await writeJson(path.join(stateDir, 'state.json'), state);
}

export async function withLock(stateDir, fn) {
  await mkdir(stateDir, { recursive: true });
  const lock = path.join(stateDir, '.lock');
  const attempt = async () => open(lock, 'wx');
  let handle;
  try {
    handle = await attempt();
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = await stat(lock).catch(() => null);
    const age = info ? Date.now() - info.mtimeMs : 0;
    if (age < 30 * 60 * 1000) {
      const locked = new Error('Another digest run holds the state lock.');
      locked.code = 'LOCKED';
      throw locked;
    }
    await unlink(lock).catch(() => {});
    handle = await attempt();
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await unlink(lock).catch(() => {});
  }
}

async function loadConfig(stateDir) {
  const file = path.join(stateDir, 'config.json');
  if (!existsSync(file)) return mergeConfig();
  return mergeConfig(await readJson(file));
}

function resolveNow(now) {
  const date = now ? new Date(now) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --now value: ${now}`);
  return date;
}

async function loadPrompts(stateDir) {
  const prompts = {};
  const overrideDir = path.join(stateDir, 'prompts');
  for (const filename of PROMPT_FILES) {
    const key = filename.replace(/\.md$/, '').replaceAll('-', '_');
    const override = path.join(overrideDir, filename);
    const bundled = path.join(ROOT, 'prompts', filename);
    const file = existsSync(override) ? override : bundled;
    if (!existsSync(file)) throw new Error(`Missing prompt: ${filename}`);
    prompts[key] = await readFile(file, 'utf8');
  }
  return prompts;
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!response.ok) return { ok: false, status: response.status };
  try {
    return { ok: true, status: response.status, json: await response.json() };
  } catch (error) {
    return { ok: false, status: response.status, error: error.message };
  }
}

async function loadRemoteFeeds(config, fetchImpl) {
  const errors = [];
  const jobs = [
    ['x', config.feeds.x, 'Could not fetch tweet feed'],
    ['podcasts', config.feeds.podcasts, 'Could not fetch podcast feed'],
    ['blogs', config.feeds.blogs, 'Could not fetch blog feed']
  ];
  if (config.feeds.rss) jobs.push(['rss', config.feeds.rss, 'Could not fetch RSS feed']);
  const raw = {};
  await Promise.all(jobs.map(async ([key, url, message]) => {
    try {
      const result = await fetchJson(url, fetchImpl);
      if (!result.ok) {
        errors.push(message);
        raw[key] = null;
        return;
      }
      raw[key] = result.json;
    } catch (error) {
      errors.push(`${message}: ${error.message}`);
      raw[key] = null;
    }
  }));
  return { raw, errors };
}

async function loadFeedDir(dir) {
  const errors = [];
  const raw = {};
  for (const [key, filename, message] of [
    ['x', 'feed-x.json', 'Could not fetch tweet feed'],
    ['podcasts', 'feed-podcasts.json', 'Could not fetch podcast feed'],
    ['blogs', 'feed-blogs.json', 'Could not fetch blog feed']
  ]) {
    const file = path.join(dir, filename);
    if (!existsSync(file)) {
      errors.push(message);
      raw[key] = null;
      continue;
    }
    try {
      raw[key] = await readJson(file);
    } catch (error) {
      errors.push(`${message}: ${error.message}`);
      raw[key] = null;
    }
  }
  const rss = path.join(dir, 'feed-rss.json');
  if (existsSync(rss)) raw.rss = await readJson(rss);
  return { raw, errors };
}

function publicConfig(config) {
  return {
    language: config.language,
    timezone: config.timezone,
    schedule: config.schedule,
    includeWeekends: config.includeWeekends,
    page: config.page,
    feeds: config.feeds
  };
}

function mailboxes(env) {
  return {
    to: parseMailbox(env.FB_NOTIFY_TO || ''),
    from: parseMailbox(env.FB_NOTIFY_FROM || '')
  };
}

export async function prepare(options) {
  const stateDir = options.stateDir;
  const config = options.config ? mergeConfig(options.config) : await loadConfig(stateDir);
  const zone = assertTimeZone(config.timezone) || 'Asia/Shanghai';
  config.timezone = zone;
  const now = resolveNow(options.now);
  const { date } = zonedParts(now, zone);
  const paths = runPaths(stateDir, date);
  const state = await loadState(stateDir);
  const day = state.days[date];
  if (day?.published) {
    return {
      status: 'ok',
      action: 'skip',
      reason: 'date-already-published',
      date,
      timezone: zone,
      fingerprint: day.fingerprint,
      pageUrl: day.pageUrl,
      paths
    };
  }
  const loaded = options.feedsDir
    ? await loadFeedDir(options.feedsDir)
    : await loadRemoteFeeds(config, options.fetchImpl || globalThis.fetch);
  const required = ['x', 'podcasts', 'blogs'];
  if (required.every(key => !loaded.raw[key])) {
    return {
      status: 'error',
      action: 'stop',
      reason: 'feeds-unavailable',
      message: 'All public feeds failed.',
      date,
      errors: loaded.errors
    };
  }
  const warnings = [];
  const feed = normalizeFeeds(loaded.raw, config.limits, warnings);
  const stats = statsOf(feed);
  const fingerprint = fingerprintOf(feed);
  const pageUrl = pageUrlFor(config.page.baseUrl, date);
  const prompts = await loadPrompts(stateDir);
  const empty = stats.totalTweets + stats.podcastEpisodes + stats.blogPosts + stats.rssItems === 0;
  let action = empty ? 'empty' : 'summarize';
  let reason = empty ? 'no-items-with-urls' : 'needs-summary';
  if (!empty && day?.prOpened && day.fingerprint === fingerprint) {
    action = 'await-publish';
    reason = 'pr-already-open';
  } else if (!empty && day?.rendered && day.fingerprint === fingerprint && !day.prOpened) {
    action = 'render-ready';
    reason = 'summary-unchanged';
  }
  const prepareDoc = {
    status: 'ok',
    action,
    reason,
    date,
    timezone: zone,
    generatedAt: now.toISOString(),
    fingerprint,
    pageUrl,
    config: publicConfig(config),
    stats,
    prompts,
    x: feed.x,
    podcasts: feed.podcasts,
    blogs: feed.blogs,
    rss: feed.rss,
    errors: loaded.errors.length ? loaded.errors : undefined,
    warnings: warnings.length ? warnings : undefined,
    summaryContract: {
      highlights: '3 to 5 items for the page hero and the notification. Each needs a url from this feed. These are short summaries, not full tweet translations.',
      entries: 'One entry per tweet, with that tweet id and url, and textZh translating that tweet text only. Preserve line breaks. Do not translate the bio into this field. A handle without id/url is ignored. Podcast summary and summaryZh must use the same blank-line paragraphs, in the same order.'
    }
  };
  await writeJson(paths.prepare, prepareDoc);
  state.days[date] = {
    ...(day || {}),
    fingerprint,
    pageUrl,
    rendered: day?.fingerprint === fingerprint ? Boolean(day.rendered) : false,
    prOpened: day?.fingerprint === fingerprint ? Boolean(day.prOpened) : false,
    published: false,
    notified: day?.fingerprint === fingerprint ? Boolean(day.notified) : false,
    updatedAt: now.toISOString()
  };
  await saveState(stateDir, state);
  return {
    status: 'ok',
    action,
    reason,
    date,
    timezone: zone,
    generatedAt: now.toISOString(),
    fingerprint,
    pageUrl,
    stats,
    errors: loaded.errors,
    warnings,
    paths,
    config: publicConfig(config)
  };
}

function translationGaps(model) {
  if (model.language === 'en') return [];
  const gaps = [];
  for (const builder of model.builders || []) {
    for (const tweet of builder.tweets || []) {
      if (!String(tweet.textZh || '').trim()) gaps.push(`missing textZh for tweet ${tweet.id || ''} ${tweet.url}`);
    }
  }
  for (const item of model.podcasts || []) {
    const segments = item.segments || [];
    const zhSegments = item.zhSegments || [];
    if (segments.length > 0 && zhSegments.length !== segments.length) {
      gaps.push(`podcast paragraph mismatch ${zhSegments.length}/${segments.length} ${item.url}`);
    }
  }
  return gaps;
}

function alignedSegments(source, translation) {
  const segments = segmentText(source);
  const zhSegments = segmentText(translation);
  if (segments.length > 1 && zhSegments.length === segments.length) {
    return { segments, zhSegments, unaligned: false };
  }
  if (segments.length > 1) {
    return { segments, zhSegments: [], unaligned: zhSegments.length > 0 };
  }
  return { segments: segments.length ? segments : zhSegments, zhSegments: segments.length ? zhSegments : [], unaligned: false };
}

function attach(feed, applied) {
  return {
    builders: feed.x.map(builder => ({
      ...builder,
      summary: '',
      summaryZh: '',
      tweets: builder.tweets.map(tweet => {
        const note = applied.byUrl.get(tweet.url) || applied.byId.get(String(tweet.id || '')) || {};
        const text = tweet.enriched?.resolvedText || tweet.text;
        return { ...tweet, text, textZh: note.summaryZh || '', quoteTextZh: note.quoteTextZh || '' };
      })
    })),
    podcasts: feed.podcasts.map(item => {
      const note = applied.byUrl.get(item.url) || {};
      const transcript = item.transcript || item.content || '';
      const aligned = alignedSegments(transcript || note.summary, note.summaryZh);
      return {
        ...item,
        segments: aligned.segments,
        zhSegments: aligned.zhSegments,
        unaligned: aligned.unaligned,
        body: aligned.segments.join('\n\n'),
        bodyZh: aligned.zhSegments.join('\n\n')
      };
    }),
    blogs: feed.blogs.map(item => {
      const note = applied.byUrl.get(item.url) || {};
      return {
        ...item,
        body: note.summary || item.content,
        bodyZh: note.summaryZh || ''
      };
    }),
    rss: feed.rss.map(item => {
      const note = applied.byUrl.get(item.url) || {};
      return {
        ...item,
        body: note.summary || item.content,
        bodyZh: note.summaryZh || ''
      };
    })
  };
}

export async function render(options) {
  const stateDir = options.stateDir;
  const config = options.config ? mergeConfig(options.config) : await loadConfig(stateDir);
  const zone = assertTimeZone(config.timezone) || 'Asia/Shanghai';
  const now = resolveNow(options.now);
  const { date } = zonedParts(now, zone);
  const paths = runPaths(stateDir, date);
  if (!existsSync(paths.prepare)) {
    return { status: 'error', action: 'stop', reason: 'missing-prepare', message: 'Run prepare before render.', date };
  }
  const prepared = await readJson(paths.prepare);
  const state = await loadState(stateDir);
  const day = state.days[date];
  if (day?.published || day?.prOpened) {
    return {
      status: 'ok',
      action: 'skip',
      reason: day.published ? 'date-already-published' : 'pr-already-open',
      date,
      pageUrl: prepared.pageUrl,
      paths
    };
  }
  if (!options.summaryPath || !existsSync(options.summaryPath)) {
    return { status: 'error', action: 'stop', reason: 'missing-summary', message: 'Summary JSON is required.', date };
  }
  const summary = await readJson(options.summaryPath);
  const feed = {
    x: prepared.x || [],
    podcasts: prepared.podcasts || [],
    blogs: prepared.blogs || [],
    rss: prepared.rss || []
  };
  const applied = applySummary(feed, summary, prepared.config?.language || config.language);
  const enriched = options.enrich === false
    ? feed
    : await enrichFeed(feed, { fetchImpl: options.fetchImpl || globalThis.fetch });
  const attached = attach(enriched, applied);
  const model = {
    date,
    timezone: zone,
    language: prepared.config?.language || config.language,
    generatedAt: prepared.generatedAt || now.toISOString(),
    stats: prepared.stats,
    highlights: applied.highlights,
    ...attached
  };
  const warnings = [
    ...applied.warnings,
    ...(enriched.enrichWarnings || []),
    ...attached.podcasts.filter(item => item.unaligned).map(item => `podcast translation for ${item.url} is not split into the same paragraphs as the transcript`)
  ];
  const gaps = translationGaps(model);
  const digest = renderDigestHtml(model);
  const root = renderRootIndex(config.page.baseUrl, date);
  await writeText(paths.digest, digest);
  await writeText(paths.root, root);
  await writeJson(paths.summary, summary);
  state.days[date] = {
    ...(day || {}),
    fingerprint: prepared.fingerprint,
    pageUrl: prepared.pageUrl,
    rendered: true,
    prOpened: false,
    published: false,
    notified: false,
    highlightCount: applied.highlights.length,
    translationComplete: gaps.length === 0,
    updatedAt: now.toISOString()
  };
  await saveState(stateDir, state);
  if (gaps.length > 0) {
    return {
      status: 'error',
      action: 'incomplete',
      reason: 'translation-incomplete',
      message: 'Refusing to treat this render as complete until every tweet and podcast paragraph has its own translation.',
      date,
      pageUrl: prepared.pageUrl,
      fingerprint: prepared.fingerprint,
      highlightCount: applied.highlights.length,
      gaps,
      warnings,
      paths
    };
  }
  return {
    status: 'ok',
    action: 'rendered',
    reason: 'wrote-local-html',
    date,
    pageUrl: prepared.pageUrl,
    fingerprint: prepared.fingerprint,
    highlightCount: applied.highlights.length,
    warnings,
    paths
  };
}

function rawUrl(repo, branch, filePath) {
  return `https://raw.githubusercontent.com/${repo}/${branch}/${filePath}`;
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  const text = typeof response.text === 'function' ? await response.text() : '';
  return { ok: Boolean(response.ok), status: response.status, text };
}

async function probeArchive(config, date, fetchImpl) {
  const url = rawUrl(config.page.repo, config.page.branch || 'main', `${date}/index.html`);
  try {
    const file = await fetchText(url, fetchImpl);
    return { onMain: file.status === 200 && file.ok, status: file.status, url };
  } catch (error) {
    return { onMain: false, status: 0, url, error: error.message };
  }
}

async function checkPages(config, date, fetchImpl) {
  const url = pageUrlFor(config.page.baseUrl, date);
  try {
    const file = await fetchText(url, fetchImpl);
    if (file.status !== 200 || !file.ok) {
      return { url, status: file.status, ready: false, reason: 'page-not-live' };
    }
    if (!pageServesDate(file.text, date)) {
      const title = file.text.match(/<title>([^<]*)<\/title>/i);
      const stale = Boolean(title && /\d{4}-\d{2}-\d{2}/.test(title[1]));
      return { url, status: 200, ready: false, reason: stale ? 'page-stale' : 'page-not-live' };
    }
    return { url, status: 200, ready: true, reason: 'pages-ready' };
  } catch (error) {
    return { url, status: 0, ready: false, reason: 'page-check-failed', message: error.message };
  }
}

export async function plan(options) {
  const stateDir = options.stateDir;
  const config = options.config ? mergeConfig(options.config) : await loadConfig(stateDir);
  const zone = assertTimeZone(config.timezone) || 'Asia/Shanghai';
  const now = resolveNow(options.now);
  const { date } = zonedParts(now, zone);
  const paths = runPaths(stateDir, date);
  const state = await loadState(stateDir);
  const day = state.days[date];
  const guards = {
    allowedPaths: [`${date}/index.html`, 'index.html'],
    deny: [
      'push-to-main',
      'force-push',
      'delete-files',
      'rewrite-other-dates',
      'overwrite-existing-date',
      'change-pages-settings',
      'merge-without-approval',
      'github-contents-api',
      'request-gh-token'
    ],
    nojekyll: 'create-empty-only-if-missing',
    merge: 'not-performed-by-this-runtime'
  };
  if (!day?.rendered || !existsSync(paths.digest)) {
    return { status: 'ok', action: 'blocked', reason: 'not-rendered', date, guards, files: [] };
  }
  const branch = config.page.branch || 'main';
  const dateUrl = rawUrl(config.page.repo, branch, `${date}/index.html`);
  const rootUrl = rawUrl(config.page.repo, branch, 'index.html');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  let dateFile;
  let rootFile;
  try {
    [dateFile, rootFile] = await Promise.all([
      fetchText(dateUrl, fetchImpl),
      fetchText(rootUrl, fetchImpl)
    ]);
  } catch (error) {
    return {
      status: 'ok',
      action: 'blocked',
      reason: 'archive-check-failed',
      message: error.message,
      date,
      guards,
      files: []
    };
  }
  if (![200, 404].includes(dateFile.status) || ![200, 404].includes(rootFile.status)) {
    return {
      status: 'ok',
      action: 'blocked',
      reason: 'archive-check-failed',
      date,
      archive: { dateStatus: dateFile.status, rootStatus: rootFile.status },
      guards,
      files: []
    };
  }
  const rootLatest = rootFile.ok ? latestDateFromRoot(rootFile.text) : null;
  if (rootFile.ok && !rootLatest) {
    return { status: 'ok', action: 'blocked', reason: 'root-index-unreadable', date, guards, files: [] };
  }
  let action = 'open-pr';
  let reason = 'date-absent-on-main';
  if (dateFile.ok) {
    action = 'skip';
    reason = 'archive-live';
  } else if (day.prOpened) {
    action = 'skip';
    reason = 'pr-already-open';
  }
  const updateRoot = action === 'open-pr' && (!rootLatest || rootLatest < date);
  const files = action === 'open-pr'
    ? [
      { path: `${date}/index.html`, source: paths.digest },
      ...(updateRoot ? [{ path: 'index.html', source: paths.root }] : [])
    ]
    : [];
  const manifest = {
    status: 'ok',
    action,
    reason,
    date,
    branchName: `digest/${date}`,
    baseBranch: branch,
    repo: config.page.repo,
    pageUrl: day.pageUrl,
    updateRoot,
    rootLatest,
    files,
    guards,
    archive: {
      dateUrl,
      rootUrl,
      dateStatus: dateFile.status,
      rootStatus: rootFile.status,
      means: 'file-on-main-not-pages'
    },
    dedupe: {
      branch: `digest/${date}`,
      titleIncludes: date,
      instruction: 'If a pull request for this branch is already open, do not open another.'
    }
  };
  await writeJson(paths.manifest, manifest);
  return { ...manifest, paths };
}

function inside(root, rel) {
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Refusing to write outside the checkout: ${rel}`);
  }
  return target;
}

export async function stage(options) {
  const planned = await plan({ ...options, fetchImpl: options.fetchImpl });
  if (planned.action !== 'open-pr') {
    return { ...planned, wrote: [] };
  }
  if (!options.dest) {
    return { ...planned, wrote: [], reason: 'manifest-only' };
  }
  const dest = path.resolve(options.dest);
  if (!existsSync(dest)) {
    return { status: 'error', action: 'stop', reason: 'dest-missing', message: 'Stage destination must already be a checkout.', date: planned.date };
  }
  const dateFile = inside(dest, `${planned.date}/index.html`);
  if (existsSync(dateFile)) {
    return {
      status: 'ok',
      action: 'skip',
      reason: 'archive-exists-in-checkout',
      date: planned.date,
      wrote: [],
      guards: planned.guards
    };
  }
  const wrote = [];
  const digestFile = planned.files.find(file => file.path.endsWith('/index.html'));
  await mkdir(path.dirname(dateFile), { recursive: true });
  await writeFile(dateFile, await readFile(digestFile.source));
  wrote.push(`${planned.date}/index.html`);
  const rootTarget = inside(dest, 'index.html');
  if (planned.updateRoot) {
    if (existsSync(rootTarget)) {
      const current = latestDateFromRoot(await readFile(rootTarget, 'utf8'));
      if (current && current >= planned.date) {
        planned.updateRoot = false;
      }
    }
    if (planned.updateRoot) {
      const rootFile = planned.files.find(file => file.path === 'index.html');
      await writeFile(rootTarget, await readFile(rootFile.source));
      wrote.push('index.html');
    }
  }
  const nojekyll = inside(dest, '.nojekyll');
  if (!existsSync(nojekyll)) {
    await writeFile(nojekyll, '');
    wrote.push('.nojekyll');
  }
  return {
    status: 'ok',
    action: 'staged',
    reason: 'wrote-allowed-paths',
    date: planned.date,
    wrote,
    guards: planned.guards,
    branchName: planned.branchName,
    baseBranch: planned.baseBranch
  };
}

function highlightGate(language, highlights) {
  if (highlights.length < 3 || highlights.length > 5) return 'highlight-count';
  if (language !== 'en' && highlights.some(item => !item.textZh)) return 'missing-chinese-highlight';
  if (language !== 'zh' && highlights.some(item => !item.text)) return 'missing-english-highlight';
  return '';
}

export async function notify(options) {
  const stateDir = options.stateDir;
  const config = options.config ? mergeConfig(options.config) : await loadConfig(stateDir);
  const zone = assertTimeZone(config.timezone) || 'Asia/Shanghai';
  const now = resolveNow(options.now);
  const { date } = zonedParts(now, zone);
  const paths = runPaths(stateDir, date);
  const state = await loadState(stateDir);
  const day = state.days[date];
  const env = options.env || process.env;
  const boxes = mailboxes(env);
  const base = {
    date,
    pageUrl: day?.pageUrl || pageUrlFor(config.page.baseUrl, date),
    to: boxes.to || null,
    from: boxes.from || null,
    toStatus: boxes.to ? 'configured' : 'unset',
    fromStatus: boxes.from ? 'configured' : 'unset',
    shouldSend: false,
    resend: null
  };
  if (!day?.rendered || !existsSync(paths.prepare) || !existsSync(paths.summary)) {
    const payload = { ...base, reason: 'not-rendered', subject: '', text: '', html: '' };
    return payload;
  }
  const prepared = await readJson(paths.prepare);
  const summary = await readJson(paths.summary);
  const feed = { x: prepared.x, podcasts: prepared.podcasts, blogs: prepared.blogs, rss: prepared.rss };
  const language = prepared.config?.language || config.language;
  const applied = applySummary(feed, summary, language);
  const subject = `AI Builders Digest — ${date}`;
  const text = renderNotificationText({
    pageUrl: prepared.pageUrl,
    date,
    highlights: applied.highlights,
    language
  });
  const html = renderNotificationHtml({
    pageUrl: prepared.pageUrl,
    date,
    highlightsHtml: highlightListHtml(applied.highlights, language),
    counts: prepared.stats
  });
  const idempotencyKey = `fb-digest-${date}-${prepared.fingerprint.slice(0, 16)}`;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const [archive, pages] = await Promise.all([
    probeArchive(config, date, fetchImpl),
    checkPages(config, date, fetchImpl)
  ]);
  let reason = 'ready';
  if (day.notified) reason = 'already-notified';
  else if (day.translationComplete === false) reason = 'translation-incomplete';
  else if (!pages.ready) reason = pages.reason;
  else if (highlightGate(language, applied.highlights)) reason = highlightGate(language, applied.highlights);
  else if (!boxes.to) reason = 'recipient-unset';
  else if (!boxes.from) reason = 'sender-unset';
  const shouldSend = reason === 'ready';
  const payload = {
    ...base,
    pageUrl: prepared.pageUrl,
    reason,
    shouldSend,
    subject,
    text,
    html,
    idempotencyKey,
    highlightCount: applied.highlights.length,
    archiveOnMain: archive.onMain,
    pages,
    resend: shouldSend
      ? {
        to: [boxes.to],
        from: boxes.from,
        subject,
        text,
        html,
        idempotencyKey
      }
      : null
  };
  await writeJson(paths.notification, payload);
  return { ...payload, paths };
}

export async function mark(options) {
  const stateDir = options.stateDir;
  const config = await loadConfig(stateDir);
  const zone = assertTimeZone(config.timezone) || 'Asia/Shanghai';
  const now = resolveNow(options.now);
  const { date } = zonedParts(now, zone);
  const state = await loadState(stateDir);
  const day = state.days[date];
  if (!day) return { status: 'error', action: 'stop', reason: 'missing-day', message: 'Nothing has been prepared for this date.', date };
  if (options.clearPr && options.pr) {
    return { status: 'error', action: 'stop', reason: 'conflicting-mark', message: 'Choose either --pr or --clear-pr.', date };
  }
  if (options.pr) {
    if (!day.rendered) return { status: 'error', action: 'stop', reason: 'not-rendered', date };
    day.prOpened = true;
  }
  if (options.clearPr) {
    if (day.published) return { status: 'error', action: 'stop', reason: 'already-published', date };
    day.prOpened = false;
  }
  if (options.published) {
    if (!day.rendered) return { status: 'error', action: 'stop', reason: 'not-rendered', date };
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const [archive, pages] = await Promise.all([
      probeArchive(config, date, fetchImpl),
      checkPages(config, date, fetchImpl)
    ]);
    if (!pages.ready) {
      return {
        status: 'error',
        action: 'stop',
        reason: pages.reason,
        message: 'Refusing to mark the day published until the public Pages URL serves this date.',
        date,
        archiveOnMain: archive.onMain,
        pages
      };
    }
    day.published = true;
  }
  if (options.notified) {
    if (!day.published && !options.published) {
      return { status: 'error', action: 'stop', reason: 'not-published', message: 'Mark published only after the public Pages URL serves this date.', date };
    }
    day.notified = true;
  }
  day.updatedAt = now.toISOString();
  state.days[date] = day;
  await saveState(stateDir, state);
  return { status: 'ok', action: 'marked', date, day: publicDay(day) };
}

function publicDay(day) {
  return {
    fingerprint: day.fingerprint,
    pageUrl: day.pageUrl,
    rendered: Boolean(day.rendered),
    prOpened: Boolean(day.prOpened),
    published: Boolean(day.published),
    notified: Boolean(day.notified),
    highlightCount: day.highlightCount || 0,
    updatedAt: day.updatedAt
  };
}

export async function status(options) {
  const config = await loadConfig(options.stateDir);
  const zone = assertTimeZone(config.timezone) || 'Asia/Shanghai';
  const now = resolveNow(options.now);
  const { date, weekday } = zonedParts(now, zone);
  const state = await loadState(options.stateDir);
  const runs = existsSync(path.join(options.stateDir, 'runs'))
    ? await readdir(path.join(options.stateDir, 'runs'))
    : [];
  return {
    status: 'ok',
    date,
    weekday,
    timezone: zone,
    day: state.days[date] ? publicDay(state.days[date]) : null,
    runs
  };
}

export async function locked(options, fn) {
  return withLock(options.stateDir, () => fn());
}

export async function removeState(stateDir) {
  await rm(stateDir, { recursive: true, force: true });
}
