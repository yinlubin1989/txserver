# 收支统计

服务端环境配置：`DEEPSEEK_API_KEY`（必填）、`DEEPSEEK_MODEL`（默认 deepseek-flash）。不要使用 NEXT_PUBLIC_ 前缀。

接口 POST /api/finance-statistics，JSON 请求 `{ "text": "原始账目" }`。成功返回 schemaVersion=1、status=completed、period（year可null）、dailyRows、totals、breakdown、warnings。每日及合计金额均为安全整数分；details中included=true的项目仅供说明，已经包含于其他支出。失败使用HTTP 4xx/5xx及 `{status:"failed",code,error}`，不得视为零金额统计。

每条 `dailyRows[].details` 保留既有 `label/category/amountCents/source/included`，增加 `unitPriceCents: number | null`、`quantity: number | null`、`quantityUnit: string | null`。三者分别保留原文事实，数量未知不会通过金额除以单价补齐；单位未知不会默认填“束”。只有单价和数量都已知时才用代码乘法核算金额。

`breakdown` 是同一批有效明细的服务端汇总，不额外调用模型：

```json
{
  "incomeByPrice": [
    { "unitPriceCents": 36800, "quantity": 190, "quantityUnit": "束", "amountCents": 6992000 }
  ],
  "unclassifiedIncomeCents": 0,
  "expenses": [
    { "category": "redPacket", "amountCents": 1066000 },
    { "category": "purchase", "amountCents": 1377370 },
    { "category": "commission", "amountCents": 0 },
    { "category": "supplies", "amountCents": 29108 },
    { "category": "other", "amountCents": 0 }
  ]
}
```

上述 `incomeByPrice` 仅展示一个价格档示例；真实响应返回所有价格档。价格档按“单价＋单位”分组，按销量降序、金额降序、单价升序、单位顺序排序。未知单位 `null` 是独立分组。只有金额或缺少单价/数量的收入进入 `unclassifiedIncomeCents`。支出固定返回红包、进货、提成、耗材、其他五类，包括零值；前端可隐藏零值行。完全重复记录和已包含费用不会重复进入分类汇总。价格档金额＋未分类收入严格等于总收入，五类支出金额严格等于总支出。

接口为 `schemaVersion=1` 的追加字段更新；先更新服务端，再发布依赖 `breakdown` 的小程序。抽取 fixture 的 `quantityUnit` 根据各条原文证据补齐，未重新请求模型。

可配置限额：FINANCE_IP_MINUTE_LIMIT=3、FINANCE_IP_DAILY_LIMIT=20、FINANCE_DAILY_LIMIT=100、FINANCE_MAX_CONCURRENT=2。当前采用单进程内存计数，服务重启会清零，上海自然日重置。未信任代理时全部请求共享客户端额度。

上线前：Nginx必须覆盖 X-Real-IP（使用 $remote_addr），阻止公网直接访问Node端口，确认后才设置 FINANCE_TRUST_PROXY=true。此接口proxy_read_timeout至少60秒。小程序后台将 https://yinlubin.cn 配为合法request域名，并按微信平台要求申报剪贴板使用。配置Key后用整月样例重复测试识别输出和45秒时限。

运行领域和接口测试：`node --test lib/financeStatistics/*.test.mjs`。仅运行测试不会调用模型。原文和结果不写入数据库或日志。


## 花店提成与红包规则

提成核对与补算由 `commissionPolicy.ts` 在完全重复记录去重、同日记录合并后执行，安全整数分运算集中在 `money.ts`。固定默认规则是 288 元／束提成 40 元／束、368 元／束提成 60 元／束，不根据旧账中的金额规律自行变更。

- 当天有已填写的红包金额（包括明确的 0，以及原文单价×数量可计算的红包），该金额为实际提成支出。当天所有注明提成都仅作核对明细，`included=true`，不再次计入支出。默认规则金额仅用于核对，不替换原文红包。
- 当天没有红包金额（字段缺失项目或金额留白），按实际销售明细补算默认提成，另加明确对应特殊价格销售的原文提成。标准价位的明确提成替代该笔默认值。纯支出日、明确非“束”商品不会被补造默认花束提成。
- 仅写“提成15元”代表该条总提成15元，不乘销量；只有原文明示“每束提成15元”或“提成15元/束”才由代码乘以对应销售数量。提成已包含于其他明确费用时仍排除重复，并替代该笔默认提成。
- 没有红包且部分提成缺信息时，仍返回统计结果：已知默认规则和明确提成照常计算，特殊价未写提成、未知数量或单位等部分暂不计入，用带日期的 `review` 备注说明缺项及“支出可能偏低、利润可能偏高”。只有收入合计也可统计，不反推销量。已有红包但无法完整核对时仍按红包入账，仅给 `info`。
- 标准价销售的关联提成留白时使用默认值，明确的 0 仍优先于默认值；已有明确关联提成、同时另有留白提成时只计已知金额，不再叠加默认值。没有红包但存在无法归属的已知提成时，保留原文提成，为免重复暂停未覆盖销售的默认补算，并给 `review` 说明；原文明示已包含于其他支出的提成也不重复加算。
- 原文“不含提成／提成另计”等与“当天红包包含全部提成”的固定业务规则冲突时，先按原文红包作为实际总提成计账，已注明提成不再叠加；用 `review` 明确冲突及当前处理。模型字段格式、原文数字依据、非法关联、包含关系和数值范围校验仍保留，不能把模型漏抽或伪造数字当成留白。

