import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { CommitMessage, CommitType, Language, Provider } from './types';
import { VALID_COMMIT_TYPES } from './types';

const SYSTEM_PROMPT_EN = `You are a commit message generator. Analyze the git diff and generate 3 different commit message suggestions following Conventional Commits format.

Output JSON only: { "candidates": [{ "type": "...", "scope": "...", "subject": "..." }, ...] }

Rules:
- type: one of feat, fix, docs, style, refactor, perf, test, build, ci, chore
- scope: optional, short identifier for affected area (e.g., "auth", "api", "ui"). Omit if changes span multiple areas
- subject: imperative mood (e.g., "add", "fix", "update"), max 72 chars, no period at end, lowercase first letter
- Provide 3 different variations with different wording or focus

Example output:
{ "candidates": [
  { "type": "feat", "scope": "auth", "subject": "add OAuth2 login support" },
  { "type": "feat", "scope": "auth", "subject": "implement OAuth2 authentication flow" },
  { "type": "feat", "subject": "add social login via OAuth2" }
]}`;

const SYSTEM_PROMPT_KO = `You are a commit message generator. Analyze the git diff and generate 3 different commit message suggestions following Conventional Commits format.

Output JSON only: { "candidates": [{ "type": "...", "scope": "...", "subject": "..." }, ...] }

Rules:
- type: one of feat, fix, docs, style, refactor, perf, test, build, ci, chore (MUST be in English)
- scope: optional, short identifier for affected area (e.g., "auth", "api", "ui"). Omit if changes span multiple areas (MUST be in English)
- subject: MUST be written in Korean, max 72 chars, no period at end
- Provide 3 different variations with different wording or focus

Example output:
{ "candidates": [
  { "type": "feat", "scope": "auth", "subject": "OAuth2 로그인 지원 추가" },
  { "type": "feat", "scope": "auth", "subject": "OAuth2 인증 흐름 구현" },
  { "type": "feat", "subject": "OAuth2를 통한 소셜 로그인 추가" }
]}`;

function getSystemPrompt(language: Language): string {
  return language === 'korean' ? SYSTEM_PROMPT_KO : SYSTEM_PROMPT_EN;
}

function buildUserPrompt(diff: string, fileSummary: string): string {
  return `Generate 3 commit message candidates for the following changes:

## Files Changed:
${fileSummary || 'No files changed'}

## Diff:
${diff || 'No diff available'}`;
}

function validateSingleCommitMessage(data: unknown): CommitMessage {
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

  // Ensure lowercase first letter (only for English)
  if (subject.length > 0 && /^[a-zA-Z]/.test(subject)) {
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

function validateCommitMessageCandidates(data: unknown): CommitMessage[] {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Response is not an object');
  }

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.candidates)) {
    throw new Error('Missing or invalid "candidates" array');
  }

  if (obj.candidates.length < 1) {
    throw new Error('No candidates provided');
  }

  return obj.candidates.slice(0, 3).map((candidate, index) => {
    try {
      return validateSingleCommitMessage(candidate);
    } catch (error) {
      throw new Error(`Invalid candidate ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function parseJsonFromText(text: string): unknown {
  // Try to extract JSON from the response (handles markdown code blocks)
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                    text.match(/(\{[\s\S]*\})/);

  if (jsonMatch) {
    return JSON.parse(jsonMatch[1].trim());
  }

  return JSON.parse(text);
}

// OpenAI API call
async function callOpenAI(
  apiKey: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language
): Promise<CommitMessage[]> {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: getSystemPrompt(language) },
      { role: 'user', content: buildUserPrompt(diff, fileSummary) }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 500
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  const parsed = JSON.parse(content);
  return validateCommitMessageCandidates(parsed);
}

// Groq API call (uses OpenAI SDK with different baseURL)
async function callGroq(
  apiKey: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language
): Promise<CommitMessage[]> {
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1'
  });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: getSystemPrompt(language) },
      { role: 'user', content: buildUserPrompt(diff, fileSummary) }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7,
    max_tokens: 500
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from Groq');
  }

  const parsed = JSON.parse(content);
  return validateCommitMessageCandidates(parsed);
}

// Gemini API call
async function callGemini(
  apiKey: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language
): Promise<CommitMessage[]> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 500,
      responseMimeType: 'application/json'
    }
  });

  const prompt = `${getSystemPrompt(language)}

${buildUserPrompt(diff, fileSummary)}`;

  const result = await geminiModel.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  if (!text) {
    throw new Error('Empty response from Gemini');
  }

  const parsed = parseJsonFromText(text);
  return validateCommitMessageCandidates(parsed);
}

// Provider dispatcher
async function callProviderForCandidates(
  provider: Provider,
  apiKey: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language
): Promise<CommitMessage[]> {
  switch (provider) {
    case 'openai':
      return callOpenAI(apiKey, model, diff, fileSummary, language);
    case 'groq':
      return callGroq(apiKey, model, diff, fileSummary, language);
    case 'gemini':
      return callGemini(apiKey, model, diff, fileSummary, language);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export async function generateCommitMessageCandidates(
  provider: Provider,
  apiKey: string,
  diff: string,
  fileSummary: string,
  model: string,
  language: Language
): Promise<CommitMessage[]> {
  // First attempt
  try {
    return await callProviderForCandidates(provider, apiKey, model, diff, fileSummary, language);
  } catch (error) {
    // Retry once on failure
    try {
      return await callProviderForCandidates(provider, apiKey, model, diff, fileSummary, language);
    } catch (retryError) {
      const message = retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(`Failed to generate commit messages after retry: ${message}`);
    }
  }
}

export function formatCommitMessage(commit: CommitMessage): string {
  if (commit.scope) {
    return `${commit.type}(${commit.scope}): ${commit.subject}`;
  }
  return `${commit.type}: ${commit.subject}`;
}
