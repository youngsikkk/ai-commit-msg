import * as vscode from 'vscode';
import * as path from 'path';
import { getApiKeyForProvider, promptForApiKeyForProvider, promptForOllamaUrl, getConfig } from './config';
import { hasStagedChanges, getStagedDiff, hasUncommittedChanges, getUncommittedDiff, getCurrentBranch } from './git';
import { generateCommitMessageCandidates, formatCommitMessage, summarizeDiff } from './ai';
import { loadRuleset, validateAgainstRuleset } from './ruleset';
import { generatePRDescription } from './pr';
import { getIssueReferenceFromBranch } from './issue';
import type { CommitMessage, Config, DiffResult, Provider } from './types';
import type { CommitRuleset } from './ruleset';

interface GitExtension {
  getAPI(version: number): GitAPI;
}

interface GitAPI {
  repositories: Repository[];
}

interface Repository {
  rootUri: vscode.Uri;
  inputBox: { value: string };
}

const REGENERATE_LABEL = '$(refresh) Regenerate candidates...';

const PROVIDER_NAMES: Record<Provider, string> = {
  openai: 'OpenAI',
  groq: 'Groq',
  gemini: 'Gemini',
  ollama: 'Ollama'
};

async function getGitAPI(): Promise<GitAPI | undefined> {
  const gitExtension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!gitExtension) {
    return undefined;
  }

  if (!gitExtension.isActive) {
    await gitExtension.activate();
  }

  return gitExtension.exports.getAPI(1);
}

