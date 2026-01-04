import * as vscode from 'vscode';
import type { Config } from './types';

const API_KEY_SECRET = 'ai-commit-msg.apiKey';

export async function getApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(API_KEY_SECRET);
}

export async function setApiKey(secrets: vscode.SecretStorage, key: string): Promise<void> {
  await secrets.store(API_KEY_SECRET, key);
}

export async function deleteApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(API_KEY_SECRET);
}

export async function promptForApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  const key = await vscode.window.showInputBox({
    prompt: 'Enter your OpenAI API key',
    password: true,
    placeHolder: 'sk-...',
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.trim().length === 0) {
        return 'API key cannot be empty';
      }
      if (!value.startsWith('sk-')) {
        return 'API key should start with "sk-"';
      }
      return null;
    }
  });

  if (key) {
    await setApiKey(secrets, key.trim());
    vscode.window.showInformationMessage('API key saved successfully');
    return key.trim();
  }

  return undefined;
}

export function getConfig(): Config {
  const config = vscode.workspace.getConfiguration('aiCommit');

  return {
    model: config.get<string>('model', 'gpt-4o-mini'),
    maxDiffChars: config.get<number>('maxDiffChars', 12000),
    exclude: config.get<string[]>('exclude', [
      'node_modules',
      '*.lock',
      'dist',
      'build',
      '*.min.*'
    ])
  };
}
