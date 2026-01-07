#!/usr/bin/env node

/**
 * Git prepare-commit-msg hook script
 * This script is called by Git before the commit message editor is opened.
 *
 * Usage: commitcraft-hook <commit-msg-file> [<commit-source>] [<sha1>]
 *
 * Arguments:
 * - commit-msg-file: Path to the file containing the commit message
 * - commit-source: Source of the commit (message, template, merge, squash, commit)
 * - sha1: SHA-1 hash (only for --amend)
 */

import fs from 'fs';
import { simpleGit, SimpleGit } from 'simple-git';
import { loadConfig, getApiKey, getDefaultModel } from './config.js';
import { generateCommitMessages, formatCommitMessage } from './ai.js';

const git: SimpleGit = simpleGit();

async function getStagedDiff(): Promise<{ diff: string; fileSummary: string }> {
  const [diff, fileSummary] = await Promise.all([
    git.diff(['--cached']),
    git.diff(['--cached', '--name-status'])
  ]);

  return { diff, fileSummary };
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

function log(message: string): void {
  // Only log if COMMITCRAFT_HOOK_DEBUG is set
  if (process.env.COMMITCRAFT_HOOK_DEBUG) {
    console.error(`[commitcraft-hook] ${message}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const commitMsgFile = args[0];
  const commitSource = args[1];

  // Validate arguments
  if (!commitMsgFile) {
    log('No commit message file provided');
    process.exit(0);
  }

  // Skip if commit has a source (merge, squash, message, etc.)
  // This means user is providing their own message or it's a special commit
  if (commitSource && commitSource !== 'template') {
    log(`Skipping - commit source is "${commitSource}"`);
    process.exit(0);
  }

  // Read existing commit message
  let existingMessage = '';
  try {
    existingMessage = fs.readFileSync(commitMsgFile, 'utf-8').trim();
    // Remove comment lines (lines starting with #)
    const nonCommentLines = existingMessage
      .split('\n')
      .filter(line => !line.startsWith('#'))
      .join('\n')
      .trim();

    // Skip if there's already a non-empty message
    if (nonCommentLines.length > 0) {
      log('Skipping - commit message already exists');
      process.exit(0);
    }
  } catch {
    // File doesn't exist or can't be read - continue
  }

  // Load configuration
  const config = loadConfig();
  const provider = config.provider;
  const model = config.model || getDefaultModel(provider);
  const language = config.language;

  // Check for API key
  const apiKey = getApiKey(config);
  if (!apiKey) {
    log(`No API key found for ${provider}`);
    process.exit(0);
  }

  // Get staged diff
  let diff: string;
  let fileSummary: string;

  try {
    const result = await getStagedDiff();
    diff = result.diff;
    fileSummary = result.fileSummary;

    if (!diff.trim()) {
      log('No staged changes found');
      process.exit(0);
    }

    // Truncate large diffs
    const MAX_CHARS = 12000;
    if (diff.length > MAX_CHARS) {
      diff = diff.substring(0, MAX_CHARS) + '\n... [truncated]';
    }
  } catch (error) {
    log(`Failed to get staged changes: ${error}`);
    process.exit(0);
  }

  // Extract issue from branch if pattern is configured
  let issueReference: string | undefined;
  const issuePattern = process.env.COMMITCRAFT_ISSUE_PATTERN || config.issuePattern;
  const issuePrefix = process.env.COMMITCRAFT_ISSUE_PREFIX || config.issuePrefix || '';

  if (issuePattern) {
    try {
      const branchName = await getCurrentBranch();
      const issue = extractIssueFromBranch(branchName, issuePattern);
      if (issue) {
        issueReference = issuePrefix + issue;
        log(`Detected issue: ${issueReference}`);
      }
    } catch {
      // Ignore branch detection errors
    }
  }

  // Generate commit message
  log(`Generating commit message via ${provider}...`);

  try {
    const candidates = await generateCommitMessages(
      provider,
      apiKey,
      diff,
      fileSummary,
      model,
      language,
      config.ollamaUrl,
      issueReference
    );

    if (candidates.length === 0) {
      log('No commit message candidates generated');
      process.exit(0);
    }

    // Use the first candidate
    const commitMessage = formatCommitMessage(candidates[0]);

    // Write the commit message to the file
    // Preserve any existing comments (like the git status summary)
    const comments = existingMessage
      .split('\n')
      .filter(line => line.startsWith('#'))
      .join('\n');

    const newContent = comments
      ? `${commitMessage}\n\n${comments}`
      : commitMessage;

    fs.writeFileSync(commitMsgFile, newContent);
    log(`Generated: ${commitMessage}`);
  } catch (error) {
    log(`Failed to generate commit message: ${error}`);
    // Don't fail the commit, just let user write their own message
    process.exit(0);
  }
}

main().catch((error) => {
  log(`Unexpected error: ${error}`);
  process.exit(0);
});
