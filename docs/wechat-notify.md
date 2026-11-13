# 微信推送接口规范

任何应用都可按此规范向已绑定的微信会话推送消息。不支持指定收件人或群发。

<h2 id="notify-api-key">接口密钥</h2>

Token / API Key：

<pre><code data-wechat-notify-key>正在读取接口密钥…</code></pre>

完整请求头：

<pre><code data-wechat-notify-header>正在读取 Authorization 请求头…</code></pre>

## 1. 请求地址

```text
POST https://yinlubin.cn/api/wechat/notify
Content-Type: application/json
Authorization: Bearer <接口密钥>
Idempotency-Key: <本条消息的唯一编号>
```

建议始终传 `Idempotency-Key`：1–128 位字母、数字或 `_.:-`；同一条消息重试时保持不变，不同消息使用不同编号。

## 2. 消息行为

| type | 行为 |
| --- | --- |
| `daily` | 发送文字和日报网页链接；后台自动生成原文朗读，网页可播放 |
| 其他值或省略 | 直接发送文字；不生成网页、图片或音频。普通通知建议用 `text`，快讯用 `news` |

**仅 `type` 决定行为，`source` 和标题不参与判断。** `daily` 必须使用小写英文；测试日报也填 `daily`，在标题注明“测试”即可。

日报网页公开可见。语音生成不阻塞文字发送；不搜索、不改写原文，朗读时略过网址。推送时间由调用方安排，接口不负责定时。

## 3. 请求字段

| 字段 | 必填 | 规则 |
| --- | --- | --- |
| `content` | 是 | 消息正文，非空，最多 3,000 字符 |
| `title` | 否 | 标题，最多 120 字符，仅用于展示 |
| `type` | 否 | 消息类型，最多 40 字符，行为见上表 |
| `source` | 否 | 自定义来源标识，如 `my-app`；1–40 位字母、数字、`_` 或 `-`，统一存为小写。仅作来源标签；省略时日报来源记为 `external` |
| `time` | 否 | 展示时间，最多 80 字符，不表示定时发送 |
| `reportDate` | 否 | 仅 `daily` 可用，有效的 `YYYY-MM-DD`；省略时采用收到请求当天的上海日期 |

仅接受以上字段，值均为字符串；可选字段不用时省略，不传 `null`。请求 JSON 上限 16 KB；排版后的文字普通消息上限 10,000 字节，日报正文上限 9,700 字节，为链接预留空间。

## 4. 调用示例

```bash
curl 'https://yinlubin.cn/api/wechat/notify' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <接口密钥>' \
  -H 'Idempotency-Key: my-app-daily-20261113-01' \
  --data '{
    "source": "my-app",
    "type": "daily",
    "title": "每日简报",
    "content": "第一条简报内容。\n第二条简报内容。",
    "reportDate": "2026-11-13"
  }'
```

发快讯时将 `type` 改为 `news`，去掉 `reportDate`。更换调用应用只需修改 `source`，无需修改服务端。

## 5. 返回结果

微信上游明确接受请求时返回 HTTP 202：

```json
{
  "schemaVersion": 1,
  "status": "accepted",
  "requestId": "请求编号",
  "submittedAt": "2026-11-13T01:00:00.000Z",
  "deduplicated": false,
  "report": {
    "id": "日报编号",
    "url": "https://yinlubin.cn/news/日报编号",
    "status": "queued",
    "audioStatus": "pending"
  }
}
```

`report` 仅在已创建日报网页时返回。微信投递与语音生成分别记录；有网页或语音不代表微信送达。

| 顶层 status | 含义与处理 |
| --- | --- |
| `accepted` | 微信接口已接受，不代表手机已读；不要重复发送 |
| `submitted` | 已提交但微信未给明确确认；不要自动重发 |
| `unknown` | 发送结果不明，可能已经送达；先查询或核对微信，不要换编号重发 |
| `failed` | 请求失败，查看 `code`、`error` 修正问题 |
| `initializing` | 状态查询发现发送前初始化中断；仅当 `retryable: true` 时可用原编号、原内容重试 |

日报 `report.status` 通常为 `queued → processing → completed`，失败为 `failed`；`idle`、`partial` 是历史状态。音频以 `audioStatus` 为准：`pending` 生成中、`ready` 可播放、`failed` 失败，`not_requested` 为旧记录等待迁移。生成失败仍保留原文，不自动重新生成。

## 6. 查询与重试

以下查询使用同一个 `Authorization` 请求头：

```text
GET https://yinlubin.cn/api/wechat/notify/requests/<requestId>
GET https://yinlubin.cn/api/wechat/notify/status
```

前者查询该条消息及日报状态；后者查看微信通道状态，不能证明消息送达。

同一编号、相同内容返回已有结果，`deduplicated: true`，不会重复发送或生成。相同编号换内容返回 **409**。未传编号则每次都是新请求。

常见错误：**400 / 413 / 415** 参数或格式不正确；**401** 密钥不正确；**409** 会话不可用、编号冲突或结果待确认；**429** 忙碌或限流；**502 / 503** 微信上游或服务异常。以 JSON 的 `status`、`code` 为准，网络超时或网关错误不代表未发送。

默认每分钟最多 10 次、上海日期每天 100 次，同时处理 1 个发送请求。遇到限流，稍后使用原编号重试；发送已进入终态的记录不会因重试而重发。
