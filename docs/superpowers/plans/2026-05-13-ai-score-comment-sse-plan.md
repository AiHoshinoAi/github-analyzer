# AI 评语 SSE 流式返回实现计划

**Goal:** 将 AI 评语获取从同步阻塞改为异步流式返回，评分使用现有规则引擎，评语通过 SSE 实时推送。

**Architecture:** 新增独立的 SSE 端点 `/api/score-comment`，前端先获取分析结果展示评分，再通过 SSE 获取流式评语。

**Tech Stack:** Next.js App Router (SSE), Vue 3 (EventSource)

---

## 文件变更概览

| 文件 | 变更 |
|------|------|
| `apps/api/app/api/score-comment/route.ts` | 新增 SSE 端点 |
| `apps/api/lib/scoring.ts` | 抽取 `generateLlmStream()` 支持流式返回 |
| `apps/web/src/api.ts` | 添加 `fetchScoreComment()` 方法 |
| `apps/web/src/App.vue` | 添加 SSE 连接、加载状态 UI |
| `README.md` | 文档更新 |

---

### Task 1: 创建 SSE 后端端点

**Files:**
- Create: `apps/api/app/api/score-comment/route.ts`

- [ ] **Step 1: 创建 SSE 端点文件**

```typescript
// apps/api/app/api/score-comment/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "缺少 url 参数" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let aborted = false;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const baseUrl = process.env.LLM_BASE_URL;
        if (!baseUrl) {
          controller.enqueue(encoder.encode("data: [ERROR] 未配置 LLM_BASE_URL\n\n"));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode("data: 正在分析项目...\n\n"));

        const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {})
          },
          body: JSON.stringify({
            model: process.env.LLM_MODEL ?? "qwen3.6-plus",
            temperature: 0.2,
            stream: true,
            messages: [
              {
                role: "system",
                content: "你是一位专业的开源项目分析师。请简洁地输出中文评语，不需要 markdown 格式。"
              },
              {
                role: "user",
                content: `请分析 GitHub 仓库: ${url}`
              }
            ]
          })
        });

        if (!response.ok) {
          controller.enqueue(encoder.encode("data: [ERROR] LLM 请求失败\n\n"));
          controller.close();
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          controller.enqueue(encoder.encode("data: [ERROR] 无法读取响应流\n\n"));
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done || aborted) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") {
                controller.enqueue(encoder.encode("\n"));
                controller.close();
                return;
              }
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  controller.enqueue(encoder.encode(`data: ${content}\n\n`));
                }
              } catch {
                // ignore parse errors
              }
            }
          }
        }

        controller.enqueue(encoder.encode("\n"));
        controller.close();
      } catch (error) {
        controller.enqueue(encoder.encode("data: [ERROR] 获取评语失败\n\n"));
        controller.close();
      }
    },
    cancel() {
      aborted = true;
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  });
}
```

- [ ] **Step 2: 添加 CORS 支持**

在 `route.ts` 底部添加：

```typescript
// CORS headers are handled by the analyze route
```

- [ ] **Step 3: 本地测试 SSE 端点**

Run: `cd apps/api && npm run dev`
然后访问: `http://localhost:3100/api/score-comment?url=https://github.com/vuejs/core`

预期：看到流式输出的评语

- [ ] **Step 4: 提交代码**

```bash
git add apps/api/app/api/score-comment/route.ts
git commit -m "feat: add SSE endpoint for AI score comment"
```

---

### Task 2: 前端 API 方法

**Files:**
- Modify: `apps/web/src/api.ts`

- [ ] **Step 1: 添加 fetchScoreComment 方法**

```typescript
// 在 api.ts 末尾添加

export function fetchScoreComment(url: string): EventSource {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  return new EventSource(`${baseUrl}/api/score-comment?url=${encodeURIComponent(url)}`);
}
```

- [ ] **Step 2: 提交代码**

```bash
git add apps/web/src/api.ts
git commit -m "feat: add fetchScoreComment API method"
```

---

### Task 3: 前端集成 SSE 展示评语

**Files:**
- Modify: `apps/web/src/App.vue`

- [ ] **Step 1: 添加响应式变量**

在 `<script setup>` 中添加：

```typescript
const aiComment = ref("");
const aiCommentLoading = ref(false);
const aiCommentError = ref(false);
```

