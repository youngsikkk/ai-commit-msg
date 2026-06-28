import * as vscode from 'vscode';
import * as path from 'path';
import { getApiKeyForProvider, promptForApiKeyForProvider, promptForOllamaUrl, getConfig } from './config';
import { hasStagedChanges, getStagedDiff, hasUncommittedChanges, getUncommittedDiff, getCurrentBranch, getRecentCommitSubjects } from './git';
import { generateCommitMessageCandidates, formatCommitMessage, summarizeDiff } from './ai';
import { loadRuleset, validateAgainstRuleset } from './ruleset';
import { ensurePRAnalysisSections, generatePRDescription } from './pr';
import { getIssueReferenceFromBranch } from './issue';
import { analyzeDiff, formatAutomatedAnalysisMarkdown } from './analysis';
import { detectValidationCommands, runValidationCommands } from './validation';
import { VALID_COMMIT_TYPES } from './types';
import type { CommitMessage, CommitType, Config, DiffResult, Language, Provider, ValidationReport } from './types';
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

function extractPRTitle(markdown: string): string {
  const heading = markdown
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.startsWith('# '));

  if (heading) {
    return heading.replace(/^#\s+/, '').trim();
  }

  return markdown.split(/\r?\n/).find(line => line.trim())?.trim() || 'PR Description';
}

