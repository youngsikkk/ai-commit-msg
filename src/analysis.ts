import type { ImpactRiskAnalysis, RiskLevel, ValidationReport } from './types';

interface ChangedFile {
  status: string;
  path: string;
}

interface RiskSignal {
  weight: number;
  factor: string;
  reviewFocus?: string;
  testSuggestion?: string;
  category?: string;
  area?: string;
}

const TEST_FILE_PATTERN = /(^|\/)(test|tests|__tests__|spec)(\/|$)|\.(test|spec)\.[jt]sx?$/i;

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function parseChangedFiles(fileSummary: string): ChangedFile[] {
  return fileSummary
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split('\t');
      const status = parts[0] || 'M';
      const filePath = parts.length > 1 ? parts[parts.length - 1] : line;
      return { status, path: normalizePath(filePath) };
    });
}

function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    }
  }

  return { additions, deletions };
}

function hasAny(files: ChangedFile[], pattern: RegExp): boolean {
  return files.some(file => pattern.test(file.path));
}

function pushUnique(target: string[], value?: string): void {
  if (value && !target.includes(value)) {
    target.push(value);
  }
}

function classifyFileSignals(files: ChangedFile[], diff: string): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const lowerDiff = diff.toLowerCase();

  if (hasAny(files, TEST_FILE_PATTERN)) {
    signals.push({
      weight: -8,
      factor: 'Tests were updated with the code change',
      category: 'tests',
      area: 'test coverage'
    });
  }

  if (hasAny(files, /(^|\/)(readme|changelog|docs?|adr)(\/|\.|-|_)|\.md$|\.mdx$/i)) {
    signals.push({
      weight: -3,
      factor: 'Documentation files changed',
      category: 'docs',
      area: 'documentation'
    });
  }

  if (hasAny(files, /(^|\/)(auth|authentication|security|permission|permissions|role|roles|login|oauth|jwt|session|token|password)(\/|\.|-|_)/i)) {
    signals.push({
      weight: 22,
      factor: 'Authentication or authorization related files changed',
      reviewFocus: 'Verify auth edge cases, permission boundaries, and session/token behavior',
      testSuggestion: 'Run login, logout, permission, expired-token, and unauthorized-access scenarios',
      category: 'security',
      area: 'authentication/authorization'
    });
  }

  if (hasAny(files, /(^|\/)(payment|billing|invoice|subscription|settlement|pg|checkout)(\/|\.|-|_)/i)) {
    signals.push({
      weight: 24,
      factor: 'Payment or billing related files changed',
      reviewFocus: 'Check money movement, idempotency, retries, and failure rollback behavior',
      testSuggestion: 'Run payment success, failure, retry, refund, and duplicate-request scenarios',
      category: 'business critical',
      area: 'payment/billing'
    });
  }

  if (hasAny(files, /(^|\/)(migration|migrations|schema|prisma|db|database|sql|liquibase|flyway)(\/|\.|-|_)|\.sql$/i)) {
    signals.push({
      weight: 25,
      factor: 'Database schema or migration files changed',
      reviewFocus: 'Check backward compatibility, rollback plan, data migration safety, and index impact',
      testSuggestion: 'Run migration up/down locally and verify existing data paths',
      category: 'database',
      area: 'database/schema'
    });
  }

  if (hasAny(files, /(^|\/)(Dockerfile|docker-compose|k8s|kubernetes|helm|terraform|nginx|deployment|deploy|infra|ops)(\/|\.|-|_)|(^|\/)Dockerfile$/i)) {
    signals.push({
      weight: 22,
      factor: 'Deployment, container, or infrastructure files changed',
      reviewFocus: 'Verify environment variables, ports, resource settings, and rollout behavior',
      testSuggestion: 'Run a local build/deploy dry run or inspect generated deployment manifests',
      category: 'infrastructure',
      area: 'deployment/infra'
    });
  }

  if (hasAny(files, /(^|\/)(\.github\/workflows|\.gitlab-ci\.yml|Jenkinsfile|azure-pipelines|circleci|ci)(\/|$|\.)/i)) {
    signals.push({
      weight: 16,
      factor: 'CI/CD workflow files changed',
      reviewFocus: 'Check build, test, deploy, and secret-handling steps',
      testSuggestion: 'Run the changed pipeline path or validate the workflow syntax',
      category: 'ci/cd',
      area: 'ci/cd'
    });
  }

  if (hasAny(files, /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|pom\.xml|build\.gradle|settings\.gradle|requirements\.txt|poetry\.lock|Cargo\.toml|Cargo\.lock)$/i)) {
    signals.push({
      weight: 15,
      factor: 'Dependencies or build manifest changed',
      reviewFocus: 'Check dependency version changes, transitive impact, and lockfile consistency',
      testSuggestion: 'Run install/build and dependency-sensitive smoke tests',
      category: 'dependencies',
      area: 'dependency/build'
    });
  }

  if (hasAny(files, /(^|\/)(api|apis|route|routes|controller|controllers|resolver|graphql|endpoint|openapi|swagger)(\/|\.|-|_)/i)) {
    signals.push({
      weight: 14,
      factor: 'API or routing layer files changed',
      reviewFocus: 'Check request/response compatibility, status codes, and error handling',
      testSuggestion: 'Run API contract, integration, and backward-compatibility checks',
      category: 'api',
      area: 'api/contracts'
    });
  }

  if (hasAny(files, /(^|\/)(\.env|env\.|config|configs|settings)(\/|\.|-|_)|\.ya?ml$|\.toml$|\.ini$/i)) {
    signals.push({
      weight: 14,
      factor: 'Configuration files changed',
      reviewFocus: 'Check environment-specific values and default behavior',
      testSuggestion: 'Run the app with local/default configuration and verify startup',
      category: 'configuration',
      area: 'configuration'
    });
  }

  if (/drop\s+table|truncate\s+table|delete\s+from|alter\s+table|create\s+index|drop\s+index/i.test(diff)) {
    signals.push({
      weight: 22,
      factor: 'Potentially destructive or heavy database operation detected in diff',
      reviewFocus: 'Confirm data safety, locks, rollout order, and rollback plan',
      testSuggestion: 'Test migration against realistic data volume',
      category: 'database',
      area: 'database/schema'
    });
  }

  if (/export\s+(async\s+)?(function|class|interface|type|const)|public\s+(async\s+)?(class|interface|void|static)|router\.(get|post|put|patch|delete)|app\.(get|post|put|patch|delete)/i.test(diff)) {
    signals.push({
      weight: 10,
      factor: 'Public API surface or exported symbol changed',
      reviewFocus: 'Check downstream callers and public contract compatibility',
      testSuggestion: 'Run caller-side or integration tests around the changed public surface',
      category: 'api',
      area: 'public contract'
    });
  }

  if (lowerDiff.includes('todo') || lowerDiff.includes('fixme')) {
    signals.push({
      weight: 5,
      factor: 'TODO/FIXME marker introduced or touched',
      reviewFocus: 'Confirm incomplete work is intentional and tracked',
      testSuggestion: 'Review TODO/FIXME context before release',
      category: 'maintainability',
      area: 'code quality'
    });
  }

  return signals;
}

