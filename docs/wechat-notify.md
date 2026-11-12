# 微信通知使用与接口文档

更新日期：2026-11-12。通知发送和 DeepSeek 自动回复均已由手机实收验证。

## 用途

外部应用通过公网 HTTPS POST，将日报、资讯或提醒发送到站长预先绑定的微信机器人会话。txserver 直接调用腾讯 iLink HTTP 接口，不经过 cc-connect 或 Hermes。快讯和普通通知直接转发文字，不经过大模型。只有明确标记的 grokbot 日报生成公开网页，网页保留原始简报；点击“生成语音”后直接朗读原文，不搜索资料，也不调用模型改写或总结。调用方不能指定任意接收人。

## 快速上手

### 在微信里使用

1. 打开已经绑定的微信机器人对话，直接发送文字。
2. 机器人通过 DeepSeek 回复当前这条消息，不需要启动 cc-connect 或打开 Hermes。
3. 外部应用推送的日报、资讯会出现在同一个对话中。通知内容不经过 AI 改写，去除首尾空白后按标题、正文和时间排版。

当前只服务已绑定的接收人，不是所有微信用户都能使用的公共机器人。自动回复没有历史记忆；如果下一条问题依赖上下文，请把必要背景一并发过去。

### 让其他应用推送通知

将下面的信息交给需要接入的应用：

```text
URL: https://yinlubin.cn/api/wechat/notify
Method: POST
Content-Type: application/json
Authorization: Bearer <单独填写接口密钥>
Idempotency-Key: <每条通知唯一且重试不变的编号>
Body: {"title":"标题","content":"正文","type":"日报","time":"展示时间"}
```

接口密钥使用 `WECHAT_NOTIFY_API_KEY`，不是 DeepSeek Key、微信 AppSecret 或微信机器人 botToken。站长可从服务器 `/root/.txserver-wechat/client.env`，或本机 txserver 项目内 `.env.wechat-notify-client.local` 获取。对方应用有加密输入框时，把密钥填在那里；本文档只提供字段与配置位置。

每天的日报使用新的编号，例如 `daily-2026-11-12`；同一条日报网络重试时沿用原编号。`time` 只是显示文字，定时发送需要调用方自行安排。

收到 `accepted` 或 `submitted` 后，不要为确认手机收取而再次生成新编号发送。状态含义见下文。

## 调用

- 地址：`https://yinlubin.cn/api/wechat/notify`
- 方法：`POST`
- 请求格式：`application/json`
- 鉴权：`Authorization: Bearer <独立通知接口密钥>`
- 推荐请求头：`Idempotency-Key: <本条通知唯一编号>`，同一条消息重试沿用编号，不同内容使用不同编号。允许 1–128 位英文字母、数字、`_ . : -`。

```json
{
  "title": "今日资讯",
  "content": "这里是需要发送到微信的正文。",
  "type": "日报",
  "time": "2026-11-12 09:00:00"
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| content | 是 | 非空文字，最多 3,000 个字符 |
| title | 否 | 标题，最多 120 个字符 |
| type | 否 | 最多 40 个字符；只有来源为 grokbot 且精确等于 `daily` 才启用日报归档，其他值仅作展示标签 |
| time | 否 | 展示时间文字，最多 80 个字符；不表示定时发送 |
| source | 否 | 1–40 位英文字母、数字、下划线或连字符；推荐填 `grokbot`，也兼容标题前缀 `【grokbot】` |
| reportDate | 否 | 仅用于 grokbot daily 日报，有效的 `YYYY-MM-DD`；省略时按接收请求的上海日期归档 |

只接受以上六个字段，所有提供的值都必须是字符串；额外字段、数字或 `null` 会返回 400。可选字段不需要时直接省略。

正文 JSON 最多 16 KB；标题、正文、时间拼接后普通通知最多 10,000 字节，日报最多 9,700 字节，为末尾网页链接预留空间。调用方不能上传图片、指定任意接收人或要求群发。微信只发文字；日报调度仍由调用方完成，服务端不新增定时任务。

```bash
curl --request POST 'https://yinlubin.cn/api/wechat/notify' \
  --header "Authorization: Bearer $WECHAT_NOTIFY_API_KEY" \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: news-2026-11-12-morning' \
  --data '{"title":"今日资讯","content":"这里是正文","type":"日报","time":"2026-11-12 09:00:00"}'
