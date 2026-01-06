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
}

export const VALID_COMMIT_TYPES: CommitType[] = [
  'feat', 'fix', 'docs', 'style', 'refactor',
  'perf', 'test', 'build', 'ci', 'chore'
];