function extractPRBody(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const firstTitleIndex = lines.findIndex(line => line.trim().startsWith('# '));

  if (firstTitleIndex === -1) {
    return markdown.trim();
  }

  return lines
    .filter((_, index) => index !== firstTitleIndex)
    .join('\n')
    .replace(/^\s+/, '')
    .trim();
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

function extractFixPrompt(markdown: string): string {
  const section = extractMarkdownSection(markdown, 'Fix Prompt');

  if (!section) {
    return '';
  }

  return section
    .replace(/^##\s+Fix Prompt\b.*$/im, '')
    .trim()
    .replace(/^```(?:\w+)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

async function saveMarkdownFile(workspacePath: string, fileName: string, content: string): Promise<void> {
  const target = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(workspacePath, fileName)),
    filters: {
      Markdown: ['md']
    }
  });

  if (!target) {
    return;
  }

  await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf-8'));
  vscode.window.showInformationMessage(`Saved ${path.basename(target.fsPath)}`);
}

function buildPreCommitReviewMarkdown(commitMessage: string, analysisMarkdown: string): string {
  return [
    '# Pre-Commit Review',
    '',
    '## Selected Commit Message',
    '```text',
    commitMessage,
    '```',
    '',
    '## Commit Step',
    '- The selected message has been inserted into the VS Code Source Control input box.',
    '- Review this pre-commit analysis before running `git commit`.',
    '- If the fix prompt identifies a real issue, update the code and regenerate the commit message before committing.',
    '',
    '---',
    '',
    analysisMarkdown.trim(),
    ''
  ].join('\n');
}

async function openPreCommitReview(workspacePath: string, commitMessage: string, analysisMarkdown: string): Promise<void> {
  const markdown = buildPreCommitReviewMarkdown(commitMessage, analysisMarkdown);
  const doc = await vscode.workspace.openTextDocument({
    content: markdown,
    language: 'markdown'
  });
  await vscode.window.showTextDocument(doc, { preview: false });
  await handlePreCommitReviewActions(workspacePath, commitMessage, markdown);
}

async function handlePreCommitReviewActions(
  workspacePath: string,
  commitMessage: string,
  markdown: string
): Promise<void> {
  const fixPrompt = extractFixPrompt(markdown);
  const actions = ['Copy Commit Message', 'Copy Fix Prompt', 'Save PRE_COMMIT_REVIEW.md'];

  if (fixPrompt) {
    actions.push('Save FIX_PROMPT.md');
  }

  const action = await vscode.window.showInformationMessage(
    'Pre-commit review generated. Review risks before committing.',
    ...actions
  );

  if (action === 'Copy Commit Message') {
    await vscode.env.clipboard.writeText(commitMessage);
    vscode.window.showInformationMessage('Commit message copied to clipboard.');
  } else if (action === 'Copy Fix Prompt' && fixPrompt) {
    await vscode.env.clipboard.writeText(fixPrompt);
    vscode.window.showInformationMessage('Fix prompt copied to clipboard.');
  } else if (action === 'Save PRE_COMMIT_REVIEW.md') {
    await saveMarkdownFile(workspacePath, 'PRE_COMMIT_REVIEW.md', markdown);
  } else if (action === 'Save FIX_PROMPT.md' && fixPrompt) {
    const fixPromptMarkdown = ['# Fix Prompt', '', '```text', fixPrompt, '```', ''].join('\n');
    await saveMarkdownFile(workspacePath, 'FIX_PROMPT.md', fixPromptMarkdown);
  }
}

async function promptForValidationRun(workspacePath: string, config: Config): Promise<string[]> {
  if (config.validationCommands.length > 0) {
    return config.runValidationBeforePR ? config.validationCommands : [];
  }

  const detectedCommands = await detectValidationCommands(workspacePath);

  if (config.runValidationBeforePR) {
    return detectedCommands;
  }

  if (detectedCommands.length === 0) {
    return [];
  }

  const picked = await vscode.window.showQuickPick(
    [
      {
        label: 'Run detected validation',
        description: detectedCommands.join(' | '),
        run: true
      },
      {
        label: 'Skip validation',
        description: 'Generate PR description without running local commands',
        run: false
      }
    ],
    {
      title: 'Detected validation commands',
      placeHolder: 'Run before PR generation?'
    }
  );

  return picked?.run ? detectedCommands : [];
}

async function handleGeneratedPRActions(workspacePath: string, prDescription: string): Promise<void> {
  const title = extractPRTitle(prDescription);
  const body = extractPRBody(prDescription);
  const fixPrompt = extractFixPrompt(prDescription);
  const actions = ['Copy PR Title', 'Copy PR Body', 'Copy All', 'Save PR.md'];

  if (fixPrompt) {
    actions.push('Copy Fix Prompt', 'Save FIX_PROMPT.md');
  }

  const action = await vscode.window.showInformationMessage(
    'PR description generated successfully!',
    ...actions
  );

  if (action === 'Copy PR Title') {
    await vscode.env.clipboard.writeText(title);
    vscode.window.showInformationMessage('PR title copied to clipboard.');
  } else if (action === 'Copy PR Body') {
    await vscode.env.clipboard.writeText(body);
    vscode.window.showInformationMessage('PR body copied to clipboard.');
  } else if (action === 'Copy All') {
    await vscode.env.clipboard.writeText(prDescription);
    vscode.window.showInformationMessage('PR markdown copied to clipboard.');
  } else if (action === 'Save PR.md') {
    await saveMarkdownFile(workspacePath, 'PR.md', prDescription);
  } else if (action === 'Copy Fix Prompt') {
    await vscode.env.clipboard.writeText(fixPrompt);
    vscode.window.showInformationMessage('Fix prompt copied to clipboard.');
  } else if (action === 'Save FIX_PROMPT.md') {
    await saveMarkdownFile(workspacePath, 'FIX_PROMPT.md', ['# Fix Prompt', '', '```text', fixPrompt, '```', ''].join('\n'));
  }
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

async function runCommandWithErrorMessage(label: string, command: () => Promise<void>): Promise<void> {
  try {
    await command();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`${label} failed: ${message}`);
  }
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
  const preCommitDiffResult = diffResult;


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

  if (config.includeImpactRiskAnalysis) {
    const preCommitAnalysis = analyzeDiff(preCommitDiffResult.diff, preCommitDiffResult.fileSummary);
    const preCommitReviewMarkdown = formatAutomatedAnalysisMarkdown(preCommitAnalysis);

    if (preCommitAnalysis.riskLevel === 'high') {
      vscode.window.showWarningMessage(
        `High-risk staged change detected (${preCommitAnalysis.riskScore}/100). Review the pre-commit analysis before committing.`
      );
    }

    await openPreCommitReview(workspacePath, finalMessage, preCommitReviewMarkdown);
  }

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

  let automatedAnalysisMarkdown: string | undefined;
  if (config.includeImpactRiskAnalysis) {
    const impactRiskAnalysis = analyzeDiff(diffResult.diff, diffResult.fileSummary);
    let validationReport: ValidationReport | undefined;
    const validationCommands = await promptForValidationRun(workspacePath, config);

    if (validationCommands.length > 0) {
      validationReport = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Running validation commands...',
          cancellable: false
        },
        async () => {
          return await runValidationCommands(
            workspacePath,
            validationCommands,
            config.validationTimeoutMs,
            config.maxValidationOutputChars
          );
        }
      );

      if (validationReport.enabled && validationReport.failed > 0) {
        vscode.window.showWarningMessage(
          `Validation found ${validationReport.failed} failing command(s). The PR description will include the failures.`
        );
      }
    }

    automatedAnalysisMarkdown = formatAutomatedAnalysisMarkdown(impactRiskAnalysis, validationReport);

    if (impactRiskAnalysis.riskLevel === 'high') {
      vscode.window.showWarningMessage(
        `High-risk change detected (${impactRiskAnalysis.riskScore}/100). Review the generated PR risk section before merging.`
      );
    }
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
          ruleset || undefined,
          automatedAnalysisMarkdown
        );
      }
    );

    prDescription = ensurePRAnalysisSections(prDescription, automatedAnalysisMarkdown);
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

  await handleGeneratedPRActions(workspacePath, prDescription);
}

