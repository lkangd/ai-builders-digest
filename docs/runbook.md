# Follow Builders：Grok Bot 例程运行手册

这份手册给父级助手保存成 Grok Bot 技能，并据此创建例程。本仓库里的运行时只准备公开 feed、接受助手写好的摘要和译文、渲染静态 HTML、写出通知载荷。它不发信，不推送，不合并，也不改 Pages 设置。

调度和改写都由 Grok Bot 自己做。不要再接 DeepSeek，不要再跑原来的抓取、富化或中央 feed 发布脚本。

## 安装

在 Grok Bot 的持久 Linux 环境里放一份 `runtime/`，不必每次克隆 Pages 仓库。状态目录也放在这台机器上，不要放进仓库。

```bash
export FB_HOME="$HOME/.follow-builders-cloud"
export FB_STATE="$FB_HOME/state"
mkdir -p "$FB_STATE"
node "$FB_HOME/runtime/bin/fb.mjs" status --state "$FB_STATE"
```

`FB_STATE` 里可以有可选的 `config.json` 和 `prompts/*.md`。提示词优先用状态目录里的同名文件，否则用包内 `runtime/prompts/`。不要从中央仓库临时拉取提示词。

`runtime/config.example.json` 是默认值：语言 `bilingual`，时区 `Asia/Shanghai`，仓库 `lkangd/ai-builders-digest`，页面根 `https://lkangd.github.io/ai-builders-digest`。归档日期一律用上海日历，不用 `America/New_York`。

私人收件人只放在环境变量里：

- `FB_NOTIFY_TO`：收件人
- `FB_NOTIFY_FROM`：Resend 里已经验证过的发件人

不要把这两个值写进仓库、示例配置或提交说明。运行时拒绝配置文件里的 `token`、`api_key`、`GH_TOKEN`、`RESEND_API_KEY` 一类键。准备页面和通知载荷都不需要 Resend 密钥。

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
3. 只根据 `prepare.json` 写 `summary.json`。不要重新抓网页，不要发明 feed 里没有的人或链接。
4. `render` 把全文 HTML 和根目录跳转页写进状态目录。
5. `plan`。只有 `action` 为 `open-pr` 时才进入发布。`skip` 且原因是 `archive-live` 或 `pr-already-open` 时不要再开 PR。
6. 发布交给绑定了 `lkangd/ai-builders-digest` 的 Cursor 云端代理，按下一节做。
7. PR 已经打开后执行 `mark --pr`。这只是本地记号，不代表页面已经公开。
8. `main` 上出现当天页面之后，`notify` 才会给出 `shouldSend: true`。用 Resend 连接器发送载荷，成功后再 `mark --published --notified`。`mark --published` 会再次检查公开的日期页，检查失败就拒绝标记。

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

标准输出会把收件人显示成 `configured` 或 `null`。完整载荷只在 `runs/YYYY-MM-DD/notification.json`。

## 摘要契约

`summary.json`：

```json
{
  "highlights": [
    { "text": "英文一句", "textZh": "中文一句", "url": "https://必须来自本次 feed" }
  ],
  "entries": [
    { "url": "https://必须来自本次 feed", "summary": "英文摘要", "summaryZh": "中文译文" },
    { "handle": "feed 里的 handle", "summary": "这个人的英文导语", "summaryZh": "中文导语" }
  ]
}
```

规则：

- 提示词用 `prepare.json` 的 `prompts.digest_intro`、`prompts.summarize_tweets`、`prompts.summarize_podcast`、`prompts.summarize_blogs`、`prompts.translate`。
- `bilingual`：亮点先英文再中文。页面上英文原文在上，中文放进现有的「译文」块。不要先写完全部英文再写完全部中文。
- `zh`：亮点和长文主体用中文。`en`：不渲染译文块。
- 亮点 3 到 5 条。超过 5 条会截断。少于 3 条仍然可以渲染页面，但通知的 `shouldSend` 为 false。
- 没有出现在本次 feed 里的 URL 或 handle 会被丢掉。没有 URL 的内容不要写进摘要。
- 推文页面保留原文，并附上 `summaryZh`。播客和博客在有 `summary` 时用摘要，不再把长转录贴进页面。
- 输入按文本转义。不要交原始 HTML。

## 页面

全文页沿用现在的版式：680 像素、Inter、`#ff385c`、概览数字、Highlights、X、Podcast、Blog、RSS 分区和根目录跳转。根 `index.html` 只跳到上海日期目录。`.nojekyll` 只在缺失时补一个空文件，已有文件不动。

公开 feed 本身没有头像、图片和引用正文。运行时不再调用富化接口。引用推文只保留标记和状态链接。播客 URL 若已经是 YouTube 观看地址，页面内嵌播放器，这是本地解析，不是新的 API。

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

失败时的停止条件：feed 全失败、`plan.action` 不是 `open-pr`、`stage` 没有写出文件、diff 含有其他路径、公开日期页已存在、同日 PR 已打开、推送或开 PR 失败。任何一条成立都不要发信。

## 通知

Resend 连接器负责发送。`notify` 只在下面全部成立时把 `shouldSend` 设为 true：

- 当天页面的公开 raw URL 返回 200
- 亮点有 3 到 5 条，且双语模式下每条都有中文
- `FB_NOTIFY_TO` 和 `FB_NOTIFY_FROM` 都已设置
- 这一天还没有标记为已通知

载荷里的 `resend` 对象只有 `to`、`from`、`subject`、`text`、`html`、`idempotencyKey`。HTML 和纯文本都是亮点加当天页面链接，不含全文、转录或凭据。把 `idempotencyKey` 交给 Resend，避免同一次发送重试时重复投递。

`shouldSend` 不是 true 时不要调用连接器。发送成功之后才 `mark --published --notified`。

## 状态丢了怎么办

持久磁盘上的 `$FB_STATE` 是去重依据。云端代理每次新的检出没有这份状态。

- 日期页已经在 `main` 上：`plan` 返回 `archive-live`，不要再写。
- 同日 PR 还开着：先 `mark --pr`，之后 `plan` 不再要求开第二个 PR。状态丢了就用只读查询找 `digest/YYYY-MM-DD`。
- 页面已经公开但本地没有「已通知」记录：不要补发。先核对 Resend 是否送出，再决定是不是人工 `mark --notified`。

## 验证

在 `runtime/` 执行 `npm test`。测试使用带 `FIXTURE` 和 `example.invalid` 的夹具，不读取线上正文，不发信，不推送。

## 还不能当成每日无人值守

代码合并进这个仓库之后，例程仍然要由人保存并打开，私人收发件人也要配好。每一天的页面要等 `digest/YYYY-MM-DD` 被批准合并后才会出现在 Pages 上，邮件链接在那之前不能发。本运行时没有做端到端的发布或投递验证。
