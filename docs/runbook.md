# Follow Builders：Grok Bot 例程运行手册

这份手册给父级助手保存成 Grok Bot 技能，并据此创建例程。本仓库里的运行时只准备公开 feed、接受助手写好的摘要和译文、渲染静态 HTML、写出通知载荷。它不发信，不推送，不合并，也不改 Pages 设置。

调度、摘要和翻译由 Grok Bot 自己做。不要接 DeepSeek，也不要重新抓取中央 X、播客或博客。公开 JSON feed 仍是正文来源。`render` 会在这之后用无密钥的公开 syndication 补头像、图片、视频和引用卡片。

## 安装

在 Grok Bot 的持久 Linux 环境里放一份 `runtime/`，旁边放 `runbook.md`。这个布局不包含仓库，也不包含 `docs/`。状态目录放在这台机器上，不要放进仓库。

```bash
export FB_HOME="$HOME/.follow-builders-cloud"
export FB_STATE="$FB_HOME/state"
mkdir -p "$FB_STATE"
node "$FB_HOME/runtime/bin/fb.mjs" status --state "$FB_STATE"
```

日常运行 `fb.mjs` 没有生产依赖，不需要 `npm ci`。只有跑测试时才安装。详见「验证」。

`FB_STATE` 里可以有可选的 `config.json` 和 `prompts/*.md`。提示词优先用状态目录里的同名文件，否则用包内 `runtime/prompts/`。不要从中央仓库临时拉取提示词。

`runtime/config.example.json` 是默认值：语言 `bilingual`，时区 `Asia/Shanghai`，仓库 `lkangd/ai-builders-digest`，页面根 `https://lkangd.github.io/ai-builders-digest`。归档日期一律用上海日历，不用 `America/New_York`。

私人收件人只放在运行环境变量里，不放进 `config.json`：

- `FB_NOTIFY_TO`：收件人
- `FB_NOTIFY_FROM`：Resend 里已经验证过的发件人

配置里如果出现 `notification.to`、`notification.from`、`email` 或 `recipient`，运行时直接拒绝，不会读取。不要把地址写进仓库、示例配置、运行时包或提交说明。运行时同样拒绝 `token`、`api_key`、`GH_TOKEN`、`RESEND_API_KEY` 一类键。准备页面和通知载荷都不需要 Resend 密钥。

## 每天做什么

Grok Bot 的时区设为 `Asia/Shanghai`。例程为每天 08:00，包含周六和周日。脚本本身不判断周末，也不会自己注册 cron。

每个上海日期只处理一次。状态在 `$FB_STATE/state.json`。同一时刻第二次运行会因为锁退出。

1. `prepare`。它读取三个公开 JSON feed，丢掉没有 http(s) URL 的条目，播客只留最新一条。标准输出是短 JSON；完整内容和提示词在 `runs/YYYY-MM-DD/prepare.json`。
2. 看 `action`：
   - `summarize`：按下面的契约写摘要。
   - `render-ready`：摘要没变，直接去 `plan`。
   - `await-publish` 或 `skip`：不要再写页面。若尚未发信，只做 `notify`。
   - `empty`：今天没有带链接的条目。不要开 PR，不要发信。
   - `status: error`：三个 feed 都失败。停下并报告，不要用昨天的页面冒充今天。
3. 只根据 `prepare.json` 写 `summary.json`。每条推文都要有 `id`、`url` 和 `textZh`。播客按空行分段，中英段落数相同。不要只写 `handle`。不要重新抓网页，不要发明 feed 里没有的人或链接。
4. `render` 先补媒体，再写全文 HTML 和根目录跳转页。双语或缺中文时，只要有一条推文没有 `textZh`，或播客中英段落数不同，命令就以 `action: incomplete` 失败。这时 HTML 只供检查，不能发布，也不能发信。
5. `plan`。它只看 `main` 上的 raw 文件，用来避免覆盖已有归档。`archive-live` 表示日期文件已经在 `main`，不表示 Pages 已经能打开。此时不要再写。`pr-already-open` 时也不要再开 PR。
6. 发布交给绑定了 `lkangd/ai-builders-digest` 的 Cursor 云端代理，按下一节做。
7. PR 已经打开后执行 `mark --pr`。这只是本地记号，不代表页面已经公开。
8. `notify` 请求配置里的 Pages 日期地址，也就是 `{baseUrl}/{YYYY-MM-DD}/`。只有 HTTP 200，并且页面标题里的日期就是这一天，`shouldSend` 才会是 true。raw 已经是 200 而 Pages 仍是 404，或者 Pages 打开的是别的日期，都不要发信，也不要 `mark --published`。发送成功后再 `mark --published --notified`。标记会再查一次同一个 Pages 地址。

命令：

