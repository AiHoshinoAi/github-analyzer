# GitHub 仓库分析可视化平台 TODO

## 项目概述和目标

构建一个本地可运行的 GitHub 仓库分析可视化平台。用户输入公开 GitHub 仓库 URL 后，系统通过后端代理聚合 GitHub API 数据，在 Vue 3 前端展示基础指标、语言分布、贡献者排行、活跃趋势、项目健康度，并结合可配置云端 AI API 或规则降级方案生成 0-100 AI 项目评分和中文评语。

## 功能清单

- [x] P0: 仓库 URL 解析与校验，支持 `https://github.com/{owner}/{repo}` 和 `owner/repo`
- [x] P0: Next.js 后端 API，聚合仓库基础信息、语言、贡献者、提交、Issue、PR、分支等数据
- [x] P0: GitHub Token 支持和内存缓存，缓解 API 限流
- [x] P0: Vue 3 + Vite 前端主界面，包含输入框、加载态、错误态和分析结果展示
- [x] P0: 数字指标卡片，展示 Stars、Forks、Watchers、Branches、Issues、PRs
- [x] P0: ECharts 图表，展示语言分布、活跃趋势、贡献者排行
- [x] P1: 项目健康度指标，展示最近更新频率、Issue 响应时间、PR 合并率
- [x] P1: AI 项目评分，优先调用可配置云端 API，失败时使用确定性规则评分降级
- [x] P1: 响应式布局和基础视觉打磨
- [x] P2: README、环境变量示例和本地运行说明

## 技术方案设计

- 项目结构采用单仓库双应用：
  - `apps/api`: Next.js API 服务，仅提供后端接口
  - `apps/web`: Vue 3 + Vite + TypeScript 前端应用
- 前端通过 Vite 代理访问 `/api/analyze`，开发环境转发到 Next.js API。
- 后端使用 GitHub REST API 获取公开仓库数据，并在服务端聚合为前端所需模型。
- 缓存使用进程内 Map，按仓库和接口参数缓存 10 分钟。
- AI 评分模块封装为独立服务：通过环境变量配置云端 AI Provider、API Base URL、API Key、模型名称和超时时间；如未配置或调用失败，返回规则评分和说明。

## 数据库设计

当前版本不引入数据库。分析结果为按需获取，短期缓存放在服务端内存中。若后续需要历史趋势和用户项目收藏，可新增 SQLite/PostgreSQL 表：

- `repositories`: owner、name、url、last_analyzed_at
- `analysis_snapshots`: repository_id、metrics_json、score_json、created_at

## API 设计

### `POST /api/analyze`

请求体：

```json
{
  "url": "https://github.com/vuejs/core"
}
```

响应体：

```json
{
  "repository": {},
  "metrics": {},
  "languages": [],
  "contributors": [],
  "activity": [],
  "health": {},
  "score": {}
}
```

错误：

- `400`: URL 格式不合法
- `404`: 仓库不存在或不可访问
- `429`: GitHub API 限流
- `500`: 服务端聚合失败

## 开发里程碑

- [x] M0: 阅读 issue 和本地技术调研文档，确认需求范围
- [x] M1: 创建 TODO 文档和项目脚手架
- [x] M2: 完成 Next.js 后端 API 与 GitHub 数据聚合
- [x] M3: 完成 Vue 3 前端界面和图表展示
- [x] M4: 集成云端 AI/规则评分与项目健康度展示
- [x] M5: 补充文档、运行验证并提交交付说明

## 注意事项和风险点

- GitHub 未配置 Token 时匿名限流较低，需在 UI 和 README 中说明 `GITHUB_TOKEN`。
- 云端 AI API 的 Provider、Base URL、API Key、模型名称必须通过环境变量配置，并提供规则评分降级。
- GitHub Issues API 会同时返回 PR，需要在后端通过 `pull_request` 字段区分。
- 大型仓库数据量较大，首版只取最近分页数据，保证响应速度。
- D 盘项目目录不在当前沙箱默认可写根内，如写入受限需申请权限。

## 进度记录

- 2026-05-13: 已阅读 issue 与本地技术调研文档，创建 `TODO.md`。
- 2026-05-13: 已创建 npm workspace、Next.js API 应用和 Vue 3 Vite 前端应用基础结构。
- 2026-05-13: 已完成后端 GitHub 数据聚合、内存缓存、Token 支持、健康度计算和 LLM/规则评分。
- 2026-05-13: 已完成前端分析工作台、指标卡片、ECharts 图表、健康度和评分展示。
- 2026-05-13: 已通过 `npm run typecheck`、`npm run build --workspace apps/web`、`npm run build --workspace apps/api`。
- 2026-05-13: 已新增 `GET /api/health` 并验证本地 API/Web 服务可访问，验证无效 URL 返回 400 错误。
- 2026-05-13: 当前机器未配置 `GITHUB_TOKEN`，匿名 GitHub API 已限流，真实仓库分析返回 429；配置 Token 后可继续验证完整数据链路。
- 2026-05-13: 收到新审批评论，需求明确为云端 AI API 且必须可配置；开始调整 AI 配置、README 和前端展示。
- 2026-05-13: 已新增云端 AI 配置模块，支持 `AI_PROVIDER`、`AI_API_BASE_URL`、`AI_API_KEY`、`AI_MODEL`、`AI_TIMEOUT_MS`，并兼容旧 `LLM_*` 变量。
- 2026-05-13: 已将评分接口和 SSE 评语端点接入云端 AI API 配置，前端评分来源展示模型名称。
- 2026-05-13: 已通过 `npm run typecheck`。
- 2026-05-13: 已通过 `npm run build --workspace apps/api` 和 `npm run build --workspace apps/web`；清理旧 `.next` 生成物后启动默认 3100/5174 服务验证通过。
