import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Provider, Language } from './config.js';

export interface CommitMessage {
  type: string;
  scope?: string;
  subject: string;
}

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
- scope: optional, short identifier for affected area (MUST be in English)
- subject: MUST be written in Korean, max 72 chars, no period at end
- Provide 3 different variations with different wording or focus

Example output:
{ "candidates": [
  { "type": "feat", "scope": "auth", "subject": "OAuth2 로그인 지원 추가" },
  { "type": "feat", "scope": "auth", "subject": "OAuth2 인증 흐름 구현" },
  { "type": "feat", "subject": "OAuth2를 통한 소셜 로그인 추가" }
]}`;

function getSystemPrompt(language: Language, issueReference?: string): string {
  let prompt = language === 'korean' ? SYSTEM_PROMPT_KO : SYSTEM_PROMPT_EN;

  if (issueReference) {
    prompt += `\n\nIMPORTANT: Include "${issueReference}" at the end of each subject.`;
  }

  return prompt;
}

function buildUserPrompt(diff: string, fileSummary: string): string {
  return `Generate 3 commit message candidates for the following changes:

## Files Changed:
${fileSummary || 'No files changed'}

## Diff:
${diff || 'No diff available'}`;
}

function parseJsonFromText(text: string): unknown {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) ||
                    text.match(/(\{[\s\S]*\})/);

  if (jsonMatch) {
    return JSON.parse(jsonMatch[1].trim());
  }

  return JSON.parse(text);
}

function validateCandidates(data: unknown): CommitMessage[] {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Response is not an object');
  }

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.candidates)) {
    throw new Error('Missing candidates array');
  }

  return obj.candidates.slice(0, 3).map((candidate) => {
    const c = candidate as Record<string, unknown>;
    let subject = String(c.subject || '').trim();

    if (subject.endsWith('.')) {
      subject = subject.slice(0, -1);
    }

    if (subject.length > 72) {
      subject = subject.substring(0, 69) + '...';
    }

    return {
      type: String(c.type || 'chore'),
      scope: c.scope ? String(c.scope).trim() : undefined,
      subject
    };
  });
}

async function callOpenAI(
  apiKey: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language,
  issueReference?: string
): Promise<CommitMessage[]> {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: getSystemPrompt(language, issueReference) },
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

  return validateCandidates(JSON.parse(content));
}

async function callGroq(
  apiKey: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language,
  issueReference?: string
): Promise<CommitMessage[]> {
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1'
  });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: getSystemPrompt(language, issueReference) },
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

  return validateCandidates(JSON.parse(content));
}

async function callGemini(
  apiKey: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language,
  issueReference?: string
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

  const prompt = `${getSystemPrompt(language, issueReference)}

${buildUserPrompt(diff, fileSummary)}`;

  const result = await geminiModel.generateContent(prompt);
  const text = result.response.text();

  if (!text) {
    throw new Error('Empty response from Gemini');
  }

  return validateCandidates(parseJsonFromText(text));
}

async function callOllama(
  ollamaUrl: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language,
  issueReference?: string
): Promise<CommitMessage[]> {
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: getSystemPrompt(language, issueReference) },
        { role: 'user', content: buildUserPrompt(diff, fileSummary) }
      ],
      format: 'json',
      stream: false
    })
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Model "${model}" not found. Run: ollama pull ${model}`);
    }
    throw new Error(`Ollama request failed: ${response.status}`);
  }

  const data = await response.json() as { message?: { content?: string } };
  const content = data.message?.content;

  if (!content) {
    throw new Error('Empty response from Ollama');
  }

  return validateCandidates(parseJsonFromText(content));
}

export async function generateCommitMessages(
  provider: Provider,
  apiKey: string,
  diff: string,
  fileSummary: string,
  model: string,
  language: Language,
  ollamaUrl?: string,
  issueReference?: string
): Promise<CommitMessage[]> {
  switch (provider) {
    case 'openai':
      return callOpenAI(apiKey, model, diff, fileSummary, language, issueReference);
    case 'groq':
      return callGroq(apiKey, model, diff, fileSummary, language, issueReference);
    case 'gemini':
      return callGemini(apiKey, model, diff, fileSummary, language, issueReference);
    case 'ollama':
      return callOllama(ollamaUrl || 'http://localhost:11434', model, diff, fileSummary, language, issueReference);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

export function formatCommitMessage(commit: CommitMessage): string {
  if (commit.scope) {
    return `${commit.type}(${commit.scope}): ${commit.subject}`;
  }
  return `${commit.type}: ${commit.subject}`;
}
