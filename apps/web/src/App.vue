<script setup lang="ts">
import type { EChartsOption } from "echarts";
import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  CircleDot,
  Code2,
  ExternalLink,
  GitBranch,
  GitFork,
  GitPullRequest,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Timer,
  Users,
  Eye
} from "lucide-vue-next";
import { computed, onUnmounted, ref } from "vue";
import { analyzeRepository, fetchScoreComment } from "./api";
import BaseChart from "./components/BaseChart.vue";
import type { AnalysisResult } from "./types";

const repositoryUrl = ref("https://github.com/vuejs/core");
const loading = ref(false);
const error = ref("");
const result = ref<AnalysisResult | null>(null);
const aiComment = ref("");
const aiCommentLoading = ref(false);
const aiCommentError = ref(false);
const scoreCommentSource = ref<EventSource | null>(null);

onUnmounted(() => {
  scoreCommentSource.value?.close();
});

const metricCards = computed(() => {
  const metrics = result.value?.metrics;
  return [
    { label: "Stars", value: metrics?.stars ?? 0, icon: Star, accent: "text-amber-600" },
    { label: "Forks", value: metrics?.forks ?? 0, icon: GitFork, accent: "text-blue-700" },
    { label: "Watchers", value: metrics?.watchers ?? 0, icon: Eye, accent: "text-emerald-700" },
    { label: "Branches", value: metrics?.branches ?? 0, icon: GitBranch, accent: "text-slate-700" },
    { label: "Issues (30 Days)", value: metrics?.openIssues ?? 0, icon: CircleDot, accent: "text-rose-700" },
    { label: "PRs (30 Days)", value: metrics?.openPullRequests ?? 0, icon: GitPullRequest, accent: "text-violet-700" }
  ];
});

const languageOption = computed<EChartsOption>(() => ({
  color: ["#2166c2", "#16805f", "#bd6b12", "#8b5cf6", "#c2414b", "#0f766e", "#64748b"],
  tooltip: {
    trigger: "item",
    formatter: "{b}: {d}%"
  },
  legend: {
    bottom: 0,
    type: "scroll"
  },
  series: [
    {
      name: "语言占比",
      type: "pie",
      radius: ["45%", "72%"],
      center: ["50%", "44%"],
      avoidLabelOverlap: true,
      label: {
        formatter: "{b}\n{d}%"
      },
      data: (result.value?.languages ?? []).slice(0, 8).map((language) => ({
        name: language.name,
        value: language.bytes
      }))
    }
  ]
}));

const activityOption = computed<EChartsOption>(() => ({
  color: ["#2166c2", "#16805f", "#bd6b12"],
  tooltip: {
    trigger: "axis"
  },
  grid: {
    left: 42,
    right: 18,
    top: 28,
    bottom: 42
  },
  legend: {
    bottom: 0
  },
  xAxis: {
    type: "category",
    boundaryGap: false,
    data: (result.value?.activity ?? []).map((point) => formatShortDate(point.date))
  },
  yAxis: {
    type: "value",
    minInterval: 1
  },
  series: [
    {
      name: "Commits",
      type: "line",
      smooth: true,
      data: (result.value?.activity ?? []).map((point) => point.commits)
    },
    {
      name: "Issues",
      type: "line",
      smooth: true,
      data: (result.value?.activity ?? []).map((point) => point.issues)
    },
    {
      name: "PRs",
      type: "line",
      smooth: true,
      data: (result.value?.activity ?? []).map((point) => point.pullRequests)
    }
  ]
}));

const contributorsOption = computed<EChartsOption>(() => {
  const contributors = [...(result.value?.contributors ?? [])].reverse();
  return {
    color: ["#2166c2"],
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "shadow"
      }
    },
    grid: {
      left: 90,
      right: 18,
      top: 18,
      bottom: 24
    },
    xAxis: {
      type: "value",
      minInterval: 1
    },
    yAxis: {
      type: "category",
      data: contributors.map((contributor) => contributor.login)
    },
    series: [
      {
        name: "Contributions",
        type: "bar",
        barMaxWidth: 20,
        data: contributors.map((contributor) => contributor.contributions)
      }
    ]
  };
});

const dimensionItems = computed(() => {
  const dimensions = result.value?.score.dimensions;
  return [
    { label: "活跃度", value: dimensions?.activity ?? 0 },
    { label: "社区生态", value: dimensions?.community ?? 0 },
    { label: "代码质量", value: dimensions?.quality ?? 0 },
    { label: "维护状态", value: dimensions?.maintenance ?? 0 },
    { label: "热度趋势", value: dimensions?.trend ?? 0 }
  ];
});

