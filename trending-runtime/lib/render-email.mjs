import { escapeHtml } from './util.mjs';

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function headerLine(issue) {
  const kind = issue.edition === 'official' ? '精选' : issue.edition === 'sample' ? '样例预览（不发送）' : '示例（不发送）';
  return `GitHub Trending ${kind} · ${issue.date}`;
}

export function emailSubject(issue) {
  if (issue.edition === 'official') return `GitHub Trending 精选 — ${issue.date}`;
  return `［不发送］GitHub Trending 精选${issue.edition === 'sample' ? '样例' : '示例'} ${issue.date}`;
}

export function renderEmailText(issue, { pageHref }) {
  const lines = [
    headerLine(issue),
    '',
    `采集时间：${issue.collectedAtLabel}（America/New_York，${issue.collectedAtAbbr}）`,
    `榜单来源：${issue.source.url}`,
    '这是独立精选，不是 GitHub 官方界面。热度不等于成熟度。',
    ''
  ];
  if (issue.edition !== 'official') {
    lines.push('此预览不会发送。下面不是正式日期归档。');
    if (issue.previewNotice) lines.push(issue.previewNotice);
    lines.push('');
  }
  issue.emailHighlights.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.text}`, item.url, '');
  });
  lines.push(`全文：${pageHref}`);
  if (issue.edition !== 'official') lines.push('上面的全文链接只打开本目录里的预览，不是已发布的正式日期归档。');
  lines.push('', issue.dataNotes);
  return `${lines.join('\n')}\n`;
}

function highlightRow(item, index) {
  return `<tr>
    <td style="padding:0 0 12px 0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#ffffff;border:1px solid #ebebeb;border-radius:14px;">
        <tr>
          <td style="padding:16px 18px;font-family:${FONT};">
            <div style="font-size:12px;line-height:16px;font-weight:700;color:#ff385c;">${index + 1}</div>
            <div style="padding-top:6px;font-size:15px;line-height:24px;color:#222222;">${escapeHtml(item.text)}</div>
            <div style="padding-top:8px;font-size:13px;line-height:20px;"><a href="${escapeHtml(item.url)}" style="color:#ff385c;text-decoration:none;word-break:break-all;">${escapeHtml(item.url)}</a></div>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

export function renderEmailHtml(issue, { pageHref }) {
  const preview = issue.edition !== 'official';
  const title = headerLine(issue);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="gt-edition" content="${escapeHtml(issue.edition)}" />
  <meta name="gt-date" content="${escapeHtml(issue.date)}" />
  <title>${escapeHtml(emailSubject(issue))}</title>
  <style>
    @media screen and (max-width: 640px) {
      .gt-shell { width: 100% !important; max-width: 100% !important; }
      .gt-pad { padding-left: 12px !important; padding-right: 12px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f7f7f7;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f7f7f7;">
    <tr>
      <td align="center" class="gt-pad" style="padding:24px 12px;">
        <table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" class="gt-shell" style="width:680px;max-width:680px;">
          <tr>
            <td style="height:3px;background:#ff385c;font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="background:#ffffff;padding:20px 24px;font-family:${FONT};">
              <div style="font-size:12px;line-height:16px;font-weight:700;color:#ff385c;">独立精选 · 不是 GitHub 官方界面</div>
              <div style="padding-top:8px;font-size:22px;line-height:28px;font-weight:600;color:#222222;">${escapeHtml(title)}</div>
              <div style="padding-top:8px;font-size:13px;line-height:20px;color:#6a6a6a;">采集时间 ${escapeHtml(issue.collectedAtLabel)}（America/New_York，${escapeHtml(issue.collectedAtAbbr)}）</div>
              <div style="padding-top:4px;font-size:13px;line-height:20px;"><a href="${escapeHtml(issue.source.url)}" style="color:#ff385c;text-decoration:none;word-break:break-all;">${escapeHtml(issue.source.url)}</a></div>
            </td>
          </tr>
          ${preview ? `<tr>
            <td style="padding-top:12px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#fff1f2;border-radius:14px;">
                <tr>
                  <td style="padding:14px 16px;font-family:${FONT};font-size:14px;line-height:22px;color:#222222;">此预览不会发送。下面不是正式日期归档。${issue.previewNotice ? ` ${escapeHtml(issue.previewNotice)}` : ''}</td>
                </tr>
              </table>
            </td>
          </tr>` : ''}
          <tr><td style="padding-top:16px;font-family:${FONT};font-size:13px;line-height:20px;font-weight:700;color:#6a6a6a;">这一期只摘 ${issue.emailHighlights.length} 条，全文在链接里。</td></tr>
          <tr><td style="padding-top:10px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              ${issue.emailHighlights.map(highlightRow).join('')}
            </table>
          </td></tr>
          <tr>
            <td style="padding-top:4px;">
              <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="background:#ff385c;border-radius:999px;">
                    <a href="${escapeHtml(pageHref)}" style="display:inline-block;padding:12px 18px;font-family:${FONT};font-size:14px;line-height:18px;font-weight:700;color:#ffffff;text-decoration:none;">${preview ? '打开预览全文' : '打开今天的全文'}</a>
                  </td>
                </tr>
              </table>
              <div style="padding-top:8px;font-family:${FONT};font-size:12px;line-height:18px;color:#6a6a6a;word-break:break-all;">${escapeHtml(pageHref)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 0 8px 0;font-family:${FONT};font-size:12px;line-height:18px;color:#929292;">${escapeHtml(issue.dataNotes)} 热度不等于成熟度。</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}
