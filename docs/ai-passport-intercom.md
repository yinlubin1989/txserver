# AI Passport 对讲中继与后台管理

本页记录跨地 Wi-Fi 对讲的中继入口、私有统计面板和运维方式。当前统计版仅修改服务端，现有设备无需更新固件即可计入统计。

## 1. 服务入口

| 用途 | 地址或配置 |
| --- | --- |
| 设备中继地址 | `wss://intercom.yinlubin.cn/v1/intercom` |
| 管理平台 | [对讲运营台](https://intercom.yinlubin.cn/admin/) |
| 管理员账号 | `admin` |
| 健康检查 | `https://intercom.yinlubin.cn/health` |
| 公共帮助页 | `https://intercom.yinlubin.cn/` |
| 中继协议 | v2，兼容旧版 v1 房间配对 |

管理密码不放在文档或 Git 中。私有配置保存在服务器 `/etc/ai-passport-intercom-relay.env`；本地访问凭据保存在 `/Users/yinlubin/Github/ai-passport/relay/.admin-access.txt`，该文件已被 Git 忽略。变更密码后应同步更新两处配置，重启中继后重新登录面板。

## 2. 设备联网与对讲

两台设备可处于不同地点，分别连接自己的 2.4 GHz Wi-Fi，但必须使用同一个中继地址。

- **随机模式**：只有主动选择随机模式的在线设备会进入随机匹配队列。
- **在线列表**：展示可邀请的在线设备匿名 ID；选择对方后发出邀请，对方接受后接通。
- **按键对讲**：同一时刻只有一方可以发言，按住说话、松开结束；单次发言最多 60 秒。
- **旧版 v1**：继续使用相同房间密钥配对；v2 不使用房间密钥。

中继地址中的 `/v1/intercom` 是兼容入口路径，并不表示当前只能使用 v1 协议。正常退出通话或断开连接后，新版设备需要重新选择模式。

## 3. 后台统计

面板每 15 秒刷新一次，可手动刷新，并提供最近 7 天或 30 天的使用趋势。

| 统计项 | 计数口径 |
| --- | --- |
| 当前在线设备 | 已成功完成协议加入、尚未断开的连接；仅握手成功不计为设备上线 |
| 今日上线次数 | 当天成功加入的次数，设备重连另计一次 |
| 今日通话次数 | 两人成功配对计为一次；邀请尚未接受不计为通话 |
| 通话持续时间 | 从配对成功到退出或断线的时间，包含静默和等待 |
| 实际发声时长 | 成功转发的音频帧数量乘以 20 毫秒，不代表终端一定播放成功 |
| 发言次数 | 获准抢麦的次数，即使随后没有音频也计一次 |
| 历史在线情况 | 过去 24 小时每分钟在线峰值；未采样区间显示空缺 |
| 设备上线明细 | 匿名 ID、协议版本、上线时间、离线时间、在线时长和状态 |
| 通话明细 | 双方匿名 ID、配对方式、开始与结束时间、持续时长、语音时长和发言次数 |

设备没有账号体系。面板里的“上线”相当于设备连接中继，不能据此识别用户姓名或统计独立用户人数。ID 会随连接变化；旧版设备也会得到统计专用的匿名 ID，不保存设备 MAC、IP 或房间密钥。

时间统一采用北京时间（Asia/Shanghai），每日连接和通话按开始日期归入当天。统计从 2026 年 10 月 9 日启用本版后开始，不能追溯此前的使用情况。

当前不保存语音录音、转写文本或聊天内容，音频仅在内存中即时转发。

## 4. 数据保存与登录保护

- 上线和通话明细各最多保留 10,000 条，默认保留 30 天；正在进行的记录会保留。
- 在线历史默认保留 30 天，面板展示其中最近 24 小时。
- 每日汇总计数独立于明细条数限制；累计上线与通话次数不会因清理历史而减少。
- 数据异步写入并原子替换，通话中的音频计数每分钟保存一次。
- 正常重启会结束当前记录；异常退出时，以下次启动读取到的最后保存时间估算结束时间，并标记 `restart_unknown`，界面显示近似时间。
- 管理会话十二小时过期，退出登录或重启中继后失效。统计接口需要管理员会话，公共健康检查不返回统计数据。
- 存储写入失败时，面板会提示；应检查磁盘空间和统计目录权限。

## 5. 当前部署位置

| 项目 | 位置或名称 |
| --- | --- |
| 云服务器 | 腾讯云 `82.157.107.78`，通过已配置的 SSH Key 登录 |
| 服务代码 | `/opt/ai-passport-intercom-relay` |
| systemd 服务 | `ai-passport-intercom-relay.service` |
| 运行账号 | `intercom-relay` |
| 内部监听 | `127.0.0.1:18089`，不直接开放到公网 |
| Node 运行文件 | `/opt/ai-passport-intercom-relay/node` |
| 统计目录 | `/var/lib/ai-passport-intercom-relay` |
| 统计文件 | `/var/lib/ai-passport-intercom-relay/analytics.json` |
| 私有环境配置 | `/etc/ai-passport-intercom-relay.env` |
| 服务附加配置 | `/etc/systemd/system/ai-passport-intercom-relay.service.d/analytics.conf` |
| Nginx 配置 | `/etc/nginx/conf.d/intercom-relay-acme.conf` |
| TLS 证书目录 | `/etc/letsencrypt/live/intercom.yinlubin.cn/` |
| 本地代码 | `/Users/yinlubin/Github/ai-passport/relay` |

Nginx 负责公网 HTTPS/WSS；中继进程由 systemd 管理，与主站的 PM2 `txserver` 进程分开。

### 查看状态与日志

```sh
ssh root@82.157.107.78
systemctl status ai-passport-intercom-relay.service --no-pager
journalctl -u ai-passport-intercom-relay.service -n 80 --no-pager
curl -fsS http://127.0.0.1:18089/health
```

### 重启中继

```sh
systemctl restart ai-passport-intercom-relay.service
systemctl is-active ai-passport-intercom-relay.service
```

重启会中断当时的对讲，并使管理会话失效。设备需要重连，管理页面需要重新登录；统计文件会保留。

### 保存统计备份

备份 `analytics.json` 或整个统计目录，备份文件保持私有。不要把统计文件、环境配置、管理密码或私钥上传到公共文档或 Git。恢复时保留统计目录归属 `intercom-relay`，目录权限 `0700`、文件权限 `0600`。

## 6. 检查接口

### 健康检查

- 方法：`GET`
- 地址：`https://intercom.yinlubin.cn/health`
- 认证：无
- 成功状态码：`200`

```json
{"status":"ok","protocol":2}
```

```sh
curl -fsS https://intercom.yinlubin.cn/health
```

### 管理统计接口

- 方法：`GET`
- 地址：`https://intercom.yinlubin.cn/admin/api/overview`
- 认证：通过登录页建立的管理员 Cookie 会话
- 参数：`days`（1～90，默认 7）、`connectionPage`、`callPage`（从 0 开始，每页 25 条）
- 成功状态码：`200`
- 未登录或会话失效：`401`，返回 `{"error":"unauthorized"}`
- 参数非法：`400`，返回 `{"error":"invalid_query"}`

响应包含 `summary`（当前在线、通话及累计/今日汇总）、`daily`（每日趋势）、`history`（最近 24 小时在线采样）、`connections` 与 `calls`（分页明细），以及保存状态 `persistence`。`persistence` 为 `ok` 表示持久化正常，`memory` 表示只在内存中保存，`error` 表示写入失败。生产环境应为 `ok`。

日常查看使用网页面板即可。不要通过链接参数传递管理密码，也不要把管理员会话 Cookie 放入公共示例。
