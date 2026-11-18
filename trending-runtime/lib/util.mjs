import path from 'node:path';

export const TIME_ZONE = 'America/New_York';
export const GMAIL_ALREADY_SENT_DATE = '2026-11-17';
export const OFFICIAL_TRENDING_URL = 'https://github.com/trending?since=daily';
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
export const PLACEHOLDER_RE = /^(unknown|n\/a|na|none|null|未知|不详|暂无|估计|约)$/i;
export const ESTIMATE_RE = /约|大约|估计|大致|≈|~/;

const BANNED_CONFIG_KEYS = new Set([
  'token',
  'api_key',
  'apikey',
  'gh_token',
  'github_token',
  'resend_api_key',
  'resend_key',
  'secret',
  'password',
  'authorization'
]);

const PRIVATE_ADDRESS_KEYS = new Set([
  'to',
  'from',
  'email',
  'recipient',
  'recipients',
  'notify_to',
  'notify_from',
  'notification'
]);

export function zonedParts(instant, timeZone = TIME_ZONE) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23'
  });
  const map = Object.fromEntries(fmt.formatToParts(instant).map(part => [part.type, part.value]));
  let hour = map.hour;
  if (hour === '24') hour = '00';
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${hour}:${map.minute}`,
    weekday: map.weekday
  };
}

export function nyOffsetMinutes(instant) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    timeZoneName: 'shortOffset',
    hour: '2-digit'
  });
  const name = fmt.formatToParts(instant).find(part => part.type === 'timeZoneName')?.value || '';
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
}

export function expectedAbbr(instant) {
  const offset = nyOffsetMinutes(instant);
  if (offset === -300) return 'EST';
  if (offset === -240) return 'EDT';
  return '';
}

export function formatCount(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function idempotencyKey(date) {
  return `gt-daily-${date}`;
}

export function officialPageUrl(baseUrl, date) {
  const root = String(baseUrl || '').replace(/\/$/, '');
  const url = new URL(`${root}/trending/${date}/`);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('page.baseUrl must be an https origin without credentials.');
  }
  return url.href;
}

export function parseRepoUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.hostname !== 'github.com') return null;
  if (url.search || url.hash) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  const repo = `${parts[0]}/${parts[1]}`;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return { repo, href: `https://github.com/${repo}` };
}

export function isOfficialTrendingUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com') return false;
  if (url.pathname.replace(/\/$/, '') !== '/trending') return false;
  return url.search === '?since=daily';
}

export function parseHttpsUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return url.href;
}

export function previewSlugOk(slug) {
  return /^[a-z0-9-]{1,64}$/.test(slug) && !DATE_RE.test(slug);
}

export function walkStrings(value, visit, base = '$') {
  if (typeof value === 'string') {
    visit(value, base);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, visit, `${base}[${index}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) walkStrings(child, visit, `${base}.${key}`);
  }
}

export function walkKeys(value, visit) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    visit(key);
    walkKeys(child, visit);
  }
}

export function assertConfigSafe(config) {
  walkKeys(config, key => {
    const normalized = String(key).toLowerCase().replaceAll('-', '_');
    if (BANNED_CONFIG_KEYS.has(normalized)) {
      throw new Error(`Refusing config key "${key}". Credentials stay outside this runtime.`);
    }
    if (PRIVATE_ADDRESS_KEYS.has(normalized)) {
      throw new Error(`Refusing config key "${key}". Notification addresses come only from GT_NOTIFY_TO and GT_NOTIFY_FROM.`);
    }
  });
}

export function assertStateDir(stateDir, runtimeRoot) {
  const state = path.resolve(stateDir);
  const runtime = path.resolve(runtimeRoot);
  if (state === runtime || state.startsWith(`${runtime}${path.sep}`)) {
    throw new Error('Refusing to store state inside the runtime package.');
  }
  return state;
}

export function inside(root, rel) {
  const target = path.resolve(root, rel);
  const base = path.resolve(root);
  if (target !== base && !target.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Refusing to write outside the checkout: ${rel}`);
  }
  if (rel.split(/[\\/]/).includes('..')) {
    throw new Error(`Refusing to write outside the checkout: ${rel}`);
  }
  return target;
}

export function redactForStdout(value) {
  if (!value || typeof value !== 'object') return value;
  const copy = { ...value };
  if (copy.toStatus) copy.to = copy.toStatus === 'configured' ? 'configured' : null;
  if (copy.fromStatus) copy.from = copy.fromStatus === 'configured' ? 'configured' : null;
  if (copy.resend && typeof copy.resend === 'object') {
    copy.resend = {
      ...copy.resend,
      ...(copy.resend.to ? { to: ['configured'] } : {}),
      ...(copy.resend.from ? { from: 'configured' } : {})
    };
  }
  return copy;
}

export function parseMailbox(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 200) return '';
  const wrapped = raw.match(/^(.*)<([^<>]+)>$/);
  const addr = (wrapped ? wrapped[2] : raw).trim();
  if (!EMAIL_RE.test(addr) || addr.split('@').length !== 2) return '';
  return raw;
}

export function recordedCounts(text) {
  const found = new Set();
  for (const token of String(text).match(/\d{1,3}(?:,\d{3})+|\d+/g) || []) {
    found.add(Number(token.replaceAll(',', '')));
  }
  return found;
}

export function recordedHasCount(text, value) {
  return recordedCounts(text).has(value);
}

export function extractUrls(text) {
  return String(text).match(/https?:\/\/[^\s<>"'，。）)]+/g) || [];
}

export function readMeta(html, name) {
  const match = String(html).match(new RegExp(`<meta name="${name}" content="([^"]*)"`, 'i'));
  if (!match) return '';
  return match[1]
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

export function pageServesOfficial(html, date) {
  if (readMeta(html, 'gt-edition') !== 'official') return false;
  if (readMeta(html, 'gt-date') !== date) return false;
  const title = String(html).match(/<title>([^<]*)<\/title>/i);
  if (!title) return false;
  if (title[1].includes('不是正式刊') || title[1].includes('样例')) return false;
  const dates = title[1].match(/\d{4}-\d{2}-\d{2}/g) || [];
  return dates.length === 1 && dates[0] === date;
}
