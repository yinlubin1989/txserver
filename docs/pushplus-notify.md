# 微信服务号推送

向「pushplus 推送加」发送通知。使用本服务专用的 Bearer 密钥。每条消息指定一个唯一编号，相同消息重试时沿用原编号和正文。

```bash
curl 'https://yinlubin.cn/api/pushplus/notify' \
  -H "Authorization: Bearer ${PUSHPLUS_NOTIFY_API_KEY}" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: my-agent:task-42:done' \
  --data '{"title":"任务完成","content":"报告已生成。"}'
```

只需填写 content（最多 3,000 字），title 可选。所有字段均为字符串。快讯可设 type 为 news。日报设 type 为 daily，会附上公开日报网页，语音在后台生成。可选 source 标记来源，time 显示时间，reportDate 仅用于日报（YYYY-MM-DD）。

HTTP 202 且 status 为 accepted 表示服务号推送已受理。若超时或 status 为 unknown，保留原编号，勿另建编号重发。有 requestId 时可用相同鉴权查询记录。

GET https://yinlubin.cn/api/pushplus/notify/requests/<requestId>
