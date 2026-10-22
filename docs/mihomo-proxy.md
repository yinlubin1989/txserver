# Mihomo 代理服务使用文档

本文档记录服务器上 Mihomo（Clash Meta）代理服务的安装与使用方法。该服务用于让服务器上的程序（如 Codex CLI、gptcodex）通过代理访问 OpenAI 等服务。

## 服务架构

订阅是 base64 编码的节点列表（非 Clash YAML），mihomo 内核无法直接解码，因此引入 subconverter 做格式转换：

```
订阅 URL（base64 节点列表）
        │
        ▼
subconverter（127.0.0.1:25500）── 转成 Clash YAML
        │
        ▼
mihomo proxy-provider「dmit」── 每小时拉取一次，自动更新节点
        │
        ▼
代理端口 7890（HTTP + SOCKS）
```

## 服务概览

| 项目 | 值 |
|------|-----|
| 代理内核 | Mihomo（Clash Meta）`v1.19.33` |
| 订阅转换 | subconverter `v0.9.0` |
| 管理工具 | Mihomosh `v2.3.2`（用于节点查看/切换） |
| mihomo 配置 | `/etc/mihomo/config.yaml` |
| subconverter 配置 | `/opt/subconverter/pref.toml` |
| mihomo 服务 | `mihomo.service` |
| subconverter 服务 | `subconverter.service` |
| 代理端口 | `7890`（mixed，HTTP+SOCKS，仅监听本机） |
| 控制 API | `http://127.0.0.1:9090` |
| 订阅地址 | `sdk.dmitai.com`（已写入 subconverter 调用参数） |

## 服务管理

```bash
# mihomo（代理内核）
systemctl status mihomo
systemctl restart mihomo
journalctl -u mihomo -f

# subconverter（订阅转换）
systemctl status subconverter
systemctl restart subconverter
```

## 使用代理

代理监听本机 `127.0.0.1:7890`，让其他命令走代理：

```bash
# 临时环境变量（当前 shell）
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890

# 单次命令，例如 codex 登录
HTTPS_PROXY=http://127.0.0.1:7890 HTTP_PROXY=http://127.0.0.1:7890 codex login

# 测试代理是否通
curl -x http://127.0.0.1:7890 -sS -o /dev/null -w "%{http_code}\n" https://api.openai.com/v1/models
# 返回 401 即代表网络已通（缺 API key 属正常）
```

## 节点选择

节点分两类：

- **SS 节点**（名称带 `S`，如「新加坡-01 S」「美国-01 S」）：通用节点，可访问 OpenAI/ChatGPT。
- **trojan 节点**（名称带 `T`，SNI 为 `claude.1maxai.com`）：仅用于访问 Claude，访问 OpenAI 会被重置。

### 查看节点

```bash
# 方式一：mihomosh（连接 mihomo 控制 API）
mihomosh proxy view      # 列出所有节点
mihomosh proxy test      # 测延迟
mihomosh proxy update    # 交互式切换

# 方式二：直接调 API
curl -s http://127.0.0.1:9090/proxies/PROXY
```

### 切换节点

```bash
# 手动指定某个节点
curl -X PUT http://127.0.0.1:9090/proxies/PROXY -d '{"name":"美国-01 S 1.0x"}'

# 切回自动（AUTO 用 chatgpt.com 测速，自动选能访问 OpenAI 的节点）
curl -X PUT http://127.0.0.1:9090/proxies/PROXY -d '{"name":"AUTO"}'
```

`PROXY` 分组默认指向 `AUTO`，`AUTO` 用 `https://chatgpt.com` 做测速地址，因此重启后会自动选中能访问 OpenAI 的 SS 节点，claude 专用节点会被自动淘汰。

## 更新订阅

订阅节点会变化（机场定期换域名/节点），更新方式：

```bash
# 方式一：触发 mihomo 重新拉取 provider
curl -X PUT http://127.0.0.1:9090/providers/proxies/dmit

# 方式二：让 subconverter 重新转换后，mihomo 会自动按 interval 拉取
# （mihomo 已配置每小时自动更新 provider）
```

## 常见问题

- **代理突然不通**：先 `systemctl status mihomo subconverter` 看两个服务是否正常；再 `mihomosh proxy test` 看节点是否还有活着的。
- **OpenAI 不通但 Google 通**：说明选中了 claude 专用 trojan 节点，切到 `AUTO` 或任一 SS 节点。
- **节点全部失效**：机场可能换了订阅域名（该机场会通过节点名提示最新官网/邮箱），去机场后台拿新订阅地址，更新 `/etc/mihomo/config.yaml` 里 subconverter 调用参数中的 `url=` 部分。
- **subconverter 勿暴露公网**：`pref.toml` 已设置 `listen = "127.0.0.1"`，订阅链接敏感，不要改成 `0.0.0.0`。
