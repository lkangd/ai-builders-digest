import { existsSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emailSubject, renderEmailHtml, renderEmailText } from './render-email.mjs';
import { readEditionMeta, renderIndex } from './render-index.mjs';
import { renderPage } from './render-page.mjs';
import { publishable, validateIssue } from './validate.mjs';
import {
  DATE_RE,
  GMAIL_ALREADY_SENT_DATE,
  OFFICIAL_TRENDING_URL,
  TIME_ZONE,
  assertConfigSafe,
  assertStateDir,
  idempotencyKey,
  inside,
  officialPageUrl,
  pageServesOfficial,
  parseMailbox,
  previewSlugOk,
  readMeta,
  zonedParts
} from './util.mjs';

const RUNTIME_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const DEFAULT_CONFIG = {
  timezone: TIME_ZONE,
  schedule: '08:00',
  includeWeekends: true,
  language: 'zh',
  page: {
    repo: 'lkangd/ai-builders-digest',
    baseUrl: 'https://lkangd.github.io/ai-builders-digest',
    branch: 'main',
    namespace: 'trending'
  },
  source: {
    list: 'github-trending',
    since: 'daily',
    spokenLanguage: 'all',
    url: OFFICIAL_TRENDING_URL
  },
  limits: {
    picksMin: 1,
    picksMax: 8,
    picksTargetMin: 5,
    emailHighlightsMin: 3,
    emailHighlightsMax: 5
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function mergeConfig(override = {}) {
  assertConfigSafe(override);
  if (override.timezone && override.timezone !== TIME_ZONE) {
    throw new Error('Trending dates use America/New_York.');
  }
  if (override.includeWeekends === false) {
    throw new Error('The Trending digest includes weekends.');
  }
  if (override.language && override.language !== 'zh') {
    throw new Error('The Trending digest is written in Chinese.');
  }
  const config = clone(DEFAULT_CONFIG);
  if (override.schedule) config.schedule = override.schedule;
  config.page = { ...config.page, ...(override.page || {}) };
  config.limits = { ...config.limits, ...(override.limits || {}) };
  officialPageUrl(config.page.baseUrl, '2000-01-01');
  return config;
}

function resolveNow(value) {
  if (!value) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --now: ${value}`);
  return date;
}

function issueDate(options) {
  if (options.date) {
    if (!DATE_RE.test(options.date)) throw new Error(`Invalid --date: ${options.date}`);
    return options.date;
  }
  return zonedParts(resolveNow(options.now)).date;
}

function guardState(options) {
  const stateDir = assertStateDir(options.stateDir, RUNTIME_ROOT);
  if (options.dest) {
    const dest = path.resolve(options.dest);
    if (stateDir === dest || stateDir.startsWith(`${dest}${path.sep}`) || dest.startsWith(`${stateDir}${path.sep}`)) {
      throw new Error('State and the checkout must be different directories.');
    }
  }
  return stateDir;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await writeText(file, `${JSON.stringify(value, null, 2)}\n`);
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
    issue: path.join(runDir, 'issue.json'),
    validation: path.join(runDir, 'validation.json'),
    page: path.join(runDir, 'page.html'),
    emailHtml: path.join(runDir, 'email.html'),
    emailText: path.join(runDir, 'email.txt'),
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

async function loadConfig(stateDir) {
  const file = path.join(stateDir, 'config.json');
  if (!existsSync(file)) return mergeConfig();
  return mergeConfig(await readJson(file));
}

export async function withLock(stateDir, fn) {
  await mkdir(stateDir, { recursive: true });
  const lock = path.join(stateDir, '.lock');
  let handle;
  try {
    handle = await open(lock, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const info = await stat(lock).catch(() => null);
    const age = info ? Date.now() - info.mtimeMs : 0;
    if (age < 30 * 60 * 1000) {
      const locked = new Error('Another trending run holds the state lock.');
      locked.code = 'LOCKED';
      throw locked;
    }
    await unlink(lock).catch(() => {});
    handle = await open(lock, 'wx');
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await unlink(lock).catch(() => {});
  }
}

function defaultSlug(issue) {
  if (issue.edition === 'sample') return `sample-${issue.date}`;
  if (issue.edition === 'example') return `example-${issue.date}`;
  return '';
}

async function loadIssue(options) {
  if (options.issue) return options.issue;
  if (!options.issuePath) throw new Error('Pass --issue.');
  return readJson(options.issuePath);
}

export async function prepare(options) {
  const stateDir = guardState(options);
  const config = options.config ? mergeConfig(options.config) : await loadConfig(stateDir);
  const now = resolveNow(options.now);
  const parts = zonedParts(now);
  const date = parts.date;
  const paths = runPaths(stateDir, date);
  const state = await loadState(stateDir);
  const day = state.days[date];
  const intake = await readFile(path.join(RUNTIME_ROOT, 'prompts', 'intake.txt'), 'utf8');
  let action = 'intake';
  let reason = 'awaiting-issue-json';
  if (date === GMAIL_ALREADY_SENT_DATE || day?.channel === 'gmail') {
    action = 'skip';
    reason = 'already-sent-gmail';
  } else if (day?.notified || day?.sendResult === 'sent') {
    action = 'skip';
    reason = 'already-notified';
  } else if (day?.sendResult === 'unknown') {
    action = 'skip';
    reason = 'send-result-unknown';
  } else if (day?.rendered) {
    action = 'render-ready';
    reason = 'issue-already-rendered';
  }
  const payload = {
    status: 'ok',
    action,
    reason,
    date,
    weekday: parts.weekday,
    timezone: config.timezone,
    schedule: config.schedule,
    includeWeekends: true,
    source: config.source,
    emailSuppressed: date === GMAIL_ALREADY_SENT_DATE,
    emailSuppressedReason: date === GMAIL_ALREADY_SENT_DATE ? 'already-sent-gmail' : '',
    doesNot: [
      'fetch-trending',
      'fetch-repositories',
      'execute-repository-code',
      'call-llm',
      'send-email',
      'publish',
      'write-root-index'
    ],
    allowedPublishPaths: ['trending/YYYY-MM-DD/index.html', 'trending/index.html'],
    previewPaths: [
      'trending/preview/<slug>/index.html',
      'trending/preview/<slug>/email.html',
      'trending/preview/<slug>/email.txt'
    ],
    intake
  };
  await writeJson(paths.prepare, payload);
  return { ...payload, paths };
}

export async function validate(options) {
  const stateDir = guardState(options);
  const issue = await loadIssue(options);
  const result = validateIssue(issue);
  const date = DATE_RE.test(issue?.date || '') ? issue.date : issueDate(options);
  const paths = runPaths(stateDir, date);
  await writeJson(paths.validation, { ...result, date: issue?.date || date });
  return {
    status: result.ok ? 'ok' : 'error',
    action: result.ok ? 'valid' : 'invalid',
    date: issue?.date || null,
    publishable: result.ok ? publishable(issue) : false,
    errors: result.errors,
    warnings: result.warnings,
    paths
  };
}

async function scanSite(dest) {
  const root = path.join(dest, 'trending');
  const official = [];
  const previews = [];
  if (!existsSync(root)) return { official, previews };
  for (const name of await readdir(root)) {
    if (!DATE_RE.test(name)) continue;
    const file = path.join(root, name, 'index.html');
    if (!existsSync(file)) continue;
    const meta = readEditionMeta(await readFile(file, 'utf8'));
    if (meta.edition === 'official' && meta.date === name) {
      official.push({ date: name, href: `${name}/`, label: meta.label || name });
    }
  }
  official.sort((a, b) => (a.date < b.date ? 1 : -1));
  const previewRoot = path.join(root, 'preview');
  if (existsSync(previewRoot)) {
    for (const slug of (await readdir(previewRoot)).sort()) {
      if (!previewSlugOk(slug)) continue;
      const file = path.join(previewRoot, slug, 'index.html');
      if (!existsSync(file)) continue;
      const meta = readEditionMeta(await readFile(file, 'utf8'));
      if (meta.edition === 'sample' || meta.edition === 'example') {
        previews.push({ slug, href: `preview/${slug}/`, label: meta.label || slug, edition: meta.edition });
      }
    }
  }
  return { official, previews };
}

async function writeIndex(dest) {
  const site = await scanSite(dest);
  const rel = 'trending/index.html';
  await writeText(inside(dest, rel), renderIndex(site));
  return rel;
}

export async function render(options) {
  const stateDir = guardState(options);
  const config = options.config ? mergeConfig(options.config) : await loadConfig(stateDir);
  const issue = await loadIssue(options);
  const result = validateIssue(issue);
  const date = DATE_RE.test(issue?.date || '') ? issue.date : 'invalid';
  const paths = runPaths(stateDir, date === 'invalid' ? 'invalid' : date);
  await writeJson(paths.validation, result);
  if (!result.ok) {
    return { status: 'error', action: 'invalid', date: issue?.date || null, errors: result.errors, warnings: result.warnings, wrote: [], paths };
  }
  const official = publishable(issue);
  const slug = options.previewSlug || defaultSlug(issue);
  if (!official && !previewSlugOk(slug)) {
    return { status: 'error', action: 'stop', reason: 'bad-preview-slug', date, wrote: [], paths };
  }
  const archiveHref = official ? '../index.html' : '../../index.html';
  const pageHref = official ? officialPageUrl(config.page.baseUrl, issue.date) : './index.html';
  const page = renderPage(issue, { archiveHref });
  const html = renderEmailHtml(issue, { pageHref });
  const text = renderEmailText(issue, { pageHref });
  await writeJson(paths.issue, issue);
  await writeText(paths.page, page);
  await writeText(paths.emailHtml, html);
  await writeText(paths.emailText, text);

  const state = await loadState(stateDir);
  const previous = state.days[issue.date] || {};
  state.days[issue.date] = {
    ...previous,
    edition: issue.edition,
    rendered: true,
    publishable: official,
    idempotencyKey: idempotencyKey(issue.date),
    pageUrl: official ? pageHref : '',
    updatedAt: new Date().toISOString()
  };
  await saveState(stateDir, state);

  const wrote = [];
  if (options.dest) {
    const dest = path.resolve(options.dest);
    if (!existsSync(dest)) {
      return { status: 'error', action: 'stop', reason: 'dest-missing', date, wrote, paths };
    }
    if (official) {
      const rel = `trending/${issue.date}/index.html`;
      const target = inside(dest, rel);
      if (existsSync(target)) {
        return {
          status: 'ok',
          action: 'skip',
          reason: 'archive-exists',
          date,
          edition: issue.edition,
          publishable: true,
          shouldSend: false,
          idempotencyKey: idempotencyKey(issue.date),
          wrote: [],
          paths
        };
      }
      await writeText(target, page);
      wrote.push(rel);
    } else {
      const base = `trending/preview/${slug}`;
      const files = [
        [`${base}/index.html`, page],
        [`${base}/email.html`, html],
        [`${base}/email.txt`, text]
      ];
      for (const [rel, body] of files) {
        if (rel.split('/').some(part => DATE_RE.test(part))) {
          throw new Error(`Refusing to write a preview into a date archive: ${rel}`);
        }
        await writeText(inside(dest, rel), body);
        wrote.push(rel);
      }
    }
    wrote.push(await writeIndex(dest));
  }
  return {
    status: 'ok',
    action: 'rendered',
    reason: 'wrote-local-html',
    date,
    edition: issue.edition,
    publishable: official,
    shouldSend: false,
    idempotencyKey: idempotencyKey(issue.date),
    subject: emailSubject(issue),
    wrote,
    warnings: result.warnings,
    paths
  };
}

async function checkPages(config, date, fetchImpl) {
  const url = officialPageUrl(config.page.baseUrl, date);
  try {
    const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    const text = typeof response.text === 'function' ? await response.text() : '';
    if (response.status !== 200 || !response.ok) {
      return { url, status: response.status, ready: false, reason: 'page-not-live' };
    }
    if (readMeta(text, 'gt-edition') !== 'official') {
      return { url, status: 200, ready: false, reason: 'page-not-official' };
    }
    if (!pageServesOfficial(text, date)) {
      return { url, status: 200, ready: false, reason: 'page-stale' };
    }
    return { url, status: 200, ready: true, reason: 'pages-ready' };
  } catch (error) {
    return { url, status: 0, ready: false, reason: 'page-check-failed', message: error.message };
  }
}

function mailboxes(env) {
  return {
    to: parseMailbox(env.GT_NOTIFY_TO || ''),
    from: parseMailbox(env.GT_NOTIFY_FROM || '')
  };
}

export async function notify(options) {
  const stateDir = guardState(options);
  const config = options.config ? mergeConfig(options.config) : await loadConfig(stateDir);
  const date = issueDate(options);
  const paths = runPaths(stateDir, date);
  const state = await loadState(stateDir);
  const day = state.days[date];
  const env = options.env || process.env;
  const boxes = mailboxes(env);
  const key = idempotencyKey(date);
  let issue = null;
  if (existsSync(paths.issue)) issue = await readJson(paths.issue);
  const pageHref = issue?.edition === 'official' ? officialPageUrl(config.page.baseUrl, date) : './index.html';
  const subject = issue ? emailSubject(issue) : '';
  const text = issue ? renderEmailText(issue, { pageHref }) : '';
  const html = issue ? renderEmailHtml(issue, { pageHref }) : '';
  const base = {
    status: 'ok',
    date,
    edition: issue?.edition || day?.edition || null,
    pageUrl: day?.pageUrl || (issue?.edition === 'official' ? pageHref : ''),
    idempotencyKey: key,
    subject,
    text,
    html,
    highlightCount: issue?.emailHighlights?.length || 0,
    to: boxes.to || null,
    from: boxes.from || null,
    toStatus: boxes.to ? 'configured' : 'unset',
    fromStatus: boxes.from ? 'configured' : 'unset',
    shouldSend: false,
    resend: null,
    sendBlocked: false
  };

  let reason = 'ready';
  let pages = null;
  if (date === GMAIL_ALREADY_SENT_DATE) {
    reason = 'already-sent-gmail';
    base.sendBlocked = true;
    pages = { url: officialPageUrl(config.page.baseUrl, date), status: null, ready: false, reason: 'already-sent-gmail' };
  } else if (!day?.rendered || !issue) reason = 'not-rendered';
  else if (issue.edition !== 'official') reason = 'not-an-official-issue';
  else if (day.sendResult === 'unknown') reason = 'send-result-unknown';
  else if (day.notified || day.sendResult === 'sent') reason = 'already-notified';
  else {
    pages = await checkPages(config, date, options.fetchImpl || globalThis.fetch);
    const count = issue.emailHighlights?.length || 0;
    if (!pages.ready) reason = pages.reason;
    else if (count < 3 || count > 5) reason = 'highlight-count';
    else if (!boxes.to) reason = 'recipient-unset';
    else if (!boxes.from) reason = 'sender-unset';
  }
  const shouldSend = reason === 'ready';
  const payload = {
    ...base,
    reason,
    shouldSend,
    pages,
    resend: shouldSend
      ? { to: [boxes.to], from: boxes.from, subject, text, html, idempotencyKey: key }
      : null
  };
  await writeJson(paths.notification, payload);
  return { ...payload, paths };
}

export async function mark(options) {
  const stateDir = guardState(options);
  const config = options.config ? mergeConfig(options.config) : await loadConfig(stateDir);
  const date = issueDate(options);
  const state = await loadState(stateDir);
  const day = state.days[date];
  const flags = [options.pr, options.clearPr, options.published, options.notified, options.sendUnknown, options.recordGmailSent].filter(Boolean);
  if (flags.length === 0) {
    return { status: 'error', action: 'stop', reason: 'missing-mark', date };
  }
  if (options.recordGmailSent && flags.length !== 1) {
    return { status: 'error', action: 'stop', reason: 'conflicting-mark', date };
  }
  if (options.notified && options.sendUnknown) {
    return { status: 'error', action: 'stop', reason: 'conflicting-mark', date };
  }
  if (options.recordGmailSent) {
    if (date !== GMAIL_ALREADY_SENT_DATE) {
      return { status: 'error', action: 'stop', reason: 'not-migration-day', date };
    }
    const next = day || { rendered: false, publishable: false };
    next.notified = true;
    next.channel = 'gmail';
    next.sendResult = 'sent';
    next.idempotencyKey = idempotencyKey(date);
    next.updatedAt = new Date().toISOString();
    state.days[date] = next;
    await saveState(stateDir, state);
    return { status: 'ok', action: 'marked', date, day: publicDay(next) };
  }
  if (!day) return { status: 'error', action: 'stop', reason: 'missing-day', date };
  if (options.pr) {
    if (!day.rendered || !day.publishable) return { status: 'error', action: 'stop', reason: 'not-publishable', date };
    day.prOpened = true;
  }
  if (options.clearPr) {
    if (day.published) return { status: 'error', action: 'stop', reason: 'already-published', date };
    day.prOpened = false;
  }
  if (options.published || options.notified) {
    if (date === GMAIL_ALREADY_SENT_DATE && options.notified) {
      return { status: 'error', action: 'stop', reason: 'already-sent-gmail', message: 'Do not record a Resend send for 2026-11-17.', date };
    }
    const pages = await checkPages(config, date, options.fetchImpl || globalThis.fetch);
    if (!pages.ready) {
      return { status: 'error', action: 'stop', reason: pages.reason, date, pages };
    }
    if (!day.rendered || !day.publishable) return { status: 'error', action: 'stop', reason: 'not-publishable', date };
    if (options.published) day.published = true;
    if (options.notified) {
      if (day.sendResult === 'unknown') return { status: 'error', action: 'stop', reason: 'send-result-unknown', date };
      if (!day.published && !options.published) return { status: 'error', action: 'stop', reason: 'not-published', date };
      day.notified = true;
      day.channel = 'resend';
      day.sendResult = 'sent';
    }
  }
  if (options.sendUnknown) {
    if (!day.rendered) return { status: 'error', action: 'stop', reason: 'not-rendered', date };
    day.sendResult = 'unknown';
    day.notified = false;
  }
  day.updatedAt = new Date().toISOString();
  state.days[date] = day;
  await saveState(stateDir, state);
  return { status: 'ok', action: 'marked', date, day: publicDay(day) };
}

function publicDay(day) {
  return {
    edition: day.edition || null,
    rendered: Boolean(day.rendered),
    publishable: Boolean(day.publishable),
    prOpened: Boolean(day.prOpened),
    published: Boolean(day.published),
    notified: Boolean(day.notified),
    sendResult: day.sendResult || null,
    channel: day.channel || null,
    idempotencyKey: day.idempotencyKey || null,
    pageUrl: day.pageUrl || '',
    updatedAt: day.updatedAt
  };
}

export async function status(options) {
  const stateDir = guardState(options);
  const config = await loadConfig(stateDir);
  const parts = zonedParts(resolveNow(options.now));
  const state = await loadState(stateDir);
  const runs = existsSync(path.join(stateDir, 'runs')) ? await readdir(path.join(stateDir, 'runs')) : [];
  return {
    status: 'ok',
    date: parts.date,
    weekday: parts.weekday,
    timezone: config.timezone,
    schedule: config.schedule,
    includeWeekends: true,
    migration: { date: GMAIL_ALREADY_SENT_DATE, email: 'already-sent-gmail', resend: false },
    day: state.days[parts.date] ? publicDay(state.days[parts.date]) : null,
    runs
  };
}

export async function stage(options) {
  const stateDir = guardState(options);
  const date = issueDate(options);
  const state = await loadState(stateDir);
  const day = state.days[date];
  const paths = runPaths(stateDir, date);
  if (!options.dest) return { status: 'error', action: 'stop', reason: 'dest-missing', date, wrote: [] };
  if (!day?.rendered || !day.publishable || !existsSync(paths.page)) {
    return { status: 'error', action: 'stop', reason: 'not-publishable', date, wrote: [] };
  }
  const page = await readFile(paths.page, 'utf8');
  const meta = readEditionMeta(page);
  if (meta.edition !== 'official' || meta.date !== date) {
    return { status: 'error', action: 'stop', reason: 'not-an-official-issue', date, wrote: [] };
  }
  const dest = path.resolve(options.dest);
  if (!existsSync(dest)) return { status: 'error', action: 'stop', reason: 'dest-missing', date, wrote: [] };
  const rel = `trending/${date}/index.html`;
  const target = inside(dest, rel);
  if (existsSync(target)) {
    return { status: 'ok', action: 'skip', reason: 'archive-exists', date, wrote: [] };
  }
  await writeText(target, page);
  const wrote = [rel, await writeIndex(dest)];
  const allowed = new Set([`trending/${date}/index.html`, 'trending/index.html']);
  if (wrote.some(item => !allowed.has(item))) {
    throw new Error(`Refusing unexpected stage paths: ${wrote.join(', ')}`);
  }
  return { status: 'ok', action: 'staged', reason: 'wrote-allowed-paths', date, wrote };
}

export async function locked(options, fn) {
  const stateDir = guardState(options);
  return withLock(stateDir, () => fn());
}
