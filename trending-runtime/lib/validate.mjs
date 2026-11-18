import {
  DATE_RE,
  EMAIL_RE,
  ESTIMATE_RE,
  OFFICIAL_TRENDING_URL,
  PLACEHOLDER_RE,
  TIME_ZONE,
  expectedAbbr,
  extractUrls,
  isOfficialTrendingUrl,
  parseHttpsUrl,
  parseRepoUrl,
  recordedHasCount,
  walkStrings,
  zonedParts
} from './util.mjs';

const RAW_HTML_RE = /<\/?[a-z!]/i;

function push(errors, code, path, message) {
  errors.push({ code, path, message });
}

function isInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function placeholder(value) {
  return PLACEHOLDER_RE.test(String(value).trim()) || ESTIMATE_RE.test(String(value));
}

export function validateIssue(issue) {
  const errors = [];
  const warnings = [];
  if (!issue || typeof issue !== 'object' || Array.isArray(issue)) {
    return { ok: false, errors: [{ code: 'issue', path: '$', message: 'Issue must be an object.' }], warnings };
  }

  const edition = issue.edition;
  if (!['official', 'sample', 'example'].includes(edition)) {
    push(errors, 'edition', '$.edition', 'edition must be official, sample, or example.');
  }
  if (edition === 'sample') {
    const sample = issue.sample;
    if (!sample || sample.notANewIssue !== true || sample.doNotPublishOrSend !== true) {
      push(errors, 'sample-flags', '$.sample', 'A sample must say it is not a new issue and must not be published or sent.');
    }
    if (sample?.purpose !== 'design-regression-only') {
      push(errors, 'sample-flags', '$.sample.purpose', 'A sample is for design and regression only.');
    }
  }
  if (edition === 'example') {
    const example = issue.example;
    if (!example || example.fictional !== true || example.notANewIssue !== true || example.doNotPublishOrSend !== true) {
      push(errors, 'example-flags', '$.example', 'An example must be fictional and must not be published or sent.');
    }
  }
  if (edition === 'official' && (issue.sample || issue.example)) {
    push(errors, 'edition', '$.edition', 'An official issue cannot carry sample or example flags.');
  }
  if (edition === 'official' && (issue.previewLabel || issue.previewNotice)) {
    push(errors, 'preview-notice', '$.previewNotice', 'Official issues cannot carry a preview-only notice.');
  }
  for (const key of ['previewLabel', 'previewNotice']) {
    if (issue[key] !== undefined && (typeof issue[key] !== 'string' || !issue[key].trim())) {
      push(errors, 'preview-notice', `$.${key}`, `${key} must be plain text when present.`);
    }
  }

  if (!DATE_RE.test(issue.date || '')) push(errors, 'date', '$.date', 'date must be YYYY-MM-DD.');
  if (issue.timezone !== TIME_ZONE) push(errors, 'timezone', '$.timezone', 'timezone must be America/New_York.');
  if (issue.language !== 'zh') push(errors, 'language', '$.language', 'language must be zh.');

  const collected = new Date(issue.collectedAt || '');
  if (Number.isNaN(collected.getTime())) {
    push(errors, 'collected-at', '$.collectedAt', 'collectedAt must be an ISO timestamp.');
  } else {
    const parts = zonedParts(collected);
    const label = `${parts.date} ${parts.time}`;
    if (parts.date !== issue.date) {
      push(errors, 'collected-at', '$.collectedAt', 'collectedAt must fall on the issue date in America/New_York.');
    }
    if (issue.collectedAtLabel !== label) {
      push(errors, 'collected-label', '$.collectedAtLabel', `collectedAtLabel must be the New York time ${label}.`);
    }
    const abbr = expectedAbbr(collected);
    if (!abbr || issue.collectedAtAbbr !== abbr) {
      push(errors, 'collected-abbr', '$.collectedAtAbbr', `collectedAtAbbr must match the New York offset (${abbr || 'unknown'}).`);
    }
  }

  const source = issue.source || {};
  if (source.list !== 'github-trending' || source.since !== 'daily' || source.spokenLanguage !== 'all') {
    push(errors, 'source-url', '$.source', 'The only ranking source is GitHub Trending daily for all languages.');
  }
  if (source.url !== OFFICIAL_TRENDING_URL || !isOfficialTrendingUrl(source.url)) {
    push(errors, 'source-url', '$.source.url', `source.url must be ${OFFICIAL_TRENDING_URL}.`);
  }

  const picks = Array.isArray(issue.picks) ? issue.picks : null;
  const mentions = Array.isArray(issue.mentions) ? issue.mentions : null;
  if (!picks) push(errors, 'picks-count', '$.picks', 'picks must be an array.');
  if (!mentions) push(errors, 'mentions', '$.mentions', 'mentions must be an array.');
  if (picks && (picks.length < 1 || picks.length > 8)) {
    push(errors, 'picks-count', '$.picks', 'Select 1 to 8 repositories. Do not pad the list.');
  } else if (picks && picks.length < 5) {
    warnings.push({ code: 'below-target', path: '$.picks', message: 'Fewer than 5 picks. Do not add repositories just to reach 5.' });
  }
  if (picks && mentions && source.listedRepoCount !== undefined && source.listedRepoCount !== picks.length + mentions.length) {
    push(errors, 'listed-count', '$.source.listedRepoCount', 'listedRepoCount must equal expanded picks plus named mentions.');
  }

  const allow = new Set([OFFICIAL_TRENDING_URL]);
  if (picks) {
    picks.forEach((pick, index) => checkPick(pick, index, edition, errors, allow));
    const featured = picks.filter(pick => pick && pick.featured === true);
    if (picks.length > 0 && (featured.length < 1 || featured.length > 2)) {
      push(errors, 'featured-count', '$.picks', 'Mark 1 or 2 opening recommendations.');
    }
    for (const pick of featured) {
      if (!String(issue.featuredLede || '').includes(pick.name)) {
        push(errors, 'featured-name', '$.featuredLede', `The opening text must name the featured repository ${pick.name}.`);
      }
    }
  }
  if (mentions) mentions.forEach((item, index) => checkMention(item, index, errors, allow));

  if (!String(issue.intro || '').trim()) push(errors, 'intro', '$.intro', 'intro is required.');
  if (!String(issue.featuredLede || '').trim()) push(errors, 'featured-lede', '$.featuredLede', 'featuredLede is required.');
  if (!String(issue.dataNotes || '').trim()) push(errors, 'data-notes', '$.dataNotes', 'dataNotes is required.');

  const highlights = Array.isArray(issue.emailHighlights) ? issue.emailHighlights : null;
  if (!highlights || highlights.length < 3 || highlights.length > 5) {
    push(errors, 'email-highlights', '$.emailHighlights', 'Email highlights must be 3 to 5 items.');
  } else {
    highlights.forEach((item, index) => {
      if (!item || !String(item.text || '').trim()) {
        push(errors, 'email-highlights', `$.emailHighlights[${index}].text`, 'Highlight text is required.');
      }
      const repo = parseRepoUrl(item?.url);
      if (!repo || !allow.has(repo.href)) {
        push(errors, 'email-url', `$.emailHighlights[${index}].url`, 'Highlight links must be repositories in this issue.');
      }
    });
  }

  walkStrings(issue, (text, path) => {
    if (EMAIL_RE.test(text)) push(errors, 'email-address', path, 'Issue JSON cannot contain an email address.');
    if (RAW_HTML_RE.test(text)) push(errors, 'raw-html', path, 'Issue text must be plain text, not HTML.');
    for (const found of extractUrls(text)) {
      const cleaned = found.replace(/[.,]+$/, '');
      let href = cleaned;
      try {
        href = new URL(cleaned).href;
      } catch {
        href = cleaned;
      }
      if (!cleaned.startsWith('https://') || (!allow.has(cleaned) && !allow.has(href))) {
        push(errors, 'unexpected-url', path, `URL is not on this issue's allowlist: ${cleaned}`);
      }
    }
  });

  return { ok: errors.length === 0, errors, warnings };
}

