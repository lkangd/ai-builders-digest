import { createHash } from 'node:crypto';
import { EMAIL_RE, formatCount, recordedHasCount } from './util.mjs';

export const PUBLIC_SAMPLE_SHA256 = 'eeadaf7c8c31adcff3fadc0d13807fec6a61f3b24f1acffe14127bed8952d29e';

function integer(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} is not a recorded non-negative integer.`);
  }
  return value;
}

function highlightNumbers(text) {
  return text.match(/\d[\d,]*/g) || [];
}

function collectedIso(source) {
  const recorded = source.source || {};
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})$/.exec(recorded.collected_at || '');
  const offset = recorded.collected_at_tz_abbr === 'EST' ? '-05:00' : recorded.collected_at_tz_abbr === 'EDT' ? '-04:00' : '';
  if (!match || recorded.collected_at_timezone !== 'America/New_York' || !offset) {
    throw new Error('The fixture does not record an America/New_York collection time.');
  }
  return `${match[1]}T${match[2]}:${match[3]}:00${offset}`;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function normalizePublicSample(source, highlights, { sourceSha256 } = {}) {
  if (!source || source.fixture_purpose !== 'design-regression-only') {
    throw new Error('This adapter only accepts the public design-regression fixture.');
  }
  if (source.not_a_new_issue !== true || source.do_not_publish_or_send_as_today !== true) {
    throw new Error('The public fixture must stay marked as not a new issue.');
  }
  if (source.issue_date !== '2026-11-17') throw new Error('The public fixture date is 2026-11-17.');
  if (!Array.isArray(source.picks) || source.picks.length !== 6) throw new Error('Expected 6 expanded projects.');
  if (!Array.isArray(source.other_listed) || source.other_listed.length !== 9) throw new Error('Expected 9 named items.');
  if (source.source?.listed_repo_count !== 15) throw new Error('The fixture recorded 15 listed repositories.');
  if (sourceSha256 && sourceSha256 !== PUBLIC_SAMPLE_SHA256) {
    throw new Error('Public fixture sha256 does not match the sent digest.');
  }

  const picks = source.picks.map((pick, index) => {
    const metrics = pick.metrics || {};
    const out = {
      rank: integer(pick.rank, `picks[${index}].rank`),
      name: pick.name,
      titleAsRecorded: pick.title_as_recorded,
      repo: pick.repo,
      url: pick.url,
      returning: pick.returning === true,
      featured: false,
      selectionNotes: Array.isArray(pick.selection_notes) ? [...pick.selection_notes] : [],
      metrics: { asRecorded: metrics.as_recorded }
    };
    if (pick.rank !== index + 1) throw new Error('Pick ranks must stay in the recorded order.');
    if (!pick.title_as_recorded || !pick.try_suggestion) throw new Error(`Pick ${pick.repo} is missing recorded text.`);
    if ('language' in metrics) out.metrics.language = metrics.language;
    if ('license' in metrics) out.metrics.license = metrics.license;
    if ('stars' in metrics) out.metrics.stars = integer(metrics.stars, `${pick.repo} stars`);
    if ('stars_today' in metrics) out.metrics.starsToday = integer(metrics.stars_today, `${pick.repo} stars_today`);
    if (!recordedHasCount(metrics.as_recorded || '', out.metrics.stars)) {
      throw new Error(`Refusing to keep stars that are absent from the recorded line for ${pick.repo}.`);
    }
    if (!recordedHasCount(metrics.as_recorded || '', out.metrics.starsToday)) {
      throw new Error(`Refusing to keep today's stars that are absent from the recorded line for ${pick.repo}.`);
    }
    if (pick.homepage) out.homepage = pick.homepage;
    if (pick.purpose) out.purpose = pick.purpose;
    if (pick.highlights) out.highlights = pick.highlights;
    if (pick.potential_value) out.value = pick.potential_value;
    if (pick.changes) out.changes = pick.changes;
    if (pick.lead) out.lead = pick.lead;
    if (pick.try_suggestion) out.try = pick.try_suggestion;
    if (pick.verified_facts) out.verifiedFacts = pick.verified_facts;
    if (pick.highlights_qualifier) out.claimLabel = pick.highlights_qualifier;
    return out;
  });

  const featured = [];
  for (const pick of picks) {
    if (pick.rank <= 2 && String(source.featured_lede || '').includes(pick.name)) {
      pick.featured = true;
      featured.push(pick.name);
    }
  }
  if (featured.length < 1 || featured.length > 2) {
    throw new Error('Could not mark the opening recommendations from the recorded lede.');
  }

  const mentions = source.other_listed.map((item, index) => {
    if (!Object.hasOwn(item, 'stars') || !Object.hasOwn(item, 'stars_today') || !item.note_as_recorded) {
      throw new Error(`Named item ${index + 1} is missing a recorded metric.`);
    }
    const stars = integer(item.stars, `${item.repo} stars`);
    const starsToday = integer(item.stars_today, `${item.repo} stars_today`);
    if (!recordedHasCount(item.note_as_recorded, stars) || !recordedHasCount(item.note_as_recorded, starsToday)) {
      throw new Error(`Named item ${item.repo} has numbers that are not in its recorded note.`);
    }
    return {
      repo: item.repo,
      url: item.url,
      note: item.note_as_recorded,
      stars,
      starsToday
    };
  });

  if (!Array.isArray(highlights) || highlights.length < 3 || highlights.length > 5) {
    throw new Error('Email highlights must be 3 to 5 compressions of the same fixture.');
  }
  const sourceText = JSON.stringify(source);
  const urls = new Set(picks.map(pick => pick.url));
  const emailHighlights = highlights.map(item => {
    const text = String(item.text || '');
    if (!urls.has(item.url)) throw new Error('Highlight URL is not one of the six expanded repositories.');
    if (EMAIL_RE.test(text)) throw new Error('Highlight contains an email address.');
    for (const token of highlightNumbers(text)) {
      const plain = token.replaceAll(',', '');
      const grouped = Number.isInteger(Number(plain)) ? formatCount(Number(plain)) : token;
      if (!sourceText.includes(token) && !sourceText.includes(plain) && !sourceText.includes(grouped)) {
        throw new Error(`Highlight introduces a number that is not in the fixture: ${token}`);
      }
    }
    return { text, url: item.url };
  });

  return {
    edition: 'sample',
    sample: {
      purpose: 'design-regression-only',
      notANewIssue: true,
      doNotPublishOrSend: true,
      sourceSha256: sourceSha256 || PUBLIC_SAMPLE_SHA256
    },
    date: source.issue_date,
    timezone: 'America/New_York',
    language: 'zh',
    collectedAt: collectedIso(source),
    collectedAtLabel: source.source.collected_at,
    collectedAtAbbr: source.source.collected_at_tz_abbr,
    source: {
      list: 'github-trending',
      since: 'daily',
      spokenLanguage: 'all',
      url: source.source.url,
      listedRepoCount: source.source.listed_repo_count
    },
    intro: source.intro,
    featuredLede: source.featured_lede,
    picks,
    mentions,
    emailHighlights,
    dataNotes: source.data_notes
  };
}
