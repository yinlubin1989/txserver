# Stories 后端接口开发提示词

请在现有 Next.js 16 App Router 项目中实现只读的 Stories 文档接口。请直接修改项目、补充示例文档并完成验证，不要只输出方案或伪代码。

## 项目信息

- 项目路径：`/Users/yinlubin/Github/txserver`
- 接口线上域名：`https://yinlubin.cn`
- 现有接口参考：`app/api/photos/route.ts`
- 技术栈：Next.js 16、App Router、TypeScript、Node.js Runtime

开始开发前：

1. 阅读项目根目录的 `AGENTS.md` 和 `CLAUDE.md`。
2. 由于项目使用 Next.js 16，请阅读 `node_modules/next/dist/docs/` 中与 Route Handlers、动态路由和 `params` 相关的本地文档，不要套用旧版 Next.js 写法。
3. 检查现有代码风格、TypeScript 配置和 ESLint 规则，保持一致。
4. 不要修改 Photos、Todo、认证以及其他现有接口的行为。

## 功能目标

服务端从项目根目录的 `stories/` 文件夹读取 Markdown 文件。每篇故事对应一个 `.md` 文件，元数据保存在 YAML frontmatter 中，正文保留为原始 Markdown。

实现两个公开、只读接口：

- `GET /api/stories`：返回全部已发布故事的元数据。
- `GET /api/stories/{slug}`：返回指定故事的元数据和 Markdown 正文。

首版不实现上传、创建、编辑、删除、搜索、分页或鉴权。

## 接口契约

### 获取故事列表

请求：

```http
GET /api/stories
```

成功响应：`200 OK`

```json
{
  "stories": [
    {
      "slug": "example-story",
      "title": "文档标题",
      "summary": "用于列表和详情页导语的简短摘要",
      "publishedAt": "2026-06-12T08:00:00.000Z",
      "updatedAt": "2026-06-12T08:00:00.000Z"
    }
  ]
}
```

列表接口要求：

- 返回 `stories/` 下全部 `draft !== true` 的有效 Markdown 文档。
- 按 `publishedAt` 从新到旧排序。
- 不得返回 `content`，避免列表请求携带完整正文。
- 没有已发布文档时返回 `200` 和 `{ "stories": [] }`。
- 单个文档格式错误时，跳过该文档并在服务端记录清晰错误；不要让一篇坏文档导致整个列表接口失败。

### 获取故事详情

请求：

```http
GET /api/stories/example-story
```

成功响应：`200 OK`

```json
{
  "story": {
    "slug": "example-story",
    "title": "文档标题",
    "summary": "用于列表和详情页导语的简短摘要",
    "publishedAt": "2026-06-12T08:00:00.000Z",
    "updatedAt": "2026-06-12T08:00:00.000Z",
    "content": "## 第一节\n\n这里是 Markdown 正文。"
  }
}
```

详情接口要求：

- 根据稳定的 `slug` 获取故事，不使用标题或文件路径作为公开标识。
- `content` 是去除 frontmatter 后的 UTF-8 原始 Markdown，不重复接口中的标题字段。
- 文档不存在、`draft: true`、slug 非法或文档元数据无效时，对外统一返回 `404`：

```json
{
  "error": "文档不存在"
}
```

- 未预期的服务端错误返回 `500`：

```json
{
  "error": "读取文档失败"
}
```

## 数据与类型约束

为列表项和详情分别定义明确的 TypeScript 类型，例如：

```ts
export interface StoryMeta {
  slug: string;
  title: string;
  summary: string;
  publishedAt: string;
  updatedAt: string;
}

export interface Story extends StoryMeta {
  content: string;
}
```

字段规则：

- `slug`：必填、全局唯一、永久稳定，只允许小写英文字母、数字和连字符，正则为 `^[a-z0-9]+(?:-[a-z0-9]+)*$`。
- `title`：必填，去除首尾空格后不能为空。
- `summary`：可选；缺失时标准化为空字符串。
- `publishedAt`：必填，必须能解析为有效日期；响应中统一输出 ISO 8601 字符串。
- `updatedAt`：可选；缺失时使用 `publishedAt`，响应中统一输出 ISO 8601 字符串。
- `draft`：可选；仅当值严格为 `true` 时视为草稿。
- 同一 `slug` 出现多次时必须记录错误，不能随机返回其中一篇。

## Markdown 文档示例

创建 `stories/example-story.md` 作为开发和验收样例：

