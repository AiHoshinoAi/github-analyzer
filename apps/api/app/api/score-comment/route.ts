import { NextResponse } from "next/server";
import { createTimeoutSignal, getAiConfig, requestAiText } from "../../../lib/ai";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "缺少 url 参数" }, { status: 400 });
  }

  if (!url.includes("github.com")) {
    return NextResponse.json({ error: "无效的 GitHub URL" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let aborted = false;

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const config = getAiConfig();
        if (!config) {
          controller.enqueue(encoder.encode("data: [ERROR] 未配置 AI_API_BASE_URL 或 AI_API_KEY\n\n"));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode("data: 正在分析项目...\n\n"));

        const timeout = createTimeoutSignal(Math.max(config.timeoutMs, 30000));
        const content = await requestAiText(
          config,
          [
            {
              role: "system",
              content: "你是一位专业的开源项目分析师。请简洁地输出中文评语，不需要 markdown 格式。"
            },
            {
              role: "user",
              content: `请分析 GitHub 仓库: ${url}`
            }
          ],
          timeout.signal
        ).finally(timeout.clear);

        if (!content) {
          controller.enqueue(encoder.encode("data: [ERROR] 云端 AI 请求失败\n\n"));
          controller.close();
          return;
        }

        const chunks = content.match(/.{1,32}/gs) ?? [content];
        for (const chunk of chunks) {
          if (aborted) break;
          controller.enqueue(encoder.encode(`data: ${chunk.replace(/\n/g, "\\n")}\n\n`));
          await sleep(15);
        }

        controller.enqueue(encoder.encode("\n"));
        controller.close();
      } catch (error) {
        console.error("SSE error:", error);
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
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
