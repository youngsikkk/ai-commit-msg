import * as vscode from 'vscode';
import type { Config, Language, Provider } from './types';

const API_KEY_SECRETS = {
  openai: 'ai-commit-msg.openaiApiKey',
  groq: 'ai-commit-msg.groqApiKey',
  gemini: 'ai-commit-msg.geminiApiKey'
} as const;

const DEFAULT_MODELS: Record<Provider, string> = {
  openai: 'gpt-4o-mini',
  groq: 'llama-3.1-8b-instant',
  gemini: 'gemini-1.5-flash'
};

const PROVIDER_NAMES: Record<Provider, string> = {
  openai: 'OpenAI',
  groq: 'Groq',
  gemini: 'Gemini'
};

export async function getApiKeyForProvider(
  provider: Provider,
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  return secrets.get(API_KEY_SECRETS[provider]);
}

export async function setApiKeyForProvider(
  provider: Provider,
  secrets: vscode.SecretStorage,
  key: string
): Promise<void> {
  await secrets.store(API_KEY_SECRETS[provider], key);
}

export async function deleteApiKeyForProvider(
  provider: Provider,
  secrets: vscode.SecretStorage
): Promise<void> {
  await secrets.delete(API_KEY_SECRETS[provider]);
}

function getValidationForProvider(provider: Provider): (value: string) => string | null {
  return (value: string) => {
    if (!value || value.trim().length === 0) {
      return 'API key cannot be empty';
    }

    // Provider-specific validation
    if (provider === 'openai' && !value.startsWith('sk-')) {
      return 'OpenAI API key should start with "sk-"';
    }

    if (provider === 'groq' && !value.startsWith('gsk_')) {
      return 'Groq API key should start with "gsk_"';
    }

    // Gemini keys don't have a specific prefix, just check length
    if (provider === 'gemini' && value.trim().length < 20) {
      return 'Gemini API key seems too short';
    }

    return null;
  };
}

function getPlaceholderForProvider(provider: Provider): string {
  switch (provider) {
    case 'openai':
      return 'sk-...';
    case 'groq':
      return 'gsk_...';
    case 'gemini':
      return 'AI...';
  }
}

export async function promptForApiKeyForProvider(
  provider: Provider,
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  const providerName = PROVIDER_NAMES[provider];

  const key = await vscode.window.showInputBox({
    prompt: `Enter your ${providerName} API key`,
    password: true,
    placeHolder: getPlaceholderForProvider(provider),
    ignoreFocusOut: true,
    validateInput: getValidationForProvider(provider)
  });

  if (key) {
    await setApiKeyForProvider(provider, secrets, key.trim());
    vscode.window.showInformationMessage(`${providerName} API key saved successfully`);
    return key.trim();
  }

  return undefined;
}

export function getConfig(): Config {
  const config = vscode.workspace.getConfiguration('aiCommit');
  const provider = config.get<Provider>('provider', 'openai');

  // Get model, use default if empty
  let model = config.get<string>('model', '');
  if (!model || model.trim() === '') {
    model = DEFAULT_MODELS[provider];
  }

  return {
    provider,
    model,
    maxDiffChars: config.get<number>('maxDiffChars', 12000),
    exclude: config.get<string[]>('exclude', [
      'node_modules',
      '*.lock',
      'dist',
      'build',
      '*.min.*'
    ]),
    language: config.get<Language>('language', 'english')
  };
}
