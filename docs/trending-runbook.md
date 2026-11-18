# GitHub Trending 精选：运行手册

这份手册给每日例程使用。仓库里的 `trending-runtime/` 只校验助手写好的 JSON、渲染静态页、写出邮件载荷。它不抓取榜单，不运行仓库代码，不调用模型，不发信，不推送，不合并，也不改 Pages 或 Actions。

AI Builders Digest 的根目录跳转、`YYYY-MM-DD/` 历史和 `runtime/` 保持原样。Trending 只用 `trending/` 这一层。

## 安装

在持久环境里放一份运行时，旁边放这份手册。包内目录名是 `runtime/`。不要把仓库、`node_modules` 或个人状态打进包。

```bash
export GT_HOME="$HOME/.github-trending-digest"
export GT_STATE="$GT_HOME/state"
mkdir -p "$GT_STATE"
node "$GT_HOME/runtime/bin/gt.mjs" status --state "$GT_STATE"
node "$GT_HOME/runtime/bin/gt.mjs" mark --state "$GT_STATE" --date 2026-11-17 --record-gmail-sent
```

安装时把已经用 Gmail 发出的 2026-11-17 记进 `$GT_STATE`。这一步只写私人状态，不发信。之后 `prepare` 和 `notify` 看到 `channel: gmail` 且 `sendResult: sent`，就不再为这一天发信。运行时代码里没有写死这个日期；没做这条记录时，它和其他日期一样。重复执行这条 `mark` 不会再写一次。

`status` 不需要安装依赖。测试才需要 `npm ci`。状态目录必须在运行时目录外面，例如上面的 `$GT_STATE`。运行时拒绝把状态写进自己的目录，也拒绝把状态写进检出目录。用 `status` 可以核对 `recordedSends` 里有没有这一天。

`$GT_STATE/config.json` 可选。默认定时是 `America/New_York` 的 `08:00`，含周六和周日，页面根是 `https://lkangd.github.io/ai-builders-digest`。不要改成别的时区，也不要关掉周末。

收件人只放在环境变量里：

- `GT_NOTIFY_TO`
- `GT_NOTIFY_FROM`：Resend 里已经验证过的发件人

配置或 issue JSON 里如果出现邮箱、`token`、`api_key`、`RESEND_API_KEY`，命令会失败。准备页面和通知载荷都不需要 Resend 密钥。

## 每天做什么

时区是 `America/New_York`。每天 08:00，含周末。脚本不注册 cron。

1. `prepare`。它不访问网络。标准输出是当天的采集契约；全文在 `$GT_STATE/runs/YYYY-MM-DD/prepare.json`。
2. 看 `action`：
   - `intake`：去官方页面采集，并写成 issue JSON。
   - `render-ready`：这一天已经渲染过，不要另开一份。
   - `skip` 且原因是 `already-sent-gmail`、`already-notified` 或 `send-result-unknown`：不要再渲染成新刊，不要发信。
3. 助手只根据官方 `https://github.com/trending?since=daily`（每日、所有语言）写 issue JSON，并对照 README 和公开元数据。不要运行仓库里的代码，不要再调用别的模型接口。缺的语言、许可证、star 总数、今日新增就省略，不要写成 0，不要估算。
4. `validate`。有错误就停下，不要渲染。
5. `render`。它把全文页、邮件 HTML 和纯文本写进状态目录，并给出稳定的 `gt-daily-YYYY-MM-DD`。`shouldSend` 在这一步永远是 false。
6. 发布交给已经绑定 `lkangd/ai-builders-digest` 的云端代理，按下一节做。不要在这一步发信。
7. PR 打开后 `mark --pr`。这只是本地记号。
8. `notify`。只有公开地址 `{baseUrl}/trending/YYYY-MM-DD/` 返回 200，而且页面声明自己是这一天的 `official` 刊，`shouldSend` 才可能为 true。样例、预览、根目录或 Builders 日期页都不算。
9. `shouldSend` 为 true 时，由例程经已经接好的 Resend 同时发送 `html` 和 `text`，并带上同一个 `idempotencyKey`。发送成功后再 `mark --published --notified`。结果不清楚就 `mark --send-unknown`，之后不要重发。