async function selectRepository(git: GitAPI): Promise<Repository | undefined> {
  const repos = git.repositories;

  if (repos.length === 0) {
    vscode.window.showErrorMessage('No git repository found. Please open a folder with a git repository.');
    return undefined;
  }

  if (repos.length === 1) {
    return repos[0];
  }

  // Multiple repos - show picker
  interface RepoItem extends vscode.QuickPickItem {
    repo: Repository;
  }

  const items: RepoItem[] = repos.map(repo => ({
    label: path.basename(repo.rootUri.fsPath),
    description: repo.rootUri.fsPath,
    repo
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a repository'
  });

  return picked?.repo;
}

async function handleExistingText(
  currentValue: string,
  newMessage: string
): Promise<string | undefined> {
  if (!currentValue.trim()) {
    return newMessage;
  }

  const choice = await vscode.window.showQuickPick(
    [
      { label: 'Overwrite', description: 'Replace existing text with the generated message' },
      { label: 'Append', description: 'Add the generated message after existing text' },
      { label: 'Cancel', description: 'Keep existing text unchanged' }
    ],
    { placeHolder: 'The commit message input already has text' }
  );

  if (!choice || choice.label === 'Cancel') {
    return undefined;
  }

  if (choice.label === 'Overwrite') {
    return newMessage;
  }

  // Append
  return `${currentValue.trim()}\n\n${newMessage}`;
}

async function fetchCandidates(
  apiKey: string,
  diffResult: DiffResult,
  config: Config,
  ruleset?: CommitRuleset,
  issueReference?: string
): Promise<CommitMessage[]> {
  const providerName = PROVIDER_NAMES[config.provider];

  return await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Generating commit messages via ${providerName}...`,
      cancellable: false
    },
    async () => {
      return await generateCommitMessageCandidates(
        config.provider,
        apiKey,
        diffResult.diff,
        diffResult.fileSummary,
        config.model,
        config.language,
        config.ollamaUrl,
        ruleset,
        issueReference
      );
    }
  );
}

interface CandidateItem extends vscode.QuickPickItem {
  commit?: CommitMessage;
  isRegenerate?: boolean;
}

async function selectCandidate(candidates: CommitMessage[]): Promise<{ selected?: CommitMessage; regenerate: boolean }> {
  const items: CandidateItem[] = candidates.map((commit, index) => ({
    label: `${index + 1}. ${formatCommitMessage(commit)}`,
    commit
  }));

  // Add regenerate option
  items.push({
    label: REGENERATE_LABEL,
    description: 'Generate new candidates',
    isRegenerate: true
  });

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a commit message'
  });

  if (!picked) {
    return { regenerate: false };
  }

  if (picked.isRegenerate) {
    return { regenerate: true };
  }

  return { selected: picked.commit, regenerate: false };
}

async function generateCommand(context: vscode.ExtensionContext): Promise<void> {
  // Get Git API
  const git = await getGitAPI();
  if (!git) {
    vscode.window.showErrorMessage('Git extension not found. Please install the Git extension.');
    return;
  }

  // Select repository
  const repo = await selectRepository(git);
  if (!repo) {
    return;
  }

  const workspacePath = repo.rootUri.fsPath;

  // Load team ruleset if exists
  const ruleset = await loadRuleset(workspacePath);
  if (ruleset) {
    vscode.window.showInformationMessage('Using team commit rules from .commitrc.json');
  }

  // Get config (includes provider)
  const config = getConfig();

  // Override language if ruleset specifies it
  if (ruleset?.language) {
    config.language = ruleset.language;
  }

  const providerName = PROVIDER_NAMES[config.provider];

  // Extract issue reference from branch name if pattern is configured
  let issueReference: string | null = null;
  if (config.issueBranchPattern) {
    try {
      const branchName = await getCurrentBranch(workspacePath);
      issueReference = getIssueReferenceFromBranch(
        branchName,
        config.issueBranchPattern,
        config.issuePrefix
      );
      if (issueReference) {
        vscode.window.showInformationMessage(`Detected issue: ${issueReference}`);
      }
    } catch {
      // Silently ignore branch detection errors
    }
  }

  // Get API key for the selected provider
  let apiKey = await getApiKeyForProvider(config.provider, context.secrets);
  if (!apiKey) {
    apiKey = await promptForApiKeyForProvider(config.provider, context.secrets);
    if (!apiKey) {
      return; // User cancelled
    }
  }

  // Check for staged changes
  const hasChanges = await hasStagedChanges(workspacePath);
  if (!hasChanges) {
    vscode.window.showInformationMessage(
      'No staged changes found. Stage files with "git add" first.'
    );
    return;
  }

  // Get diff result
  let diffResult: DiffResult;
  try {
    diffResult = await getStagedDiff(
      workspacePath,
      config.maxDiffChars,
      config.exclude,
      config.maskSensitiveInfo
    );

    if (!diffResult.diff.trim()) {
      throw new Error('No diff content after filtering excluded files');
    }

    if (diffResult.truncated) {
      vscode.window.showWarningMessage(
        'Note: The diff was truncated due to size limits.'
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to get diff: ${message}`);
    return;
  }

  // Summarize large diffs if enabled
  if (config.summarizeLargeDiff && diffResult.diff.length > config.largeDiffThreshold) {
    try {
      const summary = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Large diff detected. Summarizing before generating commit message...',
          cancellable: false
        },
        async () => {
          return await summarizeDiff(
            config.provider,
            apiKey,
            diffResult.diff,
            config.model,
            config.ollamaUrl
          );
        }
      );

      // Replace diff with summary for commit message generation
      diffResult = {
        ...diffResult,
        diff: summary,
        fileSummary: `[Summarized from ${diffResult.diff.length} chars]\n${diffResult.fileSummary}`
      };
    } catch (error) {
      // If summarization fails, continue with original diff
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showWarningMessage(
        `Failed to summarize diff, using original: ${message}`
      );
    }
  }

  // Generate and select candidates loop
  let selectedMessage: string | undefined;

  while (!selectedMessage) {
    let candidates: CommitMessage[];

    try {
      candidates = await fetchCandidates(apiKey, diffResult, config, ruleset || undefined, issueReference || undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Ollama connection error
      if (config.provider === 'ollama' && (message.includes('ECONNREFUSED') || message.includes('fetch failed'))) {
        vscode.window.showErrorMessage(
          `Cannot connect to Ollama. Make sure Ollama is running at ${config.ollamaUrl}`
        );
        return;
      }

      if (message.includes('401') || message.includes('Unauthorized') || message.includes('invalid')) {
        vscode.window.showErrorMessage(
          `Invalid ${providerName} API key. Please set a valid API key.`
        );
        return;
      }

      if (message.includes('429') || message.includes('rate limit')) {
        vscode.window.showErrorMessage(
          'Rate limit exceeded. Please wait a moment and try again.'
        );
        return;
      }

      vscode.window.showErrorMessage(`Failed to generate commit messages: ${message}`);
      return;
    }

    const result = await selectCandidate(candidates);

    if (result.regenerate) {
      // User wants to regenerate, continue loop
      continue;
    }

    if (!result.selected) {
      // User cancelled
      return;
    }

    // Validate against ruleset if exists
    if (ruleset) {
      const validationErrors = validateAgainstRuleset(result.selected, ruleset);
      if (validationErrors.length > 0) {
        const proceed = await vscode.window.showWarningMessage(
          `Commit message doesn't match team rules:\n${validationErrors.join('\n')}`,
          'Use Anyway',
          'Regenerate',
          'Cancel'
        );

        if (proceed === 'Regenerate') {
          continue;
        }
        if (proceed === 'Cancel' || !proceed) {
          return;
        }
        // 'Use Anyway' - proceed with the message
      }
    }

    selectedMessage = formatCommitMessage(result.selected);
  }

  // Handle existing text in SCM input
  const finalMessage = await handleExistingText(repo.inputBox.value, selectedMessage);
  if (finalMessage === undefined) {
    return; // User cancelled
  }

  // Insert into SCM input box
  repo.inputBox.value = finalMessage;
  vscode.window.showInformationMessage('Commit message generated successfully!');
}

