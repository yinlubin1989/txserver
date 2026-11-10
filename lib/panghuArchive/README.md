# 胖虎ai 私有消息归档 API

客户端 API 不提供公开聊天页面、分享链接或匿名记录查询。超管页面必须登录独立管理员账号才能查看所有安装实例的归档。默认由客户端从用户开启归档后的新消息开始上传，不读取或回传历史聊天。

所有响应 `Cache-Control: no-store`。访问能力令牌是 32 个随机字节的 64 位小写十六进制字符串，只在创建时返回。客户端必须安全保存；服务端仅存 SHA-256，不记录原始令牌。令牌独立于 financeLedger，不能跨服务使用。知道令牌即可访问对应归档，请勿把令牌放入 URL、日志或公共文档。

## 接口

- `POST /api/panghu-archive/session`：`Content-Type: application/json`，请求体严格为 `{}`。成功 HTTP 201：`{"ok":true,"session":{"token":"<64hex>"}}`。
- `POST /api/panghu-archive/records`：`Authorization: Bearer <token>`，请求体 `{ "records": [CloudMessage] }`，每批 1–50 条，JSON UTF-8 总大小不超过 2 MiB。成功 HTTP 200：`{"ok":true,"acceptedIds":["<id>"]}`，顺序与请求一致。
- `GET /api/panghu-archive/records?cursor=<opaque>`：相同 Authorization。仅允许单个可选 cursor 参数，固定每页最多 50 条。HTTP 200：`{"ok":true,"records":[ArchivedMessage],"nextCursor":null}`；有后续页时 nextCursor 是非空字符串。按服务端 archivedAt、记录 id 倒序分页；时间相同用 id 稳定排序。获取期间新到记录应重新从第一页读取。

所有错误都是 `{ "ok": false, "code": "<code>", "error": "<safe message>" }`。**records POST 的所有失败额外包含 `acceptedIds: string[]`**，尚未开始写入时为空数组。401 `UNAUTHORIZED`；400 `INVALID_RECORD` / `INVALID_JSON` / `INVALID_CURSOR` / `INVALID_QUERY`；413 `BODY_TOO_LARGE`；415 `UNSUPPORTED_MEDIA_TYPE`；429 `RATE_LIMITED`；409 `IDEMPOTENCY_CONFLICT`；503 `ARCHIVE_UNAVAILABLE`。

批次逐条持久，不依赖 MongoDB 副本集事务。服务端先校验整批结构，然后按请求顺序写入。中途失败，acceptedIds 只含已明确持久成功的前缀，后面的记录不再尝试。客户端只能确认该前缀；其余记录保持原始 id 和完整内容重试。数据库提交成功但响应丢失时，可能已存入而没有返回 acceptedIds；幂等重试可以安全确认。409 的冲突记录需要人工/客户端修正 ID 生成问题，不能静默覆盖或无限重试。

## 记录契约

CloudMessage 必须恰好包含以下字段，不接受 owner、token、archivedAt 等额外字段，也不修改或裁剪输入正文：

| 字段 | 契约 |
| --- | --- |
| id | 64 位小写十六进制字符串；客户端稳定计算 `SHA256(JSON.stringify([profile, source, sourceId]))` |
| profile | 非空字符串，最多 512 UTF-16 单元，精确钉钉账号标识 |
| direction | `incoming` 或 `outgoing` |
| source | `incoming`、`auto_reply`、`manual_reply`、`outbound` |
| peerId / peerName | peerId 非空，peerName 可空，各最多 256 UTF-16 单元；peerId 为原明确开放身份，peerName 只是显示名 |
| conversationId | 非空字符串最多 512，或 null；只有 outbound 允许 null |
| text | 字符串，可空，最多 64000 UTF-16 单元，不 trim、不截断；空文本不推断附件类型 |
| occurredAt | 规范 UTC ISO 时间，严格 `YYYY-MM-DDTHH:mm:ss.sssZ` |
| status | `received`、`sent`、`unknown` |
| sourceId | 稳定事件 ID 或发送任务 ID，非空字符串，最多 512 |

所有身份字段不接受首尾空白或 ASCII 控制字符。incoming 必须 source=incoming、status=received、有 conversationId。outgoing 必须 source 为后三种之一、status 为 sent 或 unknown。回复必须保留原 conversationId，主动消息可以 null。只提交最终观察到的记录；同一 id 的正文或状态不能更新。unknown 表示发送结果未知，归档不会重发钉钉消息。

ArchivedMessage 在 CloudMessage 上增加服务端 `archivedAt`（同样规范 UTC ISO 时间）。服务端不返回 ownerHash、contentHash、加密内容或令牌元数据。同一 owner+id 相同完整内容是幂等成功，不改变初次 archivedAt；不同完整内容为 409。不同 owner 可独立保存相同 id，完全隔离。

## 存储与密钥

