import fs from 'fs';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

export type Provider = 'openai' | 'groq' | 'gemini' | 'ollama';
export type Language = 'english' | 'korean';

export interface Config {
  provider: Provider;
  model: string;
  language: Language;
  ollamaUrl: string;
  openaiApiKey?: string;
  groqApiKey?: string;
  geminiApiKey?: string;
}

const CONFIG_FILE = '.commitcraftrc';
const CONFIG_PATH = path.join(os.homedir(), CONFIG_FILE);

const DEFAULT_MODELS: Record<Provider, string> = {
  openai: 'gpt-4o-mini',
  groq: 'llama-3.1-8b-instant',
  gemini: 'gemini-1.5-flash',
  ollama: 'llama3.2'
};

function loadEnvFile(): void {
  // Load from current directory .env first
  const localEnv = path.join(process.cwd(), '.env');
  if (fs.existsSync(localEnv)) {
    dotenv.config({ path: localEnv });
  }

  // Then load from home directory
  const homeEnv = path.join(os.homedir(), '.env');
  if (fs.existsSync(homeEnv)) {
    dotenv.config({ path: homeEnv });
  }
}

function loadConfigFile(): Partial<Config> {
  // Check local config first
  const localConfig = path.join(process.cwd(), CONFIG_FILE);
  if (fs.existsSync(localConfig)) {
    try {
      const content = fs.readFileSync(localConfig, 'utf-8');
      return JSON.parse(content);
    } catch {
      // Ignore parse errors
    }
  }

  // Then check home directory
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(content);
    } catch {
      // Ignore parse errors
    }
  }

  return {};
}

export function loadConfig(): Config {
  loadEnvFile();
  const fileConfig = loadConfigFile();

  const provider = (process.env.COMMITCRAFT_PROVIDER || fileConfig.provider || 'openai') as Provider;

  return {
    provider,
    model: process.env.COMMITCRAFT_MODEL || fileConfig.model || DEFAULT_MODELS[provider],
    language: (process.env.COMMITCRAFT_LANGUAGE || fileConfig.language || 'english') as Language,
    ollamaUrl: process.env.OLLAMA_URL || fileConfig.ollamaUrl || 'http://localhost:11434',
    openaiApiKey: process.env.OPENAI_API_KEY || fileConfig.openaiApiKey,
    groqApiKey: process.env.GROQ_API_KEY || fileConfig.groqApiKey,
    geminiApiKey: process.env.GEMINI_API_KEY || fileConfig.geminiApiKey
  };
}

export function saveConfig(config: Partial<Config>): void {
  let existingConfig: Partial<Config> = {};

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      existingConfig = JSON.parse(content);
    } catch {
      // Ignore parse errors
    }
  }

  const newConfig = { ...existingConfig, ...config };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2));
}

export function getApiKey(config: Config): string | undefined {
  switch (config.provider) {
    case 'openai':
      return config.openaiApiKey;
    case 'groq':
      return config.groqApiKey;
    case 'gemini':
      return config.geminiApiKey;
    case 'ollama':
      return 'ollama-no-key-needed';
    default:
      return undefined;
  }
}

export function getDefaultModel(provider: Provider): string {
  return DEFAULT_MODELS[provider];
}
