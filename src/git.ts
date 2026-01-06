import simpleGit, { SimpleGit } from 'simple-git';
import { minimatch } from 'minimatch';
import type { DiffResult } from './types';
import { maskSensitiveInfo } from './masking';

function createGit(workspacePath: string): SimpleGit {
  return simpleGit(workspacePath);
}

function shouldExcludeFile(filePath: string, excludePatterns: string[]): boolean {
  return excludePatterns.some(pattern => {
    // Handle directory patterns (e.g., "node_modules")
    if (!pattern.includes('*') && !pattern.includes('/')) {
      if (filePath.startsWith(pattern + '/') || filePath === pattern) {
        return true;
      }
    }
    // Handle glob patterns
    return minimatch(filePath, pattern, { matchBase: true });
  });
}

function filterDiffByPatterns(diff: string, excludePatterns: string[]): string {
  if (!diff || excludePatterns.length === 0) {
    return diff;
  }

  // Split diff into file sections
  const fileSections = diff.split(/^(?=diff --git)/m);

  const filteredSections = fileSections.filter(section => {
    if (!section.trim()) {
      return false;
    }

    // Extract file path from diff header: "diff --git a/path/to/file b/path/to/file"
    const match = section.match(/^diff --git a\/(.+?) b\//);
    if (!match) {
      return true; // Keep sections we can't parse
    }

    const filePath = match[1];
    return !shouldExcludeFile(filePath, excludePatterns);
  });

  return filteredSections.join('');
}

function filterFileSummary(summary: string, excludePatterns: string[]): string {
  if (!summary || excludePatterns.length === 0) {
    return summary;
  }

  const lines = summary.split('\n');
  const filteredLines = lines.filter(line => {
    if (!line.trim()) {
      return false;
    }

    // Format: "M\tpath/to/file" or "A\tpath/to/file"
    const parts = line.split('\t');
    if (parts.length < 2) {
      return true; // Keep lines we can't parse
    }

    const filePath = parts[1];
    return !shouldExcludeFile(filePath, excludePatterns);
  });

  return filteredLines.join('\n');
}

export async function hasStagedChanges(workspacePath: string): Promise<boolean> {
  const git = createGit(workspacePath);
  const diff = await git.diff(['--cached', '--name-only']);
  return diff.trim().length > 0;
}

export async function getCurrentBranch(workspacePath: string): Promise<string> {
  const git = createGit(workspacePath);
  const branchSummary = await git.branch();
  return branchSummary.current;
}

export async function getStagedDiff(
  workspacePath: string,
  maxChars: number,
  excludePatterns: string[],
  shouldMaskSensitive: boolean = true
): Promise<DiffResult> {
  const git = createGit(workspacePath);

  // Get the full diff and file summary
  const [rawDiff, rawSummary] = await Promise.all([
    git.diff(['--cached']),
    git.diff(['--cached', '--name-status'])
  ]);

  // Filter out excluded files
  let diff = filterDiffByPatterns(rawDiff, excludePatterns);
  const fileSummary = filterFileSummary(rawSummary, excludePatterns);

  // Mask sensitive information if enabled
  if (shouldMaskSensitive) {
    diff = maskSensitiveInfo(diff);
  }

  // Check if truncation is needed
  let truncated = false;
  if (diff.length > maxChars) {
    diff = diff.substring(0, maxChars);
    // Try to end at a line boundary
    const lastNewline = diff.lastIndexOf('\n');
    if (lastNewline > maxChars * 0.8) {
      diff = diff.substring(0, lastNewline);
    }
    diff += '\n... [diff truncated]';
    truncated = true;
  }

  return {
    diff,
    fileSummary,
    truncated
  };
}

export async function getFileSummary(
  workspacePath: string,
  excludePatterns: string[]
): Promise<string> {
  const git = createGit(workspacePath);
  const rawSummary = await git.diff(['--cached', '--name-status']);
  return filterFileSummary(rawSummary, excludePatterns);
}

export async function hasUncommittedChanges(workspacePath: string): Promise<boolean> {
  const git = createGit(workspacePath);
  // Check both staged and unstaged changes
  const [staged, unstaged] = await Promise.all([
    git.diff(['--cached', '--name-only']),
    git.diff(['--name-only'])
  ]);
  return staged.trim().length > 0 || unstaged.trim().length > 0;
}

export async function getUncommittedDiff(
  workspacePath: string,
  maxChars: number,
  excludePatterns: string[],
  shouldMaskSensitive: boolean = true
): Promise<DiffResult> {
  const git = createGit(workspacePath);

  // Get both staged and unstaged changes
  const [stagedDiff, unstagedDiff, stagedSummary, unstagedSummary] = await Promise.all([
    git.diff(['--cached']),
    git.diff([]),
    git.diff(['--cached', '--name-status']),
    git.diff(['--name-status'])
  ]);

  // Combine diffs (staged first, then unstaged)
  let rawDiff = stagedDiff;
  if (unstagedDiff.trim()) {
    rawDiff += (rawDiff ? '\n' : '') + unstagedDiff;
  }

  // Combine summaries and dedupe
  const allSummaryLines = new Set<string>();
  stagedSummary.split('\n').filter(l => l.trim()).forEach(l => allSummaryLines.add(l));
  unstagedSummary.split('\n').filter(l => l.trim()).forEach(l => allSummaryLines.add(l));
  const rawSummary = Array.from(allSummaryLines).join('\n');

  // Filter out excluded files
  let diff = filterDiffByPatterns(rawDiff, excludePatterns);
  const fileSummary = filterFileSummary(rawSummary, excludePatterns);

  // Mask sensitive information if enabled
  if (shouldMaskSensitive) {
    diff = maskSensitiveInfo(diff);
  }

  // Check if truncation is needed
  let truncated = false;
  if (diff.length > maxChars) {
    diff = diff.substring(0, maxChars);
    // Try to end at a line boundary
    const lastNewline = diff.lastIndexOf('\n');
    if (lastNewline > maxChars * 0.8) {
      diff = diff.substring(0, lastNewline);
    }
    diff += '\n... [diff truncated]';
    truncated = true;
  }

  return {
    diff,
    fileSummary,
    truncated
  };
}