const healthItems = computed(() => {
  const health = result.value?.health;
  return [
    {
      label: "最近更新",
      value: health?.updatedDaysAgo === null || health?.updatedDaysAgo === undefined ? "未知" : `${health.updatedDaysAgo} 天前`,
      icon: Activity
    },
    {
      label: "30 天提交",
      value: `${health?.commitsLast30Days ?? 0} 次`,
      icon: GitBranch
    },
    {
      label: "Issue 响应",
      value:
        health?.averageIssueResponseHours === null || health?.averageIssueResponseHours === undefined
          ? "无样本"
          : formatHours(health.averageIssueResponseHours),
      icon: Timer
    },
    {
      label: "PR 合并率",
      value: health?.prMergeRate === null || health?.prMergeRate === undefined ? "无样本" : formatPercent(health.prMergeRate),
      icon: CheckCircle2
    },
    {
      label: "README",
      value: health?.hasReadme ? "已配置" : "未发现",
      icon: Code2
    },
    {
      label: "CI/CD",
      value: health?.hasCi ? "已配置" : "未发现",
      icon: ShieldCheck
    }
  ];
});

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

function connectScoreComment(url: string) {
  aiCommentLoading.value = true;
  aiCommentError.value = false;
  aiComment.value = "";

  scoreCommentSource.value?.close();
  const eventSource = fetchScoreComment(url);
  scoreCommentSource.value = eventSource;

  eventSource.onmessage = (event) => {
    if (scoreCommentSource.value !== eventSource) {
      return;
    }

    const data = event.data;
    if (data.startsWith("[ERROR]")) {
      aiCommentError.value = true;
      aiCommentLoading.value = false;
      aiComment.value = result.value?.score.comment ?? "评语获取失败";
      closeScoreCommentSource(eventSource);
    } else {
      aiComment.value += data;
      aiCommentLoading.value = false;
    }
  };

  eventSource.addEventListener("done", () => {
    if (scoreCommentSource.value !== eventSource) {
      return;
    }

    aiCommentLoading.value = false;
    closeScoreCommentSource(eventSource);
  });

  eventSource.onerror = () => {
    if (scoreCommentSource.value !== eventSource) {
      return;
    }

    aiCommentError.value = true;
    aiCommentLoading.value = false;
    aiComment.value = result.value?.score.comment ?? "评语获取失败，请检查网络";
    closeScoreCommentSource(eventSource);
  };
}

