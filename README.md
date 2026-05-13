# GitHub 仓库分析可视化平台

本项目包含一个 Next.js API 后端和一个 Vue 3 + Vite 前端，用于分析公开 GitHub 仓库并展示可视化指标、健康度和 AI 项目评分。

## 本地运行

```bash
npm install
npm run dev
```

默认端口：

- API: http://localhost:3100
- Web: http://localhost:5174

请复制 `apps/api/.env.example` 为 `apps/api/.env.local`，或在系统环境中设置：
![](环境变量.png)
- `GITHUB_TOKEN`: GitHub Personal Access Token，用于提升 API 限流额度
- `AI_PROVIDER`: 云端 AI Provider，支持 `openai-compatible` 或 `anthropic`
- `AI_API_BASE_URL`: 云端 AI API 地址，例如 `https://api.openai.com/v1`
- `AI_API_KEY`: 云端 AI API Key
- `AI_MODEL`: 云端模型名称，例如 `gpt-4o-mini`
- `AI_TIMEOUT_MS`: AI 请求超时时间，默认 `12000`

如需前端直连指定 API 地址，可复制 `apps/web/.env.example` 为 `apps/web/.env.local` 并设置 `VITE_API_BASE_URL`。未配置云端 AI API 或调用失败时，后端会自动使用规则评分降级，保证演示可用。

## 常用命令

```bash
npm run dev
npm run build
npm run typecheck
```

## API

`GET /api/health`

返回 API 服务健康状态。

`POST /api/analyze`

```json
{
  "url": "https://github.com/vuejs/core"
}
```

返回仓库基础信息、指标、语言分布、贡献者排行、活跃趋势、健康度和评分结果。
![](运行截图.png)

### SSE 评语端点

`GET /api/score-comment?url=https://github.com/vuejs/core`

流式返回 AI 评语。返回格式为 `text/event-stream`，逐块推送评语内容。

```bash
curl "http://localhost:3100/api/score-comment?url=https://github.com/vuejs/core"
```

错误时返回 `[ERROR]` 标记，前端会自动降级到规则评分。

未配置云端 AI API 或调用失败时，自动使用规则评分降级。
