import { bodyHtml, escapeHtml, initials, linkify, youtubeEmbed, zonedParts } from './util.mjs';

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const ICON_HEART = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNCIgaGVpZ2h0PSIxNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjZmYzODVjIj48cGF0aCBkPSJNMTIgMjEuMzVsLTEuNDUtMS4zMkM1LjQgMTUuMzYgMiAxMi4yOCAyIDguNSAyIDUuNDIgNC40MiAzIDcuNSAzYzEuNzQgMCAzLjQxLjgxIDQuNSAyLjA5QzEzLjA5IDMuODEgMTQuNzYgMyAxNi41IDMgMTkuNTggMyAyMiA1LjQyIDIyIDguNWMwIDMuNzgtMy40IDYuODYtOC41NSAxMS41NEwxMiAyMS4zNXoiLz48L3N2Zz4=';
const ICON_RETWEET = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNCIgaGVpZ2h0PSIxNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjNmE2YTZhIj48cGF0aCBkPSJNNyA3aDEwdjNsNC00LTQtNHYzSDV2NmgyVjd6bTEwIDEwSDd2LTNsLTQgNCA0IDR2LTNoMTJ2LTZoLTJ2NHoiLz48L3N2Zz4=';
const ICON_REPLY = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNCIgaGVpZ2h0PSIxNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSIjNmE2YTZhIj48cGF0aCBkPSJNMjAgMkg0Yy0xLjEgMC0yIC45LTIgMnYxOGw0LTRoMTRjMS4xIDAgMi0uOSAyLTJWNGMwLTEuMS0uOS0yLTItMnptMCAxNEg2bC0yIDJWNGgxNnYxMnoiLz48L3N2Zz4=';

const LIGHTBOX_STYLE = `
      .fb-lightbox{position:fixed;inset:0;background:rgba(0,0,0,0.7);backdrop-filter:blur(5px);-webkit-backdrop-filter:blur(5px);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:grab;-webkit-font-smoothing:antialiased;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .22s ease,visibility 0s linear .22s;}
      .fb-lightbox.open{opacity:1;visibility:visible;pointer-events:auto;transition:opacity .22s ease,visibility 0s;}
      .fb-lightbox-stage{width:92vw;height:88vh;overflow:hidden;transform:scale(.94);opacity:0;transition:transform .24s cubic-bezier(.2,.8,.2,1),opacity .22s ease;will-change:transform,opacity;}
      .fb-lightbox.open .fb-lightbox-stage{transform:scale(1);opacity:1;}
      .fb-lightbox img{max-width:100%;max-height:100%;display:block;user-select:none;-webkit-user-drag:none;}
      .fb-lightbox-close{position:fixed;top:16px;right:16px;z-index:20;width:40px;height:40px;border-radius:9999px;background:rgba(255,255,255,0.14);color:#fff;font-size:24px;line-height:40px;text-align:center;cursor:pointer;border:none;padding:0;font-family:inherit;}
`;

function metric(icon, value) {
  return `<span style="display:inline-block;font-size:12px;line-height:16px;color:#6a6a6a;font-family:${FONT};vertical-align:middle;"><img src="${icon}" width="13" height="13" style="display:inline-block;vertical-align:-2px;margin-right:3px;" alt="" />${escapeHtml(value)}</span>`;
}

function translationTile(text) {
  if (!text) return '';
  return `<tr><td style="padding:10px 0 0 0;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #ebebeb;border-radius:8px;">
      <tr><td style="padding:10px 14px;font-family:${FONT};">
        <div style="font-size:10px;line-height:12px;font-weight:700;color:#929292;text-transform:uppercase;letter-spacing:0.1em;">译文</div>
        <div style="padding-top:4px;font-size:13px;line-height:21px;color:#3f3f3f;">${bodyHtml(text)}</div>
      </td></tr>
    </table>
  </td></tr>`;
}

