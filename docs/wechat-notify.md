# 微信通知接口

## 用途

外部应用通过公网 HTTPS POST，将日报、资讯或提醒发送到站长预先绑定的微信机器人会话。txserver 直接调用腾讯 iLink HTTP 接口；不经过 cc-connect、Hermes 或大模型。调用方不能指定任意接收人。

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

正文 JSON 最多 16 KB；拼接后的消息最多 10,000 字节。通知接口不支持图片、群发、任意接收人或定时调度。日报的调度由调用方完成；聊天自动回复由后台监听器独立处理，不改写通知正文。

```bash
curl --request POST 'https://yinlubin.cn/api/wechat/notify' \
  --header "Authorization: Bearer $WECHAT_NOTIFY_API_KEY" \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: news-2026-11-12-morning' \
  --data '{"title":"今日资讯","content":"这里是正文","type":"日报","time":"2026-11-12 09:00:00"}'
```

## 返回契约

微信接口明确返回 `ret: 0` 才返回 HTTP **202**：

```json
{
  "schemaVersion": 1,
  "status": "accepted",
  "requestId": "请求编号摘要",
  "acceptedAt": "2026-11-12T01:00:00.000Z",
  "deduplicated": false
}
```

`accepted` 表示微信上游已接受，不代表手机已读或已确认送达。不能仅根据 HTTP 200、message_id 等其他字段推断成功。

同一 Idempotency-Key 和相同规范化内容重试时返回已存结果，`deduplicated: true`，不再发送。不同内容复用编号返回 409。未传此请求头时每次请求均作为新消息，无法避免调用方重试造成的重复。

失败返回 `{ schemaVersion: 1, status: "failed" | "unknown", code, error, requestId? }`。网络超时、断线及无法确认的响应使用 `unknown`，可能已发送，**不要自动换新编号重发**，应先核对微信。

| HTTP | 情况 | 处理 |
| --- | --- | --- |
| 400 / 413 / 415 | 请求格式、字段或长度错误 | 修正请求 |
| 401 | 通知密钥错误 | 核对独立通知密钥 |
| 409 | 缺少会话、重复编号冲突、请求已在处理中/结果未知 | 按错误说明处理 |
| 429 | 本服务限流或正在发送 | 稍后沿用同一编号重试 |
| 502 / 503 / 504 | 微信拒绝、响应异常、连接失败或配置不可用 | 依据 status/code 处理，勿无条件自动重发 |

本服务默认同一时刻最多发送一条、每分钟 10 条、上海日期每天 100 条；计数随 txserver 重启清零。这是本地保护，不是微信官方配额。请求日志持久化，因此重启后同编号也不会再次发送；未完成的记录返回 unknown，需人工核对。

## 连接状态

`GET https://yinlubin.cn/api/wechat/notify/status`，使用同一 Bearer Token。成功返回 `status: "completed"`、`channel`、`contextAvailable`、`listener`。listener 包含最近轮询状态、错误码和 checkedAt；旧时间戳不能视为当前在线。状态查询不测试发送，也不能证明接收端送达。

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

## 通道限制

微信 iLink 使用入站消息中的 context_token。长期不互动的会话可能拒绝主动推送；没有在此集成中得到验证的固定有效期或通用后台续期接口。遇到发送拒绝，先检查微信通道/凭证，必要时在微信向机器人发一条消息，再核对监听状态。`ret=-2` 不直接等同“会话过期”或“限流”。登录失效则需重新绑定。

协议依据：[腾讯 openclaw-weixin 协议](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)。此处只实现独立文本通知及必要的会话监听。

## 可选文字自动回复

`WECHAT_NOTIFY_AUTO_REPLY=true` 开启，复用服务端 `DEEPSEEK_API_KEY` 和 `DEEPSEEK_MODEL`（默认 `deepseek-flash`），直接调用 DeepSeek Responses API。

仅处理已绑定接收人在监听器启动之后发来的新文字消息，跳过历史消息、图片和其他用户消息。每条独立回答，不保留多轮聊天记录。正文会发送给 DeepSeek 生成回复，但本服务不把聊天正文写入文件或日志。此功能不访问账单、不运行命令、不调用工具；不经过 Claude Code、Hermes 或 cc-connect。

AI 自动回复有单独频率限制：每分钟最多 6 次、上海日期每天 60 次，重启清零；模型调用超时 25 秒，限制输出长度。模型失败或发送状态未知时不自动重试，也不另外发送错误提示。先保存入站游标再处理回复，所以进程崩溃时可能跳过当次回复；该取舍用于避免重启后重复回复。
