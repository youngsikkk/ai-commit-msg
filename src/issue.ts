/**
 * Extract issue number/ID from branch name using regex pattern
 * @param branchName - Current git branch name (e.g., "feature/123-login", "JIRA-456-fix-bug")
 * @param pattern - Regex pattern with capture group (e.g., "feature/(\\d+)", "(JIRA-\\d+)")
 * @returns Matched issue number/ID or null if no match
 */
export function extractIssueFromBranch(branchName: string, pattern: string): string | null {
  if (!branchName || !pattern) {
    return null;
  }

  try {
    const regex = new RegExp(pattern);
    const match = branchName.match(regex);

    if (match && match[1]) {
      // Return the first capture group
      return match[1];
    }

    // If no capture group, return the full match
    if (match && match[0]) {
      return match[0];
    }

    return null;
  } catch {
    // Invalid regex pattern
    return null;
  }
}

/**
 * Format issue reference with prefix
 * @param issue - Issue number/ID (e.g., "123", "JIRA-456")
 * @param prefix - Prefix to add (e.g., "#", "JIRA-", "GH-")
 * @returns Formatted issue reference (e.g., "#123", "JIRA-456")
 */
export function formatIssueReference(issue: string, prefix: string): string {
  if (!issue) {
    return '';
  }

  // If issue already contains the prefix pattern, don't add it again
  // This handles cases like pattern "(JIRA-\\d+)" extracting "JIRA-123"
  if (prefix && issue.toUpperCase().startsWith(prefix.toUpperCase())) {
    return issue;
  }

  return `${prefix}${issue}`;
}

/**
 * Get issue reference from branch name
 * Combines extraction and formatting
 * @param branchName - Current git branch name
 * @param pattern - Regex pattern to extract issue
 * @param prefix - Prefix for issue reference
 * @returns Formatted issue reference or null
 */
export function getIssueReferenceFromBranch(
  branchName: string,
  pattern: string,
  prefix: string
): string | null {
  const issue = extractIssueFromBranch(branchName, pattern);
  if (!issue) {
    return null;
  }

  return formatIssueReference(issue, prefix);
}