```bash
node "$GT_HOME/runtime/bin/gt.mjs" prepare --state "$GT_STATE"
node "$GT_HOME/runtime/bin/gt.mjs" validate --state "$GT_STATE" --issue "$GT_STATE/incoming-issue.json"
node "$GT_HOME/runtime/bin/gt.mjs" render --state "$GT_STATE" --issue "$GT_STATE/incoming-issue.json"
node "$GT_HOME/runtime/bin/gt.mjs" stage --state "$GT_STATE" --date YYYY-MM-DD --dest "$CHECKOUT"
node "$GT_HOME/runtime/bin/gt.mjs" notify --state "$GT_STATE" --date YYYY-MM-DD
node "$GT_HOME/runtime/bin/gt.mjs" mark --state "$GT_STATE" --date YYYY-MM-DD --pr
node "$GT_HOME/runtime/bin/gt.mjs" mark --state "$GT_STATE" --date YYYY-MM-DD --published --notified
node "$GT_HOME/runtime/bin/gt.mjs" mark --state "$GT_STATE" --date YYYY-MM-DD --send-unknown
```

标准输出会把收件人显示成 `configured`。完整载荷在 `runs/YYYY-MM-DD/notification.json`，里面可能有地址，所以这个文件只能留在 `$GT_STATE`。

## 已经发过的日期

阻止重发靠 `$GT_STATE` 里的记录，不靠运行时里的日期常数。安装时用上一节的 `--record-gmail-sent` 记下 2026-11-17。记下之后，`prepare` 的 `action` 是 `skip`，`notify` 的 `shouldSend` 是 false，原因是 `already-sent-gmail`，而且不会去请求页面。不要再 `mark --notified` 把它改成 Resend 已发送。结果不明的日期用 `--send-unknown`，之后同样不重发。

其他日期不受这条记录影响。样例和示例无论哪一天都不能发信，因为 edition 不是 `official`。

仓库里的 `trending/preview/sample-2026-11-17/` 只是那封已发送邮件的公开正文，供设计和回归。页面上「2026-11-17 已由 Gmail 送出」来自这份样例自己的字段，不会出现在其他预览或新的正式刊上。不要把它标成 official，不要拷进 `trending/2026-11-17/`。

## issue JSON

字段以 `runtime/schema/issue.schema.json` 为准，实际拒绝规则在 `validate`。助手写入的正文是纯文本，不要交 HTML。

- `edition`：`official` 才能进入日期目录。`sample` 和 `example` 只能进预览目录。
- `date`：纽约日历上的 `YYYY-MM-DD`。`collectedAt` 换到 `America/New_York` 后必须落在这一天。`collectedAtLabel` 写成 `YYYY-MM-DD HH:mm`，`collectedAtAbbr` 用当时的 `EST` 或 `EDT`。
- `source.url` 只能是 `https://github.com/trending?since=daily`。
- 展开项 1 到 8 个。少于 5 个可以，警告会写明不要为了凑数补仓库。多于 8 个直接失败。
- 开头 1 到 2 个 `featured: true`，而且 `featuredLede` 里要点名它们。
- 每个展开项要有真实 `https://github.com/owner/repo`、用途、亮点、对读者的具体价值、试用建议。再次入选要写 `changes`：有变化写变化，没有就写没有变化。
- `metrics.asRecorded` 保留榜单上的那一行。语言、许可证、star、今日新增只有在这一行里出现过才能写成数字或字符串。
- 邮件 `emailHighlights` 正好 3 到 5 条，链接必须是本期仓库。
- 正文里的链接只能是本期来源、仓库或该仓库自己给出的 https 站点。

`listedRepoCount` 如果填写，必须等于展开项加要点名项。

## 页面和邮件

全文页用现有摘要的字色和卡片，按项目来排：来源和采集时间、开头推荐、用途、亮点、价值、已核对事实、试用建议、点名列表、归档链接。桌面大约 760 像素，窄屏会改成单列。页面写明这是独立精选，不是 GitHub 官方界面。