```md
---
slug: example-story
title: 一个故事
summary: 这是显示在故事列表和详情页顶部的摘要。
publishedAt: 2026-06-12T08:00:00.000Z
updatedAt: 2026-06-12T08:00:00.000Z
draft: false
---

## 第一节

这里是 Markdown 正文。

> 这是一段引用。

- 支持列表
- 支持中文内容
```

使用成熟的 frontmatter/YAML 解析库，例如 `gray-matter`。如项目尚未安装，请将其加入正式依赖并更新 lockfile。不要使用正则表达式或手写按行切割方式解析 YAML，因为标题、摘要可能包含冒号、引号或多行文本。

## 推荐目录结构

```text
txserver/
├── stories/
│   └── example-story.md
├── lib/
│   └── stories.ts
└── app/api/stories/
    ├── route.ts
    └── [slug]/
        └── route.ts
```

职责划分：

- `lib/stories.ts`：集中负责目录扫描、frontmatter 解析、字段校验、日期标准化、草稿过滤、排序和按 slug 查询。
- `app/api/stories/route.ts`：只处理列表 HTTP 响应。
- `app/api/stories/[slug]/route.ts`：只处理详情 HTTP 响应。
- Route Handler 中不要复制文件读取和校验逻辑。

两个 Route Handler 均设置：

```ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
```

注意 Next.js 16 动态路由的 `params` 可能是 Promise，必须以本项目本地文档和类型检查结果为准，不能沿用旧版同步访问方式。

## 安全要求

- 不得把请求中的 slug 直接拼接成文件路径。
- 先对 URL 解码后的 slug 执行完整正则校验，再从已解析、已验证的故事集合中按 slug 查找。
- 必须阻止 `../`、绝对路径、反斜杠、百分号编码绕过、双重编码和空字节等目录穿越尝试。
- 只扫描指定 `stories/` 目录中的普通 `.md` 文件，不递归扫描其他目录，不读取符号链接指向的外部文件。
- 草稿文档不能通过详情接口直接访问。
- 返回错误时不要泄露服务器绝对路径、堆栈、原始异常或文件内容。
- API 输出使用 `NextResponse.json`，保证 JSON 响应格式一致。

## 异常处理要求

- `stories/` 目录不存在时，列表接口返回空数组；详情接口返回 404。
- 无法读取整个目录等系统级错误应记录服务端日志，并返回 500。
- 单篇文档缺少必填字段、日期无效、slug 非法或 YAML 无法解析时，列表接口跳过该文档并记录包含文件名的错误。
- 详情查询命中无效文档时，对外返回 404，不暴露解析细节。
- 日志需要足以定位问题，但不得记录文档正文或敏感信息。

## 验收清单

实现完成后执行：

```bash
npm run lint
npm run build
```

启动服务后至少验证以下场景：

1. `GET /api/stories` 返回 `200`，结构与契约一致，并按发布日期倒序。
2. 列表响应不包含 `content`。
3. `GET /api/stories/example-story` 返回 `200` 和完整 Markdown 正文。
4. 不存在的 slug 返回 `404` 和 `{ "error": "文档不存在" }`。
5. `draft: true` 的文档不会出现在列表中，也不能通过详情接口访问。
6. `../secret`、编码后的路径穿越字符串、非法字符和空 slug 均不能读取任意文件。
7. 无效日期或缺少标题的单篇文档不会导致列表接口整体失败。
8. 中文标题、中文摘要、引用、列表、代码块和图片 Markdown 能原样返回。
9. 两篇文档使用重复 slug 时能够明确记录配置错误，不会随机返回内容。
10. `npm run lint` 和 `npm run build` 均通过，且现有接口不受影响。

可使用以下命令进行基础接口验证：

```bash
curl -i http://localhost:3000/api/stories
curl -i http://localhost:3000/api/stories/example-story
curl -i http://localhost:3000/api/stories/not-found
curl -i http://localhost:3000/api/stories/%2E%2E%2Fsecret
```

## 最终交付要求

完成后请输出：

1. 新增和修改的文件列表。
2. 最终接口契约及示例响应。
3. 关键安全处理说明。
4. `npm run lint` 与 `npm run build` 的实际结果。
5. 尚未覆盖的风险或限制；如果没有，明确说明没有已知阻塞项。

不要只给出建议。请完成代码、依赖、示例文档和验证，并确保实现可由微信小程序通过 `https://yinlubin.cn/api/stories` 和 `https://yinlubin.cn/api/stories/{slug}` 直接调用。
