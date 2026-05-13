import type { AnalysisResult, HealthMetrics, Metrics, RepositoryInfo, ScoreDimensions, ScoreResult } from "./types";

const weights = {
  activity: 0.25,
  community: 0.25,
  quality: 0.2,
  maintenance: 0.2,
  trend: 0.1
};

type ScoringInput = Omit<AnalysisResult, "score" | "generatedAt">;

export async function scoreRepository(input: ScoringInput): Promise<ScoreResult> {
  const dimensions = calculateDimensions(input.repository, input.metrics, input.health);
  const ruleScore = weightedTotal(dimensions);
  const fallbackComment = buildRuleComment(input.repository, dimensions, ruleScore);

  const llmResult = await generateLlmComment(input, dimensions, ruleScore).catch(() => null);
  if (!llmResult) {
    return {
      total: ruleScore,
      dimensions,
      comment: fallbackComment,
      source: "rules"
    };
  }

  return {
    total: llmResult.score ?? ruleScore,
    dimensions,
    comment: llmResult.comment,
    source: "llm"
  };
}

function calculateDimensions(repository: RepositoryInfo, metrics: Metrics, health: HealthMetrics): ScoreDimensions {
  const closedIssueScore = health.openIssueRatio === null ? 35 : (1 - health.openIssueRatio) * 35;
  const activity = clamp(health.commitsLast30Days * 3 + closedIssueScore + (health.prMergeRate ?? 0) * 20);

  const community = clamp(
    Math.log10(metrics.stars + 1) * 22 +
      Math.log10(metrics.forks + 1) * 14 +
      Math.min(metrics.contributors, 25) * 2.2
  );

  const quality = clamp((health.hasReadme ? 55 : 15) + (health.hasCi ? 30 : 0) + (repository.license !== "未声明" ? 15 : 0));

  const updateScore =
    health.updatedDaysAgo === null
      ? 20
      : health.updatedDaysAgo <= 7
        ? 100
        : health.updatedDaysAgo <= 30
          ? 85
          : health.updatedDaysAgo <= 90
            ? 65
            : health.updatedDaysAgo <= 180
              ? 45
              : 25;
  const responseScore =
    health.averageIssueResponseHours === null
      ? 50
      : health.averageIssueResponseHours <= 24
        ? 100
        : health.averageIssueResponseHours <= 72
          ? 80
          : health.averageIssueResponseHours <= 168
            ? 60
            : 35;
  const maintenance = clamp(updateScore * 0.55 + responseScore * 0.45 - (repository.isArchived ? 35 : 0));

  const trend = clamp(health.commitsLast30Days * 2 + (health.prMergeRate ?? 0) * 35 + Math.log10(metrics.stars + 1) * 15);

  return {
    activity: round(activity),
    community: round(community),
    quality: round(quality),
    maintenance: round(maintenance),
    trend: round(trend)
  };
}

function weightedTotal(dimensions: ScoreDimensions): number {
  return round(
    dimensions.activity * weights.activity +
      dimensions.community * weights.community +
      dimensions.quality * weights.quality +
      dimensions.maintenance * weights.maintenance +
      dimensions.trend * weights.trend
  );
}

function buildRuleComment(repository: RepositoryInfo, dimensions: ScoreDimensions, score: number): string {
  const strengths: string[] = [];
  const risks: string[] = [];

  if (dimensions.activity >= 75) strengths.push("近期提交和协作活动较活跃");
  if (dimensions.community >= 70) strengths.push("社区关注度和贡献者基础较好");
  if (dimensions.quality >= 75) strengths.push("README、License 或 CI 配置较完整");
  if (dimensions.maintenance >= 75) strengths.push("维护响应较及时");

  if (dimensions.activity < 45) risks.push("近期活跃度偏低");
  if (dimensions.community < 45) risks.push("社区生态仍需积累");
  if (dimensions.quality < 55) risks.push("文档、License 或 CI 完整度不足");
  if (dimensions.maintenance < 55) risks.push("维护及时性存在改善空间");
  if (repository.isArchived) risks.push("仓库已归档，不建议作为活跃依赖重点投入");

  const summary =
    score >= 80
      ? "整体表现优秀，适合重点关注和深入评估。"
      : score >= 65
        ? "整体表现稳健，具备持续使用或跟进价值。"
        : score >= 50
          ? "项目具备一定基础，但需要结合业务风险谨慎评估。"
          : "项目健康度偏弱，建议优先确认维护状态和替代方案。";

  return [
    `${repository.fullName} 综合评分 ${score}/100。${summary}`,
    strengths.length ? `主要优势：${strengths.join("、")}。` : "主要优势：暂未发现特别突出的优势维度。",
    risks.length ? `风险提示：${risks.join("、")}。` : "风险提示：暂无明显短板。"
  ].join("\n");
}

type LlmResult = {
  score: number | null;
  comment: string;
};

async function generateLlmComment(input: ScoringInput, dimensions: ScoreDimensions, ruleScore: number): Promise<LlmResult | null> {
  const baseUrl = process.env.LLM_BASE_URL;
  if (!baseUrl) {
    return null;
  }

  const controller = new AbortController();
  const timeout = Number.parseInt(process.env.LLM_TIMEOUT_MS ?? "12000", 10);
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeout) ? timeout : 12000);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {})
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL ?? "qwen3.6-plus",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "你是一位专业的开源项目分析师。请基于给定 GitHub 仓库数据输出 JSON，不要输出 Markdown。格式：{\"score\": 数字, \"comment\": \"中文评语\"}。"
          },
          {
            role: "user",
            content: JSON.stringify({
              repository: input.repository,
              metrics: input.metrics,
              health: input.health,
              dimensions,
              ruleScore,
              languageTop5: input.languages.slice(0, 5),
              contributorTop5: input.contributors.slice(0, 5)
            })
          }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return null;
    }

    const parsed = parseLlmJson(content);
    if (!parsed.comment) {
      return {
        score: null,
        comment: content
      };
    }

    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function parseLlmJson(content: string): LlmResult {
  const jsonText = content.match(/\{[\s\S]*\}/)?.[0] ?? content;

  try {
    const parsed = JSON.parse(jsonText) as {
      score?: unknown;
      comment?: unknown;
    };
    const score = typeof parsed.score === "number" && parsed.score >= 0 && parsed.score <= 100 ? round(parsed.score) : null;
    const comment = typeof parsed.comment === "string" ? parsed.comment : "";

    return {
      score,
      comment
    };
  } catch {
    const scoreMatch = content.match(/(?:评分|score)\D{0,8}(\d{1,3})/i);
    const score = scoreMatch ? clamp(Number.parseInt(scoreMatch[1], 10)) : null;

    return {
      score,
      comment: content
    };
  }
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value);
}