async function setOpenAIKeyCommand(context: vscode.ExtensionContext): Promise<void> {
  await promptForApiKeyForProvider('openai', context.secrets);
}

async function setGroqKeyCommand(context: vscode.ExtensionContext): Promise<void> {
  await promptForApiKeyForProvider('groq', context.secrets);
}

async function setGeminiKeyCommand(context: vscode.ExtensionContext): Promise<void> {
  await promptForApiKeyForProvider('gemini', context.secrets);
}

async function setOllamaUrlCommand(): Promise<void> {
  await promptForOllamaUrl();
}

async function generatePRCommand(context: vscode.ExtensionContext): Promise<void> {
  // Get Git API
  const git = await getGitAPI();
  if (!git) {
    vscode.window.showErrorMessage('Git extension not found. Please install the Git extension.');
    return;
  }

  // Select repository
  const repo = await selectRepository(git);
  if (!repo) {
    return;
  }

  const workspacePath = repo.rootUri.fsPath;

  // Load team ruleset if exists
  const ruleset = await loadRuleset(workspacePath);

  // Get config
  const config = getConfig();

  // Override language if ruleset specifies it
  if (ruleset?.language) {
    config.language = ruleset.language;
  }

  const providerName = PROVIDER_NAMES[config.provider];

  // Get API key for the selected provider
  let apiKey = await getApiKeyForProvider(config.provider, context.secrets);
  if (!apiKey) {
    apiKey = await promptForApiKeyForProvider(config.provider, context.secrets);
    if (!apiKey) {
      return; // User cancelled
    }
  }

  // Check for uncommitted changes (staged or unstaged)
  const hasChanges = await hasUncommittedChanges(workspacePath);
  if (!hasChanges) {
    vscode.window.showInformationMessage(
      'No uncommitted changes found. Make some changes first.'
    );
    return;
  }

  // Get diff result (all uncommitted changes)
  let diffResult: DiffResult;
  try {
    diffResult = await getUncommittedDiff(
      workspacePath,
      config.maxDiffChars,
      config.exclude,
      config.maskSensitiveInfo
    );

    if (!diffResult.diff.trim()) {
      throw new Error('No diff content after filtering excluded files');
    }

    if (diffResult.truncated) {
      vscode.window.showWarningMessage(
        'Note: The diff was truncated due to size limits.'
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to get diff: ${message}`);
    return;
  }

  // Summarize large diffs if enabled
  if (config.summarizeLargeDiff && diffResult.diff.length > config.largeDiffThreshold) {
    try {
      const summary = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Large diff detected. Summarizing before generating PR description...',
          cancellable: false
        },
        async () => {
          return await summarizeDiff(
            config.provider,
            apiKey,
            diffResult.diff,
            config.model,
            config.ollamaUrl
          );
        }
      );

      diffResult = {
        ...diffResult,
        diff: summary,
        fileSummary: `[Summarized from ${diffResult.diff.length} chars]\n${diffResult.fileSummary}`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showWarningMessage(
        `Failed to summarize diff, using original: ${message}`
      );
    }
  }

  // Generate PR description
  let prDescription: string;
  try {
    prDescription = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Generating PR description via ${providerName}...`,
        cancellable: false
      },
      async () => {
        return await generatePRDescription(
          config.provider,
          apiKey,
          diffResult.diff,
          diffResult.fileSummary,
          config.model,
          config.language,
          config.ollamaUrl,
          ruleset || undefined
        );
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Ollama connection error
    if (config.provider === 'ollama' && (message.includes('ECONNREFUSED') || message.includes('fetch failed'))) {
      vscode.window.showErrorMessage(
        `Cannot connect to Ollama. Make sure Ollama is running at ${config.ollamaUrl}`
      );
      return;
    }

    if (message.includes('401') || message.includes('Unauthorized') || message.includes('invalid')) {
      vscode.window.showErrorMessage(
        `Invalid ${providerName} API key. Please set a valid API key.`
      );
      return;
    }

    if (message.includes('429') || message.includes('rate limit')) {
      vscode.window.showErrorMessage(
        'Rate limit exceeded. Please wait a moment and try again.'
      );
      return;
    }

    vscode.window.showErrorMessage(`Failed to generate PR description: ${message}`);
    return;
  }

  // Open PR description in new editor tab
  const doc = await vscode.workspace.openTextDocument({
    content: prDescription,
    language: 'markdown'
  });
  await vscode.window.showTextDocument(doc, { preview: false });

  // Show info message with copy option
  const action = await vscode.window.showInformationMessage(
    'PR description generated successfully!',
    'Copy to Clipboard'
  );

  if (action === 'Copy to Clipboard') {
    await vscode.env.clipboard.writeText(prDescription);
    vscode.window.showInformationMessage('PR description copied to clipboard!');
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('AI Commit Message Generator is now active');

  const generateDisposable = vscode.commands.registerCommand(
    'ai-commit-msg.generate',
    () => generateCommand(context)
  );

  const setOpenAIKeyDisposable = vscode.commands.registerCommand(
    'ai-commit-msg.setOpenAIKey',
    () => setOpenAIKeyCommand(context)
  );

  const setGroqKeyDisposable = vscode.commands.registerCommand(
    'ai-commit-msg.setGroqKey',
    () => setGroqKeyCommand(context)
  );

  const setGeminiKeyDisposable = vscode.commands.registerCommand(
    'ai-commit-msg.setGeminiKey',
    () => setGeminiKeyCommand(context)
  );

  const setOllamaUrlDisposable = vscode.commands.registerCommand(
    'ai-commit-msg.setOllamaUrl',
    () => setOllamaUrlCommand()
  );

  const generatePRDisposable = vscode.commands.registerCommand(
    'ai-commit-msg.generatePR',
    () => generatePRCommand(context)
  );

  context.subscriptions.push(
    generateDisposable,
    setOpenAIKeyDisposable,
    setGroqKeyDisposable,
    setGeminiKeyDisposable,
    setOllamaUrlDisposable,
    generatePRDisposable
  );
}

export function deactivate() {}
