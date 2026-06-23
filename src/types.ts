export type CommitType =
  | 'feat'
  | 'fix'
  | 'docs'
  | 'style'
  | 'refactor'
  | 'perf'
  | 'test'
  | 'build'
  | 'ci'
  | 'chore';

export interface CommitMessage {
  type: CommitType;
  scope?: string;
  subject: string;
}

export interface DiffResult {
  diff: string;
  fileSummary: string;
  truncated: boolean;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface ImpactRiskAnalysis {
  changedFiles: number;
  additions: number;
  deletions: number;
  changedLines: number;
  testFilesChanged: boolean;
  categories: string[];
  affectedAreas: string[];
  riskLevel: RiskLevel;
  riskScore: number;
  riskFactors: string[];
  impactSummary: string[];
  reviewFocus: string[];
  testSuggestions: string[];
  suggestedCommitSplits: string[];
  deploymentChecklist: string[];
}

export type ValidationStatus = 'passed' | 'failed' | 'skipped';

export interface ValidationCommandResult {
  command: string;
  status: ValidationStatus;
  exitCode?: number;
  durationMs: number;
  output: string;
}

export interface ValidationReport {
  enabled: boolean;
  results: ValidationCommandResult[];
  passed: number;
  failed: number;
  skipped: number;
  summary: string;
}

export type Language = 'english' | 'korean';

export type Provider = 'openai' | 'groq' | 'gemini' | 'ollama';

export interface Config {
  provider: Provider;
  model: string;
  ollamaUrl: string;
  maxDiffChars: number;
  exclude: string[];
  language: Language;
  maskSensitiveInfo: boolean;
  summarizeLargeDiff: boolean;
  largeDiffThreshold: number;
  issuePrefix: string;
  issueBranchPattern: string;
  includeImpactRiskAnalysis: boolean;
  runValidationBeforePR: boolean;
  validationCommands: string[];
  validationTimeoutMs: number;
  maxValidationOutputChars: number;
}

export const VALID_COMMIT_TYPES: CommitType[] = [
  'feat', 'fix', 'docs', 'style', 'refactor',
  'perf', 'test', 'build', 'ci', 'chore'
];
