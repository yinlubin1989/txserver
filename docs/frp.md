# FRP 内网穿透

## Dashboard

https://yinlubin.cn/frp/

## 服务端信息

| 项目 | 值 |
|------|-----|
| 服务器 IP | `82.157.107.78` |
| 端口 | `7000` |
| Token | `frp_secret_token_2024` |

## 服务管理

```bash
ssh root@82.157.107.78
systemctl start|stop|restart|status frps
```

## 当前代理

| 名称 | 远程端口 | 用途 |
|------|----------|------|
| openwrt-admin | 6080 | OpenWRT 路由器 |
| openwrt-ssh | 6001 | OpenWRT SSH |
| raspberrypi-ssh | 6002 | 树莓派 SSH |