async function createRulesetCommand(): Promise<void> {
  const git = await getGitAPI();
  if (!git) {
    vscode.window.showErrorMessage('Git extension not found. Please install the Git extension.');
    return;
  }

  const repo = await selectRepository(git);
  if (!repo) {
    return;
  }

  const workspacePath = repo.rootUri.fsPath;
  const rulesetUri = vscode.Uri.file(path.join(workspacePath, '.commitrc.json'));

  try {
    await vscode.workspace.fs.stat(rulesetUri);
    const overwrite = await vscode.window.showWarningMessage(
      '.commitrc.json already exists.',
      'Overwrite',
      'Cancel'
    );

    if (overwrite !== 'Overwrite') {
      return;
    }
  } catch {
    // File does not exist yet.
  }

  const pickedTypes = await vscode.window.showQuickPick(
    VALID_COMMIT_TYPES.map(type => ({
      label: type,
      picked: ['feat', 'fix', 'docs', 'refactor', 'test', 'chore'].includes(type)
    })),
    {
      title: 'Allowed commit types',
      canPickMany: true,
      placeHolder: 'Select commit types this team allows'
    }
  );

  if (!pickedTypes || pickedTypes.length === 0) {
    return;
  }

  const scopesInput = await vscode.window.showInputBox({
    title: 'Allowed scopes',
    prompt: 'Comma-separated scopes. Leave empty to allow any scope.',
    placeHolder: 'api, auth, ui, db, config'
  });

  if (scopesInput === undefined) {
    return;
  }

  const scopeRequirement = await vscode.window.showQuickPick(
    [
      { label: 'Scope optional', value: false },
      { label: 'Scope required', value: true }
    ],
    {
      title: 'Scope rule',
      placeHolder: 'Should every commit message include a scope?'
    }
  );

  if (!scopeRequirement) {
    return;
  }

  const maxSubjectInput = await vscode.window.showInputBox({
    title: 'Max subject length',
    prompt: 'Recommended: 72',
    value: '72',
    validateInput: value => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 && parsed <= 200
        ? undefined
        : 'Enter a number from 1 to 200';
    }
  });

  if (!maxSubjectInput) {
    return;
  }

  const languagePick = await vscode.window.showQuickPick(
    [
      { label: 'english', value: 'english' as Language },
      { label: 'korean', value: 'korean' as Language }
    ],
    {
      title: 'Commit message language',
      placeHolder: 'Select subject language'
    }
  );

  if (!languagePick) {
    return;
  }

  const allowedScopes = scopesInput
    .split(',')
    .map(scope => scope.trim())
    .filter(Boolean);

  const ruleset = {
    allowedTypes: pickedTypes.map(type => type.label as CommitType),
    requireScope: scopeRequirement.value,
    allowedScopes: allowedScopes.length > 0 ? allowedScopes : undefined,
    maxSubjectLength: Number(maxSubjectInput),
    language: languagePick.value
  };

  await vscode.workspace.fs.writeFile(
    rulesetUri,
    Buffer.from(JSON.stringify(ruleset, null, 2) + '\n', 'utf-8')
  );

  const doc = await vscode.workspace.openTextDocument(rulesetUri);
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.showInformationMessage('Team ruleset created: .commitrc.json');
}

