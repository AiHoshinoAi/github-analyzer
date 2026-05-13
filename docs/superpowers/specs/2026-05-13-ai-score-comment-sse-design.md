---
name: ai-score-comment-sse-design
description: AI 评语 SSE 流式返回设计
type: project
---

# AI 评语 SSE 流式返回设计

## 目标

将 AI 评语获取从同步阻塞改为异步流式返回，评分使用现有规则引擎计算，评语通过 SSE 实时推送。

## API 设计

### 端点

**GET** `/api/score-comment?url=https://github.com/owner/repo`

### 请求参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| url | string | 是 | GitHub 仓库 URL |

### 响应

`Content-Type: text/event-stream`

```
data: 正在分析活跃度...

data: 正在分析社区生态...

data: vuejs/core 综合评分 78/100。该项目近期提交活跃，社区关注度较高...
```

错误时：
```
data: [ERROR] 无法获取 AI 评语，使用规则评分备选
```

## 前端交互流程

1. 调用 `/api/analyze` → 获取完整分析结果（含评分、维度等基础数据）
2. 调用 `/api/score-comment` SSE → 获取流式评语
3. 页面展示：
   - 初始：评语区域显示"AI 评语生成中..." + 加载动画
   - SSE 连接后：逐行追加更新评语内容
   - 连接失败/超时：显示规则评分备选评语

## 错误处理

- SSE 连接失败：显示规则评分备选评语 + 重试按钮
- SSE 超时（默认 15s）：降级显示规则评语
- 网络中断：显示已有内容 + 重试按钮

## 文件变更

| 文件 | 变更 |
|------|------|
| `apps/api/lib/scoring.ts` | 抽取 `generateLlmComment()` 为独立函数，支持流式写入 |
| `apps/api/app/api/score-comment/route.ts` | 新增 SSE 端点 |
| `apps/web/src/App.vue` | 添加 SSE 连接逻辑、加载状态 UI |
| `apps/web/src/api.ts` | 添加 `fetchScoreComment()` 方法 |
| `README.md` | 文档更新 |

## 实现细节

### 后端 SSE 端点

- 使用 `ReadableStream` 返回流式响应
- LLM 响应分块写入，支持逐句输出
- 超时控制：15s 无响应则终止并发送错误标记

### 前端 SSE 处理

- 使用 `EventSource` API 连接 SSE 端点
- 监听 `message` 事件处理数据块
- 错误时自动降级到规则评语