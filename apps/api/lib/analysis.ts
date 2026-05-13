import { cached } from "./cache";
import {
  cacheKey,
  cacheTtlMs,
  getTotalFromLinkHeader,
  githubJson,
  optionalGithubJson,
  parseRepoInput,
  type GitHubCommit,
  type GitHubContent,
  type GitHubContributor,
  type GitHubIssue,
  type GitHubPullRequest,
  type GitHubRepo
} from "./github";
import { scoreRepository } from "./scoring";
import type { ActivityPoint, AnalysisResult, ContributorStat, HealthMetrics, LanguageStat, Metrics, RepositoryInfo } from "./types";

export async function analyzeRepository(input: string): Promise<AnalysisResult> {
  const ref = parseRepoInput(input);

  return cached(cacheKey(ref, "analysis"), cacheTtlMs(), async () => {
    const repoResponse = await githubJson<GitHubRepo>(`/repos/${ref.owner}/${ref.repo}`);
    const canonicalRef = {
      owner: repoResponse.data.owner.login,
      repo: repoResponse.data.name
    };
    const encodedRepo = `${canonicalRef.owner}/${canonicalRef.repo}`;

    const [
      languagesResponse,
      branchesResponse,
      contributorsResponse,
      commitsResponse,
      issuesResponse,
      pullsResponse,
      readme,
      workflows
    ] = await Promise.all([
      githubJson<Record<string, number>>(`/repos/${encodedRepo}/languages`),
      githubJson<unknown[]>(`/repos/${encodedRepo}/branches?per_page=100`),
      githubJson<GitHubContributor[]>(`/repos/${encodedRepo}/contributors?per_page=100`),
      githubJson<GitHubCommit[]>(`/repos/${encodedRepo}/commits?per_page=100`),
      githubJson<GitHubIssue[]>(`/repos/${encodedRepo}/issues?state=all&per_page=100`),
      githubJson<GitHubPullRequest[]>(`/repos/${encodedRepo}/pulls?state=all&per_page=100`),
      optionalGithubJson<GitHubContent | null>(`/repos/${encodedRepo}/readme`, null),
      optionalGithubJson<GitHubContent[]>(`/repos/${encodedRepo}/contents/.github/workflows`, [])
    ]);

    const repository = mapRepository(repoResponse.data);
    const issues = issuesResponse.data.filter((issue) => !issue.pull_request);
    const metrics = buildMetrics(
      repoResponse.data,
      branchesResponse.headers,
      branchesResponse.data.length,
      contributorsResponse.headers,
      contributorsResponse.data.length,
      issues,
      pullsResponse.data
    );
    const languages = buildLanguages(languagesResponse.data);
    const contributors = buildContributors(contributorsResponse.data);
    const activity = buildActivity(commitsResponse.data, issues, pullsResponse.data);
    const health = buildHealth(repository, commitsResponse.data, issues, pullsResponse.data, readme !== null, workflows.length > 0);
    const score = await scoreRepository({
      repository,
      metrics,
      languages,
      contributors,
      activity,
      health
    });

    return {
      repository,
      metrics,
      languages,
      contributors,
      activity,
      health,
      score,
      generatedAt: new Date().toISOString()
    };
  });
}

function mapRepository(repo: GitHubRepo): RepositoryInfo {
  return {
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    description: repo.description ?? "暂无描述",
    url: repo.html_url,
    homepage: repo.homepage,
    defaultBranch: repo.default_branch,
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
    pushedAt: repo.pushed_at,
    license: repo.license?.spdx_id || repo.license?.name || "未声明",
    topics: repo.topics ?? [],
    isArchived: repo.archived
  };
}

function buildMetrics(
  repo: GitHubRepo,
  branchHeaders: Headers,
  branchPageLength: number,
  contributorHeaders: Headers,
  contributorPageLength: number,
  issues: GitHubIssue[],
  pulls: GitHubPullRequest[]
): Metrics {
  return {
    stars: repo.stargazers_count,
    forks: repo.forks_count,
    watchers: repo.watchers_count,
    branches: getTotalFromLinkHeader(branchHeaders, branchPageLength),
    openIssues: issues.filter((issue) => issue.state === "open").length,
    openPullRequests: pulls.filter((pull) => pull.state === "open").length,
    contributors: getTotalFromLinkHeader(contributorHeaders, contributorPageLength)
  };
}