复用 `lib/mongodb.ts` 的连接，独立 `PanghuArchiveSession` 和 `PanghuArchiveRecord` 模型。记录 `_id` 是 `[ownerHash,id]` 哈希，另建 ownerHash+id 唯一索引以及 ownerHash+archivedAt+id 分页索引。所有读写都显式带 ownerHash；不接受 body 中的所有者。

必须配置 `PANGHU_ARCHIVE_ENCRYPTION_KEY`：**精确 32 字节的规范 base64 字符串**。缺失、格式错误或旧数据无法解密均返回 503，不回退到明文。完整 CloudMessage 用 AES-256-GCM、随机 12 字节 IV、16 字节认证标签加密；AAD 绑定版本、ownerHash、id、archivedAt、contentHash。MongoDB 明文元数据为 ownerHash/id/contentHash/archivedAt、必要加密参数，以及用于管理员精确过滤的 profileHash、peerIdHash、occurredAt。两个身份索引是 SHA-256，原始身份与正文只存密文；解密时再次核对索引元数据。Session 只存 tokenHash 和创建时间。密钥存服务器私有环境配置，并与数据库分别备份；丢失后无法恢复正文，本版本不实现轮换。写入要求 majority+journal 确认且等待结果；重复写入仅在 majority 读取确认原记录后才返回已接受，不把超时后只在本地可见的写入当作成功。

独立限流使用最多 10000 项进程内计数器；重启会重置，多实例不共享计数。默认不信任客户端 IP 头；仅在可信反向代理覆盖 `X-Real-IP` 时可设 `PANGHU_ARCHIVE_TRUST_PROXY=true`。每 IP 每分钟 240 次；创建令牌每 IP 每 UTC 日 10 次、全局 200 次；写入每 owner 每分钟 60 批、每日 2000 批；查询每 owner 每分钟 120 次；管理员登录每 IP 每 15 分钟 5 次、全局 60 次。不得通过限流错误判断某条消息是否已经保存。

## 超管接口

另需服务器私有配置 `PANGHU_ARCHIVE_ADMIN_PASSWORD_HASH`（bcrypt，密码 UTF-8 最长 72 字节）和 `PANGHU_ARCHIVE_ADMIN_ORIGIN=https://yinlubin.cn`。Origin 必须是规范 HTTPS origin，不含末尾斜杠或路径。未配置返回 503，不存在默认密码。管理页面入口由独立的 `app/panghu-archive/admin` 实现，不在公共文档中嵌入聊天记录。

- `POST /api/panghu-archive/admin/session`：严格 `{ "password": "..." }`，成功 200 `{ "ok": true, "authenticated": true }`。只通过 Set-Cookie 返回能力，不在 JSON 返回 token。
- `GET /api/panghu-archive/admin/session`：已登录返回同样 JSON，未登录或过期返回 401。
- `DELETE /api/panghu-archive/admin/session`：撤销当前会话，成功 200 `{ "ok": true, "authenticated": false }` 并清 cookie。存储失败返回 503，不假报已撤销。
- `GET /api/panghu-archive/admin/records?cursor=...&profile=...&peerId=...&from=...&to=...`：仅管理员 cookie 授权；普通客户端 Bearer 令牌不能访问。返回 `{ "ok": true, "records": [ArchivedMessage & {ownerId:string}], "nextCursor": string|null }`。ownerId 是 ownerHash 的前 12 位展示摘要，不是原始 token，也不用于授权。profile/peerId 精确匹配；from/to 为规范 UTC 时间，按 occurredAt 两端包含过滤。只发送非空筛选；重复或未知参数返回 400。每页 50，按 archivedAt、内部存储 ID 倒序，cursor 绑定当前过滤条件；修改过滤必须清空 cursor。

Cookie 名 `panghu_archive_admin`，固定 `HttpOnly; Secure; SameSite=Strict; Path=/api/panghu-archive/admin; Max-Age=43200`。登录/退出必须带与配置完全相同的 Origin，否则 403 `FORBIDDEN_ORIGIN`；不接受缺失 Origin。管理员 token 只以 SHA-256 存独立 `PanghuArchiveAdminSession`，有效 12 小时；TTL 清理之外，每次访问也显式检查过期。普通归档 token 与管理员 cookie互不通用。管理员密码和 token 都不写日志、不放 URL，不存浏览器 localStorage。错误响应不包含已解密记录。数据库加密保护存储副本，经过身份验证的超管仍能按用户要求查看正文。

## 验证

`node --test lib/panghuArchive/*.test.mjs` 使用模拟存储和固定假密钥，不连接真实数据库、不发送钉钉消息。覆盖 owner 隔离、严格结构、大小/分页、加密与 AAD、防覆盖、并发幂等及批次部分成功。生产部署还需验证独立测试令牌的写入/重读，以及无令牌与不同令牌不可读取；样例只使用明确虚构消息。
