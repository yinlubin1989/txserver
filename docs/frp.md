# FRP 内网穿透

## Dashboard
https://yinlubin.cn/frp/

## 服务端信息

| 项目 | 值 |
|------|-----|
| 服务器 IP | 82.157.107.78 |
| 端口 | 7000 |
| Token | frp_secret_token_2024 |

## 服务管理
ssh root@82.157.107.78
systemctl start|stop|restart|status frps

## 当前代理

| 名称 | 远程端口 | 内网目标 | 用途 |
|------|----------|----------|------|
| openwrt-admin | 6080 | 192.168.11.1:80 | OpenWRT 路由器 |
| openwrt-ssh | 6001 | 192.168.11.1:22 | OpenWRT SSH |
| huawei-admin | 6081 | 192.168.3.1:80 | 华为路由器 |
| homeassistant | 6123 | 192.168.3.195:8123 | Home Assistant |

## 访问方式

| 服务 | 地址 |
|------|------|
| 华为路由器 | http://yinlubin.cn:8082 |
| OpenWRT 管理 | http://yinlubin.cn:6080 |
| OpenWRT SSH | ssh -p 6001 root@yinlubin.cn |
| Home Assistant | http://yinlubin.cn:6123 |

华为路由器通过 nginx 反向代理（8082）访问，配置 /etc/nginx/conf.d/huawei.conf
