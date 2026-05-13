import { NextResponse } from "next/server";

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
        const baseUrl = process.env.LLM_BASE_URL;
        if (!baseUrl) {
          controller.enqueue(encoder.encode("data: [ERROR] 未配置 LLM_BASE_URL\n\n"));
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode("data: 正在分析项目...\n\n"));

        const abortController = new AbortController();
        const timeout = setTimeout(() => abortController.abort(), 30000);

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
          }),
          signal: abortController.signal
        });

        clearTimeout(timeout);

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
      "X-Accel-Buffering": "no"
    }
  });
}