```bash
node "$FB_HOME/runtime/bin/fb.mjs" prepare --state "$FB_STATE"
node "$FB_HOME/runtime/bin/fb.mjs" render --state "$FB_STATE" --summary "$FB_STATE/incoming-summary.json"
node "$FB_HOME/runtime/bin/fb.mjs" plan --state "$FB_STATE"
node "$FB_HOME/runtime/bin/fb.mjs" stage --state "$FB_STATE" --dest "$CHECKOUT"
node "$FB_HOME/runtime/bin/fb.mjs" notify --state "$FB_STATE"
node "$FB_HOME/runtime/bin/fb.mjs" mark --state "$FB_STATE" --pr
node "$FB_HOME/runtime/bin/fb.mjs" mark --state "$FB_STATE" --published --notified
```

标准输出保留 `html` 和 `resend.html`，只把收件地址显示成 `configured`。同一份载荷也写在 `runs/YYYY-MM-DD/notification.json`。

## 摘要契约

`summary.json`：

```json
{
  "highlights": [
    { "text": "英文短亮点", "textZh": "中文短亮点", "url": "https://必须来自本次 feed" }
  ],
  "entries": [
    { "id": "推文数字 id", "url": "https://x.com/handle/status/同一id", "textZh": "只翻译这条推文正文，保留换行", "quoteTextZh": "可选，只翻译引用正文" },
    { "url": "播客 url", "summary": "第1段\n\n第2段", "summaryZh": "第一段\n\n第二段" }
  ]
}
```

规则：

- 提示词用 `prepare.json` 的 `prompts.digest_intro`、`prompts.summarize_tweets`、`prompts.summarize_podcast`、`prompts.summarize_blogs`、`prompts.translate`。`prompts.translate` 要求按上面的字段写，不是只写人物导语。
- 亮点是 3 到 5 条短摘要，先英文再中文。它们不是 19 条推文的全文翻译。少于 3 条时页面仍可检查，但 `shouldSend` 为 false。
- 推文正文保留 feed 原文。`textZh` 只属于该 `id`/`url` 的正文，并保留换行。简介保持原文，只作身份说明。
- 只写 `handle`、不写 `id` 和 `url` 的项会被拒绝，不能当成完成。
- 引用正文来自 syndication 的被引用帖，不使用父推正文。`quoteTextZh` 若提供，只出现在引用卡片里。原页面的引用卡片没有单独译文；不提供时引用保持原文，不因此判为不完整。
- 播客按转录空行分段。`summary` 与 `summaryZh` 段落数必须相同。段落数不同时 `render` 失败，不能发信。
- 输入是纯文本。不要交原始 HTML。

## 页面

全文页沿用现在的版式：680 像素、Inter、`#ff385c`、概览数字、Highlights、X、Podcast、Blog、RSS 分区和根目录跳转。根 `index.html` 只跳到上海日期目录。`.nojekyll` 只在缺失时补一个空文件，已有文件不动。

公开 feed 只有正文、互动数和引用 id。`render` 对每条数字推文 id 请求 `https://cdn.syndication.twimg.com/tweet-result`，补上头像、图片、视频和引用卡片。引用长文在 syndication 缺正文时才再请求公开的 `api.fxtwitter.com`。这两处都不需要密钥。单条失败会记入 `warnings`，该条降为文本，其他条继续。播客频道地址没有视频 id 时不编造播放器。YouTube 观看地址仍只在本地解析后内嵌。

中央仓库不发布 RSS。运行时不再生成本地 RSS，也不再提交 seen state。只有私人配置显式写了 `feeds.rss` 指向一份公开 JSON 时才会读取。

## 怎样发布到 Pages

内置的 GitHub 读取工具不能提交文件，也不能写文件。`runtime` 不读取 `GH_TOKEN`，不调用 Contents API，也不假定脚本继承了云端代理的 git 凭据。

能公开页面的路径是：一个已经绑定 `lkangd/ai-builders-digest` 的 Cursor 云端代理打开拉取请求。Grok Bot 例程可以在自己的持久环境里完成 prepare、摘要和 render，再把当天的 HTML 交给这个云端代理；也可以让例程本身就是绑定该仓库的 Cursor Automation。仓库绑定后，平台会提供检出和开 PR 的授权。Pull request creation 是这类自动化的默认能力。

云端代理只做这些事：

1. 使用平台已经准备好的检出。不要再 clone，不要申请 token。
2. 在检出目录执行 `stage --dest`。它只会写入 `YYYY-MM-DD/index.html`、需要时更新根 `index.html`，以及在缺失时新建空的 `.nojekyll`。
3. 日期目录已经存在时，`stage` 什么都不写。不要覆盖已有归档，不要删除其他日期。
4. 根目录若已经指向更晚的日期，不要把跳转改回去。
5. 用 `git status` 和 `git diff --stat` 核对。变更超出上面三个路径就停止，不要提交。
6. 从 `main` 建立分支 `digest/YYYY-MM-DD`，只提交这些路径，并用平台远程推送该分支。推送失败就停止并报告，不要改用个人令牌。
7. 用平台的拉取请求能力对 `main` 开 PR。开之前用只读的 GitHub 查询确认没有同名分支的未合并 PR。已经有就不要再开。
8. 不要推 `main`，不要 force push，不要合并，不要改 Pages 源或设置，不要启用 GitHub cron。

