# 已保存账单与分享

统计接口继续负责识别和整数分计算；本模块只在用户点击保存后持久化完整结果快照。打开账本、历史账单或分享页不调用 AI，也不再次计算或改变已保存口径。金额、有效明细、包含关系和警告等级保留原值。

## 身份与数据范围

第一版为**当前设备账本**，无需登录。小程序首次保存/打开账本时创建随机 256 位设备凭证，在当前微信设备持久保存；服务端仅保存凭证的 SHA-256。所有私有接口须传 `Authorization: Bearer <session.token>`，按凭证哈希隔离账单。不能把 `bill.id`、客户端 userId 或分享标识当作所有权凭证。

换手机、清理小程序本地存储或丢失设备凭证后不能恢复原账本；第一版没有账号绑定或跨设备同步。遇到 401 不应自动新建并冒充原账本恢复成功。

分享是独立的随机 256 位能力标识，仅能读取对应的一张不可变结果快照。只有主人可以生成分享标识；公开期间复用；切回私有时撤销，重新公开分享会生成新标识。分享接收响应不包含原始 `text` 全文、设备凭证、所属账本或其他账单；结果明细原有 `source` 依据随结果保留。拥有分享链接的人可阅读该张账单；私有账单与已删除账单不可通过分享接口读取。公开指链接可读，不提供公开广场。已打开页面的内容无法远程抹除，但再次加载时会检查权限。

## HTTP 契约

成功均含 `schemaVersion: 1`、`status: "completed"`，不能根据非空对象推断成功。失败均为 HTTP 4xx/5xx 和 `{ "status": "failed", "code": "...", "error": "中文提示" }`。所有响应 `Cache-Control: no-store`。

| 方法与路径 | 请求 | 成功内容（省略公共字段） |
| --- | --- | --- |
| `POST /api/finance-ledger/session` | 无认证、空 body | HTTP 201，`{ session: { token } }` |
| `POST /api/finance-ledger/bills` | Bearer；`{ report, text, clientRequestId }` | HTTP 201 首次 / 200 幂等重试，`{ bill: { id, createdAt, report, text, visibility } }` |
| `GET /api/finance-ledger/bills?cursor=...` | Bearer；首屏省略 cursor | `{ bills: [{ id, createdAt, period, totals, reviewCount, visibility }], nextCursor }` |
| `GET /api/finance-ledger/bills/[id]` | Bearer | `{ bill: { id, createdAt, report, text, visibility } }` |
| `POST /api/finance-ledger/bills/[id]/share` | Bearer；空 body；明确授权公开分享 | 原子设为公开并生成/复用标识，`{ share: { token } }` |
| `PATCH /api/finance-ledger/bills/[id]` | Bearer；仅 `{ visibility: "private" 或 "public" }` | `{ bill: { id, visibility } }` |
| `DELETE /api/finance-ledger/bills/[id]` | Bearer | `{ bill: { id, deleted: true } }`；重复删除幂等 |
| `GET /api/finance-ledger/shared/[token]` | 无认证 | `{ bill: { id, createdAt, report } }` |