function checkPick(pick, index, edition, errors, allow) {
  const path = `$.picks[${index}]`;
  if (!pick || typeof pick !== 'object') {
    push(errors, 'pick', path, 'Pick must be an object.');
    return;
  }
  if (pick.rank !== index + 1) push(errors, 'pick-rank', `${path}.rank`, 'Ranks must be contiguous from 1.');
  if (!String(pick.name || '').trim()) push(errors, 'pick-name', `${path}.name`, 'name is required.');
  const repo = parseRepoUrl(pick.url);
  if (!repo || repo.repo !== pick.repo) {
    push(errors, 'pick-url', `${path}.url`, 'url must be the https GitHub repository named in repo.');
  } else {
    allow.add(repo.href);
  }
  if (pick.homepage) {
    const home = parseHttpsUrl(pick.homepage);
    if (!home) push(errors, 'homepage', `${path}.homepage`, 'homepage must be https without credentials.');
    else allow.add(home);
  }
  const narrative = ['purpose', 'highlights', 'lead', 'changes', 'value'].some(key => String(pick[key] || '').trim());
  if (!narrative) push(errors, 'narrative', path, 'A pick needs a purpose, highlight, lead, change note, or value.');
  if (!String(pick.try || '').trim()) push(errors, 'try', `${path}.try`, 'A lightweight try suggestion is required.');
  if (edition === 'official') {
    for (const key of ['purpose', 'highlights', 'value', 'try']) {
      if (!String(pick[key] || '').trim()) push(errors, `official-${key}`, `${path}.${key}`, `${key} is required on an official pick.`);
    }
    if (pick.returning === true && !String(pick.changes || '').trim()) {
      push(errors, 'official-changes', `${path}.changes`, 'A returning official pick must say what changed, or that nothing changed.');
    }
  } else if (pick.returning === true) {
    const note = String(pick.changes || '').trim()
      || String(pick.lead || '').trim()
      || (Array.isArray(pick.selectionNotes) && pick.selectionNotes.join(''));
    if (!note) push(errors, 'returning-note', path, 'A returning pick must carry the recorded change note.');
  }
  checkMetrics(pick.metrics, `${path}.metrics`, errors);
}