```

## 返回契约

普通通知直接发送，HTTP **202** 包含两种明确区分的状态。微信接口明确返回 `ret: 0` 时为 `accepted`：

```json
{
  "schemaVersion": 1,
  "status": "accepted",
  "requestId": "请求编号摘要",
  "submittedAt": "2026-11-12T01:00:00.000Z",
  "deduplicated": false
}
```

`accepted` 表示微信上游已接受，不代表手机已读或已确认送达。不能仅根据 HTTP 200、message_id 等其他字段推断业务成功。

微信官方客户端还接受 HTTP 成功 + 空对象 `{}` 的响应。对此本接口返回 HTTP **202**、`status: "submitted"`、`deliveryStatus: "unknown"`、`acknowledgement: "missing_business_status"`，含义仅为请求已提交，微信没有提供业务确认。它不等于 `accepted` 或已送达；调用方应标记“已提交，送达未确认”，**不要自动重发**。同样会保存请求编号防止重复发送。参考[腾讯官方成功测试](https://github.com/Tencent/openclaw-weixin/blob/main/src/api/api.test.ts)。

同一 Idempotency-Key 和相同规范化内容重试时返回已存结果，`deduplicated: true`，不再发送。不同内容复用编号返回 409。未传此请求头时每次请求均作为新消息，无法避免调用方重试造成的重复。

失败返回 `{ schemaVersion: 1, status: "failed" | "unknown", code, error, requestId? }`。微信明确拒绝时还可能包含数值 `upstreamRet`、`upstreamErrcode`，用于排查；不返回原始响应或凭证。网络超时、断线及无法确认的响应使用 `unknown`，可能已发送，**不要自动换新编号重发**，应先核对微信。

| HTTP | 情况 | 处理 |
| --- | --- | --- |
| 207 | grokbot 同编号 POST 重试返回已保存的 partial 结果 | 查看 parts，不自动重放整组 |
| 400 / 413 / 415 | 请求格式、字段或长度错误 | 修正请求 |
| 401 | 通知密钥错误 | 核对独立通知密钥 |
| 408 | REQUEST_TIMEOUT，读取请求超过 10 秒，尚未发送 | 可沿用原编号重试 |
| 409 | 缺少会话、重复编号冲突、请求已在处理中/结果未知 | 按错误说明处理 |
| 429 | 本服务限流或正在发送 | 稍后沿用同一编号重试 |
| 502 / 503 | 微信拒绝、响应异常、连接失败或配置不可用 | 依据 status/code 处理，勿无条件自动重发 |

代理网关另可能返回 504 等非本接口 JSON 响应；这不能证明未发送，应沿用原编号查询重试结果，勿换新编号盲目重发。

通知 HTTP 接口默认同一时刻最多处理一个请求、每分钟 10 次、上海日期每天 100 次；一份日报算一次请求，只发一条文字加链接。计数随 txserver 重启清零。AI 自动回复和新闻后台各自运行，可能与普通通知并行。这是本地保护，不是微信官方配额。请求日志持久化，因此重启后同编号也不会再次发送；未完成的发送记录返回 unknown，需人工核对。

## grokbot 日报：文字链接、公开网页与语音

**快讯直接发送原文，不调用 AI、不保存网页、不生成图片或音频，不等待日报后台任务。** 只有来源为 grokbot 且 `type` 精确为 `daily` 才启用下面的流程。`type: "日报"`、标题含“日报”等都不会自动进入归档。

```json
{
  "source": "grokbot",
  "type": "daily",
  "title": "【grokbot】每日资讯",
  "content": "第一条新闻与已知事实。\n来源：https://example.com/news\n\n第二条新闻正文。",
  "time": "2026-11-12 09:00:00",
  "reportDate": "2026-11-12"
}
```

每份日报发送一个固定 `Idempotency-Key`，例如 `grokbot-daily-2026-11-12-morning`；重试必须沿用。服务端先持久保存原日报和网页，再立即向微信发送原文字和末尾的“完整日报与语音：https://yinlubin.cn/news/<id>”。不等待联网或 TTS，不再发送阅读图片、MP3 文件或语音不可用提示。

网页打开时只显示原始简报和“生成语音”按钮，不调用语音服务，也不轮询。只有点击按钮才持久排队，处理时显示“正在生成语音”，每 3 秒检查一次状态，终态后停止。音频生成后共享保存，重复打开或点击均复用已有结果。整个日报流程不调用大模型、不消耗模型 token。公开列表为 [日报](https://yinlubin.cn/news)，首页也有入口；所有访客可阅读与播放，**日报内容是公开保存的**。列表每页 20 条、按日报日期及创建时间倒序；同日多份独立保存。上线前的旧通知不会自动补档。

### 内容与音频

用户点击后，后台将原始简报正文直接交给 TTS，不搜索、不补充资料、不改写或生成摘要。仅从朗读稿中移除 HTTP(S) 链接，网页原文不变；数字、事实与措辞按原文保留。实际朗读稿通过公开接口的 `audio.text` 返回，网页可展开查看。正文只有链接、没有可朗读文字时会明确失败。

音频使用 edge-tts 中文音色，时长取决于原文长度，最多朗读 3,000 字。只在网页上点击播放，支持暂停、拖动和倍速，不自动播放。朗读稿会发送给 Microsoft Edge 在线语音服务，生成的 MP3 上限 8 MB。

音频失败时页面明确提示，原始简报保留。公开接口不暴露内部工作记录、密钥或微信凭证。旧“拉取详情”功能已停用，不会继续搜索或消耗模型 token。

### 响应与独立状态

通知顶层 `status` 仍然只描述微信投递，不代表网页处理结果。示例：

```json
{
  "schemaVersion": 1,
  "status": "accepted",
  "requestId": "64位十六进制请求编号",
  "deduplicated": false,
  "report": {
    "id": "64位十六进制请求编号",
    "url": "https://yinlubin.cn/news/64位十六进制请求编号",
    "status": "idle",
    "audioStatus": "not_requested"
  }
}
```

实际微信未明确确认时，顶层可能是 `submitted` 或 `unknown`；即使通知发送失败，已经保存的原日报仍可阅读，后续处理仍必须由页面点击触发。不要根据有网页链接推断消息送达。

用同一 Bearer 密钥请求 `GET /api/wechat/notify/requests/<requestId>` 查询通知记录及报告最新状态；HTTP 200 只表示查询成功。报告读取异常时保留原微信状态，返回 `report: null` 和独立的 `reportError`。

| 报告 status | 含义 |
| --- | --- |
| idle | 仅保存原始简报，尚未点击“生成语音” |
| queued | 用户已点击，任务已持久保存，等待后台处理 |
| processing | 正在生成原文朗读音频 |
| completed | 音频已完整保存并可播放 |
| partial | 旧版历史状态；新版不会产生，播放仍以 audio.status 为准 |
| failed | 语音未能完成；原日报仍可阅读，查看 warnings |

`audioStatus` 为 `not_requested`（尚未点击）、`pending`、`ready` 或 `failed`。公开详情接口中对应字段是 `report.audio.status`，只有 `ready` 才能播放。客户端必须按这些明确字段展示，不从 body、URL 或来源数量推断成功。

- `GET /api/news?page=1`：`{schemaVersion:1,status:"completed",items,page,hasMore}`，每页 20 条。
- `GET /api/news/<id>`：`{schemaVersion:1,status:"completed",report}`；外层 completed 仅表示读取成功，处理结果在 `report.status`。
- `POST /api/news/<id>/audio`：无请求正文、页面同源调用，首次点击将 idle 报告原子排队，返回 `{schemaVersion:1,status:"completed",report}`。所有访客共享一次生成；queued/processing/completed/partial/failed 都返回现有记录，不再次排队。跨站请求拒绝，接口不能上传正文或新链接。POST 网络结果不明时先 GET 查询状态，不自动重复生成。
- `POST /api/news/<id>/details`：已停用，固定返回 HTTP 410、`NEWS_DETAILS_RETIRED`，不会产生任何任务。
- `GET /api/news/<id>/audio`、`HEAD /api/news/<id>/audio`：同源 MP3，支持单段 Range、206/416，供微信内网页播放和拖动。未准备好不返回空音频。

同一幂等键不重复建页或推送；相同键不同内容返回 409。仅发送前初始化中断返回 `retryable: true` 时可沿用原键安全恢复；通知状态查询此时为 `initializing`。一旦进入发送阶段，中断后返回 unknown，不自动重发。语音任务独立恢复，不会因此再次发送微信。语音失败后仍保留原文，当前页面不提供“重新生成”，防止重复调用。

### 日报服务配置

```text
WECHAT_NEWS_ENABLED=true
NEWS_REPORTS_DIR=/root/.txserver-news
NEWS_PUBLIC_ORIGIN=https://yinlubin.cn
WECHAT_NEWS_TTS_BIN=/root/.txserver-wechat/tts-venv/bin/edge-tts
WECHAT_NEWS_TTS_VOICE=zh-CN-XiaoxiaoNeural
```

日报不再使用 `NEWS_REPORT_MODEL` 或 `DEEPSEEK_API_KEY`。DeepSeek 仍用于独立的微信聊天自动回复。旧 `WECHAT_NEWS_AUDIO_MODE` 与字体配置不影响日报发送，不能用它们重新开启图片/MP3 推送。

原文和音频长期保存在独立磁盘目录，不放 Git。`reports/` 保存初始原文，`triggers/` 首次原子创建完整语音任务，后续由 worker 更新；读取优先使用触发记录，避免重复点击覆盖进度。单 worker 顺序处理，每份任务从首次执行开始最多 120 秒，单次 TTS 最多 90 秒；截止时间和调用次数在调用前落盘，重启不清零。最多 2 次尝试仅用于中断恢复，明确失败不会自动重试；音频完整保存后才发布 ready，恢复时校验本次音频摘要后直接复用。

依赖沿用已安装的 `edge-tts==7.3.1`。新的 worker 入口如下（从旧入口升级时应替换 PM2 的启动参数，而不仅 restart）：

```bash
pm2 start /root/.nvm/versions/node/v24.14.1/bin/node --name wechat-news \
  --interpreter none --kill-timeout 10000 --restart-delay 10000 -- \
  --env-file=/root/txserver/.env.production.local /root/txserver/lib/newsReports/worker.mjs