function scaleRisk(changedFiles: number, changedLines: number): RiskSignal[] {
  const signals: RiskSignal[] = [];

  if (changedFiles >= 20) {
    signals.push({
      weight: 18,
      factor: `Large file blast radius (${changedFiles} files changed)`,
      reviewFocus: 'Split review by subsystem and check cross-module behavior',
      testSuggestion: 'Run a broad regression suite before merge',
      category: 'scale',
      area: 'cross-module'
    });
  } else if (changedFiles >= 8) {
    signals.push({
      weight: 10,
      factor: `Moderate file blast radius (${changedFiles} files changed)`,
      reviewFocus: 'Check whether changes span unrelated modules',
      testSuggestion: 'Run targeted regression tests for touched modules',
      category: 'scale',
      area: 'cross-module'
    });
  }

  if (changedLines >= 1000) {
    signals.push({
      weight: 20,
      factor: `Large diff size (${changedLines} changed lines)`,
      reviewFocus: 'Review generated files and separate mechanical changes from logic changes',
      testSuggestion: 'Run full automated validation plus focused smoke tests',
      category: 'scale',
      area: 'large diff'
    });
  } else if (changedLines >= 300) {
    signals.push({
      weight: 10,
      factor: `Moderate diff size (${changedLines} changed lines)`,
      reviewFocus: 'Check hidden side effects in the larger changed areas',
      testSuggestion: 'Run targeted tests around modified modules',
      category: 'scale',
      area: 'moderate diff'
    });
  }

  return signals;
}

function determineRiskLevel(score: number): RiskLevel {
  if (score >= 70) {
    return 'high';
  }
  if (score >= 35) {
    return 'medium';
  }
  return 'low';
}

function buildImpactSummary(files: ChangedFile[], categories: string[], areas: string[]): string[] {
  const summary: string[] = [];

  if (files.length === 0) {
    summary.push('No changed files were detected from the file summary');
    return summary;
  }

  summary.push(`${files.length} file${files.length === 1 ? '' : 's'} changed`);

  if (areas.length > 0) {
    summary.push(`Likely affected area${areas.length === 1 ? '' : 's'}: ${areas.join(', ')}`);
  }

  if (categories.length > 0) {
    summary.push(`Change categor${categories.length === 1 ? 'y' : 'ies'}: ${categories.join(', ')}`);
  }

  if (files.some(file => file.status.startsWith('D'))) {
    summary.push('One or more files were deleted');
  }

  return summary;
}

