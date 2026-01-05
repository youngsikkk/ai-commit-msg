import * as fs from 'fs';
import * as path from 'path';
import type { CommitMessage, CommitType, Language } from './types';
import { VALID_COMMIT_TYPES } from './types';

export interface CommitRuleset {
  allowedTypes?: string[];
  requireScope?: boolean;
  allowedScopes?: string[];
  maxSubjectLength?: number;
  subjectPrefix?: string;
  language?: Language;
  customPrompt?: string;
}

const RULESET_FILENAME = '.commitrc.json';

export async function loadRuleset(workspacePath: string): Promise<CommitRuleset | null> {
  const rulesetPath = path.join(workspacePath, RULESET_FILENAME);

  try {
    const exists = fs.existsSync(rulesetPath);
    if (!exists) {
      return null;
    }

    const content = fs.readFileSync(rulesetPath, 'utf-8');
    const ruleset = JSON.parse(content) as CommitRuleset;

    // Validate and sanitize the ruleset
    return validateRuleset(ruleset);
  } catch (error) {
    // If there's any error reading or parsing, return null
    console.error(`Failed to load ruleset from ${rulesetPath}:`, error);
    return null;
  }
}

function validateRuleset(ruleset: unknown): CommitRuleset | null {
  if (typeof ruleset !== 'object' || ruleset === null) {
    return null;
  }

  const r = ruleset as Record<string, unknown>;
  const validated: CommitRuleset = {};

  // Validate allowedTypes
  if (Array.isArray(r.allowedTypes)) {
    const validTypes = r.allowedTypes.filter(
      (t): t is string => typeof t === 'string' && VALID_COMMIT_TYPES.includes(t as CommitType)
    );
    if (validTypes.length > 0) {
      validated.allowedTypes = validTypes;
    }
  }

  // Validate requireScope
  if (typeof r.requireScope === 'boolean') {
    validated.requireScope = r.requireScope;
  }

  // Validate allowedScopes
  if (Array.isArray(r.allowedScopes)) {
    const validScopes = r.allowedScopes.filter(
      (s): s is string => typeof s === 'string' && s.trim().length > 0
    );
    if (validScopes.length > 0) {
      validated.allowedScopes = validScopes;
    }
  }

  // Validate maxSubjectLength
  if (typeof r.maxSubjectLength === 'number' && r.maxSubjectLength > 0) {
    validated.maxSubjectLength = Math.min(r.maxSubjectLength, 200); // Cap at 200
  }

  // Validate subjectPrefix
  if (typeof r.subjectPrefix === 'string' && r.subjectPrefix.trim().length > 0) {
    validated.subjectPrefix = r.subjectPrefix.trim();
  }

  // Validate language
  if (r.language === 'english' || r.language === 'korean') {
    validated.language = r.language;
  }

  // Validate customPrompt
  if (typeof r.customPrompt === 'string' && r.customPrompt.trim().length > 0) {
    validated.customPrompt = r.customPrompt.trim();
  }

  return validated;
}

export function validateAgainstRuleset(
  message: CommitMessage,
  ruleset: CommitRuleset
): string[] {
  const errors: string[] = [];

  // Check type
  if (ruleset.allowedTypes && ruleset.allowedTypes.length > 0) {
    if (!ruleset.allowedTypes.includes(message.type)) {
      errors.push(
        `Type "${message.type}" is not allowed. Allowed types: ${ruleset.allowedTypes.join(', ')}`
      );
    }
  }

  // Check scope requirement
  if (ruleset.requireScope && !message.scope) {
    errors.push('Scope is required by team ruleset');
  }

  // Check allowed scopes
  if (ruleset.allowedScopes && ruleset.allowedScopes.length > 0 && message.scope) {
    if (!ruleset.allowedScopes.includes(message.scope)) {
      errors.push(
        `Scope "${message.scope}" is not allowed. Allowed scopes: ${ruleset.allowedScopes.join(', ')}`
      );
    }
  }

  // Check subject length
  const maxLength = ruleset.maxSubjectLength || 72;
  if (message.subject.length > maxLength) {
    errors.push(
      `Subject exceeds maximum length of ${maxLength} characters (current: ${message.subject.length})`
    );
  }

  // Check subject prefix
  if (ruleset.subjectPrefix) {
    if (!message.subject.startsWith(ruleset.subjectPrefix)) {
      errors.push(
        `Subject must start with "${ruleset.subjectPrefix}"`
      );
    }
  }

  return errors;
}

export function buildRulesetPromptAdditions(ruleset: CommitRuleset): string {
  const additions: string[] = [];

  if (ruleset.allowedTypes && ruleset.allowedTypes.length > 0) {
    additions.push(`- ONLY use these commit types: ${ruleset.allowedTypes.join(', ')}`);
  }

  if (ruleset.requireScope) {
    additions.push('- Scope is REQUIRED for all commits');
  }

  if (ruleset.allowedScopes && ruleset.allowedScopes.length > 0) {
    additions.push(`- ONLY use these scopes: ${ruleset.allowedScopes.join(', ')}`);
  }

  if (ruleset.maxSubjectLength) {
    additions.push(`- Subject must be ${ruleset.maxSubjectLength} characters or less`);
  }

  if (ruleset.subjectPrefix) {
    additions.push(`- Subject MUST start with "${ruleset.subjectPrefix}"`);
  }

  if (ruleset.customPrompt) {
    additions.push(`- ${ruleset.customPrompt}`);
  }

  if (additions.length === 0) {
    return '';
  }

  return '\n\nTeam Rules:\n' + additions.join('\n');
}
