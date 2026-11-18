import { escapeHtml, formatCount } from './util.mjs';

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function urlsOf(issue) {
  const urls = [issue.source?.url];
  for (const pick of issue.picks || []) {
    urls.push(pick.url, pick.homepage);
  }
  for (const item of issue.mentions || []) urls.push(item.url);
  return urls.filter(Boolean);
}

function inline(text, urls) {
  let html = escapeHtml(text).replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replaceAll('\n', '<br>');
  const tokens = [];
  const sorted = [...new Set(urls)].sort((a, b) => b.length - a.length);
  for (const url of sorted) {
    const safe = escapeHtml(url);
    if (!html.includes(safe)) continue;
    const token = `%%GTURL${tokens.length}%%`;
    tokens.push(`<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`);
    html = html.split(safe).join(token);
  }
  tokens.forEach((anchor, index) => {
    html = html.split(`%%GTURL${index}%%`).join(anchor);
  });
  return html;
}

function prose(text, urls) {
  if (!text) return '';
  return String(text).split(/\n{2,}/).map(part => `<p>${inline(part, urls)}</p>`).join('');
}

function block(title, kicker, text, urls, tone) {
  if (!text) return '';
  return `<section class="block ${tone || ''}">
    <h4>${escapeHtml(title)}</h4>
    ${kicker ? `<p class="kicker">${escapeHtml(kicker)}</p>` : ''}
    ${prose(text, urls)}
  </section>`;
}

