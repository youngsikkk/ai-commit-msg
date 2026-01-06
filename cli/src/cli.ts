#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import clipboardy from 'clipboardy';
import { simpleGit, SimpleGit } from 'simple-git';
import { loadConfig, saveConfig, getApiKey, getDefaultModel, type Provider, type Language } from './config.js';
import { generateCommitMessages, formatCommitMessage, type CommitMessage } from './ai.js';

const VERSION = '0.3.0';

const git: SimpleGit = simpleGit();

async function getStagedDiff(): Promise<{ diff: string; fileSummary: string }> {
  const [diff, fileSummary] = await Promise.all([
    git.diff(['--cached']),
    git.diff(['--cached', '--name-status'])
  ]);

  return { diff, fileSummary };
}

async function hasStagedChanges(): Promise<boolean> {
  const diff = await git.diff(['--cached', '--name-only']);
  return diff.trim().length > 0;
}

async function getCurrentBranch(): Promise<string> {
  const branchSummary = await git.branch();
  return branchSummary.current;
}

function extractIssueFromBranch(branchName: string, pattern?: string): string | null {
  if (!pattern) return null;

  try {
    const regex = new RegExp(pattern);
    const match = branchName.match(regex);
    return match?.[1] || match?.[0] || null;
  } catch {
    return null;
  }
}

async function generateCommand(options: {
  provider?: Provider;
  model?: string;
  language?: Language;
  commit?: boolean;
  issuePattern?: string;
  issuePrefix?: string;
}) {
  const config = loadConfig();

  // Override config with CLI options
  const provider = options.provider || config.provider;
  const model = options.model || config.model || getDefaultModel(provider);
  const language = options.language || config.language;

  // Check for API key
  const apiKey = getApiKey({ ...config, provider });
  if (!apiKey) {
    console.error(chalk.red(`\nNo API key found for ${provider}.`));
    console.log(chalk.yellow(`\nSet your API key:`));
    console.log(chalk.gray(`  Environment: OPENAI_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY`));
    console.log(chalk.gray(`  Config file: ~/.commitcraftrc`));
    console.log(chalk.gray(`  Or run: commitcraft config\n`));
    process.exit(1);
  }

  // Check for staged changes
  const hasChanges = await hasStagedChanges();
  if (!hasChanges) {
    console.log(chalk.yellow('\nNo staged changes found.'));
    console.log(chalk.gray('Stage files with: git add <files>\n'));
    process.exit(1);
  }

  // Get diff
  const spinner = ora('Getting staged changes...').start();
  let diff: string;
  let fileSummary: string;

  try {
    const result = await getStagedDiff();
    diff = result.diff;
    fileSummary = result.fileSummary;

    if (!diff.trim()) {
      spinner.fail('No diff content found');
      process.exit(1);
    }

    // Truncate large diffs
    const MAX_CHARS = 12000;
    if (diff.length > MAX_CHARS) {
      diff = diff.substring(0, MAX_CHARS) + '\n... [truncated]';
    }

    spinner.succeed('Got staged changes');
  } catch (error) {
    spinner.fail('Failed to get staged changes');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }

  // Extract issue from branch if pattern is configured
  let issueReference: string | undefined;
  if (options.issuePattern) {
    try {
      const branchName = await getCurrentBranch();
      const issue = extractIssueFromBranch(branchName, options.issuePattern);
      if (issue) {
        issueReference = (options.issuePrefix || '') + issue;
        console.log(chalk.blue(`\nDetected issue: ${issueReference}`));
      }
    } catch {
      // Ignore branch detection errors
    }
  }

  // Generate commit messages
  const generateSpinner = ora(`Generating commit messages via ${provider}...`).start();
  let candidates: CommitMessage[];

  try {
    candidates = await generateCommitMessages(
      provider,
      apiKey,
      diff,
      fileSummary,
      model,
      language,
      config.ollamaUrl,
      issueReference
    );
    generateSpinner.succeed('Generated commit messages');
  } catch (error) {
    generateSpinner.fail('Failed to generate commit messages');
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes('401') || message.includes('Unauthorized')) {
      console.error(chalk.red(`\nInvalid ${provider} API key.`));
    } else if (message.includes('ECONNREFUSED')) {
      console.error(chalk.red(`\nCannot connect to Ollama at ${config.ollamaUrl}`));
    } else {
      console.error(chalk.red(`\n${message}`));
    }
    process.exit(1);
  }

  // Format choices for inquirer
  const choices = candidates.map((commit, index) => ({
    name: `${index + 1}. ${formatCommitMessage(commit)}`,
    value: commit
  }));

  choices.push({
    name: chalk.gray('Cancel'),
    value: null as unknown as CommitMessage
  });

  // Let user select a message
  console.log();
  const { selected } = await inquirer.prompt<{ selected: CommitMessage | null }>([
    {
      type: 'list',
      name: 'selected',
      message: 'Select a commit message:',
      choices
    }
  ]);

  if (!selected) {
    console.log(chalk.yellow('\nCancelled.'));
    process.exit(0);
  }

  const commitMessage = formatCommitMessage(selected);

  if (options.commit) {
    // Auto-commit
    const commitSpinner = ora('Committing...').start();
    try {
      await git.commit(commitMessage);
      commitSpinner.succeed(chalk.green(`Committed: ${commitMessage}`));
    } catch (error) {
      commitSpinner.fail('Failed to commit');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  } else {
    // Copy to clipboard
    try {
      await clipboardy.write(commitMessage);
      console.log(chalk.green(`\n✓ Copied to clipboard: ${commitMessage}`));
    } catch {
      // Clipboard might not work in all environments
      console.log(chalk.green(`\n✓ Selected: ${commitMessage}`));
      console.log(chalk.gray('(Copy manually if clipboard is not available)'));
    }
  }
}

