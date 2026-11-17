import { asCount, cap, safeUrl, sha256 } from './util.mjs';

function listFrom(payload, key) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload[key])) return payload[key];
  return [];
}

export function normalizeFeeds(raw, limits, warnings) {
  const tweetsPerBuilder = limits.tweetsPerBuilder;
  const x = [];
  for (const builder of listFrom(raw.x, 'x')) {
    if (!builder || typeof builder !== 'object') continue;
    const tweets = [];
    const seen = new Set();
    for (const tweet of builder.tweets || []) {
      const url = safeUrl(tweet?.url);
      if (!url) {
        warnings.push('dropped tweet without an http(s) url');
        continue;
      }
      if (seen.has(url)) continue;
      seen.add(url);
      const text = String(tweet.text || '').trim();
      if (!text) {
        warnings.push('dropped tweet with empty text');
        continue;
      }
      tweets.push({
        id: String(tweet.id || ''),
        text,
        createdAt: String(tweet.createdAt || ''),
        url,
        likes: asCount(tweet.likes),
        retweets: asCount(tweet.retweets),
        replies: asCount(tweet.replies),
        isQuote: Boolean(tweet.isQuote),
        quotedTweetId: /^[0-9]+$/.test(String(tweet.quotedTweetId || '')) ? String(tweet.quotedTweetId) : ''
      });
      if (tweets.length >= tweetsPerBuilder) break;
    }
    if (tweets.length === 0) continue;
    x.push({
      name: String(builder.name || builder.handle || 'Builder'),
      handle: String(builder.handle || '').replace(/^@/, ''),
      bio: String(builder.bio || ''),
      tweets
    });
  }

  const podcasts = listFrom(raw.podcasts, 'podcasts')
    .map(item => ({
      name: String(item?.name || ''),
      title: String(item?.title || item?.name || ''),
      url: safeUrl(item?.url),
      publishedAt: String(item?.publishedAt || ''),
      transcript: String(item?.transcript || '')
    }))
    .filter(item => {
      if (item.url && item.title) return true;
      warnings.push('dropped podcast without an http(s) url');
      return false;
    })
    .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)))
    .slice(0, limits.podcasts)
    .map(item => ({ ...item, transcript: cap(item.transcript, limits.transcriptChars) }));

  const blogs = listFrom(raw.blogs, 'blogs')
    .map(item => ({
      name: String(item?.name || item?.source || ''),
      title: String(item?.title || item?.name || ''),
      url: safeUrl(item?.url),
      author: String(item?.author || ''),
      publishedAt: String(item?.publishedAt || ''),
      content: cap(String(item?.content || item?.description || ''), limits.blogChars)
    }))
    .filter(item => {
      if (item.url && item.title) return true;
      warnings.push('dropped blog without an http(s) url');
      return false;
    });

  const rss = listFrom(raw.rss, 'rss')
    .map(item => ({
      name: String(item?.name || ''),
      title: String(item?.title || item?.name || ''),
      url: safeUrl(item?.url),
      publishedAt: String(item?.publishedAt || ''),
      content: cap(String(item?.content || item?.description || ''), limits.rssChars)
    }))
    .filter(item => {
      if (item.url && item.title) return true;
      warnings.push('dropped rss item without an http(s) url');
      return false;
    });

  return { x, podcasts, blogs, rss };
}

export function fingerprintOf(feed) {
  const canonical = {
    x: feed.x.map(builder => ({
      handle: builder.handle,
      name: builder.name,
      bio: builder.bio,
      tweets: builder.tweets.map(tweet => ({
        url: tweet.url,
        text: tweet.text,
        createdAt: tweet.createdAt,
        isQuote: tweet.isQuote,
        quotedTweetId: tweet.quotedTweetId
      }))
    })),
    podcasts: feed.podcasts.map(item => ({
      url: item.url,
      title: item.title,
      name: item.name,
      publishedAt: item.publishedAt,
      transcript: item.transcript
    })),
    blogs: feed.blogs.map(item => ({
      url: item.url,
      title: item.title,
      content: item.content
    })),
    rss: feed.rss.map(item => ({
      url: item.url,
      title: item.title,
      content: item.content
    }))
  };
  return sha256(JSON.stringify(canonical));
}

export function statsOf(feed) {
  return {
    xBuilders: feed.x.length,
    totalTweets: feed.x.reduce((sum, builder) => sum + builder.tweets.length, 0),
    podcastEpisodes: feed.podcasts.length,
    blogPosts: feed.blogs.length,
    rssItems: feed.rss.length
  };
}

export function feedUrls(feed) {
  const urls = new Set();
  for (const builder of feed.x) {
    for (const tweet of builder.tweets) urls.add(tweet.url);
  }
  for (const item of [...feed.podcasts, ...feed.blogs, ...feed.rss]) urls.add(item.url);
  return urls;
}

export function applySummary(feed, summary, language) {
  const warnings = [];
  const urls = feedUrls(feed);
  const handles = new Set(feed.x.map(builder => builder.handle).filter(Boolean));
  const byUrl = new Map();
  const byHandle = new Map();
  const entries = Array.isArray(summary?.entries) ? summary.entries : [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const summaryText = String(entry.summary || '').trim();
    const summaryZh = String(entry.summaryZh || '').trim();
    if (!summaryText && !summaryZh) continue;
    if (entry.url) {
      const url = safeUrl(entry.url);
      if (!url || !urls.has(url)) {
        warnings.push('dropped summary whose url is not in the prepared feed');
        continue;
      }
      byUrl.set(url, { summary: summaryText, summaryZh });
      continue;
    }
    if (entry.handle) {
      const handle = String(entry.handle).replace(/^@/, '');
      if (!handles.has(handle)) {
        warnings.push('dropped summary whose handle is not in the prepared feed');
        continue;
      }
      byHandle.set(handle, { summary: summaryText, summaryZh });
    }
  }

  const highlights = [];
  const seen = new Set();
  for (const item of Array.isArray(summary?.highlights) ? summary.highlights : []) {
    const url = safeUrl(item?.url);
    const text = String(item?.text || '').trim();
    const textZh = String(item?.textZh || '').trim();
    if (!url || !urls.has(url) || seen.has(url)) {
      warnings.push('dropped highlight whose url is not in the prepared feed');
      continue;
    }
    if ((language === 'en' && !text) || (language !== 'en' && !text && !textZh)) {
      warnings.push('dropped empty highlight');
      continue;
    }
    seen.add(url);
    highlights.push({
      text: cap(text, 600),
      textZh: cap(textZh, 600),
      url
    });
  }
  if (highlights.length > 5) warnings.push('truncated highlights to 5');
  return { byUrl, byHandle, highlights: highlights.slice(0, 5), warnings };
}