function buildLanguages(languageMap: Record<string, number>): LanguageStat[] {
  const total = Object.values(languageMap).reduce((sum, bytes) => sum + bytes, 0);

  return Object.entries(languageMap)
    .map(([name, bytes]) => ({
      name,
      bytes,
      percent: total === 0 ? 0 : Math.round((bytes / total) * 1000) / 10
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

function buildContributors(contributors: GitHubContributor[]): ContributorStat[] {
  return contributors
    .filter((contributor) => contributor.type !== "Bot")
    .slice(0, 10)
    .map((contributor) => ({
      login: contributor.login,
      avatarUrl: contributor.avatar_url,
      profileUrl: contributor.html_url,
      contributions: contributor.contributions
    }));
}

function buildActivity(commits: GitHubCommit[], issues: GitHubIssue[], pulls: GitHubPullRequest[]): ActivityPoint[] {
  const buckets = new Map<string, ActivityPoint>();
  const now = new Date();

  for (let index = 11; index >= 0; index -= 1) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - index * 7);
    const key = start.toISOString().slice(0, 10);
    buckets.set(key, {
      date: key,
      commits: 0,
      issues: 0,
      pullRequests: 0
    });
  }

  const keys = [...buckets.keys()];

  for (const commit of commits) {
    incrementBucket(keys, buckets, commit.commit.author?.date ?? commit.commit.committer?.date, "commits");
  }

  for (const issue of issues) {
    incrementBucket(keys, buckets, issue.created_at, "issues");
  }

  for (const pull of pulls) {
    incrementBucket(keys, buckets, pull.created_at, "pullRequests");
  }

  return [...buckets.values()];
}

function incrementBucket(keys: string[], buckets: Map<string, ActivityPoint>, dateValue: string | undefined, field: keyof Omit<ActivityPoint, "date">) {
  if (!dateValue) {
    return;
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return;
  }

  let key: string | undefined;
  for (let index = keys.length - 1; index >= 0; index -= 1) {
    const candidate = keys[index];
    if (date >= new Date(`${candidate}T00:00:00.000Z`)) {
      key = candidate;
      break;
    }
  }
  if (!key) {
    return;
  }

  const bucket = buckets.get(key);
  if (bucket) {
    bucket[field] += 1;
  }
}

function buildHealth(
  repository: RepositoryInfo,
  commits: GitHubCommit[],
  issues: GitHubIssue[],
  pulls: GitHubPullRequest[],
  hasReadme: boolean,
  hasCi: boolean
): HealthMetrics {
  const now = Date.now();
  const updatedAt = new Date(repository.pushedAt || repository.updatedAt);
  const updatedDaysAgo = Number.isNaN(updatedAt.getTime()) ? null : Math.max(0, Math.round((now - updatedAt.getTime()) / 86_400_000));
  const thirtyDaysAgo = now - 30 * 86_400_000;
  const commitsLast30Days = commits.filter((commit) => {
    const rawDate = commit.commit.author?.date ?? commit.commit.committer?.date;
    const timestamp = rawDate ? new Date(rawDate).getTime() : Number.NaN;
    return Number.isFinite(timestamp) && timestamp >= thirtyDaysAgo;
  }).length;
  const closedIssues = issues.filter((issue) => issue.closed_at);
  const averageIssueResponseHours =
    closedIssues.length === 0
      ? null
      : Math.round(
          closedIssues.reduce((sum, issue) => {
            const created = new Date(issue.created_at).getTime();
            const closed = issue.closed_at ? new Date(issue.closed_at).getTime() : created;
            return sum + Math.max(0, closed - created) / 3_600_000;
          }, 0) / closedIssues.length
        );
  const closedPulls = pulls.filter((pull) => pull.state === "closed");
  const mergedPulls = closedPulls.filter((pull) => pull.merged_at);
  const prMergeRate = closedPulls.length === 0 ? null : Math.round((mergedPulls.length / closedPulls.length) * 100) / 100;
  const openIssueRatio = issues.length === 0 ? null : Math.round((issues.filter((issue) => issue.state === "open").length / issues.length) * 100) / 100;

  return {
    updatedDaysAgo,
    commitsLast30Days,
    averageIssueResponseHours,
    prMergeRate,
    openIssueRatio,
    hasReadme,
    hasCi
  };
}