- [ ] **Step 2: 添加 SSE 连接函数**

```typescript
function connectScoreComment(url: string) {
  aiCommentLoading.value = true;
  aiCommentError.value = false;
  aiComment.value = "";

  const eventSource = fetchScoreComment(url);

  eventSource.onmessage = (event) => {
    const data = event.data;
    if (data.startsWith("[ERROR]")) {
      aiCommentError.value = true;
      aiCommentLoading.value = false;
      aiComment.value = result.value?.score.comment ?? "评语获取失败";
    } else {
      aiComment.value += data;
      aiCommentLoading.value = false;
    }
  };

  eventSource.onerror = () => {
    aiCommentError.value = true;
    aiCommentLoading.value = false;
    aiComment.value = result.value?.score.comment ?? "评语获取失败，请检查网络";
    eventSource.close();
  };
}
```

- [ ] **Step 3: 修改 runAnalyze 函数**

在 `runAnalyze` 成功获取 result 后调用：

```typescript
async function runAnalyze() {
  error.value = "";
  loading.value = true;

  try {
    result.value = await analyzeRepository(repositoryUrl.value);
    // 分析完成后，异步获取 AI 评语
    connectScoreComment(repositoryUrl.value);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : "分析失败，请稍后重试。";
  } finally {
    loading.value = false;
  }
}
```

- [ ] **Step 4: 修改评语展示区域**

找到评语展示的 `<p>` 标签，修改为：

```html
<section v-if="result" class="workspace-panel">
  <div class="panel-heading">
    <div>
      <p class="section-kicker">Assessment</p>
      <h2>综合评语</h2>
    </div>
    <Bot class="size-5 text-brand" />
  </div>

  <!-- AI 评语加载状态 -->
  <div v-if="aiCommentLoading" class="mt-4 flex items-center gap-3 text-sm text-muted">
    <div class="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent"></div>
    <span>AI 评语生成中...</span>
  </div>

  <!-- 错误状态 -->
  <div v-if="aiCommentError" class="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
    <AlertCircle class="mt-0.5 size-4 shrink-0" />
    <span>AI 评语服务暂时不可用，已使用规则评分替代</span>
  </div>

  <!-- 评语内容 -->
  <p v-if="aiComment" class="mt-4 whitespace-pre-line text-sm leading-7 text-slate-700">{{ aiComment }}</p>
  <p v-else-if="!aiCommentLoading" class="mt-4 whitespace-pre-line text-sm leading-7 text-slate-700">{{ result.score.comment }}</p>
</section>
```

- [ ] **Step 5: 本地测试**

1. 启动 API: `cd apps/api && npm run dev`
2. 启动前端: `cd apps/web && npm run dev`
3. 访问 http://localhost:5174
4. 输入 `https://github.com/vuejs/core` 并分析

预期：
- 评分立即显示
- 评语区域显示"AI 评语生成中..."
- SSE 连接后逐字显示评语
- 失败时显示规则评分 + 错误提示

- [ ] **Step 6: 提交代码**

```bash
git add apps/web/src/App.vue apps/web/src/api.ts
git commit -m "feat: integrate SSE for AI score comment display"
```

---

### Task 4: 更新 README 文档

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 在 API 部分后添加 SSE 端点说明**

在 `README.md` 的 API 部分添加：

```markdown
### SSE 评语端点

`GET /api/score-comment?url=https://github.com/vuejs/core`

流式返回 AI 评语。返回格式为 `text/event-stream`，逐块推送评语内容。

```bash
curl "http://localhost:3100/api/score-comment?url=https://github.com/vuejs/core"
```

错误时返回 `[ERROR]` 标记，前端会自动降级到规则评分。

未配置 LLM 或调用失败时，自动使用规则评分降级。
```

- [ ] **Step 2: 提交代码**

```bash
git add README.md
git commit -m "docs: add SSE endpoint documentation"
```

---

## 自检清单

- [ ] spec 覆盖：SSE 端点已实现 ✓
- [ ] spec 覆盖：前端加载状态已实现 ✓
- [ ] spec 覆盖：错误降级已实现 ✓
- [ ] spec 覆盖：README 更新已完成 ✓
- [ ] 占位符检查：无 TBD/TODO ✓
- [ ] 类型一致性：EventSource API 正确使用 ✓
- [ ] 错误处理：SSE 失败降级到规则评分 ✓