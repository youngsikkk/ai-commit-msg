import * as vscode from 'vscode';
import * as path from 'path';
import { getApiKey, promptForApiKey, getConfig } from './config';
import { hasStagedChanges, getStagedDiff } from './git';
import { generateCommitMessage, formatCommitMessage } from './ai';

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

  // Get API key
  let apiKey = await getApiKey(context.secrets);
  if (!apiKey) {
    apiKey = await promptForApiKey(context.secrets);
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

  // Get config
  const config = getConfig();

  // Generate commit message with progress
  let commitMessage: string | undefined;

  try {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Generating commit message...',
        cancellable: false
      },
      async () => {
        const diffResult = await getStagedDiff(
          workspacePath,
          config.maxDiffChars,
          config.exclude
        );

        if (!diffResult.diff.trim()) {
          throw new Error('No diff content after filtering excluded files');
        }

        const result = await generateCommitMessage(
          apiKey,
          diffResult.diff,
          diffResult.fileSummary,
          config.model,
          config.language
        );

        commitMessage = formatCommitMessage(result);

        if (diffResult.truncated) {
          vscode.window.showWarningMessage(
            'Note: The diff was truncated due to size limits.'
          );
        }
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Check for common API errors
    if (message.includes('401') || message.includes('Unauthorized')) {
      vscode.window.showErrorMessage(
        'Invalid API key. Please set a valid API key using "AI Commit: Set API Key".'
      );
      return;
    }

    if (message.includes('429') || message.includes('rate limit')) {
      vscode.window.showErrorMessage(
        'Rate limit exceeded. Please wait a moment and try again.'
      );
      return;
    }

    vscode.window.showErrorMessage(`Failed to generate commit message: ${message}`);
    return;
  }

  if (!commitMessage) {
    return;
  }

  // Handle existing text in SCM input
  const finalMessage = await handleExistingText(repo.inputBox.value, commitMessage);
  if (finalMessage === undefined) {
    return; // User cancelled
  }

  // Insert into SCM input box
  repo.inputBox.value = finalMessage;
  vscode.window.showInformationMessage('Commit message generated successfully!');
}

async function setApiKeyCommand(context: vscode.ExtensionContext): Promise<void> {
  await promptForApiKey(context.secrets);
}

export function activate(context: vscode.ExtensionContext) {
  console.log('AI Commit Message Generator is now active');

  const generateDisposable = vscode.commands.registerCommand(
    'ai-commit-msg.generate',
    () => generateCommand(context)
  );

  const setApiKeyDisposable = vscode.commands.registerCommand(
    'ai-commit-msg.setApiKey',
    () => setApiKeyCommand(context)
  );

  context.subscriptions.push(generateDisposable, setApiKeyDisposable);
}

export function deactivate() {}
