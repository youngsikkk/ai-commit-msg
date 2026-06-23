#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import clipboardy from 'clipboardy';
import { simpleGit, type SimpleGit } from 'simple-git';
import fs from 'fs';
import path from 'path';
import { loadConfig, saveConfig, getApiKey, getDefaultModel, type Provider, type Language } from './config.js';
import { generateCommitMessages, formatCommitMessage, generatePRDescription, type CommitMessage } from './ai.js';
import { formatAnalysisMarkdown } from './analysis.js';
import { detectValidationCommands, runValidationCommands, type ValidationReport } from './validation.js';

const VERSION = '0.4.1';
const MAX_DIFF_CHARS = 12000;
const git: SimpleGit = simpleGit();

async function getStagedDiff(): Promise<{ diff: string; fileSummary: string }> {
  const [diff, fileSummary] = await Promise.all([
    git.diff(['--cached']),
    git.diff(['--cached', '--name-status'])
  ]);

  return { diff, fileSummary };
}

async function getUncommittedDiff(): Promise<{ diff: string; fileSummary: string }> {
  const [stagedDiff, unstagedDiff, stagedSummary, unstagedSummary] = await Promise.all([
    git.diff(['--cached']),
    git.diff([]),
    git.diff(['--cached', '--name-status']),
    git.diff(['--name-status'])
  ]);

  const summaryLines = new Set<string>();
  for (const line of `${stagedSummary}\n${unstagedSummary}`.split(/\r?\n/)) {
    if (line.trim()) {
      summaryLines.add(line.trim());
    }
  }

  return {
    diff: [stagedDiff, unstagedDiff].filter(part => part.trim()).join('\n'),
    fileSummary: Array.from(summaryLines).join('\n')
  };
}

async function hasStagedChanges(): Promise<boolean> {
  const diff = await git.diff(['--cached', '--name-only']);
  return diff.trim().length > 0;
}

async function hasUncommittedChanges(): Promise<boolean> {
  const [staged, unstaged] = await Promise.all([
    git.diff(['--cached', '--name-only']),
    git.diff(['--name-only'])
  ]);

  return staged.trim().length > 0 || unstaged.trim().length > 0;
}

async function getCurrentBranch(): Promise<string> {
  const branchSummary = await git.branch();
  return branchSummary.current;
}

function truncateDiff(diff: string): string {
  return diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, MAX_DIFF_CHARS) + '\n... [truncated]'
    : diff;
}

function extractIssueFromBranch(branchName: string, pattern?: string): string | null {
  if (!pattern) {
    return null;
  }

  try {
    const regex = new RegExp(pattern);
    const match = branchName.match(regex);
    return match?.[1] || match?.[0] || null;
  } catch {
    return null;
  }
}