邮件是 680 像素的表格式 HTML，样式写在元素上，另有一份内容相同的纯文本。邮件只放 3 到 5 条亮点和全文链接，不放图片。

样例页会带「不是正式刊、不发送」。这种页即使被误传到日期地址，`notify` 也会因为 edition 不是 `official` 而拒绝。

## 可以提交的 trending 路径

每日发布只允许这两组：

- `trending/YYYY-MM-DD/index.html`：edition 必须是 `official`，而且目录还不存在。已有归档不要覆盖。
- `trending/index.html`：由日期目录和已有预览重新生成的归档首页。

设计和回归还可以有，但每日 `stage` 不会写这些文件：

- `trending/preview/<slug>/index.html`
- `trending/preview/<slug>/email.html`
- `trending/preview/<slug>/email.txt`

`<slug>` 只能是小写、数字和连字符，而且不能本身就是一个日期。`sample-2026-11-17` 可以，`2026-11-17` 不可以。

不要提交或覆盖：

- 仓库根目录 `index.html`
- `YYYY-MM-DD/` 下的 Builders 归档
- `.nojekyll`、`.github/`、Actions、Pages 设置
- 状态目录、通知回执、收件人配置

`stage` 发现日期文件已经存在就什么都不写。发布前用只读查询确认 `main` 上还没有这一天，并且没有同名未合并 PR。分支可用 `trending/YYYY-MM-DD`。不要推 `main`，不要 force push，不要合并。

## 发信

Resend 连接器负责发送。下面任何一条成立都不要调用它：

- `shouldSend` 不是 true
- 状态里这一天已经是 Gmail 已发送，或 `sendResult` 是 `sent`
- edition 不是 `official`
- Pages 还不是 200，或打开的不是这一天的正式刊
- 亮点不是 3 到 5 条
- 收件人或发件人没有配在环境变量里
- 这一天已经标记为已通知，或 `sendResult` 是 `sent`
- `sendResult` 是 `unknown`

发送时把载荷里的 `html`、`text` 和 `idempotencyKey` 一起交给 Resend。只发纯文本不合格。密钥由连接器持有，不要写进命令行。

成功之后才 `mark --published --notified`。连接器没有明确成功或失败时，执行 `mark --send-unknown`，然后停止。不要再发一次。

## 验证

在 `runtime/`（仓库里是 `trending-runtime/`）执行：

```bash
npm ci
npm test
```

完整检出还可以另跑站点集成，便携包没有仓库根，不要把这项算进 `npm test`，也不要为了通过去伪造根目录：

```bash
npm run test:site
```

`npm test` 在便携包和仓库里是同一组。打包测试会在解包后的内层再跑这组；那一次 bundle 自测记为 skip。`test:site` 检查已提交的样例预览，以及 Builders 根目录 `index.html` 未被改动。

`package-lock.json` 锁定开发依赖 `parse5@8.1.1`。不要设置 `NODE_ENV=production`，否则装不上解析器。`npm test` 不启动 Chrome，也不需要本机的 `google-chrome --dump-dom`。

测试使用已发送的 2026-11-17 公开样例和一份标明虚构的 example。样例的 sha256 是 `eeadaf7c8c31adcff3fadc0d13807fec6a61f3b24f1acffe14127bed8952d29e`。测试不读取当天的在线榜单，不发信，不推送。

打包测试会把不含 `node_modules` 和 `state/` 的运行时，连同旁边的 `runbook.md`，打成 `github-trending-digest-runtime.tar.gz`，再在临时目录里 `npm ci` 并跑测试。手册和包内都不放私人邮箱。测试里若出现地址，只能是 `example.invalid`。

## 这次预览没有发布

`trending/preview/sample-2026-11-17/` 是预览。`trending/index.html` 只把它列在「预览」下面。正式刊列表是空的。根目录 `index.html` 没有改。不要把这次 PR 合并当作已经开始每日发信。
