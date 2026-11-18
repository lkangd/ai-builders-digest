export function officialIssue(date = '2099-01-05') {
  return {
    edition: 'official',
    date,
    timezone: 'America/New_York',
    language: 'zh',
    collectedAt: `${date}T08:00:00-05:00`,
    collectedAtLabel: `${date} 08:00`,
    collectedAtAbbr: 'EST',
    source: {
      list: 'github-trending',
      since: 'daily',
      spokenLanguage: 'all',
      url: 'https://github.com/trending?since=daily',
      listedRepoCount: 1
    },
    intro: '测试用正式刊形状。不是真实榜单，测试结束后只留在临时目录。',
    featuredLede: '先看 Fixture Repo。它只存在于这条测试里。',
    picks: [
      {
        rank: 1,
        name: 'Fixture Repo',
        repo: 'example-only/official-shape',
        url: 'https://github.com/example-only/official-shape',
        featured: true,
        returning: false,
        metrics: {
          language: 'Text',
          license: 'MIT',
          stars: 2,
          starsToday: 1,
          asRecorded: 'Text · MIT · 2 stars · 今日 +1'
        },
        purpose: '测试用途。',
        highlights: '测试亮点。',
        value: '测试价值。',
        try: '不要安装。'
      }
    ],
    mentions: [],
    emailHighlights: [
      { text: '亮点一，链接到测试仓库。', url: 'https://github.com/example-only/official-shape' },
      { text: '亮点二，仍然是测试。', url: 'https://github.com/example-only/official-shape' },
      { text: '亮点三，用来满足三到五条。', url: 'https://github.com/example-only/official-shape' }
    ],
    dataNotes: '测试数据说明。热度不是成熟度。'
  };
}
