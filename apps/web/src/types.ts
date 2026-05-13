export type RepositoryInfo = {
  owner: string;
  name: string;
  fullName: string;
  description: string;
  url: string;
  homepage: string | null;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  license: string;
  topics: string[];
  isArchived: boolean;
};

export type Metrics = {
  stars: number;
  forks: number;
  watchers: number;
  branches: number;
  openIssues: number;
  openPullRequests: number;
  contributors: number;
};

export type LanguageStat = {
  name: string;
  bytes: number;
  percent: number;
};

export type ContributorStat = {
  login: string;
  avatarUrl: string;
  profileUrl: string;
  contributions: number;
};

export type ActivityPoint = {
  date: string;
  commits: number;
  issues: number;
  pullRequests: number;
};

export type HealthMetrics = {
  updatedDaysAgo: number | null;
  commitsLast30Days: number;
  averageIssueResponseHours: number | null;
  prMergeRate: number | null;
  openIssueRatio: number | null;
  hasReadme: boolean;
  hasCi: boolean;
};

export type ScoreDimensions = {
  activity: number;
  community: number;
  quality: number;
  maintenance: number;
  trend: number;
};

export type ScoreResult = {
  total: number;
  dimensions: ScoreDimensions;
  comment: string;
  source: "cloud" | "rules";
  model: string | null;
};

export type AnalysisResult = {
  repository: RepositoryInfo;
  metrics: Metrics;
  languages: LanguageStat[];
  contributors: ContributorStat[];
  activity: ActivityPoint[];
  health: HealthMetrics;
  score: ScoreResult;
  generatedAt: string;
};