function fallbackReviewFocus(riskLevel: RiskLevel): string[] {
  if (riskLevel === 'high') {
    return [
      'Check rollback strategy and deployment order',
      'Verify critical user flows manually before merge',
      'Confirm monitoring or logs are enough to detect issues quickly'
    ];
  }

  if (riskLevel === 'medium') {
    return [
      'Check changed module boundaries and regression-prone paths',
      'Verify error handling and compatibility with existing behavior'
    ];
  }

  return [
    'Check that the implementation matches the intended scope',
    'Confirm the changed path has at least a targeted test or manual check'
  ];
}

function fallbackTestSuggestions(riskLevel: RiskLevel): string[] {
  if (riskLevel === 'high') {
    return [
      'Run full automated tests if available',
      'Run smoke tests for login/startup/core business flows',
      'Prepare rollback or feature flag fallback before release'
    ];
  }

  if (riskLevel === 'medium') {
    return [
      'Run targeted unit/integration tests around touched modules',
      'Perform a quick manual smoke test for the changed flow'
    ];
  }

  return [
    'Run the nearest targeted test or a manual sanity check'
  ];
}

function buildSuggestedCommitSplits(categories: string[], areas: string[]): string[] {
  const suggestions: string[] = [];

  const hasCategory = (category: string) => categories.includes(category);
  const hasArea = (needle: string) => areas.some(area => area.includes(needle));

  if (hasCategory('security') || hasArea('authentication')) {
    suggestions.push('feat(auth): update authentication or authorization behavior');
  }
  if (hasCategory('database') || hasArea('database')) {
    suggestions.push('chore(db): update schema, migration, or data access changes');
  }
  if (hasCategory('api') || hasArea('api') || hasArea('public contract')) {
    suggestions.push('feat(api): update API contract or routing changes');
  }
  if (hasCategory('configuration')) {
    suggestions.push('chore(config): update runtime configuration changes');
  }
  if (hasCategory('infrastructure')) {
    suggestions.push('chore(infra): update deployment or infrastructure changes');
  }
  if (hasCategory('ci/cd')) {
    suggestions.push('ci: update pipeline or release workflow changes');
  }
  if (hasCategory('dependencies')) {
    suggestions.push('build(deps): update dependency or build manifest changes');
  }
  if (hasCategory('tests')) {
    suggestions.push('test: update validation coverage');
  }
  if (hasCategory('docs')) {
    suggestions.push('docs: update documentation');
  }

  return suggestions.length >= 2 ? suggestions : [];
}

function buildDeploymentChecklist(
  riskLevel: RiskLevel,
  categories: string[],
  areas: string[]
): string[] {
  const checklist: string[] = [];
  const hasCategory = (category: string) => categories.includes(category);
  const hasArea = (needle: string) => areas.some(area => area.includes(needle));

  if (riskLevel !== 'high' && !['database', 'security', 'configuration', 'infrastructure', 'dependencies'].some(hasCategory)) {
    return checklist;
  }

  if (hasCategory('database') || hasArea('database')) {
    checklist.push('DB migration rollback plan checked');
    checklist.push('Migration tested against existing data shape');
  }
  if (hasCategory('security') || hasArea('authentication')) {
    checklist.push('Auth flow and permission smoke tests completed');
  }
  if (hasCategory('configuration')) {
    checklist.push('Environment variables and default config verified');
  }
  if (hasCategory('dependencies')) {
    checklist.push('Install, build, and dependency-sensitive smoke tests completed');
  }
  if (hasCategory('infrastructure') || hasCategory('ci/cd')) {
    checklist.push('Deployment manifest or pipeline path reviewed');
  }
  if (hasCategory('api') || hasArea('public contract')) {
    checklist.push('API compatibility and downstream caller impact checked');
  }
  if (riskLevel === 'high') {
    checklist.push('Rollback owner and deployment window confirmed');
    checklist.push('Monitoring and logs checked after deploy');
  }

  return checklist;
}

