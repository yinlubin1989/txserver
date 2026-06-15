<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:deploy-tencent -->
# 部署到腾讯云服务器

当用户说"部署到腾讯云"、"部署到服务器"、"上线"、"发布到服务器"时，执行以下流程：

## 服务器信息
- **IP**: `82.157.107.78`
- **用户**: `root`
- **项目路径**: `/root/txserver`
- **进程**: `node /root/txserver/server.mjs` (端口 8000)
- **反向代理**: Nginx → `yinlubin.cn`

## 部署流程

### 步骤 1: 本地推送代码
确保本地改动已 commit 并 push 到 GitHub：
```bash
git add <files> && git commit -m "<message>" && git push
```

### 步骤 2: 服务器拉取代码
```bash
ssh root@82.157.107.78 "cd /root/txserver && git pull"
```

### 步骤 3: 重启应用
先杀掉旧进程，再启动新进程：
```bash
# 找到当前运行的进程 PID
ssh root@82.157.107.78 "ps aux | grep 'node /root/txserver/server.mjs' | grep -v grep | awk '{print \$2}'"

# 杀掉旧进程并重启（一步完成）
ssh root@82.157.107.78 "kill \$(ps aux | grep 'node /root/txserver/server.mjs' | grep -v grep | awk '{print \$2}'); sleep 1; cd /root/txserver && nohup node server.mjs > /tmp/txserver.log 2>&1 & sleep 2"
```

### 步骤 4: 验证部署
```bash
# 确认进程已启动
ssh root@82.157.107.78 "ps aux | grep 'node /root/txserver/server.mjs' | grep -v grep"

# 验证 API 可用
curl -s https://yinlubin.cn/api/stories | python3 -m json.tool | head -20
```

## 注意事项
- `ps aux` 中进程显示为 `node /root/txserver/server.mjs`（带完整路径），grep 时需用完整路径匹配
- 如果旧进程杀不掉，可用 `kill -9 <PID>` 强制结束
- 应用日志在 `/tmp/txserver.log`
- 服务端 Next.js 使用 dev 模式运行，关键改动会自动热更新，但新增文件通常需要重启
<!-- END:deploy-tencent -->