抽取 Schema 增加必填 `commissionFor: string | null`。仅 commission 可填写同条 record 内的 income id，其 source 必须覆盖关联销售的完整 source 和提成表述；其他项目填 null。不允许跨 record 引用，也不允许靠同名 id 关联不同记录。每束提成使用既有 `unitPrice/quantity/quantityUnit` 字段，数量须等于关联销售的原文数量；模型不能生成默认提成或计算金额。

响应保持 `schemaVersion: 1`、`status` 和原字段，追加：

- 所有 `details[]`：`accountingNote: string | null`，解释排除或补算原因。默认规则产生的包含关系写“已包含于当日红包”，不伪称“原文明示”；推导提成的 `source` 保留对应销售原文。
- 所有 `dailyRows[]`：`commissionCheck: null | { status: 'matched' | 'mismatch' | 'incomplete' | 'inferred', message: string }`。message 展示代码计算公式、原文红包和差额，或不能完整核对的原因。
- 顶部 `warnings` 汇总普通红包核对差异和完整补算说明；影响暂计费用的缺项或规则冲突逐日返回 `review`，包含日期、缺项和处理方式。强提示不再重复计入普通说明汇总。逐日细节仍在 `commissionCheck` 中展示。

已确认的新样例口径：25 天收入 80,798.00 元、支出 **24,724.78 元**、利润 **56,073.22 元**；显式提成 230.00 元已包含于红包 10,660.00 元，不重复入账。24 天规则核对不符；10 月 3 日特殊价 260 元花束未注明提成，为核对不完整，不能假定其提成为 0。10 月 28 日按 7×60＋1×40＋15 核对为 475 元，但实际红包395元为准：当日支出1,533元、利润1,499元。去掉该日红包后补算475元：支出1,613元、利润1,419元。

## 统计说明的提示级别

每条 `warnings[]` 返回必填字段 `{ code: string, date: string, message: string, severity: 'review' | 'info' }`。`date` 可为空（多日合并说明），`code`、`message` 非空。前端严格使用 `severity` 分组，不从文案、错误码或提成核对状态猜测级别；缺失或非法级别视为接口格式异常。服务端先更新、小程序随后更新。

- `review`：有效计账项的原文行金额与单价×数量矛盾（`ITEM_MISMATCH`），收入合计与明细不符，或无红包时提成缺项、提成无法归属、红包包含规则与原文冲突（`COMMISSION_INCOMPLETE`）。提示必须写清当前处理和需要核对的日期/项目，提醒当前结果为暂计；不能确定的特殊提成不假称明确为 0。
- `info`：已有明确处理方式的说明，在概览后用浅灰卡展示。包括留白按0、完全重复记录去重、原文包含关系、小计按明细重算，以及红包核对差异、已填红包但无法完整核对提成、按已确认规则补算提成。被红包或其他费用包含、不会再计入合计的行金额冲突也仅为普通说明；分类在包含规则执行后确定。

最高级别用于可能影响当前入账的冲突或缺项，不因“出现说明”、金额大小或AI自报置信分数触发。完整十月样例保持全部 `info`，不会因24天红包核对差异触发强提示。没有强提示不代表已证明原文完全准确。`status: 'completed'` 表示已完成已知事实及约定默认规则的计算，费用完整性以 `warnings` 明示。数值溢出、非法抽取及服务失败仍返回 `status: 'failed'`。金额继续由代码按整数分计算。

无红包样例：8 月 25 日，368 元 6 束、288 元 1 束、328 元 1 束。收入 2,824.00 元；可确定默认提成 6×60＋1×40＝400.00 元；暂计利润 2,424.00 元。328 元花束提成尚未计入，在核对备注中逐日提示，不拒绝统计。
