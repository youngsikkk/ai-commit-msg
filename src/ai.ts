import OpenAI from 'openai';
import type { CommitMessage, CommitType, Language } from './types';
import { VALID_COMMIT_TYPES } from './types';

const SYSTEM_PROMPT_EN = `You are a commit message generator. Analyze the git diff and generate a commit message following Conventional Commits format.

Output JSON only: { "type": "...", "scope": "...", "subject": "..." }

Rules:
- type: one of feat, fix, docs, style, refactor, perf, test, build, ci, chore
- scope: optional, short identifier for affected area (e.g., "auth", "api", "ui"). Omit if changes span multiple areas
- subject: imperative mood (e.g., "add", "fix", "update"), max 72 chars, no period at end, lowercase first letter

Examples:
- { "type": "feat", "scope": "auth", "subject": "add OAuth2 login support" }
- { "type": "fix", "subject": "resolve memory leak in image processing" }
- { "type": "refactor", "scope": "api", "subject": "simplify error handling middleware" }`;

const SYSTEM_PROMPT_KO = `You are a commit message generator. Analyze the git diff and generate a commit message following Conventional Commits format.

Output JSON only: { "type": "...", "scope": "...", "subject": "..." }

Rules:
- type: one of feat, fix, docs, style, refactor, perf, test, build, ci, chore (MUST be in English)
- scope: optional, short identifier for affected area (e.g., "auth", "api", "ui"). Omit if changes span multiple areas (MUST be in English)
- subject: MUST be written in Korean, max 72 chars, no period at end

Examples:
- { "type": "feat", "scope": "auth", "subject": "OAuth2 로그인 지원 추가" }
- { "type": "fix", "subject": "이미지 처리 메모리 누수 해결" }
- { "type": "refactor", "scope": "api", "subject": "에러 핸들링 미들웨어 단순화" }`;

function getSystemPrompt(language: Language): string {
  return language === 'korean' ? SYSTEM_PROMPT_KO : SYSTEM_PROMPT_EN;
}

function buildUserPrompt(diff: string, fileSummary: string): string {
  return `Generate a commit message for the following changes:

## Files Changed:
${fileSummary || 'No files changed'}

## Diff:
${diff || 'No diff available'}`;
}

function validateCommitMessage(data: unknown): CommitMessage {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Response is not an object');
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.type !== 'string') {
    throw new Error('Missing or invalid "type" field');
  }

  if (!VALID_COMMIT_TYPES.includes(obj.type as CommitType)) {
    throw new Error(`Invalid commit type: ${obj.type}`);
  }

  if (typeof obj.subject !== 'string' || obj.subject.trim().length === 0) {
    throw new Error('Missing or invalid "subject" field');
  }

  let subject = obj.subject.trim();

  // Ensure subject doesn't end with period
  if (subject.endsWith('.')) {
    subject = subject.slice(0, -1);
  }

  // Ensure lowercase first letter
  if (subject.length > 0) {
    subject = subject.charAt(0).toLowerCase() + subject.slice(1);
  }

  // Truncate if too long
  if (subject.length > 72) {
    subject = subject.substring(0, 69) + '...';
  }

  return {
    type: obj.type as CommitType,
    scope: typeof obj.scope === 'string' && obj.scope.trim() ? obj.scope.trim() : undefined,
    subject
  };
}

async function callOpenAI(
  client: OpenAI,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language
): Promise<CommitMessage> {
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: getSystemPrompt(language) },
      { role: 'user', content: buildUserPrompt(diff, fileSummary) }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.3,
    max_tokens: 200
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  const parsed = JSON.parse(content);
  return validateCommitMessage(parsed);
}

export async function generateCommitMessage(
  apiKey: string,
  diff: string,
  fileSummary: string,
  model: string,
  language: Language
): Promise<CommitMessage> {
  const client = new OpenAI({ apiKey });

  // First attempt
  try {
    return await callOpenAI(client, model, diff, fileSummary, language);
  } catch (error) {
    // Retry once on failure
    try {
      return await callOpenAI(client, model, diff, fileSummary, language);
    } catch (retryError) {
      // Re-throw the retry error with more context
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(`Failed to generate commit message after retry: ${message}`);
    }
  }
}

export function formatCommitMessage(commit: CommitMessage): string {
  if (commit.scope) {
    return `${commit.type}(${commit.scope}): ${commit.subject}`;
  }
  return `${commit.type}: ${commit.subject}`;
}
