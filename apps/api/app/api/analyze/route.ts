import { NextResponse } from "next/server";
import { analyzeRepository } from "../../../lib/analysis";
import { AppError } from "../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      url?: unknown;
    };

    if (typeof body.url !== "string") {
      throw new AppError(400, "INVALID_INPUT", "请求体必须包含字符串字段 url。");
    }

    const result = await analyzeRepository(body.url);
    return withCors(NextResponse.json(result));
  } catch (error) {
    if (error instanceof AppError) {
      return withCors(
        NextResponse.json(
          {
            code: error.code,
            message: error.message
          },
          { status: error.status }
        )
      );
    }

    console.error(error);
    return withCors(
      NextResponse.json(
        {
          code: "INTERNAL_ERROR",
          message: "分析失败，请稍后重试。"
        },
        { status: 500 }
      )
    );
  }
}

function withCors(response: NextResponse) {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return response;
}
