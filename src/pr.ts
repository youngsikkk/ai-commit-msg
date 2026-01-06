import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Language, Provider } from './types';
import type { CommitRuleset } from './ruleset';

const PR_SYSTEM_PROMPT_EN = `You are a PR description generator. Analyze the git diff and generate a well-structured PR description in markdown format.

Output format:
# <Title: short summary, max 50 chars>

## Summary
<What this PR does in 2-3 sentences>

## Changes
<Bullet list of main changes>

## Testing
<How to test these changes>

Rules:
- Title should be concise and descriptive (max 50 chars)
- Summary should explain the "why" and "what" of the changes
- Changes should be a bullet list of the main modifications
- Testing should include specific steps or scenarios to verify the changes
- Use clear, professional language`;

const PR_SYSTEM_PROMPT_KO = `You are a PR description generator. Analyze the git diff and generate a well-structured PR description in markdown format.

Output format:
# <Title: 짧은 요약, 최대 50자>

## 요약
<이 PR이 무엇을 하는지 2-3문장으로 설명>

## 변경 사항
<주요 변경 사항 bullet list>

## 테스트
<변경 사항을 테스트하는 방법>

Rules:
- Title은 간결하고 설명적이어야 합니다 (최대 50자)
- 요약은 변경의 "왜"와 "무엇"을 설명해야 합니다
- 변경 사항은 주요 수정 사항의 bullet list여야 합니다
- 테스트는 변경 사항을 확인하는 구체적인 단계나 시나리오를 포함해야 합니다
- 명확하고 전문적인 언어를 사용하세요`;

function getPRSystemPrompt(language: Language, ruleset?: CommitRuleset): string {
  let basePrompt = language === 'korean' ? PR_SYSTEM_PROMPT_KO : PR_SYSTEM_PROMPT_EN;

  if (ruleset?.customPrompt) {
    basePrompt += `\n\nAdditional instructions: ${ruleset.customPrompt}`;
  }

  return basePrompt;
}

function buildPRUserPrompt(diff: string, fileSummary: string): string {
  return `Generate a PR description for the following changes:

## Files Changed:
${fileSummary || 'No files changed'}

## Diff:
${diff || 'No diff available'}`;
}

// OpenAI PR description generation
async function generatePRWithOpenAI(
  apiKey: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language,
  ruleset?: CommitRuleset
): Promise<string> {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: getPRSystemPrompt(language, ruleset) },
      { role: 'user', content: buildPRUserPrompt(diff, fileSummary) }
    ],
    temperature: 0.7,
    max_tokens: 1000
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  return content.trim();
}

// Groq PR description generation
async function generatePRWithGroq(
  apiKey: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language,
  ruleset?: CommitRuleset
): Promise<string> {
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1'
  });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: getPRSystemPrompt(language, ruleset) },
      { role: 'user', content: buildPRUserPrompt(diff, fileSummary) }
    ],
    temperature: 0.7,
    max_tokens: 1000
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from Groq');
  }

  return content.trim();
}

// Gemini PR description generation
async function generatePRWithGemini(
  apiKey: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language,
  ruleset?: CommitRuleset
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1000
    }
  });

  const prompt = `${getPRSystemPrompt(language, ruleset)}

${buildPRUserPrompt(diff, fileSummary)}`;

  const result = await geminiModel.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  if (!text) {
    throw new Error('Empty response from Gemini');
  }

  return text.trim();
}

// Ollama PR description generation
async function generatePRWithOllama(
  ollamaUrl: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language,
  ruleset?: CommitRuleset
): Promise<string> {
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: getPRSystemPrompt(language, ruleset) },
        { role: 'user', content: buildPRUserPrompt(diff, fileSummary) }
      ],
      stream: false
    })
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Model "${model}" not found. Run: ollama pull ${model}`);
    }
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { message?: { content?: string } };
  const content = data.message?.content;

  if (!content) {
    throw new Error('Empty response from Ollama');
  }

  return content.trim();
}

// Provider dispatcher for PR description generation
export async function generatePRDescription(
  provider: Provider,
  apiKey: string,
  diff: string,
  fileSummary: string,
  model: string,
  language: Language,
  ollamaUrl?: string,
  ruleset?: CommitRuleset
): Promise<string> {
  switch (provider) {
    case 'openai':
      return generatePRWithOpenAI(apiKey, model, diff, fileSummary, language, ruleset);
    case 'groq':
      return generatePRWithGroq(apiKey, model, diff, fileSummary, language, ruleset);
    case 'gemini':
      return generatePRWithGemini(apiKey, model, diff, fileSummary, language, ruleset);
    case 'ollama':
      return generatePRWithOllama(ollamaUrl || 'http://localhost:11434', model, diff, fileSummary, language, ruleset);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