function extractPRTitle(markdown: string): string {
  const titleLine = markdown
    .split(/\r?\n/)
    .find(line => line.trim().startsWith('# '));

  return titleLine?.replace(/^#\s+/, '').trim() || 'PR Description';
}

function hasHeading(markdown: string, heading: string): boolean {
  return new RegExp(`^##\\s+${heading}\\b`, 'im').test(markdown);
}

function extractMarkdownSection(markdown: string, heading: string): string | undefined {
  const match = new RegExp(`^##\\s+${heading}\\b.*$`, 'im').exec(markdown);

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

function ensurePRHasAnalysis(markdown: string, analysisContext: string): string {
  const missingCoreSection = ['Impact', 'Risk', 'Validation'].some(heading => !hasHeading(markdown, heading));

  if (missingCoreSection) {
    return `${markdown.trim()}\n\n---\n\n${analysisContext.trim()}`;
  }

  const missingOptionalSections = ['Suggested Commit Split', 'Deployment Checklist']
    .filter(heading => !hasHeading(markdown, heading))
    .map(heading => extractMarkdownSection(analysisContext, heading))
    .filter((section): section is string => Boolean(section));

  if (missingOptionalSections.length === 0) {
    return markdown.trim();
  }

  return `${markdown.trim()}\n\n---\n\n${missingOptionalSections.join('\n\n')}`;
}

function loadProviderConfig(options: {
  provider?: Provider;
  model?: string;
  language?: Language;
}): {
  config: ReturnType<typeof loadConfig>;
  provider: Provider;
  model: string;
  language: Language;
  apiKey: string;
} {
  const config = loadConfig();
  const provider = options.provider || config.provider;
  const model = options.model || config.model || getDefaultModel(provider);
  const language = options.language || config.language;
  const apiKey = getApiKey({ ...config, provider });

  if (!apiKey) {
    console.error(chalk.red(`\nNo API key found for ${provider}.`));
    console.log(chalk.yellow('\nSet your API key:'));
    console.log(chalk.gray('  Environment: OPENAI_API_KEY, GROQ_API_KEY, or GEMINI_API_KEY'));
    console.log(chalk.gray('  Config file: ~/.commitcraftrc'));
    console.log(chalk.gray('  Or run: commitcraft config\n'));
    process.exit(1);
  }

  return { config, provider, model, language, apiKey };
}

async function generateCommand(options: {
  provider?: Provider;
  model?: string;
  language?: Language;
  commit?: boolean;
  issuePattern?: string;
  issuePrefix?: string;
}): Promise<void> {
  const { config, provider, model, language, apiKey } = loadProviderConfig(options);

  if (!(await hasStagedChanges())) {
    console.log(chalk.yellow('\nNo staged changes found.'));
    console.log(chalk.gray('Stage files with: git add <files>\n'));
    process.exit(1);
  }

  const spinner = ora('Getting staged changes...').start();
  let diff: string;
  let fileSummary: string;

  try {
    const result = await getStagedDiff();
    diff = truncateDiff(result.diff);
    fileSummary = result.fileSummary;

    if (!diff.trim()) {
      spinner.fail('No diff content found');
      process.exit(1);
    }

    spinner.succeed('Got staged changes');
  } catch (error) {
    spinner.fail('Failed to get staged changes');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }

  let issueReference: string | undefined;
  const issuePattern = options.issuePattern || config.issuePattern;
  const issuePrefix = options.issuePrefix || config.issuePrefix || '';

  if (issuePattern) {
    try {
      const branchName = await getCurrentBranch();
      const issue = extractIssueFromBranch(branchName, issuePattern);
      if (issue) {
        issueReference = issuePrefix + issue;
        console.log(chalk.blue(`\nDetected issue: ${issueReference}`));
      }
    } catch {
      // Branch detection is optional.
    }
  }

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

  const choices = [
    ...candidates.map((commit, index) => ({
      name: `${index + 1}. ${formatCommitMessage(commit)}`,
      value: commit
    })),
    {
      name: chalk.gray('Cancel'),
      value: null
    }
  ];

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
    const commitSpinner = ora('Committing...').start();
    try {
      await git.commit(commitMessage);
      commitSpinner.succeed(chalk.green(`Committed: ${commitMessage}`));
    } catch (error) {
      commitSpinner.fail('Failed to commit');
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
    return;
  }

  try {
    await clipboardy.write(commitMessage);
    console.log(chalk.green(`\nCopied to clipboard: ${commitMessage}`));
  } catch {
    console.log(chalk.green(`\nSelected: ${commitMessage}`));
    console.log(chalk.gray('(Copy manually if clipboard is not available)'));
  }
}

async function maybeRunValidation(
  workspacePath: string,
  options: { validate?: boolean; validationPrompt?: boolean }
): Promise<ValidationReport | undefined> {
  const detectedCommands = detectValidationCommands(workspacePath);

  if (detectedCommands.length === 0) {
    return undefined;
  }

  let shouldRun = Boolean(options.validate);

  if (!shouldRun && options.validationPrompt !== false) {
    console.log(chalk.cyan('\nDetected validation commands:'));
    for (const command of detectedCommands) {
      console.log(chalk.gray(`- ${command}`));
    }

    const answer = await inquirer.prompt<{ run: boolean }>([
      {
        type: 'confirm',
        name: 'run',
        message: 'Run before PR generation?',
        default: false
      }
    ]);
    shouldRun = answer.run;
  }

  if (!shouldRun) {
    return undefined;
  }

  const spinner = ora('Running validation commands...').start();
  const report = await runValidationCommands(detectedCommands, workspacePath);

  if (report.failed > 0) {
    spinner.warn(`Validation completed with failures: ${report.summary}`);
  } else {
    spinner.succeed(`Validation passed: ${report.summary}`);
  }

  return report;
}

async function prCommand(options: {
  provider?: Provider;
  model?: string;
  language?: Language;
  copy?: boolean;
  output?: string;
  validate?: boolean;
  validationPrompt?: boolean;
}): Promise<void> {
  const { config, provider, model, language, apiKey } = loadProviderConfig(options);

  if (!(await hasUncommittedChanges())) {
    console.log(chalk.yellow('\nNo uncommitted changes found.'));
    process.exit(1);
  }

  const spinner = ora('Getting uncommitted changes...').start();
  let diff: string;
  let fileSummary: string;

  try {
    const result = await getUncommittedDiff();
    diff = truncateDiff(result.diff);
    fileSummary = result.fileSummary;

    if (!diff.trim()) {
      spinner.fail('No diff content found');
      process.exit(1);
    }

    spinner.succeed('Got uncommitted changes');
  } catch (error) {
    spinner.fail('Failed to get uncommitted changes');
    console.error(chalk.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  }

  const workspacePath = process.cwd();
  const validationReport = await maybeRunValidation(workspacePath, options);
  const analysisContext = formatAnalysisMarkdown(diff, fileSummary, validationReport);
  const generateSpinner = ora(`Generating PR description via ${provider}...`).start();
  let prDescription: string;

  try {
    prDescription = await generatePRDescription(
      provider,
      apiKey,
      diff,
      fileSummary,
      model,
      language,
      config.ollamaUrl,
      analysisContext
    );
    prDescription = ensurePRHasAnalysis(prDescription, analysisContext);
    generateSpinner.succeed('Generated PR description');
  } catch (error) {
    generateSpinner.fail('Failed to generate PR description');
    console.error(chalk.red(`\n${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }

  const title = extractPRTitle(prDescription);
  console.log(chalk.bold('\nPR Title'));
  console.log(title);

  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.writeFileSync(outputPath, prDescription + '\n', 'utf-8');
    console.log(chalk.green(`\nSaved PR markdown: ${outputPath}`));
  }

  if (options.copy) {
    try {
      await clipboardy.write(prDescription);
      console.log(chalk.green('\nCopied PR markdown to clipboard'));
    } catch {
      console.log(chalk.yellow('\nCould not copy to clipboard in this environment'));
    }
  }

  if (!options.output && !options.copy) {
    console.log(chalk.bold('\nPR Markdown\n'));
    console.log(prDescription);
  }
}

async function configCommand(): Promise<void> {
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
    configToSave[`${provider}ApiKey`] = apiKey;
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
  console.log(chalk.green('\nConfiguration saved to ~/.commitcraftrc\n'));
}

async function getGitHooksPath(): Promise<string | null> {
  try {
    const gitDir = await git.revparse(['--git-dir']);
    return path.join(gitDir.trim(), 'hooks');
  } catch {
    return null;
  }
}

function getHookScript(): string {
  return `#!/bin/sh
# CommitCraft AI - prepare-commit-msg hook
# Auto-generates commit messages using AI

commitcraft-hook "$1" "$2" "$3"
`;
}

const program = new Command();

program
  .name('commitcraft')
  .description('Generate AI-powered commit messages and PR descriptions')
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
  .command('pr')
  .description('Generate PR description from uncommitted changes')
  .option('-p, --provider <provider>', 'AI provider (openai, groq, gemini, ollama)')
  .option('-m, --model <model>', 'Model to use')
  .option('-l, --language <language>', 'Language (english, korean)')
  .option('--copy', 'Copy generated PR markdown to clipboard')
  .option('-o, --output <file>', 'Save generated PR markdown to a file')
  .option('--validate', 'Run detected validation commands without prompting')
  .option('--no-validation-prompt', 'Skip detected validation command prompt')
  .action(prCommand);

program
  .command('config')
  .description('Configure API keys and preferences')
  .action(configCommand);

const hookCommand = program
  .command('hook')
  .description('Manage Git hook integration');

hookCommand
  .command('install')
  .description('Install Git hook for automatic commit message generation')
  .option('-f, --force', 'Overwrite existing hook')
  .action(async (options: { force?: boolean }) => {
    const hooksPath = await getGitHooksPath();

    if (!hooksPath) {
      console.error(chalk.red('\nNot a Git repository.'));
      console.log(chalk.gray('Run this command from a Git repository.\n'));
      process.exit(1);
    }

    const hookPath = path.join(hooksPath, 'prepare-commit-msg');

    if (fs.existsSync(hookPath) && !options.force) {
      const existingContent = fs.readFileSync(hookPath, 'utf-8');

      if (existingContent.includes('commitcraft')) {
        console.log(chalk.yellow('\nCommitCraft hook is already installed.'));
        console.log(chalk.gray('Use --force to reinstall.\n'));
        process.exit(0);
      }

      console.error(chalk.red('\nA prepare-commit-msg hook already exists.'));
      console.log(chalk.gray('Use --force to overwrite, or manually edit the hook.\n'));
      process.exit(1);
    }

    if (!fs.existsSync(hooksPath)) {
      fs.mkdirSync(hooksPath, { recursive: true });
    }

    fs.writeFileSync(hookPath, getHookScript(), { mode: 0o755 });
    console.log(chalk.green('\nGit hook installed successfully.'));
    console.log(chalk.gray(`Location: ${hookPath}`));
    console.log(chalk.blue('\nNow when you run "git commit", CommitCraft will auto-generate a message.'));
    console.log(chalk.gray('To disable, run: commitcraft hook uninstall\n'));
  });

hookCommand
  .command('uninstall')
  .description('Remove Git hook')
  .action(async () => {
    const hooksPath = await getGitHooksPath();

    if (!hooksPath) {
      console.error(chalk.red('\nNot a Git repository.\n'));
      process.exit(1);
    }

    const hookPath = path.join(hooksPath, 'prepare-commit-msg');

    if (!fs.existsSync(hookPath)) {
      console.log(chalk.yellow('\nNo prepare-commit-msg hook found.\n'));
      process.exit(0);
    }

    const content = fs.readFileSync(hookPath, 'utf-8');

    if (!content.includes('commitcraft')) {
      console.error(chalk.red('\nThe existing hook was not installed by CommitCraft.'));
      console.log(chalk.gray('Manually remove it if needed.\n'));
      process.exit(1);
    }

    fs.unlinkSync(hookPath);
    console.log(chalk.green('\nGit hook uninstalled successfully.\n'));
  });

hookCommand
  .command('status')
  .description('Check Git hook status')
  .action(async () => {
    const hooksPath = await getGitHooksPath();

    if (!hooksPath) {
      console.error(chalk.red('\nNot a Git repository.\n'));
      process.exit(1);
    }

    const hookPath = path.join(hooksPath, 'prepare-commit-msg');
    console.log(chalk.bold('\nCommitCraft Git Hook Status\n'));

    if (!fs.existsSync(hookPath)) {
      console.log(chalk.yellow('Status: Not installed'));
      console.log(chalk.gray('Run "commitcraft hook install" to enable.\n'));
      process.exit(0);
    }

    const content = fs.readFileSync(hookPath, 'utf-8');

    if (content.includes('commitcraft')) {
      console.log(chalk.green('Status: Installed'));
      console.log(chalk.gray(`Location: ${hookPath}`));

      if (process.platform !== 'win32') {
        try {
          fs.accessSync(hookPath, fs.constants.X_OK);
          console.log(chalk.gray('Executable: Yes'));
        } catch {
          console.log(chalk.yellow('Executable: No (may need: chmod +x)'));
        }
      }

      const config = loadConfig();
      console.log(chalk.gray(`Provider: ${config.provider}`));
      console.log(chalk.gray(`Model: ${config.model || getDefaultModel(config.provider)}`));

      const apiKey = getApiKey(config);
      console.log(apiKey ? chalk.gray('API Key: Configured') : chalk.yellow('API Key: Not configured'));
    } else {
      console.log(chalk.yellow('Status: Different hook installed'));
      console.log(chalk.gray('A non-CommitCraft hook exists at this location.'));
    }

    console.log();
  });

program.parse();