pm2 save
pm2 logs wechat-news --lines 50 --nostream
```

`GET /api/wechat/notify/status` 的 `newsWorker` 读取新目录 health.json 的状态和时间；旧时间戳不证明在线。语音进程使用服务器 `/usr/bin/flock` 对新目录 `worker.lock` 持有内核排他锁；进程退出后自动释放，不删除锁文件，不依赖 PID 文件恢复。不可启动两个语音 worker。停止 worker 不影响快讯直发，已有日报页面仍可阅读。关闭新日报接收需设 `WECHAT_NEWS_ENABLED=false` 并重启 txserver。

## 连接状态

`GET https://yinlubin.cn/api/wechat/notify/status`，使用同一 Bearer Token。成功返回 `status: "completed"`、`channel`、`contextAvailable`、`listener`。listener 包含最近轮询状态、错误码和 checkedAt；旧时间戳不能视为当前在线。状态查询不测试发送，也不能证明接收端送达。

连接状态查询示例（不会发送微信消息）：

```bash
curl 'https://yinlubin.cn/api/wechat/notify/status' \
  --header "Authorization: Bearer $WECHAT_NOTIFY_API_KEY"
```

```json
{
  "schemaVersion": 1,
  "status": "completed",
  "channel": "weixin-ilink",
  "contextAvailable": true,
  "listener": {
    "status": "connected",
    "code": null,
    "checkedAt": "2026-11-12T06:40:47.971Z"
  },
  "note": "连接状态不代表消息已送达；发送结果以 POST 返回为准。"
}
```

