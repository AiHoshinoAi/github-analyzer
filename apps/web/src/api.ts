import type { AnalysisResult } from "./types";

type ApiErrorPayload = {
  message?: string;
};

export async function analyzeRepository(url: string): Promise<AnalysisResult> {
  const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";
  const response = await fetch(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as ApiErrorPayload;
    throw new Error(payload.message ?? `分析失败，HTTP ${response.status}`);
  }

  return (await response.json()) as AnalysisResult;
}