function metric(label, value) {
  return `<div class="metric"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function pickArticle(pick, urls) {
  const metrics = pick.metrics || {};
  const chips = [];
  if (metrics.language) chips.push(metric('语言', metrics.language));
  if (metrics.license && metrics.license.length <= 24) chips.push(metric('许可证', metrics.license));
  if (Number.isInteger(metrics.stars)) chips.push(metric('Star 总数', formatCount(metrics.stars)));
  if (Number.isInteger(metrics.starsToday)) chips.push(metric('今日新增', `+${formatCount(metrics.starsToday)}`));
  const badges = [];
  if (pick.featured) badges.push('先看');
  if (Array.isArray(pick.selectionNotes) && pick.selectionNotes.length) badges.push(...pick.selectionNotes);
  else if (pick.returning) badges.push('再次入选');
  const id = `pick-${pick.rank}`;
  return `<article class="card pick${pick.featured ? ' featured' : ''}" id="${id}">
    <header class="pick-head">
      <div class="rank" aria-hidden="true">${escapeHtml(pick.rank)}</div>
      <div>
        <h3><a href="${escapeHtml(pick.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pick.name)}</a></h3>
        <p class="repo"><a href="${escapeHtml(pick.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pick.url)}</a></p>
        ${badges.length ? `<div class="badges">${badges.map(item => `<span class="badge">${escapeHtml(item)}</span>`).join('')}</div>` : ''}
        ${pick.titleAsRecorded ? `<p class="recorded-title">实录标题：${escapeHtml(pick.titleAsRecorded)}</p>` : ''}
        ${pick.homepage ? `<p class="repo">项目站点（仓库给出的地址）：<a href="${escapeHtml(pick.homepage)}" target="_blank" rel="noopener noreferrer">${escapeHtml(pick.homepage)}</a></p>` : ''}
      </div>
    </header>
    ${chips.length ? `<dl class="metrics">${chips.join('')}</dl>` : ''}
    ${metrics.asRecorded ? `<p class="as-recorded">榜单实录：${inline(metrics.asRecorded, urls)}</p>` : ''}
    ${block('用途', '含项目自述', pick.purpose, urls)}
    ${block('亮点', pick.claimLabel || '', pick.highlights, urls)}
    ${block('对你的具体价值', '', pick.value, urls)}
    ${block('相对上次', pick.returning ? '再次入选时只写变化；没有变化就写没有变化' : '', pick.changes, urls)}
    ${block('当日说明', '正文保留原有的「项目自述」和「已核对」区分', pick.lead, urls)}
    ${block('已核对事实', '不是从 star 数量推断的', pick.verifiedFacts, urls, 'fact')}
    ${block('试用建议', '轻量、可停、不碰生产密钥', pick.try, urls, 'try')}
  </article>`;
}

function mentionArticle(item) {
  const bits = [];
  if (Number.isInteger(item.stars)) bits.push(`Star 总数 ${formatCount(item.stars)}`);
  if (Number.isInteger(item.starsToday)) bits.push(`今日新增 +${formatCount(item.starsToday)}`);
  return `<article class="mention">
    <h3><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.repo)}</a></h3>
    <p class="repo"><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.url)}</a></p>
    ${bits.length ? `<p class="mention-metrics">${escapeHtml(bits.join(' · '))}</p>` : ''}
    <p>${inline(item.note, [item.url])}</p>
  </article>`;
}

function banner(issue) {
  if (issue.edition === 'official') return '';
  const label = issue.edition === 'sample'
    ? '样例预览 · 来自已发送的 2026-11-17 日报公开正文 · 只用于设计和回归'
    : '显式示例 · 不是榜单，也不是正式刊';
  return `<div class="banner">
    <strong>${escapeHtml(label)}</strong>
    <p>不是新刊，不会写入 <span class="path">trending/${escapeHtml(issue.date)}/</span>，不会发布，也不会发信。2026-11-17 已由 Gmail 送出，不会再用 Resend 补发。</p>
  </div>`;
}

function visibleHeading(issue) {
  if (issue.edition === 'official') return { title: 'GitHub Trending 精选', sub: issue.date };
  if (issue.edition === 'sample') return { title: 'GitHub Trending 精选', sub: `${issue.date} · 公开样例，不是正式刊` };
  return { title: 'GitHub Trending 精选', sub: `${issue.date} · 显式示例，不是正式刊` };
}

function editionMeta(issue) {
  const label = issue.edition === 'sample'
    ? `${issue.date} 公开样例（不是正式刊）`
    : issue.edition === 'example'
      ? `${issue.date} 显式示例（不是正式刊）`
      : issue.date;
  const robots = issue.edition === 'official' ? 'index,follow' : 'noindex';
  const title = issue.edition === 'official'
    ? `GitHub Trending 精选 — ${issue.date}`
    : `GitHub Trending 精选${issue.edition === 'sample' ? '样例' : '示例'} · ${issue.date}（不是正式刊）`;
  return { label, robots, title };
}

export function renderPage(issue, { archiveHref = '../index.html' } = {}) {
  const urls = urlsOf(issue);
  const meta = editionMeta(issue);
  const heading = visibleHeading(issue);
  const listed = issue.source?.listedRepoCount;
  const toc = (issue.picks || []).map(pick => `<a href="#pick-${pick.rank}">${escapeHtml(pick.rank)} ${escapeHtml(pick.name)}</a>`).join('');
  const sha = issue.sample?.sourceSha256
    ? `<meta name="gt-source-sha256" content="${escapeHtml(issue.sample.sourceSha256)}" />`
    : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="referrer" content="no-referrer" />
  <meta name="robots" content="${meta.robots}" />
  <meta name="gt-edition" content="${escapeHtml(issue.edition)}" />
  <meta name="gt-date" content="${escapeHtml(issue.date)}" />
  <meta name="gt-label" content="${escapeHtml(meta.label)}" />
  ${sha}
  <title>${escapeHtml(meta.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;display=swap" rel="stylesheet" />
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f7f7f7; color: #222222; font-family: ${FONT}; -webkit-font-smoothing: antialiased; }
    a { color: #ff385c; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 28px 20px 72px; }
    .banner { background: #fff1f2; border: 1px solid #ffd5dc; border-radius: 14px; padding: 14px 16px; }
    .banner strong { display: block; color: #ff385c; font-size: 14px; line-height: 1.5; }
    .banner p, .source p, .block p, .mention p, .intro p, .lede p { margin: 8px 0 0; font-size: 15px; line-height: 1.75; color: #3f3f3f; }
    .path { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
    .mast { margin: 22px 0 8px; }
    .pill { display: inline-block; background: #fff1f2; color: #ff385c; border-radius: 999px; padding: 4px 12px; font-size: 12px; font-weight: 700; }
    h1 { margin: 12px 0 0; font-size: 32px; line-height: 1.25; font-weight: 600; letter-spacing: -0.03em; }
    .sub { margin: 8px 0 0; color: #6a6a6a; font-size: 15px; line-height: 1.5; }
    h2 { margin: 0 0 8px; font-size: 20px; line-height: 1.35; font-weight: 600; }
    h3 { margin: 0; font-size: 20px; line-height: 1.35; font-weight: 600; }
    h3 a, .repo a { text-decoration: none; }
    h3 a:hover, .repo a:hover, .toc a:hover { text-decoration: underline; }
    .card { background: #ffffff; border: 1px solid #ebebeb; border-radius: 14px; box-shadow: 0 2px 8px rgba(0,0,0,0.04); padding: 22px 24px; margin-top: 14px; }
    .featured { box-shadow: inset 3px 0 0 #ff385c, 0 2px 8px rgba(0,0,0,0.04); }
    .kicker { margin: 0 0 6px; font-size: 12px; font-weight: 700; color: #6a6a6a; }
    .pick-head { display: flex; gap: 14px; align-items: flex-start; }
    .rank { flex: 0 0 auto; width: 36px; height: 36px; border-radius: 999px; background: #fff1f2; color: #ff385c; font-weight: 700; display: flex; align-items: center; justify-content: center; }
    .repo, .recorded-title, .as-recorded, .license, .mention-metrics { margin: 6px 0 0; color: #6a6a6a; font-size: 13px; line-height: 1.6; word-break: break-word; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .badge { background: #f7f7f7; border-radius: 999px; padding: 3px 8px; font-size: 12px; font-weight: 600; color: #222222; }
    .metrics { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 0; }
    .metric { min-width: 108px; border: 1px solid #ebebeb; border-radius: 10px; padding: 10px 12px; background: #ffffff; }
    .metric dt { margin: 0; font-size: 11px; font-weight: 700; color: #6a6a6a; }
    .metric dd { margin: 4px 0 0; font-size: 18px; line-height: 1.2; font-weight: 700; }
    .block { margin-top: 16px; }
    .block h4 { margin: 0; font-size: 13px; }
    .fact, .try { border-radius: 10px; padding: 12px 14px; }
    .fact { background: #f7f7f7; }
    .try { background: #fff1f2; }
    .toc { display: flex; flex-wrap: wrap; gap: 8px 14px; margin-top: 12px; }
    .toc a { font-size: 14px; font-weight: 600; text-decoration: none; }
    .mention { padding: 16px 0; border-top: 1px solid #ebebeb; }
    .mention:first-of-type { border-top: 0; padding-top: 0; }
    .mention h3 { font-size: 16px; }
    footer { margin-top: 18px; color: #6a6a6a; font-size: 13px; line-height: 1.7; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; background: #f7f7f7; border-radius: 4px; padding: 0 4px; }
    @media (max-width: 640px) {
      .wrap { padding: 16px 14px 48px; }
      h1 { font-size: 26px; }
      .card { padding: 16px; }
      .metric { min-width: calc(50% - 8px); flex: 1 1 calc(50% - 8px); }
      .metric dd { font-size: 16px; }
    }
  </style>
</head>
<body>
  <div class="wrap" data-gt-page="issue">
    ${banner(issue)}
    <header class="mast">
      <span class="pill">独立精选 · 不是 GitHub 官方界面</span>
      <h1>${escapeHtml(heading.title)}</h1>
      <p class="sub">${escapeHtml(heading.sub)}</p>
    </header>
    <section class="card source">
      <h2>榜单从哪里来</h2>
      <p>唯一榜单事实来源是 GitHub 官方 Trending，范围是每日、所有编程语言。本页不另排榜，也不把 star 热度写成成熟度。</p>
      <p><a href="${escapeHtml(issue.source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(issue.source.url)}</a></p>
      <p>采集时间 <time datetime="${escapeHtml(issue.collectedAt)}">${escapeHtml(issue.collectedAtLabel)}</time>（America/New_York，${escapeHtml(issue.collectedAtAbbr)}）。${listed === undefined ? '' : `当日页面列出 ${escapeHtml(listed)} 个仓库，这里展开 ${escapeHtml(issue.picks.length)} 个，点名 ${escapeHtml(issue.mentions.length)} 个。`}</p>
    </section>
    <section class="card intro">
      <h2>今天怎么读</h2>
      ${prose(issue.intro, urls)}
    </section>
    <section class="card lede featured">
      <p class="kicker">开头先看</p>
      <h2>今天值得先打开的</h2>
      ${prose(issue.featuredLede, urls)}
    </section>
    <nav class="toc" aria-label="本页目录">${toc}<a href="#mentions">其余点名</a></nav>
    ${(issue.picks || []).map(pick => pickArticle(pick, urls)).join('')}
    <section class="card" id="mentions">
      <h2>其余上榜项目</h2>
      <p class="kicker">点名，未展开。数字仍是采集当时的实录。</p>
      ${(issue.mentions || []).map(mentionArticle).join('') || '<p>这一期没有单独点名的仓库。</p>'}
    </section>
    <section class="card">
      <h2>数据说明</h2>
      ${prose(issue.dataNotes, urls)}
      <p>语言、许可证、star 总数或今日新增如果当时没有记到，页面就留空，不补 0，也不写「未知」。</p>
    </section>
    <footer>
      <nav aria-label="归档"><a href="${escapeHtml(archiveHref)}">精选归档</a></nav>
      <p>${issue.edition === 'official'
        ? `正式刊在 trending/${escapeHtml(issue.date)}/。根目录仍是 AI Builders Digest，不受本页影响。`
        : `本页是预览，路径不在 trending/${escapeHtml(issue.date)}/。根目录的 AI Builders Digest 跳转保持原样。`}</p>
    </footer>
  </div>
</body>
</html>
`;
}