function closeScoreCommentSource(eventSource: EventSource) {
  eventSource.close();
  if (scoreCommentSource.value === eventSource) {
    scoreCommentSource.value = null;
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatHours(value: number): string {
  if (value < 24) {
    return `${value} 小时`;
  }
  return `${Math.round(value / 24)} 天`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function scoreColor(score: number): string {
  if (score >= 80) return "#16805f";
  if (score >= 65) return "#2166c2";
  if (score >= 50) return "#bd6b12";
  return "#c2414b";
}

void runAnalyze();
</script>

<template>
  <div class="min-h-screen bg-[#f5f7fb] text-ink">
    <main class="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
      <section class="workspace-panel">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div class="min-w-0">
            <p class="section-kicker">Repository Intelligence</p>
            <h1 class="truncate text-2xl font-semibold tracking-normal text-ink sm:text-3xl">GitHub 仓库分析平台</h1>
          </div>

          <form class="flex w-full flex-col gap-3 sm:flex-row lg:max-w-2xl" @submit.prevent="runAnalyze">
            <label class="relative min-w-0 flex-1">
              <Search class="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted" />
              <input
                v-model="repositoryUrl"
                class="input-field pl-10"
                placeholder="https://github.com/vuejs/core"
                autocomplete="off"
                spellcheck="false"
              />
            </label>
            <button class="primary-button" :disabled="loading" type="submit">
              <RefreshCw v-if="loading" class="size-5 animate-spin" />
              <Search v-else class="size-5" />
              <span>{{ loading ? "分析中" : "开始分析" }}</span>
            </button>
          </form>
        </div>

        <div v-if="error" class="mt-4 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle class="mt-0.5 size-5 shrink-0" />
          <span>{{ error }}</span>
        </div>
      </section>

      <section v-if="result" class="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <article class="workspace-panel">
          <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div class="min-w-0">
              <div class="flex min-w-0 items-center gap-2">
                <h2 class="truncate text-xl font-semibold text-ink">{{ result.repository.fullName }}</h2>
                <a
                  class="icon-link"
                  :href="result.repository.url"
                  target="_blank"
                  rel="noreferrer"
                  title="打开 GitHub 仓库"
                >
                  <ExternalLink class="size-4" />
                </a>
              </div>
              <p class="mt-2 max-w-3xl text-sm leading-6 text-muted">{{ result.repository.description }}</p>
            </div>
            <div class="repo-badges">
              <span>{{ result.repository.defaultBranch }}</span>
              <span>{{ result.repository.license }}</span>
              <span v-if="result.repository.isArchived" class="border-danger/30 bg-red-50 text-danger">Archived</span>
            </div>
          </div>

          <div v-if="result.repository.topics.length" class="mt-4 flex flex-wrap gap-2">
            <span v-for="topic in result.repository.topics.slice(0, 10)" :key="topic" class="topic-chip">{{ topic }}</span>
          </div>
        </article>

        <article class="workspace-panel">
          <div class="flex items-center justify-between">
            <div>
              <p class="section-kicker">AI Score</p>
              <h2 class="text-lg font-semibold text-ink">项目评分</h2>
            </div>
            <span class="rounded-md border border-line px-2 py-1 text-xs font-medium text-muted">
              {{ result.score.source === "cloud" ? result.score.model ?? "云端 API" : "规则评分" }}
            </span>
          </div>

          <div class="mt-4 flex items-center gap-5">
            <div
              class="score-ring"
              :style="{
                background: `conic-gradient(${scoreColor(result.score.total)} ${result.score.total * 3.6}deg, #e6ebf2 0deg)`
              }"
            >
              <div class="score-ring-inner">
                <strong>{{ result.score.total }}</strong>
                <span>/100</span>
              </div>
            </div>
            <div class="min-w-0 flex-1 space-y-2">
              <div v-for="dimension in dimensionItems" :key="dimension.label" class="dimension-row">
                <span>{{ dimension.label }}</span>
                <div class="dimension-track">
                  <div class="dimension-fill" :style="{ width: `${dimension.value}%` }" />
                </div>
                <b>{{ dimension.value }}</b>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section v-if="result" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <article v-for="card in metricCards" :key="card.label" class="metric-card">
          <component :is="card.icon" class="size-5" :class="card.accent" />
          <div>
            <p>{{ card.label }}</p>
            <strong>{{ formatNumber(card.value) }}</strong>
                      </div>
        </article>
      </section>

      <section v-if="result" class="grid gap-5 xl:grid-cols-2">
        <article class="workspace-panel">
          <div class="panel-heading">
            <div>
              <p class="section-kicker">Languages</p>
              <h2>编程语言分布</h2>
            </div>
            <Code2 class="size-5 text-brand" />
          </div>
          <BaseChart :option="languageOption" />
        </article>

        <article class="workspace-panel">
          <div class="panel-heading">
            <div>
              <p class="section-kicker">Activity</p>
              <h2>最近活跃趋势</h2>
            </div>
            <Activity class="size-5 text-success" />
          </div>
          <BaseChart :option="activityOption" />
        </article>
      </section>

      <section v-if="result" class="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <article class="workspace-panel">
          <div class="panel-heading">
            <div>
              <p class="section-kicker">Contributors</p>
              <h2>Top 贡献者</h2>
            </div>
            <Users class="size-5 text-brand" />
          </div>
          <BaseChart :option="contributorsOption" />
        </article>

        <article class="workspace-panel">
          <div class="panel-heading">
            <div>
              <p class="section-kicker">Health</p>
              <h2>项目健康度</h2>
            </div>
            <ShieldCheck class="size-5 text-success" />
          </div>

          <div class="mt-4 grid gap-3 sm:grid-cols-2">
            <div v-for="item in healthItems" :key="item.label" class="health-item">
              <component :is="item.icon" class="size-5 text-muted" />
              <div>
                <p>{{ item.label }}</p>
                <strong>{{ item.value }}</strong>
              </div>
            </div>
          </div>

          <dl class="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <div class="info-cell">
              <dt>创建时间</dt>
              <dd>{{ formatDate(result.repository.createdAt) }}</dd>
            </div>
            <div class="info-cell">
              <dt>更新时间</dt>
              <dd>{{ formatDate(result.repository.updatedAt) }}</dd>
            </div>
            <div class="info-cell">
              <dt>生成时间</dt>
              <dd>{{ formatDate(result.generatedAt) }}</dd>
            </div>
          </dl>
        </article>
      </section>

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
    </main>
  </div>
</template>