function cardShell(inner) {
  return `<tr>
      <td style="padding:0 0 20px 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #ebebeb;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
          <tr>
            <td class="mobile-card-padding" style="padding:24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                ${inner}
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function sectionHeader(icon, label, title) {
  return `<tr>
      <td style="padding:32px 0 18px 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="width:36px;vertical-align:middle;">
              <table role="presentation" width="32" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #ebebeb;border-radius:9999px;">
                <tr><td align="center" style="padding:7px 0;font-size:14px;line-height:14px;color:#222222;font-family:${FONT};">${escapeHtml(icon)}</td></tr>
              </table>
            </td>
            <td style="vertical-align:middle;padding-left:12px;">
              <div style="font-size:10px;line-height:12px;font-weight:700;color:#6a6a6a;text-transform:uppercase;letter-spacing:0.1em;font-family:${FONT};">${escapeHtml(label)}</div>
              <div class="mobile-section-title" style="padding-top:3px;font-size:20px;line-height:26px;font-weight:600;color:#222222;font-family:${FONT};">${escapeHtml(title)}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function avatar(name) {
  return `<div style="width:48px;height:48px;border-radius:9999px;background:linear-gradient(135deg,#f7f7f7,#ebebeb);border:1px solid #ebebeb;display:flex;align-items:center;justify-content:center;font-weight:700;color:#222222;font-family:${FONT};">${escapeHtml(initials(name))}</div>`;
}

function stamp(iso, timeZone) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return escapeHtml(iso);
  const parts = zonedParts(date, timeZone);
  return `${parts.date} ${parts.time}`;
}

export function highlightListHtml(highlights, language) {
  if (!highlights.length) return '';
  const items = highlights.map(item => {
    const lines = [];
    if (language !== 'zh' && item.text) lines.push(escapeHtml(item.text));
    if (language !== 'en' && item.textZh) lines.push(escapeHtml(item.textZh));
    lines.push(`<a href="${escapeHtml(item.url)}">${escapeHtml(item.url)}</a>`);
    return `<li>${lines.join('<br>')}</li>`;
  }).join('\n');
  return `<ul>\n${items}\n</ul>`;
}

