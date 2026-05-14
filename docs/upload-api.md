# 公共图片上传接口文档

本文档说明当前项目提供的公共图片上传接口，适用于：

- Web/H5 项目
- 其他前端项目
- 微信小程序

接口支持跨域，浏览器和小程序均可直接调用。

所有响应中的 `url` 字段均为可直接访问的完整绝对地址，固定使用域名 `https://yinlubin.cn`，调用方不需要自行拼接协议、域名或路径。

## 1. 接口概览

### 1.1 上传图片

- 方法：`POST`
- 路径：`/api/uploads`
- Content-Type：`multipart/form-data`

用途：上传一张图片，上传成功后返回完整图片访问地址，并将记录持久化到 MongoDB。

### 1.2 获取上传历史

- 方法：`GET`
- 路径：`/api/uploads`

用途：获取已上传图片的历史记录，按创建时间倒序返回。

### 1.3 访问图片文件

- 方法：`GET`
- 路径：`/api/uploads/files/:filename`

用途：通过接口返回图片内容，可直接用于前端展示。

## 2. 跨域支持

上传接口和图片访问接口均已开启公共跨域，响应头包含：

- `Access-Control-Allow-Origin: *`
- `Access-Control-Allow-Methods: GET, POST, OPTIONS`
- `Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With`

图片文件访问路由支持：

- `GET`
- `OPTIONS`

上传接口支持：

- `GET`
- `POST`
- `OPTIONS`

## 3. 上传接口

### 3.1 请求说明

`POST /api/uploads`

请求体使用 `multipart/form-data`，字段如下：

| 字段名 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `image` | File | 是 | 要上传的图片文件 |

限制说明：

- 只允许 `image/*` 类型文件
- 当前没有 10MB 之类的大小限制
- 如果上传失败，不会写入上传历史
- 如果文件已落盘但 MongoDB 记录失败，会自动回滚删除该文件

### 3.2 成功响应

状态码：`201`

```json
{
  "upload": {
    "originalName": "example.png",
    "filename": "409b1a01-3787-48a3-a7a3-85825ab5ec0d.png",
    "url": "https://yinlubin.cn/api/uploads/files/409b1a01-3787-48a3-a7a3-85825ab5ec0d.png",
    "mimeType": "image/png",
    "size": 12345,
    "createdAt": "2026-04-24T03:00:00.000Z",
    "updatedAt": "2026-04-24T03:00:00.000Z",
    "id": "6809b0000000000000000001"
  },
  "url": "https://yinlubin.cn/api/uploads/files/409b1a01-3787-48a3-a7a3-85825ab5ec0d.png"
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `upload.id` | MongoDB 记录 ID |
| `upload.originalName` | 原始文件名 |
| `upload.filename` | 服务端生成的文件名 |
| `upload.url` | 图片完整访问地址，包含协议和域名 |
| `upload.mimeType` | 图片 MIME 类型 |
| `upload.size` | 文件大小，单位字节 |
| `upload.createdAt` | 创建时间 |
| `upload.updatedAt` | 更新时间 |
| `url` | 便于前端直接使用的图片完整地址，等同于 `upload.url` |

### 3.3 失败响应

状态码：`400`

```json
{
  "error": "请选择要上传的图片"
}
```

或：

```json
{
  "error": "只能上传图片文件"
}
```

状态码：`500`

```json
{
  "error": "上传失败，请稍后重试"
}
```

## 4. 上传历史接口

### 4.1 请求说明

`GET /api/uploads`

### 4.2 成功响应

状态码：`200`

```json
{
  "uploads": [
    {
      "originalName": "example.png",
      "filename": "409b1a01-3787-48a3-a7a3-85825ab5ec0d.png",
      "url": "https://yinlubin.cn/api/uploads/files/409b1a01-3787-48a3-a7a3-85825ab5ec0d.png",
      "mimeType": "image/png",
      "size": 12345,
      "createdAt": "2026-04-24T03:00:00.000Z",
      "updatedAt": "2026-04-24T03:00:00.000Z",
      "id": "6809b0000000000000000001"
    }
  ]
}
```

说明：

- 按 `createdAt` 倒序返回
- 仅返回上传成功且已写入 MongoDB 的记录

## 5. 图片访问接口

### 5.1 请求说明

`GET /api/uploads/files/:filename`

示例：

```text
/api/uploads/files/409b1a01-3787-48a3-a7a3-85825ab5ec0d.png
```

### 5.2 成功响应

- 状态码：`200`
- 响应体：图片二进制内容
- 响应头包含正确的 `Content-Type`

### 5.3 失败响应

状态码：`400`

```json
{
  "error": "无效的文件名"
}
```

状态码：`404`

```json
{
  "error": "图片不存在"
}
```

## 6. Web/H5 调用示例

```ts
async function uploadImage(file: File) {
  const formData = new FormData();
  formData.append("image", file);

  const response = await fetch("https://yinlubin.cn/api/uploads", {
    method: "POST",
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "上传失败");
  }

  return data;
}
```

获取上传历史：

```ts
async function getUploadHistory() {
  const response = await fetch("https://yinlubin.cn/api/uploads");
  const data = await response.json();

  if (!response.ok) {
    throw new Error("获取上传历史失败");
  }

  return data.uploads;
}
```

## 7. 微信小程序调用示例

微信小程序上传文件建议使用 `wx.uploadFile`：

```js
wx.uploadFile({
  url: "https://yinlubin.cn/api/uploads",
  filePath: tempFilePath,
  name: "image",
  success(res) {
    const data = JSON.parse(res.data);

    if (res.statusCode !== 201) {
      wx.showToast({
        title: data.error || "上传失败",
        icon: "none",
      });
      return;
    }

    console.log("上传成功", data);
    console.log("图片地址", data.url);
  },
  fail(err) {
    console.error("上传失败", err);
  },
});
```

注意事项：

- 小程序后台要把接口域名加入合法域名白名单
- `name` 必须传 `image`
- 上传成功后返回的 `url` 可直接保存使用

## 8. 生产环境建议

如果要给多个项目或小程序长期复用，建议：

1. 使用固定线上域名，例如 `https://api.xxx.com`
2. 统一在反向代理层开启 HTTPS
3. 如果后续需要权限控制，可将 `Access-Control-Allow-Origin` 从 `*` 改为白名单域名
4. 如果图片量变大，后续可以把本地文件存储替换成对象存储（如 OSS、COS、S3），接口协议保持不变

## 9. 当前实现说明

当前上传链路为：

1. 图片文件保存到服务器本地目录 `.local-uploads/images`
2. 上传记录保存到 MongoDB
3. 接口响应会根据当前请求自动拼接完整域名，返回绝对图片地址
4. 图片通过 `/api/uploads/files/:filename` 对外访问

`.local-uploads/` 已被 `.gitignore` 忽略，不会进入版本管理。
