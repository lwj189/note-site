# MyNote

一个简洁的笔记管理工具，支持 Markdown 编辑、代码高亮、图片管理、笔记本分类。

## 功能

- ✍️ Markdown 笔记编辑（支持代码高亮、实时预览）
- 📁 笔记本 / 标签分类管理
- 🖼️ 图库（上传、浏览、复制引用）
- 🔍 全文搜索（关键词高亮 + 时间筛选）
- 🌙 暗色主题
- 🗑️ 回收站（软删除，可还原）
- 🖥️ 桌面版（Electron）
- 🌐 网页版

## 快速启动

```bash
cd note-site
npm install
node server.js
```

访问 http://localhost:3000

### 桌面版

```bash
npm start
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3000 | 端口号 |
| `SITE_TITLE` | MyNote | 网站标题 |
| `GIT_TOKEN` | - | Git 自动同步令牌 |
| `GIT_REPO` | github.com/用户/仓库.git | Git 仓库地址 |
| `GIT_USER` | 用户名 | Git 用户名 |

## 部署

### 本地运行

```bash
node server.js
```

### 内网穿透（如需公网访问）

```bash
# ngrok
ngrok http 3000

# cloudflared
cloudflared tunnel --url http://localhost:3000
```

## 技术栈

- 后端：Node.js + Express
- 模板：EJS
- 编辑器：Markdown (marked + highlight.js)
- 桌面：Electron
- 存储：JSON 文件