function checkMention(item, index, errors, allow) {
  const path = `$.mentions[${index}]`;
  if (!item || typeof item !== 'object') {
    push(errors, 'mention', path, 'Mention must be an object.');
    return;
  }
  const repo = parseRepoUrl(item.url);
  if (!repo || repo.repo !== item.repo) {
    push(errors, 'mention-url', `${path}.url`, 'url must be the https GitHub repository named in repo.');
  } else {
    allow.add(repo.href);
  }
  if (!String(item.note || '').trim()) push(errors, 'mention-note', `${path}.note`, 'A named item needs its recorded note.');
  if ('language' in item || 'license' in item) {
    push(errors, 'mention-metric', path, 'Do not invent language or license for a named item.');
  }
  if ('stars' in item && !isInteger(item.stars)) push(errors, 'metric-stars', `${path}.stars`, 'stars must be a non-negative integer when present.');
  if ('starsToday' in item && !isInteger(item.starsToday)) {
    push(errors, 'metric-stars-today', `${path}.starsToday`, 'starsToday must be a non-negative integer when present.');
  }
}

function checkMetrics(metrics, path, errors) {
  if (!metrics || typeof metrics !== 'object') {
    push(errors, 'metric-recorded', path, 'metrics.asRecorded is required.');
    return;
  }
  const recorded = String(metrics.asRecorded || '');
  if (!recorded.trim()) push(errors, 'metric-recorded', `${path}.asRecorded`, 'Keep the recorded metric line.');
  if (ESTIMATE_RE.test(recorded)) push(errors, 'metric-estimated', `${path}.asRecorded`, 'Do not estimate stars, language, or license.');
  if ('language' in metrics) {
    if (typeof metrics.language !== 'string' || !metrics.language.trim() || placeholder(metrics.language)) {
      push(errors, 'metric-language', `${path}.language`, 'Omit language when it was not recorded. Do not write a placeholder.');
    } else if (!recorded.includes(metrics.language)) {
      push(errors, 'metric-language', `${path}.language`, 'language must appear in the recorded metric line.');
    }
  }
  if ('license' in metrics) {
    if (typeof metrics.license !== 'string' || !metrics.license.trim() || placeholder(metrics.license)) {
      push(errors, 'metric-license', `${path}.license`, 'Omit license when it was not recorded. Do not write a placeholder.');
    } else if (!recorded.includes(metrics.license)) {
      push(errors, 'metric-license', `${path}.license`, 'license must appear in the recorded metric line.');
    }
  }
  if ('stars' in metrics) {
    if (!isInteger(metrics.stars)) push(errors, 'metric-stars', `${path}.stars`, 'stars must be a non-negative integer when present.');
    else if (!recordedHasCount(recorded, metrics.stars)) {
      push(errors, 'metric-stars', `${path}.stars`, 'stars must appear in the recorded metric line.');
    }
  }
  if ('starsToday' in metrics) {
    if (!isInteger(metrics.starsToday)) {
      push(errors, 'metric-stars-today', `${path}.starsToday`, 'starsToday must be a non-negative integer when present.');
    } else if (!recordedHasCount(recorded, metrics.starsToday)) {
      push(errors, 'metric-stars-today', `${path}.starsToday`, 'starsToday must appear in the recorded metric line.');
    }
  }
}

export function publishable(issue) {
  return issue?.edition === 'official';
}