function overview(model) {
  const stats = [
    ['BUILDERS', model.stats.xBuilders],
    ['UPDATES', model.stats.totalTweets],
    ['PODCASTS', model.stats.podcastEpisodes],
    ['BLOGS', model.stats.blogPosts],
    ['RSS', model.stats.rssItems]
  ];
  const when = zonedParts(new Date(model.generatedAt), model.timezone);
  return `<tr>
      <td style="padding:0 0 24px 0;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #ebebeb;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,0.04);overflow:hidden;">
          <tr><td style="height:3px;background:linear-gradient(90deg,#ff385c,#ff5470);font-size:0;line-height:0;">&nbsp;</td></tr>
          <tr>
            <td style="padding:28px 28px 26px 28px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr><td>
                  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="background:#fff1f2;border-radius:9999px;">
                    <tr><td style="padding:4px 12px;font-size:10px;line-height:14px;font-weight:700;color:#ff385c;font-family:${FONT};text-transform:uppercase;letter-spacing:0.1em;">Weekly Report</td></tr>
                  </table>
                </td></tr>
                <tr><td class="mobile-hero-title" style="padding-top:14px;font-size:26px;line-height:32px;font-weight:600;color:#222222;font-family:${FONT};">Intelligence Summary</td></tr>
                <tr><td style="padding-top:6px;font-size:13px;line-height:20px;color:#6a6a6a;font-family:${FONT};">Generated ${escapeHtml(when.date)} ${escapeHtml(when.time)}</td></tr>
                <tr><td style="padding-top:20px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
                    ${stats.map(([label, value], index) => `<td style="width:20%;padding-right:${index < stats.length - 1 ? '8px' : '0'};vertical-align:top;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #ebebeb;border-radius:10px;">
                        <tr><td align="center" style="padding:14px 6px 4px 6px;font-size:10px;line-height:12px;color:#6a6a6a;font-family:${FONT};font-weight:700;letter-spacing:0.08em;">${label}</td></tr>
                        <tr><td align="center" style="padding:0 6px 14px 6px;font-size:28px;line-height:32px;font-weight:700;color:#222222;font-family:${FONT};">${escapeHtml(value)}</td></tr>
                      </table>
                    </td>`).join('')}
                  </tr></table>
                </td></tr>
                <tr><td class="mobile-overview-copy" style="padding-top:18px;font-size:14px;line-height:22px;color:#6a6a6a;font-family:${FONT};">This digest tracks fresh builder updates, podcast ideas, blog posts, and RSS briefings with bilingual summaries optimized for scanning.</td></tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function tweetCard(builder, model) {
  const showZh = model.language !== 'en';
  const tweets = builder.tweets.map((tweet, index) => {
    const quote = tweet.isQuote
      ? ` <span style="display:inline-block;padding:1px 8px;background:#fff1f2;border-radius:9999px;color:#ff385c;font-size:10px;font-weight:700;font-family:${FONT};vertical-align:1px;">Quoted</span>`
      : '';
    const quoteLink = tweet.quotedTweetId
      ? `<tr><td style="padding-top:8px;"><a href="https://x.com/i/status/${tweet.quotedTweetId}" target="_blank" rel="noopener noreferrer" style="color:#ff385c;text-decoration:none;font-size:12px;font-weight:600;font-family:${FONT};">Quoted post →</a></td></tr>`
      : '';
    return `<tr><td style="padding-top:${index === 0 ? '0' : '10px'};">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f7f7;border-radius:14px;">
        <tr><td style="padding:14px 16px;font-family:${FONT};">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            <tr><td style="font-size:13px;line-height:18px;color:#6a6a6a;">${escapeHtml(stamp(tweet.createdAt, model.timezone))}${quote}</td></tr>
            <tr><td class="mobile-body-text" style="padding-top:5px;font-size:15px;line-height:24px;color:#222222;">${bodyHtml(tweet.text)}</td></tr>
            ${showZh ? translationTile(tweet.summaryZh) : ''}
            ${quoteLink}
            <tr><td style="padding-top:10px;">
              <a href="${escapeHtml(tweet.url)}" target="_blank" rel="noopener noreferrer" style="color:#ff385c;text-decoration:none;font-weight:600;font-size:12px;">View on X →</a>
              <span style="display:inline-flex;align-items:center;gap:14px;margin-left:14px;white-space:nowrap;vertical-align:middle;">${metric(ICON_HEART, tweet.likes)}${metric(ICON_RETWEET, tweet.retweets)}${metric(ICON_REPLY, tweet.replies)}</span>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>`;
  }).join('');
  const profile = builder.handle ? `https://x.com/${encodeURIComponent(builder.handle)}` : '';
  return cardShell(`<tr><td>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td style="width:60px;vertical-align:top;">${avatar(builder.name || builder.handle)}</td>
          <td style="vertical-align:top;padding-left:12px;">
            <div style="font-size:17px;line-height:22px;font-weight:600;color:#222222;font-family:${FONT};">${escapeHtml(builder.name || builder.handle || 'Builder')}${builder.handle ? `<span style="font-size:12px;font-weight:500;color:#6a6a6a;margin-left:6px;">@${escapeHtml(builder.handle)}</span>` : ''}</div>
            ${builder.bio ? `<div style="padding-top:4px;font-size:12px;line-height:17px;color:#6a6a6a;font-family:${FONT};">${linkify(builder.bio)}</div>` : ''}
            ${builder.summary && model.language !== 'zh' ? `<div style="padding-top:8px;font-size:14px;line-height:22px;color:#222222;font-family:${FONT};">${bodyHtml(builder.summary)}</div>` : ''}
            ${showZh && builder.summaryZh ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${translationTile(builder.summaryZh)}</table>` : ''}
          </td>
          <td align="right" style="vertical-align:top;font-size:9px;font-weight:700;color:#929292;text-transform:uppercase;letter-spacing:0.08em;font-family:${FONT};">X Update</td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding-top:14px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${tweets}</table></td></tr>
    <tr><td style="padding-top:12px;font-size:12px;line-height:16px;color:#6a6a6a;font-family:${FONT};">
      ${profile ? `<a href="${escapeHtml(profile)}" target="_blank" rel="noopener noreferrer" style="color:#ff385c;text-decoration:none;font-weight:600;">Open profile →</a>` : ''}
      <span style="color:#929292;"> · ${escapeHtml(builder.tweets.length)} posts</span>
    </td></tr>`);
}

function sourceCard({ icon, kicker, title, subtitle, body, bodyZh, href, hrefLabel, embed, language }) {
  const showZh = language !== 'en' && bodyZh;
  const english = language === 'zh' ? (bodyZh || body) : body;
  return cardShell(`<tr><td>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
        <tr>
          <td style="width:60px;vertical-align:top;">
            <div style="width:48px;height:48px;border-radius:10px;background:#ffffff;border:1px solid #ebebeb;display:flex;align-items:center;justify-content:center;font-size:20px;color:#222222;">${icon}</div>
          </td>
          <td style="vertical-align:top;padding-left:12px;">
            <div style="font-size:17px;line-height:22px;font-weight:600;color:#222222;font-family:${FONT};">${escapeHtml(title)}</div>
            ${subtitle ? `<div style="padding-top:4px;font-size:12px;line-height:16px;color:#6a6a6a;font-family:${FONT};">${escapeHtml(subtitle)}</div>` : ''}
          </td>
          <td align="right" style="vertical-align:top;font-size:9px;font-weight:700;color:#929292;text-transform:uppercase;letter-spacing:0.08em;font-family:${FONT};">${escapeHtml(kicker)}</td>
        </tr>
      </table>
    </td></tr>
    ${embed ? `<tr><td style="padding-top:14px;">${embed}</td></tr>` : ''}
    ${english ? `<tr><td class="mobile-body-text" style="padding-top:14px;font-size:14px;line-height:22px;color:#3f3f3f;font-family:${FONT};">${bodyHtml(english)}</td></tr>` : ''}
    ${showZh && language !== 'zh' ? `<tr><td><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${translationTile(bodyZh)}</table></td></tr>` : ''}
    <tr><td style="padding-top:14px;font-size:12px;line-height:16px;font-family:${FONT};">
      <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="color:#ff385c;text-decoration:none;font-weight:600;">${escapeHtml(hrefLabel)}</a>
    </td></tr>`);
}

function documentShell({ title, subtitle, rows, interactive }) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="referrer" content="no-referrer" />
    <title>${escapeHtml(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
    ${interactive ? '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swiper@12/swiper-bundle.min.css" />' : ''}
    <style>
      .mobile-shell img { max-width: 100% !important; height: auto !important; }
      .mobile-shell video { max-width: 100% !important; }
      .mobile-shell table { max-width: 100% !important; }
      .mobile-shell pre { max-width: 100% !important; overflow-x: auto !important; }
      .mobile-shell td, .mobile-shell th { overflow-wrap: anywhere; word-break: break-word; }
      @media screen and (max-width: 640px) {
        .mobile-shell { width: 100% !important; max-width: 100% !important; }
        .mobile-topbar { padding: 12px 16px !important; }
        .mobile-card-padding { padding: 20px !important; }
        .mobile-hero-title { font-size: 22px !important; line-height: 28px !important; }
        .mobile-overview-copy { font-size: 15px !important; line-height: 24px !important; }
        .mobile-section-title { font-size: 18px !important; line-height: 24px !important; }
        .mobile-body-text { font-size: 15px !important; line-height: 24px !important; }
        .mobile-translation { font-size: 13px !important; line-height: 20px !important; }
      }
    ${interactive ? LIGHTBOX_STYLE : ''}</style>
  </head>
  <body style="margin:0;padding:0;background:#f7f7f7;font-family:${FONT};-webkit-font-smoothing:antialiased;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f7f7;">
      <tr>
        <td align="center" style="padding:0 12px 40px 12px;">
          <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" class="mobile-shell" style="width:680px;max-width:680px;">
            <tr>
              <td style="background:#ffffff;border-radius:0 0 14px 14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr><td style="height:3px;background:linear-gradient(90deg,#ff385c,#ff5470);font-size:0;line-height:0;">&nbsp;</td></tr>
                  <tr>
                    <td class="mobile-topbar" style="padding:18px 24px;">
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                        <tr>
                          <td style="font-size:18px;line-height:24px;font-weight:700;color:#222222;font-family:${FONT};letter-spacing:-0.2px;">${escapeHtml(title)}</td>
                          <td align="right" style="font-size:11px;line-height:16px;color:#929292;font-family:${FONT};font-weight:500;text-transform:uppercase;letter-spacing:0.08em;">${escapeHtml(subtitle)}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr><td style="padding-top:24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                ${rows}
              </table>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export function renderRootIndex(baseUrl, date) {
  const fullUrl = `${String(baseUrl).replace(/\/$/, '')}/${date}/`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="refresh" content="0; url=${escapeHtml(fullUrl)}" />
<link rel="canonical" href="${escapeHtml(fullUrl)}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AI Builders Digest — ${escapeHtml(date)}</title>
<meta property="og:title" content="AI Builders Digest — ${escapeHtml(date)}" />
<meta property="og:url" content="${escapeHtml(fullUrl)}" />
<meta name="robots" content="noindex" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  body{margin:0;font-family:'Inter',-apple-system,system-ui,'Segoe UI',Roboto,Arial,sans-serif;background:#f7f7f7;color:#222222;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:560px;margin:80px auto;padding:32px;text-align:center;}
  .pill{display:inline-block;padding:5px 14px;background:#fff1f2;border-radius:9999px;font-size:10px;font-weight:700;color:#ff385c;letter-spacing:0.1em;text-transform:uppercase;}
  h1{font-size:22px;font-weight:600;margin:14px 0 16px;color:#222222;}
  p{font-size:15px;color:#6a6a6a;}
  a{color:#ff385c;text-decoration:none;font-weight:600;}
</style>
</head>
<body><div class="wrap">
  <span class="pill">AI Builders Digest</span>
  <h1>Redirecting to ${escapeHtml(date)}…</h1>
  <p>If you are not redirected, <a href="${escapeHtml(fullUrl)}">open today's digest →</a></p>
</div></body>
</html>`;
}

