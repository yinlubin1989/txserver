# FRP 代理穿透配置

本文档记录通过 FRP 穿透到 yinlubin.cn 的所有代理映射。

## 服务端信息

| 项目 | 值 |
|------|-----|
| 服务器 | 82.157.107.78 |
| frps 端口 | 7000 |
| Dashboard | 82.157.107.78:7500 |
| 认证方式 | Token |

## 代理列表

| 名称 | 远程端口 | 内网目标 | 用途 |
|------|----------|----------|------|
| openwrt-admin | 6080 | 192.168.11.1:80 | OpenWRT 路由器管理后台 |
| openwrt-ssh | 6001 | 192.168.11.1:22 | OpenWRT SSH |
| huawei-admin | 6081 | 192.168.3.1:80 | 华为路由器管理后台 |
| homeassistant | 6123 | 192.168.3.195:8123 | Home Assistant |
| raspberrypi-ssh | 6002 | - | 树莓派 SSH |
| piserver-3210 | 13210 | - | 树莓派 piServer HTTP (3210) |
| piserver-8082 | 18082 | - | 树莓派 piServer HTTP (8082) |

## 访问方式

### 华为路由器

通过 nginx 反向代理访问（推荐，已处理内网地址重定向问题）：
http://yinlubin.cn:8082

直连方式（浏览器会因内网地址重定向而无法访问）：
http://yinlubin.cn:6081

nginx 配置文件：/etc/nginx/conf.d/huawei.conf，关键：伪装 Host: 192.168.3.1，proxy_redirect + sub_filter 替换内网 IP

### Home Assistant
http://yinlubin.cn:6123（设备需保持开机）

### OpenWRT 路由器
管理后台 http://yinlubin.cn:6080
SSH: ssh -p 6001 root@yinlubin.cn

### 树莓派
SSH: ssh -p 6002 root@yinlubin.cn
piServer 3210: http://yinlubin.cn:13210
piServer 8082: http://yinlubin.cn:18082

## 客户端配置

OpenWRT 路由器 frpc 配置 /etc/frp/frpc.ini：

```ini
[common]
server_addr = 82.157.107.78
server_port = 7000
token = frp_secret_token_2024

[openwrt-admin]
type = tcp
local_ip = 192.168.11.1
local_port = 80
remote_port = 6080

[openwrt-ssh]
type = tcp
local_ip = 192.168.11.1
local_port = 22
remote_port = 6001

[huawei-admin]
type = tcp
local_ip = 192.168.3.1
local_port = 80
remote_port = 6081

[homeassistant]
type = tcp
local_ip = 192.168.3.195
local_port = 8123
remote_port = 6123
```

## 新增代理

在对应客户端的 frpc 配置中添加 section：

```ini
[代理名称]
type = tcp
local_ip = <内网IP>
local_port = <本地端口>
remote_port = <远程端口>
```

然后重启 frpc 或重载配置使其生效。