- `id` 为 24 位小写十六进制；设备和分享 token 分别为 64 位小写十六进制。它们用途不同，不能互换。
- `createdAt` 是服务端 ISO 8601 UTC 保存时间，仅用于保存时间显示；不作为账单年份。`period.year === null` 时继续只显示月份。
- `report` 必须是现有统计接口完整成功响应（含零金额五类支出、完整明细与警告）。不接受前端格式化金额或省略的字段。
- `text` 为原始记账文案，非空且不超过 20,000 字符。完整保存请求最多 1 MiB，按实际流字节计数，不能靠 Content-Length 绕过。
- `clientRequestId` 为 8–100 位字母、数字、`_`、`-`。同一统计结果每次重试复用同一标识。相同 owner＋标识＋内容只保存一次；同标识内容变化返回 HTTP 409 / `IDEMPOTENCY_CONFLICT`。修改原文重新统计需生成新标识。
- 金额快照不可变；可切换可见性、删除。新账单 `visibility: "private"`。`visibility` 是明确状态字段，客户端不可从分享标识或其他字段猜测。私有切换同时清空分享标识，再公开不会恢复旧链接。删除采用带时间戳的逻辑删除，所有列表/详情/分享查询均排除；保留幂等墓碑和原记录，不提供用户恢复入口，迟到的相同保存请求返回 410 / `BILL_DELETED`，不复活账单。重复点击“保存并分享”先确认保存成功，再调用分享端点。取消微信分享不会撤销已保存账单。
- 列表每页 20 条，按 `createdAt DESC, id DESC` 排序；`nextCursor` 为 opaque 字符串或 `null`，客户端原样传回，不自行解码。不同 owner 的 cursor 不能突破 owner 查询条件。
- `reviewCount` 只统计 `warnings[].severity === "review"`，普通差异说明不升级严重程度。
- `UNAUTHORIZED` 为 401；不存在和不属于当前设备的账单统一返回 404 / `BILL_NOT_FOUND`；服务/数据库异常统一 503 / `LEDGER_UNAVAILABLE`，不返回内部错误。

## 校验与存储

`validation.ts` 严格检查已完成状态、字段完整性、日期有序唯一、数量与单位、警告等级及 safe integer 范围；使用 BigInt 对分币乘法、有效明细求和、利润、每日/月度/分类金额关系作精确校验。包含项不再入账，负收入、负支出、负利润依照现有统计契约保留。不对模糊字段猜测，不用名称或原文重新解析金额。

`service.ts` 负责身份、快照和分享；`storage.ts` 沿用 `connectDB`，创建 `FinanceLedgerSession`、`FinanceLedgerBill` 模型，保存在专属集合。写入前等待索引就绪，`ownerHash + clientRequestId` 唯一索引保证并发幂等，独立唯一分享索引保证能力标识唯一。查询设置 10 秒 maxTimeMS。测试使用替代存储，不访问远程数据库。

## 调用限制

| 环境变量 | 默认 |
| --- | --- |
| `FINANCE_LEDGER_IP_MINUTE_LIMIT` | 120（全部账本请求） |
| `FINANCE_LEDGER_SESSION_IP_DAILY_LIMIT` | 20 |
| `FINANCE_LEDGER_SESSION_DAILY_LIMIT` | 200（全局） |
| `FINANCE_LEDGER_WRITE_MINUTE_LIMIT` | 30（每设备凭证） |
| `FINANCE_LEDGER_WRITE_DAILY_LIMIT` | 200（每设备凭证） |

沿用 `FINANCE_TRUST_PROXY=true` 时的 `X-Real-IP` 约定：上线前反向代理必须覆盖该请求头，并禁止直接访问 Node 端口。未启用信任时共享 IP 配额。计数为单进程内存；每日在上海午夜重置，服务重启清零。计数表有容量上限，满时返回 429。失败日志只含模块名和错误码，不记录 token、原文、结果、数据库错误文本或分享路径。

启动首次访问时将旧记录中缺失的 visibility 显式迁移：已有分享标识为 public，其余为 private；只处理缺失字段，不覆盖用户选择。先部署服务端及 Mongo 索引，再发布小程序。现有 Mongo 配置由项目管理，本模块不复制凭证。

## 验证

```sh
node --test lib/financeLedger/*.test.mjs
npx eslint lib/financeLedger app/api/finance-ledger
npx tsc --noEmit --incremental false
```

测试覆盖真实整月快照、owner 隔离、匿名凭证哈希、分享字段边界、幂等与内容冲突、存储失败、分页、不合法金额与结构、包含项、负金额、请求体上限、限流及上海午夜重置；不访问 AI 或远程数据库。部署后的真实 Mongo 保存/查询/索引与手机微信分享仍需端到端验证。