Pages 从 `main` 的仓库根目录提供网站。PR 合并进 `main` 之后，日期页和根跳转才会公开。这个运行时没有合并命令。合并必须是仓库里已经存在、并且由人批准的规则；不要假设云端代理会自动合并。

失败时的停止条件：feed 全失败、`plan.action` 不是 `open-pr`、`stage` 没有写出文件、diff 含有其他路径、`main` 上已经有当天归档、同日 PR 已打开、推送或开 PR 失败。任何一条成立都不要覆盖归档。另外，Pages 日期地址还没有以 HTTP 200 返回这一天的标题时，不要发信，也不要标记已发布。

## 通知

Resend 连接器负责发送。`notify` 只在下面全部成立时把 `shouldSend` 设为 true：

- `{baseUrl}/{YYYY-MM-DD}/` 返回 HTTP 200，并且 `<title>` 里的日期就是这一天。这是邮件里的链接，不是 raw GitHub 地址。
- 亮点有 3 到 5 条，且双语模式下每条都有中文
- `FB_NOTIFY_TO` 和 `FB_NOTIFY_FROM` 都已设置，而且没有从配置文件读取
- 这一天还没有标记为已通知

载荷里的 `archiveOnMain` 只说明 `main` 上有没有当天文件。`pages.ready` 才决定能不能发。raw 为 200 而 Pages 为 404 时，`shouldSend` 是 false，`mark --published` 也会拒绝。Pages 返回另一个日期时，原因是 `page-stale`。

`resend` 同时包含 `html` 和 `text`。发送时两个都要交给 Resend。只发 `text` 会让邮件变成纯文字，这是不合格的。`html` 是 680px 表格式亮点加 “Open today's digest →” 按钮，不含图片和视频。标准输出保留这份 HTML，只把收件地址显示成 `configured`。

当天译文不完整时 `shouldSend` 为 false，原因是 `translation-incomplete`。不要改发纯文本凑合。

`shouldSend` 不是 true 时不要调用连接器。发送成功之后才 `mark --published --notified`。

## 状态丢了怎么办

持久磁盘上的 `$FB_STATE` 是去重依据。云端代理每次新的检出没有这份状态。

- 日期文件已经在 `main` 上：`plan` 返回 `archive-live`，不要再写。这还不表示可以发信。
- 同日 PR 还开着：先 `mark --pr`，之后 `plan` 不再要求开第二个 PR。状态丢了就用只读查询找 `digest/YYYY-MM-DD`。
- Pages 已经打开当天页面，但本地没有「已通知」记录：不要补发。先核对 Resend 是否送出，再决定是不是人工 `mark --notified`。

## 验证

在 `runtime/` 里，可携测试的安装是：

```bash
npm ci
npm test
```

`package-lock.json` 锁定唯一的 devDependency `parse5@8.1.1`。不要设置 `NODE_ENV=production`，否则 npm 不安装 devDependencies，HTML5 解析器缺失，测试会失败。发布包不要带 `node_modules`，也不要带个人状态。

`npm test` 不启动 Chrome，也不调用 `google-chrome` 或 `box-chrome`。播客中英相邻由 parse5 按 HTML5 树构造检查：标题在分段之前，每一段英文和对应中文是同一个 `fb-segment` 的子节点。同一组测试会把旧的译文 `<tr>` 放回单元格再解析。源字符串里标题仍在后段英文之前，解析树会把那些英文挪到标题前面，并把引用译文移出引用卡。这项不能跳过，也不能改成只看源码顺序。

`npm run test:chrome` 是另一套验收，不在 `npm test` 里。它要求一次性 Chrome 执行 `--dump-dom` 并把 DOM 写到 stdout。持久桌面 launcher 如果把 stdout 丢掉，这项会超时失败。不要把它当成可携测试，也不要为了通过而跳过。

打包测试会把不含 `node_modules` 的 `runtime/` 和旁边的 `runbook.md` 打成包，解到临时目录，先 `npm ci` 再跑 `npm test`。安装包不需要仓库里的 `docs/`。测试使用带 `FIXTURE` 和 `example.invalid` 的夹具，不读取线上正文，不发信，不推送。

## 发布和发信仍要人工确认

上面的 prepare、译文、render 和 notify 就是每日步骤，不要改回“不富化”或“只按人物写中文”。页面要等 `digest/YYYY-MM-DD` 被批准合并后才会出现在 Pages 上。`notify` 在 `shouldSend` 为 true 时必须同时发送 `html` 和 `text`。本运行时没有做端到端的发布或投递验证。
