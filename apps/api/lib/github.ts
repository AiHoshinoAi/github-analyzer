import { AppError, type RepoRef } from "./types";

const GITHUB_API_BASE = "https://api.github.com";
const CACHE_TTL_MS = 10 * 60 * 1000;

type GitHubResponse<T> = {
  data: T;
  headers: Headers;
};

export type GitHubRepo = {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  archived: boolean;
  topics?: string[];
  owner: {
    login: string;
  };
  license: {
    spdx_id: string | null;
    name: string | null;
  } | null;
};

export type GitHubContributor = {
  login: string;
  avatar_url: string;
  html_url: string;
  contributions: number;
  type: string;
};

export type GitHubCommit = {
  sha: string;
  commit: {
    author?: {
      date?: string;
    } | null;
    committer?: {
      date?: string;
    } | null;
  };
};

export type GitHubIssue = {
  id: number;
  number: number;
  state: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  pull_request?: unknown;
};

export type GitHubPullRequest = {
  id: number;
  number: number;
  state: "open" | "closed";
  created_at: string;
  closed_at: string | null;
  merged_at: string | null;
};

export type GitHubContent = {
  type: string;
  name: string;
  path: string;
};

export function parseRepoInput(rawInput: string): RepoRef {
  const input = rawInput.trim();

  if (!input) {
    throw new AppError(400, "INVALID_URL", "请输入 GitHub 仓库 URL。");
  }

  const shorthand = input.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  if (shorthand) {
    return {
      owner: shorthand[1],
      repo: shorthand[2]
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new AppError(400, "INVALID_URL", "URL 格式不正确，请输入公开 GitHub 仓库地址。");
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    throw new AppError(400, "INVALID_URL", "仅支持 github.com 仓库地址。");
  }

  const [owner, repoWithSuffix] = parsed.pathname.split("/").filter(Boolean);
  if (!owner || !repoWithSuffix) {
    throw new AppError(400, "INVALID_URL", "GitHub URL 缺少 owner 或 repo。");
  }

  return {
    owner,
    repo: repoWithSuffix.replace(/\.git$/, "")
  };
}

export function cacheKey(ref: RepoRef, suffix: string): string {
  return `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}:${suffix}`;
}

export function cacheTtlMs(): number {
  return CACHE_TTL_MS;
}

export async function githubJson<T>(path: string): Promise<GitHubResponse<T>> {
  const token = process.env.GITHUB_TOKEN;
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "github-analyzer-local",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    next: {
      revalidate: 0
    }
  });

  if (response.status === 404) {
    throw new AppError(404, "NOT_FOUND", "仓库不存在、不可访问，或 GitHub API 资源不存在。");
  }

  if (response.status === 401 || response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = response.headers.get("x-ratelimit-reset");
    const suffix = remaining === "0" && reset ? `，限流重置时间戳：${reset}` : "";
    throw new AppError(429, "RATE_LIMITED", `GitHub API 请求受限，请配置 GITHUB_TOKEN 后重试${suffix}。`);
  }

  if (!response.ok) {
    throw new AppError(response.status, "GITHUB_ERROR", `GitHub API 请求失败：${response.status}`);
  }

  return {
    data: (await response.json()) as T,
    headers: response.headers
  };
}

export async function optionalGithubJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await githubJson<T>(path);
    return response.data;
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      return fallback;
    }

    throw error;
  }
}

export function getTotalFromLinkHeader(headers: Headers, currentLength: number): number {
  const linkHeader = headers.get("link");
  if (!linkHeader) {
    return currentLength;
  }

  const lastMatch = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);
  if (!lastMatch) {
    return currentLength;
  }

  const pageCount = Number.parseInt(lastMatch[1], 10);
  if (Number.isNaN(pageCount) || pageCount < 1) {
    return currentLength;
  }

  return Math.max(currentLength, pageCount * 100);
}