async function configCommand() {
  console.log(chalk.bold('\nCommitCraft CLI Configuration\n'));

  const { provider } = await inquirer.prompt<{ provider: Provider }>([
    {
      type: 'list',
      name: 'provider',
      message: 'Select AI provider:',
      choices: [
        { name: 'OpenAI', value: 'openai' },
        { name: 'Groq', value: 'groq' },
        { name: 'Gemini', value: 'gemini' },
        { name: 'Ollama (local)', value: 'ollama' }
      ]
    }
  ]);

  let apiKey: string | undefined;

  if (provider !== 'ollama') {
    const { key } = await inquirer.prompt<{ key: string }>([
      {
        type: 'password',
        name: 'key',
        message: `Enter your ${provider} API key:`,
        mask: '*'
      }
    ]);
    apiKey = key;
  }

  const { language } = await inquirer.prompt<{ language: Language }>([
    {
      type: 'list',
      name: 'language',
      message: 'Select language for commit messages:',
      choices: [
        { name: 'English', value: 'english' },
        { name: 'Korean', value: 'korean' }
      ]
    }
  ]);

  const { model } = await inquirer.prompt<{ model: string }>([
    {
      type: 'input',
      name: 'model',
      message: 'Model (leave empty for default):',
      default: getDefaultModel(provider)
    }
  ]);

  const configToSave: Record<string, string> = {
    provider,
    language,
    model
  };

  if (apiKey) {
    const keyName = `${provider}ApiKey`;
    configToSave[keyName] = apiKey;
  }

  if (provider === 'ollama') {
    const { ollamaUrl } = await inquirer.prompt<{ ollamaUrl: string }>([
      {
        type: 'input',
        name: 'ollamaUrl',
        message: 'Ollama URL:',
        default: 'http://localhost:11434'
      }
    ]);
    configToSave.ollamaUrl = ollamaUrl;
  }

  saveConfig(configToSave);
  console.log(chalk.green('\n✓ Configuration saved to ~/.commitcraftrc\n'));
}

// Main CLI
const program = new Command();

program
  .name('commitcraft')
  .description('Generate AI-powered commit messages')
  .version(VERSION);

program
  .command('generate', { isDefault: true })
  .description('Generate commit message from staged changes')
  .option('-p, --provider <provider>', 'AI provider (openai, groq, gemini, ollama)')
  .option('-m, --model <model>', 'Model to use')
  .option('-l, --language <language>', 'Language (english, korean)')
  .option('-c, --commit', 'Auto-commit with selected message')
  .option('--issue-pattern <pattern>', 'Regex to extract issue from branch name')
  .option('--issue-prefix <prefix>', 'Prefix for issue reference (e.g., #)')
  .action(generateCommand);

program
  .command('config')
  .description('Configure API keys and preferences')
  .action(configCommand);

program.parse();