export function analyzeDiff(diff: string, fileSummary: string): ImpactRiskAnalysis {
  const files = parseChangedFiles(fileSummary);
  const { additions, deletions } = countDiffLines(diff);
  const changedLines = additions + deletions;
  const testFilesChanged = files.some(file => TEST_FILE_PATTERN.test(file.path));

  const signals = [
    ...classifyFileSignals(files, diff),
    ...scaleRisk(files.length, changedLines)
  ];

  if (!testFilesChanged && (changedLines >= 80 || files.length >= 4)) {
    signals.push({
      weight: 10,
      factor: 'No test files changed alongside a non-trivial code change',
      reviewFocus: 'Check whether existing tests cover the changed behavior',
      testSuggestion: 'Add or run targeted tests for the changed behavior',
      category: 'test coverage',
      area: 'test coverage'
    });
  }

  const categories: string[] = [];
  const affectedAreas: string[] = [];
  const riskFactors: string[] = [];
  const reviewFocus: string[] = [];
  const testSuggestions: string[] = [];

  let riskScore = Math.min(20, files.length * 2) + Math.min(20, Math.floor(changedLines / 50));

  for (const signal of signals) {
    riskScore += signal.weight;
    pushUnique(riskFactors, signal.factor);
    pushUnique(reviewFocus, signal.reviewFocus);
    pushUnique(testSuggestions, signal.testSuggestion);
    pushUnique(categories, signal.category);
    pushUnique(affectedAreas, signal.area);
  }

  riskScore = Math.max(0, Math.min(100, riskScore));
  const riskLevel = determineRiskLevel(riskScore);

  for (const item of fallbackReviewFocus(riskLevel)) {
    pushUnique(reviewFocus, item);
  }
  for (const item of fallbackTestSuggestions(riskLevel)) {
    pushUnique(testSuggestions, item);
  }

  return {
    changedFiles: files.length,
    additions,
    deletions,
    changedLines,
    testFilesChanged,
    categories,
    affectedAreas,
    riskLevel,
    riskScore,
    riskFactors: riskFactors.length > 0 ? riskFactors : ['No strong risk signal detected from the diff'],
    impactSummary: buildImpactSummary(files, categories, affectedAreas),
    reviewFocus,
    testSuggestions,
    suggestedCommitSplits: buildSuggestedCommitSplits(categories, affectedAreas),
    deploymentChecklist: buildDeploymentChecklist(riskLevel, categories, affectedAreas)
  };
}

function formatList(items: string[]): string {
  return items.map(item => `- ${item}`).join('\n');
}

function formatChecklist(items: string[]): string {
  return items.map(item => `- [ ] ${item}`).join('\n');
}

function formatRiskLabel(level: RiskLevel): string {
  switch (level) {
    case 'high':
      return 'High';
    case 'medium':
      return 'Medium';
    case 'low':
      return 'Low';
  }
}

function formatValidation(report?: ValidationReport): string {
  if (!report || !report.enabled) {
    return '- Not run. Configure `aiCommit.validationCommands` and enable `aiCommit.runValidationBeforePR` to include local checks.';
  }

  if (report.results.length === 0) {
    return `- ${report.summary}`;
  }

  const lines = [
    `- Summary: ${report.summary}`
  ];

  for (const result of report.results) {
    const status = result.status === 'passed' ? 'PASS' : result.status === 'failed' ? 'FAIL' : 'SKIP';
    const duration = `${Math.round(result.durationMs / 100) / 10}s`;
    lines.push(`- ${status}: \`${result.command}\` (${duration})`);
  }

  return lines.join('\n');
}

export function formatAutomatedAnalysisMarkdown(
  analysis: ImpactRiskAnalysis,
  validationReport?: ValidationReport
): string {
  const validationFailures = validationReport?.enabled ? validationReport.failed : 0;
  const displayedRiskScore = Math.min(100, analysis.riskScore + validationFailures * 15);
  const displayedRiskLevel = determineRiskLevel(displayedRiskScore);
  const riskFactors = [...analysis.riskFactors];

  if (validationFailures > 0) {
    riskFactors.push(`${validationFailures} configured validation command(s) failed`);
  }

  const suggestedSplitSection = analysis.suggestedCommitSplits.length > 0
    ? `\n\n## Suggested Commit Split\n${formatList(analysis.suggestedCommitSplits)}`
    : '';
  const deploymentChecklistSection = analysis.deploymentChecklist.length > 0
    ? `\n\n## Deployment Checklist\n${formatChecklist(analysis.deploymentChecklist)}`
    : '';

  return `## Impact
${formatList(analysis.impactSummary)}

## Risk
- Level: ${formatRiskLabel(displayedRiskLevel)} (${displayedRiskScore}/100)
- Changed lines: +${analysis.additions} / -${analysis.deletions}
${formatList(riskFactors)}

## Review Focus
${formatList(analysis.reviewFocus)}

## Testing
${formatList(analysis.testSuggestions)}

## Validation
${formatValidation(validationReport)}${suggestedSplitSection}${deploymentChecklistSection}`;
}
