# FRP 代理穿透配置

本文档记录通过 FRP 穿透到 `yinlubin.cn` 的所有代理映射。

## 服务端信息

| 项目 | 值 |
|------|-----|
| 服务器 | 82.157.107.78 |
| frps 端口 | 7000 |
| Dashboard | `http://82.157.107.78:7500` |
| 认证方式 | Token |

## 代理列表

| 名称 | 远程端口 | 目标 | 用途 |
|------|----------|------|------|
| openwrt-admin | 6080 | OpenWRT 路由器 | 路由器管理后台 |
| openwrt-ssh | 6001 | OpenWRT 路由器 | OpenWRT SSH |
| raspberrypi-ssh | 6002 | 树莓派 | 树莓派 SSH |
| piserver-3210 | 13210 | 树莓派 | piServer HTTP (3210) |
| piserver-8082 | 18082 | 树莓派 | piServer HTTP (8082) |

## 访问方式

所有代理均通过 `yinlubin.cn` 域名访问，格式为 `yinlubin.cn:<远程端口>`。例如：

```bash
# 树莓派 SSH
ssh -p 6002 root@yinlubin.cn

# 树莓派 piServer (3210)
curl http://yinlubin.cn:13210

# 树莓派 piServer (8082)
curl http://yinlubin.cn:18082
```

## 新增代理

在对应客户端的 `frpc.toml` 中添加配置，格式如下：

```toml
[[proxies]]
name = "代理名称"
type = "tcp"
localIP = "127.0.0.1"
localPort = <本地端口>
remotePort = <远程端口>
```

然后重启 frpc 或重载配置使其生效。