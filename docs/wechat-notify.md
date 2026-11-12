# 微信通知使用与接口文档

更新日期：2026-11-12。通知发送和 DeepSeek 自动回复均已由手机实收验证。

## 用途

外部应用通过公网 HTTPS POST，将日报、资讯或提醒发送到站长预先绑定的微信机器人会话。txserver 直接调用腾讯 iLink HTTP 接口；不经过 cc-connect、Hermes 或大模型。调用方不能指定任意接收人。

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
| type | 否 | 展示标签，最多 40 个字符，例如日报、资讯、提醒 |
| time | 否 | 展示时间文字，最多 80 个字符；不表示定时发送 |

只接受以上四个字段，所有提供的值都必须是字符串；额外字段、数字或 `null` 会返回 400。可选字段不需要时直接省略。

正文 JSON 最多 16 KB；拼接后的消息最多 10,000 字节。通知接口不支持图片、群发、任意接收人或定时调度。日报的调度由调用方完成；聊天自动回复由后台监听器独立处理，不改写通知正文。

```bash
curl --request POST 'https://yinlubin.cn/api/wechat/notify' \
  --header "Authorization: Bearer $WECHAT_NOTIFY_API_KEY" \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: news-2026-11-12-morning' \
  --data '{"title":"今日资讯","content":"这里是正文","type":"日报","time":"2026-11-12 09:00:00"}'
```

## 返回契约

HTTP **202** 包含两种明确区分的状态。微信接口明确返回 `ret: 0` 时为 `accepted`：

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
| 400 / 413 / 415 | 请求格式、字段或长度错误 | 修正请求 |
| 401 | 通知密钥错误 | 核对独立通知密钥 |
| 408 | REQUEST_TIMEOUT，读取请求超过 10 秒，尚未发送 | 可沿用原编号重试 |
| 409 | 缺少会话、重复编号冲突、请求已在处理中/结果未知 | 按错误说明处理 |
| 429 | 本服务限流或正在发送 | 稍后沿用同一编号重试 |
| 502 / 503 | 微信拒绝、响应异常、连接失败或配置不可用 | 依据 status/code 处理，勿无条件自动重发 |

代理网关另可能返回 504 等非本接口 JSON 响应；这不能证明未发送，应沿用原编号查询重试结果，勿换新编号盲目重发。

通知 HTTP 接口默认同一时刻最多发送一条、每分钟 10 条、上海日期每天 100 条；计数随 txserver 重启清零。AI 自动回复独立限流，可能与通知并行。这是本地保护，不是微信官方配额。请求日志持久化，因此重启后同编号也不会再次发送；未完成的记录返回 unknown，需人工核对。

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
- `requests/` 保存请求摘要、状态及返回结果，不保存消息正文；不要在可能重试期间删除这些记录。
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

协议依据：[腾讯 openclaw-weixin 协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)。此处只实现独立文本通知及必要的会话监听。

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

`DEEPSEEK_MODEL` 与现有收支统计共用。修改它会影响两项功能；修改后需要分别重启 `wechat-notify` 和 `txserver` 才能让两边加载新环境配置。

## 数据与能力边界

- 通知正文、微信入站聊天正文不写入本服务的文件或日志；自动回复会把当前文字提交给 DeepSeek。
- 请求摘要、发送状态、微信会话凭证保存在服务器；停止进程不会删除这些文件。
- 机器人不访问账单、不执行服务器命令、不控制其他应用；没有网页搜索或工具调用能力。
- 日报推送与 AI 自动回复分别限流。接口限流、微信上游限制、模型调用失败是不同情况，应按返回状态或日志错误码处理。

## 验证记录

2026-11-12：38 项相关测试、定向 lint、类型检查与生产构建通过；公网未授权请求返回 401。用户已确认收到通知测试文字，也确认收到“你好”的 AI 自动回复。接管后 cc-connect 已停止，Hermes 网页服务保持独立运行。