export function renderDigestHtml(model) {
  const rows = [overview(model)];
  const highlights = highlightListHtml(model.highlights, model.language);
  if (highlights) {
    rows.push(cardShell(`<tr><td style="font-size:11px;line-height:14px;font-weight:700;color:#6a6a6a;font-family:${FONT};text-transform:uppercase;letter-spacing:0.1em;">Today's Highlights</td></tr>
    <tr><td style="padding-top:10px;font-size:15px;line-height:24px;color:#222222;font-family:${FONT};">${highlights}</td></tr>`));
  }
  if (model.builders.length) {
    rows.push(sectionHeader('𝕏', 'Social feed', 'X'));
    rows.push(...model.builders.map(builder => tweetCard(builder, model)));
  }
  if (model.podcasts.length) {
    rows.push(sectionHeader('🎙', 'Audio', 'Podcast Episodes'));
    for (const item of model.podcasts) {
      const embedUrl = youtubeEmbed(item.url);
      const embed = embedUrl
        ? `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;border-radius:14px;border:1px solid #ebebeb;"><iframe src="${escapeHtml(embedUrl)}" title="${escapeHtml(item.title)}" style="position:absolute;top:0;left:0;width:100%;height:100%;border:0;" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>`
        : '';
      rows.push(sourceCard({
        icon: '🎙',
        kicker: 'Podcast',
        title: item.title,
        subtitle: item.name,
        body: item.body,
        bodyZh: item.bodyZh,
        href: item.url,
        hrefLabel: embed ? 'Watch on YouTube →' : 'Open episode →',
        embed,
        language: model.language
      }));
    }
  }
  if (model.blogs.length) {
    rows.push(sectionHeader('✦', 'Written', 'Blog Posts'));
    for (const item of model.blogs) {
      rows.push(sourceCard({
        icon: '✦',
        kicker: 'Blog',
        title: item.title,
        subtitle: [item.name, item.author].filter(Boolean).join(' · '),
        body: item.body,
        bodyZh: item.bodyZh,
        href: item.url,
        hrefLabel: 'Read more →',
        language: model.language
      }));
    }
  }
  if (model.rss.length) {
    rows.push(sectionHeader('📰', 'News', 'RSS Briefings'));
    for (const item of model.rss) {
      rows.push(sourceCard({
        icon: '📰',
        kicker: 'RSS',
        title: item.title,
        subtitle: item.name,
        body: item.body,
        bodyZh: item.bodyZh,
        href: item.url,
        hrefLabel: 'Read issue →',
        language: model.language
      }));
    }
  }
  rows.push(`<tr><td style="padding:24px 0 8px 0;text-align:center;">
    <div style="font-size:11px;line-height:18px;color:#929292;font-family:${FONT};">
      Generated through the Follow Builders skill ·
      <a href="https://github.com/zarazhangrui/follow-builders" target="_blank" rel="noopener noreferrer" style="color:#6a6a6a;text-decoration:none;">github.com/zarazhangrui/follow-builders</a>
    </div>
  </td></tr>`);
  return documentShell({
    title: `AI Builders Digest — ${model.date}`,
    subtitle: 'Intelligence Refined',
    rows: rows.join('\n'),
    interactive: true
  });
}

