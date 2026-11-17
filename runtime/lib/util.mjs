import { createHash } from 'node:crypto';

export function zonedParts(instant, timeZone) {
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

export function assertTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return timeZone;
  } catch {
    return null;
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function safeUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

export function linkify(text) {
  return escapeHtml(text).replace(
    /https?:\/\/[^\s&<]+/g,
    url => `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#ff385c;text-decoration:none;word-break:break-all;">${url}</a>`
  );
}

export function cap(text, max) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function pageUrlFor(baseUrl, date) {
  return `${String(baseUrl || '').replace(/\/$/, '')}/${date}/`;
}

export function latestDateFromRoot(html) {
  const match = String(html || '').match(/rel="canonical" href="[^"]+\/(\d{4}-\d{2}-\d{2})\//);
  return match ? match[1] : null;
}

export function parseMailbox(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 200) return '';
  const wrapped = raw.match(/^(.*)<([^<>]+)>$/);
  const addr = (wrapped ? wrapped[2] : raw).trim();
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(addr)) return '';
  return raw;
}

export function bodyHtml(text) {
  return escapeHtml(text).replaceAll('\n', '<br>');
}

export function initials(name) {
  const parts = String(name || '').split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map(part => part[0]?.toUpperCase() || '').join('') || 'AI';
}

export function asCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}

export function youtubeEmbed(value) {
  const href = safeUrl(value);
  if (!href) return '';
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, '');
    let id = '';
    if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') id = url.searchParams.get('v') || '';
      if (url.pathname.startsWith('/embed/')) id = url.pathname.split('/')[2] || '';
    }
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) return '';
    return `https://www.youtube.com/embed/${id}`;
  } catch {
    return '';
  }
}

export function redactForStdout(value) {
  if (!value || typeof value !== 'object') return value;
  const copy = { ...value };
  if (copy.toStatus) copy.to = copy.toStatus === 'configured' ? 'configured' : null;
  if (copy.fromStatus) copy.from = copy.fromStatus === 'configured' ? 'configured' : null;
  if (copy.resend) copy.resend = { ready: true, idempotencyKey: copy.idempotencyKey };
  delete copy.html;
  return copy;
}

export function walkKeys(value, visit) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    visit(key);
    walkKeys(child, visit);
  }
}