尚未产生监听状态文件时 `listener` 为 `null`。`contextAvailable` 仅表示当前接收人的会话凭证已保存，不证明凭证一直有效。

## 服务端配置与运维

- `/root/txserver/.env.production.local`：`WECHAT_NOTIFY_API_KEY`（独立随机密钥，至少 32 字符）、`WECHAT_NOTIFY_STATE_DIR=/root/.txserver-wechat`。
- `/root/.txserver-wechat/credentials.json`：`{ "botToken": "微信机器人凭证", "recipient": "已绑定的接收人ID" }`。
- 同目录 `context.json`：`{ "recipient": "同一接收人ID", "contextToken": "最近会话凭证", "cursor": "轮询游标或空串", "updatedAt": "ISO时间" }`。
- `node lib/wechatNotify/listener.mjs`：独立后台监听。只保存固定接收人的会话凭证和游标，不持久化微信聊天正文。默认不自动回复；启用 `WECHAT_NOTIFY_AUTO_REPLY=true` 后，按下方规则调用 AI 回复。
- 同一机器人账号仅运行一个轮询程序，不与 cc-connect 或 Hermes 网关同时轮询。
- 监听器用 `listener.lock` 防止重复启动。正常 SIGTERM 会释放；异常断电/SIGKILL 后，必须先确认锁里 PID 已退出，再删除旧锁并重启。
- 目录权限 700、文件权限 600；密钥不进入文档、Git、URL 查询参数或日志。
- `requests/` 保存请求摘要、状态及返回结果；普通通知不保存正文，日报原文和音频独立保存在 NEWS_REPORTS_DIR。不要在可能重试期间删除去重记录。
- 登录失效时需要重新绑定获取有效 botToken，更新配置并重启监听。该接口不是微信小程序 AppSecret 接口，二者凭证不能混用。