export function renderNotificationHtml({ pageUrl, date, highlightsHtml, counts }) {
  const countLine = [
    counts.xBuilders ? `${counts.xBuilders} builders` : '',
    counts.totalTweets ? `${counts.totalTweets} posts` : '',
    counts.podcastEpisodes ? `${counts.podcastEpisodes} podcasts` : '',
    counts.blogPosts ? `${counts.blogPosts} blogs` : ''
  ].filter(Boolean).join(' · ');
  const rows = [
    cardShell(`<tr><td>
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="background:#fff1f2;border-radius:9999px;"><tr><td style="padding:5px 14px;font-size:10px;line-height:14px;font-weight:700;color:#ff385c;font-family:${FONT};text-transform:uppercase;letter-spacing:0.1em;">Today's Digest</td></tr></table>
      </td></tr>
      <tr><td class="mobile-hero-title" style="padding-top:14px;font-size:26px;line-height:32px;font-weight:600;color:#222222;font-family:${FONT};">Your AI builders digest is ready</td></tr>
      ${countLine ? `<tr><td style="padding-top:6px;font-size:13px;line-height:20px;color:#6a6a6a;font-family:${FONT};">${escapeHtml(countLine)}</td></tr>` : ''}`),
    highlightsHtml
      ? cardShell(`<tr><td style="font-size:11px;line-height:14px;font-weight:700;color:#6a6a6a;font-family:${FONT};text-transform:uppercase;letter-spacing:0.1em;">Highlights</td></tr>
        <tr><td style="padding-top:10px;font-size:15px;line-height:24px;color:#222222;font-family:${FONT};">${highlightsHtml}</td></tr>`)
      : '',
    cardShell(`<tr><td style="font-size:14px;line-height:22px;color:#3f3f3f;font-family:${FONT};">完整条目、双语摘要和原文链接在页面上。</td></tr>
      <tr><td style="padding-top:18px;" align="center">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0">
          <tr><td style="border-radius:8px;background:#ff385c;">
            <a href="${escapeHtml(pageUrl)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;font-family:${FONT};text-decoration:none;">Open today's digest →</a>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding-top:14px;font-size:11px;line-height:16px;color:#929292;font-family:${FONT};">${escapeHtml(pageUrl)}</td></tr>`)
  ];
  return documentShell({
    title: `AI Builders Digest — ${date}`,
    subtitle: date,
    rows: rows.filter(Boolean).join('\n'),
    interactive: false
  });
}

export function renderNotificationText({ pageUrl, date, highlights, language }) {
  const lines = [`AI Builders Digest — ${date}`, ''];
  for (const item of highlights) {
    if (language !== 'zh' && item.text) lines.push(`- ${item.text}`);
    if (language !== 'en' && item.textZh) lines.push(`  ${item.textZh}`);
    lines.push(`  ${item.url}`);
  }
  lines.push('', `Full digest: ${pageUrl}`);
  return lines.join('\n');
}