function formatReleaseNotesFromSubjects(subjects: string[]): string {
  const groups: Record<string, string[]> = {
    Features: [],
    Fixes: [],
    Documentation: [],
    Tests: [],
    Build: [],
    Chores: [],
    Other: []
  };

  for (const subject of subjects) {
    const match = subject.match(/^(\w+)(?:\([^)]+\))?:\s*(.+)$/);
    const type = match?.[1];
    const text = match?.[2] || subject;

    switch (type) {
      case 'feat':
        groups.Features.push(text);
        break;
      case 'fix':
        groups.Fixes.push(text);
        break;
      case 'docs':
        groups.Documentation.push(text);
        break;
      case 'test':
        groups.Tests.push(text);
        break;
      case 'build':
      case 'ci':
        groups.Build.push(text);
        break;
      case 'chore':
      case 'refactor':
      case 'style':
      case 'perf':
        groups.Chores.push(text);
        break;
      default:
        groups.Other.push(subject);
        break;
    }
  }

  const sections = Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([heading, items]) => {
      return `## ${heading}\n${items.map(item => `- ${item}`).join('\n')}`;
    });

  return `# Release Notes Draft

${sections.length > 0 ? sections.join('\n\n') : '- No recent commits found.'}
`;
}

async function generateReleaseNotesCommand(): Promise<void> {
  const git = await getGitAPI();
  if (!git) {
    vscode.window.showErrorMessage('Git extension not found. Please install the Git extension.');
    return;
  }

  const repo = await selectRepository(git);
  if (!repo) {
    return;
  }

  const maxCountInput = await vscode.window.showInputBox({
    title: 'Release notes source',
    prompt: 'How many recent commits should be used?',
    value: '20',
    validateInput: value => {
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed > 0 && parsed <= 100
        ? undefined
        : 'Enter a number from 1 to 100';
    }
  });

  if (!maxCountInput) {
    return;
  }

  let subjects: string[];
  try {
    subjects = await getRecentCommitSubjects(repo.rootUri.fsPath, Number(maxCountInput));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Failed to read recent commits: ${message}`);
    return;
  }

  const markdown = formatReleaseNotesFromSubjects(subjects);
  const doc = await vscode.workspace.openTextDocument({
    content: markdown,
    language: 'markdown'
  });
  await vscode.window.showTextDocument(doc, { preview: false });

  const action = await vscode.window.showInformationMessage(
    'Release notes draft generated.',
    'Copy',
    'Save RELEASE_NOTES.md'
  );

  if (action === 'Copy') {
    await vscode.env.clipboard.writeText(markdown);
    vscode.window.showInformationMessage('Release notes copied to clipboard.');
  } else if (action === 'Save RELEASE_NOTES.md') {
    await saveMarkdownFile(repo.rootUri.fsPath, 'RELEASE_NOTES.md', markdown);
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('AI Commit Message Generator is now active');

  const generateDisposable = vscode.commands.registerCommand(
    'ai-commit-msg.generate',
    () => runCommandWithErrorMessage('Generate commit message', () => generateCommand(context))
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
    () => runCommandWithErrorMessage('Generate PR description', () => generatePRCommand(context))
  );

  const createRulesetDisposable = vscode.commands.registerCommand(
    'ai-commit-msg.createRuleset',
    () => runCommandWithErrorMessage('Create team ruleset', () => createRulesetCommand())
  );

  const generateReleaseNotesDisposable = vscode.commands.registerCommand(
    'ai-commit-msg.generateReleaseNotes',
    () => runCommandWithErrorMessage('Generate release notes', () => generateReleaseNotesCommand())
  );

  context.subscriptions.push(
    generateDisposable,
    setOpenAIKeyDisposable,
    setGroqKeyDisposable,
    setGeminiKeyDisposable,
    setOllamaUrlDisposable,
    generatePRDisposable,
    createRulesetDisposable,
    generateReleaseNotesDisposable
  );
}

export function deactivate() {}
