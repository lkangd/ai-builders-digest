// Public, keyless media enrichment. Same sources as the original enrich-feed.js:
// Twitter syndication for avatars, photos, video, and quoted posts, with
// fxtwitter only when syndication omits a long-post or quote body.

const FX_TWITTER_URL = 'https://api.fxtwitter.com/status/';
const USER_AGENT = 'follow-builders-cloud-runtime';

export function selectTweetText(sourceText, enrichedText) {
  const source = String(sourceText || '').trim();
  const enriched = String(enrichedText || '').trim();
  return source.length > enriched.length ? source : enriched;
}

export function syndicationBodyText(raw) {
  const note = raw?.note_tweet?.text;
  if (note) return String(note);
  return String(raw?.text || '');
}

function noteTweetMissingText(note) {
  return !!(note && typeof note === 'object' && !note.text);
}

export function syndicationNeedsFullText(raw) {
  if (!raw || typeof raw !== 'object') return false;
  if (noteTweetMissingText(raw.note_tweet)) return true;
  if (noteTweetMissingText(raw.quoted_tweet?.note_tweet)) return true;
  if (raw.quoted_tweet) return true;
  return false;
}

function pickBestMp4(videoInfo) {
  const variants = videoInfo?.variants || [];
  const mp4s = variants.filter(item => item && /mp4/i.test(item.content_type || item.type || 'video/mp4') && item.url);
  if (mp4s.length === 0) return null;
  mp4s.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const best = mp4s[0];
  return { mp4Url: best.url, bitrate: best.bitrate || 0 };
}

function mapMedia(rawMedia) {
  if (!Array.isArray(rawMedia)) return [];
  return rawMedia
    .filter(item => item && (item.type === 'photo' || item.type === 'video' || item.type === 'animated_gif') && item.media_url_https)
    .map(item => {
      const out = {
        type: item.type,
        url: item.media_url_https,
        altText: item.alt_text || item.ext_alt_text || item.description || ''
      };
      if (item.type !== 'photo') {
        const video = pickBestMp4(item.video_info);
        if (video) out.video = video;
      }
      return out;
    });
}

function extractMedia(raw) {
  if (!raw) return [];
  if (Array.isArray(raw.mediaDetails) && raw.mediaDetails.length) return mapMedia(raw.mediaDetails);
  const out = [];
  for (const photo of raw.photos || []) {
    if (photo && (photo.url || photo.mediaUrlHttps)) {
      out.push({ type: 'photo', url: photo.url || photo.mediaUrlHttps, altText: photo.altText || '' });
    }
  }
  if (raw.video && (raw.video.poster || raw.video.mediaUrlHttps)) {
    const video = pickBestMp4({ variants: raw.video.variants });
    out.push({
      type: raw.video.type || 'video',
      url: raw.video.poster || raw.video.mediaUrlHttps,
      altText: '',
      ...(video ? { video } : {})
    });
  }
  return out.filter(item => item.url);
}

function resolveTco(text, urls) {
  let out = String(text || '');
  for (const item of urls || []) {
    const replacement = item.display || item.expanded;
    if (item.url && replacement && item.url !== replacement) out = out.split(item.url).join(replacement);
  }
  return out.replace(/\s*https?:\/\/t\.co\/\S+/g, '').trim();
}

function mapUrls(rawUrls) {
  if (!Array.isArray(rawUrls)) return [];
  return rawUrls.map(item => ({
    url: item.url,
    expanded: item.expanded_url,
    display: item.display_url || item.expanded_url
  }));
}

function upgradeAvatar(url) {
  if (!url) return '';
  return String(url).replace(/_normal\.(jpe?g|png|webp)/i, '_400x400.$1');
}

function mapQuoted(quoted) {
  if (!quoted) return null;
  const user = quoted.user || {};
  const urls = mapUrls(quoted.entities?.urls);
  const id = quoted.id_str || quoted.rest_id || '';
  return {
    id,
    url: user.screen_name && id ? `https://x.com/${user.screen_name}/status/${id}` : '',
    author: {
      name: user.name || '',
      screenName: user.screen_name || '',
      profileImageUrlHttps: upgradeAvatar(user.profile_image_url_https)
    },
    text: resolveTco(syndicationBodyText(quoted), urls),
    media: extractMedia(quoted)
  };
}

function mapTweet(raw) {
  const user = raw.user || {};
  const urls = mapUrls(raw.entities?.urls);
  const fullText = syndicationBodyText(raw);
  return {
    author: {
      name: user.name || '',
      screenName: user.screen_name || '',
      profileImageUrlHttps: upgradeAvatar(user.profile_image_url_https)
    },
    resolvedText: resolveTco(fullText, urls),
    media: extractMedia(raw),
    quotedTweet: mapQuoted(raw.quoted_tweet)
  };
}

function preserveFullTweetText(tweet, enriched) {
  const sourceText = resolveTco(tweet.text || '', enriched.urls || []);
  const resolvedText = selectTweetText(sourceText, enriched.resolvedText);
  return resolvedText === enriched.resolvedText ? enriched : { ...enriched, resolvedText };
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    redirect: 'follow',
    signal: AbortSignal.timeout(12000)
  });
  if (!response.ok) {
    const error = new Error(`HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function fetchFxTweet(tweetId, fetchImpl) {
  try {
    const json = await fetchJson(`${FX_TWITTER_URL}${encodeURIComponent(tweetId)}`, fetchImpl);
    return json?.tweet || null;
  } catch {
    return null;
  }
}

function applyFxFullText(enriched, fx) {
  if (!fx || !enriched) return enriched;
  let next = enriched;
  const fxText = String(fx.text || '').trim();
  if (fxText) {
    const resolvedText = selectTweetText(fxText, enriched.resolvedText);
    if (resolvedText !== enriched.resolvedText) next = { ...next, resolvedText };
  }
  const fxQuote = String(fx.quote?.text || '').trim();
  if (fxQuote && next.quotedTweet) {
    const text = selectTweetText(fxQuote, next.quotedTweet.text);
    if (text !== next.quotedTweet.text) next = { ...next, quotedTweet: { ...next.quotedTweet, text } };
  }
  return next;
}

async function mapTweetWithFallback(raw, tweetId, fetchImpl) {
  let enriched = mapTweet(raw);
  if (!syndicationNeedsFullText(raw)) return enriched;
  const fx = await fetchFxTweet(tweetId, fetchImpl);
  return applyFxFullText(enriched, fx);
}

async function mapPool(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
  return out;
}

export async function enrichFeed(feed, { fetchImpl = globalThis.fetch, token = 'public' } = {}) {
  const warnings = [];
  const x = await mapPool(feed.x || [], 4, async builder => {
    const tweets = await mapPool(builder.tweets || [], 4, async tweet => {
      if (!/^\d{6,}$/.test(String(tweet.id || ''))) return tweet;
      const url = `https://cdn.syndication.twimg.com/tweet-result?id=${encodeURIComponent(tweet.id)}&token=${encodeURIComponent(token)}&d=1`;
      try {
        const raw = await fetchJson(url, fetchImpl);
        const enriched = preserveFullTweetText(tweet, await mapTweetWithFallback(raw, tweet.id, fetchImpl));
        return { ...tweet, enriched };
      } catch (error) {
        warnings.push(`tweet ${tweet.id} enrichment failed: ${error.message}`);
        return tweet;
      }
    });
    return { ...builder, tweets };
  });
  return { ...feed, x, enrichWarnings: warnings };
}

export function segmentText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean);
}
