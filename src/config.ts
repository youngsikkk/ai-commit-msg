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
  gemini: 'gemini-1.5-flash',
  ollama: 'llama3.2'
};

const PROVIDER_NAMES: Record<Provider, string> = {
  openai: 'OpenAI',
  groq: 'Groq',
  gemini: 'Gemini',
  ollama: 'Ollama'
};

export async function getApiKeyForProvider(
  provider: Provider,
  secrets: vscode.SecretStorage
): Promise<string | undefined> {
  // Ollama doesn't require an API key
  if (provider === 'ollama') {
    return 'ollama-no-key-needed';
  }
  const secretKey = API_KEY_SECRETS[provider as keyof typeof API_KEY_SECRETS];
  return secrets.get(secretKey);
}

export async function setApiKeyForProvider(
  provider: Provider,
  secrets: vscode.SecretStorage,
  key: string
): Promise<void> {
  // Ollama doesn't need API key storage
  if (provider === 'ollama') {
    return;
  }
  const secretKey = API_KEY_SECRETS[provider as keyof typeof API_KEY_SECRETS];
  await secrets.store(secretKey, key);
}

export async function deleteApiKeyForProvider(
  provider: Provider,
  secrets: vscode.SecretStorage
): Promise<void> {
  // Ollama doesn't have API key to delete
  if (provider === 'ollama') {
    return;
  }
  const secretKey = API_KEY_SECRETS[provider as keyof typeof API_KEY_SECRETS];
  await secrets.delete(secretKey);
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
    case 'ollama':
      return ''; // Ollama doesn't need API key
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

export async function promptForOllamaUrl(): Promise<string | undefined> {
  const config = vscode.workspace.getConfiguration('aiCommit');
  const currentUrl = config.get<string>('ollamaUrl', 'http://localhost:11434');

  const url = await vscode.window.showInputBox({
    prompt: 'Enter your Ollama server URL',
    value: currentUrl,
    placeHolder: 'http://localhost:11434',
    ignoreFocusOut: true,
    validateInput: (value: string) => {
      if (!value || value.trim().length === 0) {
        return 'URL cannot be empty';
      }
      try {
        new URL(value);
        return null;
      } catch {
        return 'Invalid URL format';
      }
    }
  });

  if (url) {
    await config.update('ollamaUrl', url.trim(), vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Ollama URL set to: ${url.trim()}`);
    return url.trim();
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
    ollamaUrl: config.get<string>('ollamaUrl', 'http://localhost:11434'),
    maxDiffChars: config.get<number>('maxDiffChars', 12000),
    exclude: config.get<string[]>('exclude', [
      'node_modules',
      '*.lock',
      'dist',
      'build',
      '*.min.*'
    ]),
    language: config.get<Language>('language', 'english'),
    maskSensitiveInfo: config.get<boolean>('maskSensitiveInfo', true),
    summarizeLargeDiff: config.get<boolean>('summarizeLargeDiff', true),
    largeDiffThreshold: config.get<number>('largeDiffThreshold', 8000),
    issuePrefix: config.get<string>('issuePrefix', ''),
    issueBranchPattern: config.get<string>('issueBranchPattern', '')
  };
}
