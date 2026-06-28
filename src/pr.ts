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

## Impact
<Affected areas and expected behavior impact>

## Risk
<Risk level, risk factors, and reviewer attention points>

## Security Review
<Security-sensitive review points when provided>

## Suggested Remediation
<Concrete remediation direction when risk signals are present>

## Testing
<How to test these changes>

## Validation
<Automated validation result if provided, otherwise say not run>

## Suggested Commit Split
<Optional split recommendation when the change mixes unrelated areas>

## Deployment Checklist
<Optional pre-deploy checklist for risky changes>

## Fix Prompt
<Optional prompt developers can copy into an AI coding assistant for safe remediation>

Rules:
- Title should be concise and descriptive (max 50 chars)
- Summary should explain the "why" and "what" of the changes
- Changes should be a bullet list of the main modifications
- Impact should explain affected modules, users, data, or runtime behavior
- Risk should use the provided automated analysis context when available
- Testing should include specific steps or scenarios to verify the changes
- Validation should summarize configured validation commands and failures when provided
- Security Review and Suggested Remediation should preserve the provided automated analysis context
- Include Suggested Commit Split, Deployment Checklist, and Fix Prompt when they are present in the automated context
- Use clear, professional language`;

const PR_SYSTEM_PROMPT_KO = `${PR_SYSTEM_PROMPT_EN}

Language:
- Write the title and body content in Korean.
- Keep markdown headings in English so GitHub, GitLab, and Bitbucket templates stay easy to scan.
- Keep Conventional Commit style words such as feat, fix, chore, and docs in English when mentioned.`;

function getPRSystemPrompt(language: Language, ruleset?: CommitRuleset): string {
  let basePrompt = language === 'korean' ? PR_SYSTEM_PROMPT_KO : PR_SYSTEM_PROMPT_EN;

  if (ruleset?.customPrompt) {
    basePrompt += `\n\nAdditional instructions: ${ruleset.customPrompt}`;
  }

  return basePrompt;
}

function buildPRUserPrompt(diff: string, fileSummary: string, analysisContext?: string): string {
  return `Generate a PR description for the following changes:

## Files Changed:
${fileSummary || 'No files changed'}

## Automated Analysis Context:
${analysisContext || 'No automated impact/risk/validation context provided'}

## Diff:
${diff || 'No diff available'}`;
}

async function generatePRWithOpenAI(
  apiKey: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language,
  ruleset?: CommitRuleset,
  analysisContext?: string
): Promise<string> {
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: getPRSystemPrompt(language, ruleset) },
      { role: 'user', content: buildPRUserPrompt(diff, fileSummary, analysisContext) }
    ],
    temperature: 0.7,
    max_tokens: 1800
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  return content.trim();
}

async function generatePRWithGroq(
  apiKey: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language,
  ruleset?: CommitRuleset,
  analysisContext?: string
): Promise<string> {
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.groq.com/openai/v1'
  });

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: getPRSystemPrompt(language, ruleset) },
      { role: 'user', content: buildPRUserPrompt(diff, fileSummary, analysisContext) }
    ],
    temperature: 0.7,
    max_tokens: 1800
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from Groq');
  }

  return content.trim();
}

async function generatePRWithGemini(
  apiKey: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language,
  ruleset?: CommitRuleset,
  analysisContext?: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1800
    }
  });

  const prompt = `${getPRSystemPrompt(language, ruleset)}

${buildPRUserPrompt(diff, fileSummary, analysisContext)}`;

  const result = await geminiModel.generateContent(prompt);
  const response = result.response;
  const text = response.text();

  if (!text) {
    throw new Error('Empty response from Gemini');
  }

  return text.trim();
}

async function generatePRWithOllama(
  ollamaUrl: string,
  model: string,
  diff: string,
  fileSummary: string,
  language: Language,
  ruleset?: CommitRuleset,
  analysisContext?: string
): Promise<string> {
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: getPRSystemPrompt(language, ruleset) },
        { role: 'user', content: buildPRUserPrompt(diff, fileSummary, analysisContext) }
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

export async function generatePRDescription(
  provider: Provider,
  apiKey: string,
  diff: string,
  fileSummary: string,
  model: string,
  language: Language,
  ollamaUrl?: string,
  ruleset?: CommitRuleset,
  analysisContext?: string
): Promise<string> {
  switch (provider) {
    case 'openai':
      return generatePRWithOpenAI(apiKey, model, diff, fileSummary, language, ruleset, analysisContext);
    case 'groq':
      return generatePRWithGroq(apiKey, model, diff, fileSummary, language, ruleset, analysisContext);
    case 'gemini':
      return generatePRWithGemini(apiKey, model, diff, fileSummary, language, ruleset, analysisContext);
    case 'ollama':
      return generatePRWithOllama(ollamaUrl || 'http://localhost:11434', model, diff, fileSummary, language, ruleset, analysisContext);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

function hasMarkdownHeading(markdown: string, heading: string): boolean {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^##\\s+${escaped}\\b`, 'im').test(markdown);
}

function extractMarkdownSection(markdown: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`^##\\s+${escaped}\\b.*$`, 'im').exec(markdown);

  if (!match || match.index === undefined) {
    return undefined;
  }

  const sectionStart = match.index;
  const remainder = markdown.slice(sectionStart + match[0].length);
  const nextHeadingMatch = /^##\s+/m.exec(remainder);
  const sectionEnd = nextHeadingMatch
    ? sectionStart + match[0].length + nextHeadingMatch.index
    : markdown.length;

  return markdown.slice(sectionStart, sectionEnd).trim();
}

export function ensurePRAnalysisSections(description: string, automatedAnalysisMarkdown?: string): string {
  if (!automatedAnalysisMarkdown) {
    return description;
  }

  const missingCoreSection = ['Impact', 'Risk', 'Validation'].some(section => {
    return !hasMarkdownHeading(description, section);
  });

  if (missingCoreSection) {
    return `${description.trim()}\n\n---\n\n${automatedAnalysisMarkdown.trim()}`;
  }

  const missingOptionalSections = ['Security Review', 'Suggested Remediation', 'Suggested Commit Split', 'Deployment Checklist', 'Fix Prompt']
    .filter(section => !hasMarkdownHeading(description, section))
    .map(section => extractMarkdownSection(automatedAnalysisMarkdown, section))
    .filter((section): section is string => Boolean(section));

  if (missingOptionalSections.length === 0) {
    return description;
  }

  return `${description.trim()}\n\n---\n\n${missingOptionalSections.join('\n\n')}`;
}


