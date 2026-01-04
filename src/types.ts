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

export interface Config {
  model: string;
  maxDiffChars: number;
  exclude: string[];
  language: Language;
}

export const VALID_COMMIT_TYPES: CommitType[] = [
  'feat', 'fix', 'docs', 'style', 'refactor',
  'perf', 'test', 'build', 'ci', 'chore'
];