部署时直接让 PM2 执行 Node，避免 PM2 的脚本包装器影响 ESM 入口判断：

```bash
cd /root/txserver
pm2 start /root/.nvm/versions/node/v24.14.1/bin/node --name wechat-notify \
  --interpreter none --kill-timeout 5000 --restart-delay 10000 -- \
  --env-file=/root/txserver/.env.production.local /root/txserver/lib/wechatNotify/listener.mjs
pm2 save
```

监听器更新后使用 `pm2 restart wechat-notify`；接口代码更新仍需生产构建并重启 `txserver`。

## 通道限制

微信 iLink 使用入站消息中的 context_token。长期不互动的会话可能拒绝主动推送；没有在此集成中得到验证的固定有效期或通用后台续期接口。遇到发送拒绝，先检查微信通道/凭证，必要时在微信向机器人发一条消息，再核对监听状态。`ret=-2` 不直接等同“会话过期”或“限流”。登录失效则需重新绑定。

协议依据：[腾讯 openclaw-weixin 协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)。此处实现独立通知及必要的会话监听。

## 可选文字自动回复

`WECHAT_NOTIFY_AUTO_REPLY=true` 开启，复用服务端 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_MODEL`（默认 `deepseek-flash`），直接调用 DeepSeek Responses API。

仅处理已绑定接收人在监听器启动之后发来的新文字消息，跳过历史消息、图片和其他用户消息。每条独立回答，不保留多轮聊天记录。正文会发送给 DeepSeek 生成回复，但本服务不把聊天正文写入文件或日志。此功能不访问账单、不运行命令、不调用工具；不经过 Claude Code、Hermes 或 cc-connect。

AI 自动回复有单独频率限制：每分钟最多 6 次、上海日期每天 60 次，重启清零；模型调用超时 25 秒，限制输出长度。模型失败或发送状态未知时不自动重试，也不另外发送错误提示。先保存入站游标再处理回复，所以进程崩溃时可能跳过当次回复；该取舍用于避免重启后重复回复。

## 日常管理与故障排查

| 现象 | 检查与处理 |
| --- | --- |
| 401 / UNAUTHORIZED | 检查 Header 是否为 `Authorization: Bearer <通知密钥>`，不要填其他服务的 Key |
| CHANNEL_NOT_CONFIGURED / NOT_CONFIGURED | 检查服务端通知密钥和机器人配置是否齐全 |
| CONTEXT_REQUIRED | 在微信里给机器人发一条文字；确认监听正常并更新了会话后重试 |
| WECHAT_LOGIN_REQUIRED | 微信机器人登录失效，需要重新绑定；它不同于小程序微信登录 |
| WECHAT_REJECTED | 查看数值 upstreamRet/upstreamErrcode，检查会话及微信通道；不要把所有拒绝都当成限流 |
| submitted | 已完成 HTTP 提交，但微信未提供明确业务确认；查看手机，不要自动重复发送 |
| unknown / SEND_UNCONFIRMED | 可能已发送；先人工核对。同一编号不会重复发送，不要直接换编号重试 |
| 同一编号修复后仍返回原失败结果 | 如果请求已进入发送流程，结果会持久化。确认之前确实未送达且故障已修复后，才能使用新编号重新提交 |
| 没有 AI 回复 | 只处理当前绑定人的新文字；历史消息、非文字、超长输入、达到频率上限或模型失败都会跳过；查看监听日志中的错误码 |
| 重启后监听不工作 | 查看 PM2 和 listener.lock。正常退出会释放锁；强杀遗留锁只能在确认旧进程退出后清理 |

查看服务与日志（不触发发送）：

```bash
pm2 list
pm2 logs wechat-notify --lines 50 --nostream
pm2 logs txserver --lines 50 --nostream
```

暂停/恢复微信监听及自动回复：

```bash
pm2 stop wechat-notify
pm2 restart wechat-notify
```

停掉监听器不会关闭通知 HTTP 接口；接口仍可能使用已缓存的会话发送。仅关闭 AI 自动回复时，把 `.env.production.local` 的 `WECHAT_NOTIFY_AUTO_REPLY` 设为 `false`，然后重启 `wechat-notify`。

`DEEPSEEK_MODEL` 由收支统计、微信自动回复共用，日报朗读不使用模型。修改模型配置后需重启 `wechat-notify` 和 `txserver`；修改语音配置则需重启 `wechat-news`。

## 数据与能力边界

- 快讯、普通通知正文及微信入站聊天正文不写入本服务的文件或日志；明确标记的日报原文公开归档。只有聊天自动回复将消息提交给 DeepSeek；日报点击生成语音后，将原文朗读稿提交给在线语音服务。
- 请求摘要、发送状态、微信会话凭证保存在服务器；停止进程不会删除这些文件。
- 聊天自动回复不访问账单、不执行服务器命令、不控制其他应用，也没有联网工具。日报后台只处理原文 TTS，不具备搜索或网页读取能力。
- 日报推送与 AI 自动回复分别限流。接口限流、微信上游限制、模型调用失败是不同情况，应按返回状态或日志错误码处理。

## 验证记录

2026-11-12：38 项相关测试、定向 lint、类型检查与生产构建通过；公网未授权请求返回 401。用户已确认收到通知测试文字，也确认收到“你好”的 AI 自动回复。接管后 cc-connect 已停止，Hermes 网页服务保持独立运行。

2026-11-12 日报简化：移除搜索和模型整理，改为原文＋按需语音；本地相关测试 115 项，113 通过、2 项 Linux 锁集成测试在 macOS 跳过，定向 lint、类型检查与生产构建通过。覆盖快讯直发、日报幂等、无点击不生成、重复点击复用、TTS 失败与中断恢复、音频 Range 和旧详情接口停用。
