# Mihomo 代理服务使用文档

本文档记录服务器上 Mihomo（Clash Meta）代理服务的安装与使用方法，配合 Mihomosh 命令行工具进行订阅管理、节点切换和代理出口。

## 服务概览

| 项目 | 值 |
|------|-----|
| 代理内核 | Mihomo（Clash Meta）`v1.19.33` |
| 管理工具 | Mihomosh `v2.3.2` |
| 内核二进制 | `/usr/local/bin/mihomo` |
| 管理工具二进制 | `/usr/local/bin/mihomosh` |
| 配置目录 | `/etc/mihomo/`（主配置 `config.yaml`） |
| systemd 服务 | `mihomo.service` |
| HTTP 代理端口 | `7890`（仅监听本机） |
| 外部控制 API | `http://127.0.0.1:9090` |
| Mihomosh 配置 | `~/.local/share/mihomosh/config.yaml` |

> 说明：Mihomosh **不包含** Mihomo 内核，两者是分开安装的。Mihomo 负责代理转发，Mihomosh 负责订阅/节点管理。

## 服务管理

```bash
# 启动 / 停止 / 重启
systemctl start mihomo
systemctl stop mihomo
systemctl restart mihomo

# 查看状态
systemctl status mihomo

# 查看实时日志
journalctl -u mihomo -f
```

systemd 服务通过 `-ext-ctl 127.0.0.1:9090` 强制开启外部控制 API，Mihomosh 依赖该 API 来控制和重启内核。

## 订阅管理（核心流程）

Mihomosh 通过「订阅（profile）」管理机场节点。常见类型：

- `remote`：远程订阅链接（机场订阅）
- `local`：本地配置文件

### 1. 查看 Mihomosh 配置

```bash
mihomosh config view
mihomosh config edit        # 修改 mihomo-path / mihomo-api 等
```

默认配置已将 `mihomo-path` 指向 `/etc/mihomo/config.yaml`，`mihomo-api` 指向 `http://127.0.0.1:9090`，HTTP 端口为 `7890`，一般无需修改。

### 2. 新增订阅

```bash
mihomosh profile create
```

命令会打开编辑器（默认 `nano`，可用 `-e vim` 指定），填写订阅信息后保存：

```yaml
# Profile name (REQUIRED)
name: 机场名称

# Profile type (REQUIRED; One of `remote` or `local`)
type: remote

# Profile URL (Required when type is `remote`)
url: https://你的机场订阅链接

# Proxy for updating (One of `none`, `system` or `mihomo`)
proxy: none
```

### 3. 更新订阅

```bash
mihomosh profile update            # 更新所有订阅
mihomosh profile update <名称>     # 更新指定订阅
```

### 4. 激活订阅

```bash
mihomosh profile activate <名称>   # 激活指定订阅，生成 mihomo 配置并重启内核
mihomosh profile activate          # 重新激活上次激活的订阅
```

激活后 Mihomosh 会把订阅中的节点、规则写入 `/etc/mihomo/config.yaml`，并自动重启 Mihomo 使其生效。

### 5. 其他订阅命令

```bash
mihomosh profile list              # 列出所有订阅
mihomosh profile view <名称>       # 查看订阅内容
mihomosh profile delete <名称>     # 删除订阅
```

## 节点选择与测试

```bash
mihomosh proxy view                # 查看所有节点
mihomosh proxy test                # 测试所有节点延迟
mihomosh proxy update              # 交互式选择节点
```

## 使用代理

代理默认只监听本机 `127.0.0.1:7890`（HTTP），让其他命令走代理：

```bash
# 临时环境变量（当前 shell 会话）
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890

# 单次命令走代理，例如让 codex 走代理
HTTPS_PROXY=http://127.0.0.1:7890 codex login
```

## Mihomo 控制

```bash
mihomosh control restart           # 重启内核
mihomosh control update-geo        # 更新 GEO 数据库
mihomosh control flush-cache       # 清理 fake-ip 缓存
```

## 查看运行状态

```bash
mihomosh inspect                   # 查看运行时信息（内存、流量、日志等）
```

## 常见问题

- **修改订阅后未生效**：先 `mihomosh profile update` 再 `mihomosh profile activate`。
- **无法写入配置**：Mihomosh 与 Mihomo 都需以 root 运行，否则可能无权限写入 `/etc/mihomo/config.yaml`。
- **API 连接失败**：确认 mihomo 服务已启动（`systemctl status mihomo`），且控制 API 在 `127.0.0.1:9090`。
- **节点全部超时**：先确认机场订阅是否过期，再 `mihomosh proxy test` 测延迟换节点。
