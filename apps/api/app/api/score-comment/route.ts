import { NextResponse } from "next/server";
import { createTimeoutSignal, getAiConfig, requestAiTextStream } from "../../../lib/ai";
import type { AiMessage } from "../../../lib/ai";
import { analyzeRepository } from "../../../lib/analysis";
import type { AnalysisResult } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CombinedSignal = {
  signal: AbortSignal;
  clear: () => void;
};

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return withCors(NextResponse.json({ error: "缺少 url 参数" }, { status: 400 }));
  }

  if (!url.includes("github.com")) {
    return withCors(NextResponse.json({ error: "无效的 GitHub URL" }, { status: 400 }));
  }

  const encoder = new TextEncoder();
  const streamAbort = new AbortController();
  let streamClosed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let timeout: ReturnType<typeof createTimeoutSignal> | null = null;
      let upstreamAbort: CombinedSignal | null = null;

      const send = (payload: string, event?: string) => {
        if (streamClosed || request.signal.aborted || streamAbort.signal.aborted) {
          return false;
        }

        try {
          controller.enqueue(encoder.encode(formatSse(payload, event)));
          return true;
        } catch {
          streamClosed = true;
          streamAbort.abort();
          return false;
        }
      };

      const close = () => {
        if (streamClosed) {
          return;
        }

        streamClosed = true;

        try {
          controller.close();
        } catch {
          // The client may already have closed the EventSource.
        }
      };

      try {
        const config = getAiConfig();
        if (!config) {
          send("[ERROR] 未配置 AI_API_BASE_URL 或 AI_API_KEY");
          send("[DONE]", "done");
          close();
          return;
        }

        if (!sendComment("connected", controller, encoder)) {
          return;
        }

        timeout = createTimeoutSignal(Math.max(config.timeoutMs, 30000));
        upstreamAbort = combineAbortSignals([request.signal, streamAbort.signal, timeout.signal]);
        const analysis = await analyzeRepository(url);

        let hasContent = false;

        for await (const chunk of requestAiTextStream(
          config,
          buildAssessmentMessages(analysis),
          upstreamAbort.signal
        )) {
          hasContent = true;

          if (!send(chunk)) {
            return;
          }
        }

        if (!hasContent) {
          send("[ERROR] 云端 AI 未返回流式内容");
        }

        send("[DONE]", "done");
      } catch (error) {
        const clientClosed = request.signal.aborted || streamAbort.signal.aborted;
        const timedOut = timeout?.signal.aborted && !clientClosed;

        if (clientClosed) {
          return;
        }

        if (timedOut || isAbortError(error)) {
          send("[ERROR] AI 评语生成超时");
          send("[DONE]", "done");
          return;
        }

        console.error("SSE error:", error);
        send("[ERROR] 获取评语失败");
        send("[DONE]", "done");
      } finally {
        upstreamAbort?.clear();
        timeout?.clear();
        close();
      }
    },
    cancel() {
      streamAbort.abort();
      streamClosed = true;
    }
  });

  return withCors(
    new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no"
      }
    })
  );
}

function withCors(response: Response) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return response;
}

function formatSse(payload: string, event?: string): string {
  const normalized = payload.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").map((line) => `data: ${line}`);

  return `${event ? `event: ${event}\n` : ""}${lines.join("\n")}\n\n`;
}

function sendComment(comment: string, controller: ReadableStreamDefaultController<Uint8Array>, encoder: TextEncoder) {
  try {
    controller.enqueue(encoder.encode(`: ${comment}\n\n`));
    return true;
  } catch {
    return false;
  }
}

function buildAssessmentMessages(analysis: AnalysisResult): AiMessage[] {
  return [
    {
      role: "system",
      content:
        "你是一位专业的开源项目分析师。只能依据提供的后端 GitHub API 结构化数据输出中文综合评语。评分必须使用 payload.score.total，不要根据仓库名、知名度或外部知识重新打分；如果 payload.score.source 为 rules，需要说明评分来自规则降级。输出 2-4 句，包含主要优势和风险，不要 Markdown。"
    },
    {
      role: "user",
      content: JSON.stringify({
        repository: {
          fullName: analysis.repository.fullName,
          description: analysis.repository.description,
          defaultBranch: analysis.repository.defaultBranch,
          createdAt: analysis.repository.createdAt,
          updatedAt: analysis.repository.updatedAt,
          pushedAt: analysis.repository.pushedAt,
          license: analysis.repository.license,
          topics: analysis.repository.topics,
          isArchived: analysis.repository.isArchived
        },
        metrics: analysis.metrics,
        health: analysis.health,
        languagesTop5: analysis.languages.slice(0, 5),
        contributorsTop5: analysis.contributors.slice(0, 5).map((contributor) => ({
          login: contributor.login,
          contributions: contributor.contributions
        })),
        activityLast12Weeks: analysis.activity,
        score: {
          total: analysis.score.total,
          source: analysis.score.source,
          model: analysis.score.model,
          dimensions: analysis.score.dimensions
        }
      })
    }
  ];
}

function combineAbortSignals(signals: AbortSignal[]): CombinedSignal {
  const controller = new AbortController();
  const activeSignals: AbortSignal[] = [];

  const abort = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  for (const signal of signals) {
    if (signal.aborted) {
      abort();
      break;
    }

    signal.addEventListener("abort", abort, { once: true });
    activeSignals.push(signal);
  }

  return {
    signal: controller.signal,
    clear: () => {
      for (const signal of activeSignals) {
        signal.removeEventListener("abort", abort);
      }
    }
  };
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
