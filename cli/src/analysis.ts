import type { ValidationReport } from './validation.js';

type RiskLevel = 'low' | 'medium' | 'high';

interface ChangedFile {
  status: string;
  path: string;
}

interface Analysis {
  additions: number;
  deletions: number;
  changedFiles: number;
  riskLevel: RiskLevel;
  riskScore: number;
  impact: string[];
  riskFactors: string[];
  reviewFocus: string[];
  testing: string[];
  suggestedCommitSplits: string[];
  deploymentChecklist: string[];
  securityReview: string[];
  suggestedRemediations: string[];
  fixPrompt: string;
}

const TEST_FILE_PATTERN = /(^|\/)(test|tests|__tests__|spec)(\/|$)|\.(test|spec)\.[jt]sx?$/i;

function parseChangedFiles(fileSummary: string): ChangedFile[] {
  return fileSummary
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const parts = line.split('\t');
      return {
        status: parts[0] || 'M',
        path: (parts[parts.length - 1] || line).replace(/\\/g, '/')
      };
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

function pushUnique(items: string[], value: string): void {
  if (!items.includes(value)) {
    items.push(value);
  }
}

function getRiskLevel(score: number): RiskLevel {
  if (score >= 70) {
    return 'high';
  }
  if (score >= 35) {
    return 'medium';
  }
  return 'low';
}

function riskLabel(level: RiskLevel): string {
  return level[0].toUpperCase() + level.slice(1);
}

function includesArea(areas: string[], needle: string): boolean {
  return areas.some(area => area.includes(needle));
}

function buildSecurityReview(categories: string[], areas: string[], riskFactors: string[], riskLevel: RiskLevel): string[] {
  const review: string[] = [];

  if (categories.includes('security') || includesArea(areas, 'authentication')) {
    review.push('Authentication or authorization behavior changed; inspect permission boundaries, token/session handling, and sensitive logging.');
  }
  if (categories.includes('database') || includesArea(areas, 'database')) {
    review.push('Database or migration behavior changed; inspect SQL safety, rollback strategy, locks, and data exposure risk.');
  }
  if (categories.includes('configuration')) {
    review.push('Configuration changed; verify secrets are not hardcoded and environment defaults are safe.');
  }
  if (categories.includes('dependencies')) {
    review.push('Dependency or build manifest changed; run a dependency audit and check vulnerable transitive packages.');
  }
  if (categories.includes('api')) {
    review.push('API or public contract changed; verify input validation, error handling, and backward compatibility.');
  }
  if (categories.includes('infrastructure') || categories.includes('ci/cd')) {
    review.push('Deployment or CI/CD path changed; verify secret handling, rollout safety, and environment-specific behavior.');
  }
  if (riskFactors.some(factor => /destructive|heavy database/i.test(factor))) {
    review.push('Potentially destructive database operation detected; confirm data backup, rollback, and lock impact before deploy.');
  }
  if (review.length === 0 && riskLevel !== 'low') {
    review.push('No direct security-specific pattern was detected, but the change is broad enough to review for unintended exposure.');
  }
  if (review.length === 0) {
    review.push('No direct security-sensitive pattern was detected; keep the review focused on correctness and regression checks.');
  }

  return review;
}

function buildSuggestedRemediations(categories: string[], areas: string[], riskFactors: string[], riskLevel: RiskLevel): string[] {
  const remediations: string[] = [];

  if (categories.includes('security') || includesArea(areas, 'authentication')) {
    remediations.push('Add or verify tests for unauthorized access, expired sessions, role boundaries, and sensitive data masking.');
  }
  if (categories.includes('database') || includesArea(areas, 'database')) {
    remediations.push('Use safe query patterns, document migration rollback, and verify the change with existing data shape.');
  }
  if (categories.includes('configuration')) {
    remediations.push('Move secrets to environment or secret-manager configuration and confirm safe defaults for each environment.');
  }
  if (categories.includes('dependencies')) {
    remediations.push('Run dependency audit/build checks and review lockfile changes for unexpected package upgrades.');
  }
  if (categories.includes('api')) {
    remediations.push('Add contract or integration checks for request validation, error responses, and downstream compatibility.');
  }
  if (categories.includes('infrastructure') || categories.includes('ci/cd')) {
    remediations.push('Validate deploy manifests or pipeline steps and confirm rollback and monitoring before release.');
  }
  if (riskFactors.some(factor => /No test files changed/i.test(factor))) {
    remediations.push('Add a focused automated test or document a manual verification path before merging.');
  }
  if (riskLevel === 'high') {
    remediations.push('Split unrelated changes if possible and prepare a rollback/smoke-test plan before deployment.');
  }
  if (remediations.length === 0) {
    remediations.push('Keep the fix minimal, preserve existing behavior, and run the nearest targeted validation before merge.');
  }

  return remediations;
}

function buildFixPrompt(
  riskLevel: RiskLevel,
  riskScore: number,
  areas: string[],
  riskFactors: string[],
  securityReview: string[],
  suggestedRemediations: string[]
): string {
  return [
    'Review the attached diff and propose safe fixes for the detected risks.',
    '',
    'Context:',
    `- Risk level: ${riskLabel(riskLevel)} (${riskScore}/100)`,
    `- Affected areas: ${areas.length > 0 ? areas.join(', ') : 'not detected'}`,
    '',
    'Risk factors:',
    ...riskFactors.map(item => `- ${item}`),
    '',
    'Security review points:',
    ...securityReview.map(item => `- ${item}`),
    '',
    'Suggested remediation direction:',
    ...suggestedRemediations.map(item => `- ${item}`),
    '',
    'Instructions:',
    '1. Identify the exact risky files or logic paths.',
    '2. Propose minimal code changes that reduce the risk.',
    '3. Add or update focused tests when behavior changes.',
    '4. Preserve existing public behavior unless the diff clearly intends to change it.',
    '5. Do not commit, push, or modify files without explicit approval.'
  ].join('\n');
}

function analyze(diff: string, fileSummary: string): Analysis {
  const files = parseChangedFiles(fileSummary);
  const { additions, deletions } = countDiffLines(diff);
  const changedLines = additions + deletions;
  const categories: string[] = [];
  const areas: string[] = [];
  const riskFactors: string[] = [];
  const reviewFocus: string[] = [];
  const testing: string[] = [];
  let riskScore = Math.min(20, files.length * 2) + Math.min(20, Math.floor(changedLines / 50));

  const addSignal = (
    category: string,
    area: string,
    weight: number,
    factor: string,
    review: string,
    test: string
  ) => {
    riskScore += weight;
    pushUnique(categories, category);
    pushUnique(areas, area);
    pushUnique(riskFactors, factor);
    pushUnique(reviewFocus, review);
    pushUnique(testing, test);
  };

  if (hasAny(files, TEST_FILE_PATTERN)) {
    riskScore -= 8;
    pushUnique(categories, 'tests');
    pushUnique(areas, 'test coverage');
  }

  if (hasAny(files, /(^|\/)(readme|changelog|docs?|adr)(\/|\.|-|_)|\.md$|\.mdx$/i)) {
    riskScore -= 3;
    pushUnique(categories, 'docs');
    pushUnique(areas, 'documentation');
  }

  if (hasAny(files, /(^|\/)(auth|authentication|security|permission|roles?|login|oauth|jwt|session|token|password)(\/|\.|-|_)/i)) {
    addSignal('security', 'authentication/authorization', 22, 'Authentication or authorization related files changed', 'Verify auth edge cases and permission boundaries', 'Run login, permission, expired-token, and unauthorized-access scenarios');
  }

  if (hasAny(files, /(^|\/)(migration|migrations|schema|prisma|db|database|sql|liquibase|flyway)(\/|\.|-|_)|\.sql$/i)) {
    addSignal('database', 'database/schema', 25, 'Database schema or migration files changed', 'Check rollback plan, data migration safety, and index impact', 'Run migration up/down and verify existing data paths');
  }

  if (hasAny(files, /(^|\/)(Dockerfile|docker-compose|k8s|kubernetes|helm|terraform|nginx|deployment|deploy|infra|ops)(\/|\.|-|_)|(^|\/)Dockerfile$/i)) {
    addSignal('infrastructure', 'deployment/infra', 22, 'Deployment, container, or infrastructure files changed', 'Verify env vars, ports, resources, and rollout behavior', 'Run a local build/deploy dry run or inspect manifests');
  }

  if (hasAny(files, /(^|\/)(\.github\/workflows|\.gitlab-ci\.yml|Jenkinsfile|azure-pipelines|circleci|ci)(\/|$|\.)/i)) {
    addSignal('ci/cd', 'ci/cd', 16, 'CI/CD workflow files changed', 'Check build, test, deploy, and secret-handling steps', 'Validate the changed pipeline path');
  }

  if (hasAny(files, /(^|\/)(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|pom\.xml|build\.gradle|requirements\.txt|poetry\.lock|Cargo\.toml|Cargo\.lock)$/i)) {
    addSignal('dependencies', 'dependency/build', 15, 'Dependencies or build manifest changed', 'Check dependency versions and lockfile consistency', 'Run install/build and dependency-sensitive smoke tests');
  }

  if (hasAny(files, /(^|\/)(api|apis|route|routes|controller|controllers|resolver|graphql|endpoint|openapi|swagger)(\/|\.|-|_)/i)) {
    addSignal('api', 'api/contracts', 14, 'API or routing layer files changed', 'Check request/response compatibility and error handling', 'Run API contract and integration checks');
  }

  if (hasAny(files, /(^|\/)(\.env|env\.|config|configs|settings)(\/|\.|-|_)|\.ya?ml$|\.toml$|\.ini$/i)) {
    addSignal('configuration', 'configuration', 14, 'Configuration files changed', 'Check environment-specific values and defaults', 'Run app startup with local/default configuration');
  }

  if (/drop\s+table|truncate\s+table|delete\s+from|alter\s+table|create\s+index|drop\s+index/i.test(diff)) {
    addSignal('database', 'database/schema', 22, 'Potentially destructive or heavy database operation detected', 'Confirm data safety, locks, rollout order, and rollback plan', 'Test migration against realistic data volume');
  }

  if (!hasAny(files, TEST_FILE_PATTERN) && (changedLines >= 80 || files.length >= 4)) {
    addSignal('test coverage', 'test coverage', 10, 'No test files changed alongside a non-trivial code change', 'Check whether existing tests cover the changed behavior', 'Add or run targeted tests for the changed behavior');
  }

  if (files.length >= 8) {
    addSignal('scale', 'cross-module', files.length >= 20 ? 18 : 10, `${files.length} files changed`, 'Check whether changes span unrelated modules', 'Run targeted regression tests for touched modules');
  }

  riskScore = Math.max(0, Math.min(100, riskScore));
  const riskLevel = getRiskLevel(riskScore);

  if (reviewFocus.length === 0) {
    reviewFocus.push('Check that the implementation matches the intended scope');
  }
  if (testing.length === 0) {
    testing.push('Run the nearest targeted test or a manual sanity check');
  }

  const impact = [`${files.length} file${files.length === 1 ? '' : 's'} changed`];
  if (areas.length > 0) {
    impact.push(`Likely affected areas: ${areas.join(', ')}`);
  }
  if (categories.length > 0) {
    impact.push(`Change categories: ${categories.join(', ')}`);
  }

  const suggestedCommitSplits: string[] = [];
  if (categories.includes('security')) suggestedCommitSplits.push('feat(auth): update authentication or authorization behavior');
  if (categories.includes('database')) suggestedCommitSplits.push('chore(db): update schema, migration, or data access changes');
  if (categories.includes('api')) suggestedCommitSplits.push('feat(api): update API contract or routing changes');
  if (categories.includes('configuration')) suggestedCommitSplits.push('chore(config): update runtime configuration changes');
  if (categories.includes('infrastructure')) suggestedCommitSplits.push('chore(infra): update deployment or infrastructure changes');
  if (categories.includes('ci/cd')) suggestedCommitSplits.push('ci: update pipeline or release workflow changes');
  if (categories.includes('dependencies')) suggestedCommitSplits.push('build(deps): update dependency or build manifest changes');
  if (categories.includes('tests')) suggestedCommitSplits.push('test: update validation coverage');
  if (categories.includes('docs')) suggestedCommitSplits.push('docs: update documentation');

  const deploymentChecklist: string[] = [];
  if (riskLevel === 'high' || ['database', 'security', 'configuration', 'infrastructure', 'dependencies'].some(category => categories.includes(category))) {
    if (categories.includes('database')) {
      deploymentChecklist.push('DB migration rollback plan checked');
      deploymentChecklist.push('Migration tested against existing data shape');
    }
    if (categories.includes('security')) deploymentChecklist.push('Auth flow and permission smoke tests completed');
    if (categories.includes('configuration')) deploymentChecklist.push('Environment variables and default config verified');
    if (categories.includes('dependencies')) deploymentChecklist.push('Install, build, and dependency-sensitive smoke tests completed');
    if (categories.includes('infrastructure') || categories.includes('ci/cd')) deploymentChecklist.push('Deployment manifest or pipeline path reviewed');
    if (categories.includes('api')) deploymentChecklist.push('API compatibility and downstream caller impact checked');
    if (riskLevel === 'high') {
      deploymentChecklist.push('Rollback owner and deployment window confirmed');
      deploymentChecklist.push('Monitoring and logs checked after deploy');
    }
  }

  const normalizedRiskFactors = riskFactors.length > 0 ? riskFactors : ['No strong risk signal detected from the diff'];
  const securityReview = buildSecurityReview(categories, areas, normalizedRiskFactors, riskLevel);
  const suggestedRemediations = buildSuggestedRemediations(categories, areas, normalizedRiskFactors, riskLevel);

  return {
    additions,
    deletions,
    changedFiles: files.length,
    riskLevel,
    riskScore,
    impact,
    riskFactors: normalizedRiskFactors,
    reviewFocus,
    testing,
    suggestedCommitSplits: suggestedCommitSplits.length >= 2 ? suggestedCommitSplits : [],
    deploymentChecklist,
    securityReview,
    suggestedRemediations,
    fixPrompt: buildFixPrompt(riskLevel, riskScore, areas, normalizedRiskFactors, securityReview, suggestedRemediations)
  };
}

function list(items: string[]): string {
  return items.map(item => `- ${item}`).join('\n');
}

function checklist(items: string[]): string {
  return items.map(item => `- [ ] ${item}`).join('\n');
}

function validationMarkdown(report?: ValidationReport): string {
  if (!report || report.results.length === 0) {
    return '- Not run';
  }

  const lines = [`- Summary: ${report.summary}`];
  for (const result of report.results) {
    lines.push(`- ${result.status.toUpperCase()}: \`${result.command}\` (${Math.round(result.durationMs / 100) / 10}s)`);
  }
  return lines.join('\n');
}

export function formatAnalysisMarkdown(diff: string, fileSummary: string, validationReport?: ValidationReport): string {
  const analysis = analyze(diff, fileSummary);
  const riskScore = Math.min(100, analysis.riskScore + (validationReport?.failed || 0) * 15);
  const riskLevel = getRiskLevel(riskScore);
  const splitSection = analysis.suggestedCommitSplits.length > 0
    ? `\n\n## Suggested Commit Split\n${list(analysis.suggestedCommitSplits)}`
    : '';
  const checklistSection = analysis.deploymentChecklist.length > 0
    ? `\n\n## Deployment Checklist\n${checklist(analysis.deploymentChecklist)}`
    : '';
  const fixPromptSection = analysis.fixPrompt.trim()
    ? `\n\n## Fix Prompt\n\`\`\`text\n${analysis.fixPrompt.trim()}\n\`\`\``
    : '';

  return `## Impact
${list(analysis.impact)}

## Risk
- Level: ${riskLabel(riskLevel)} (${riskScore}/100)
- Changed lines: +${analysis.additions} / -${analysis.deletions}
${list(analysis.riskFactors)}

## Security Review
${list(analysis.securityReview)}

## Review Focus
${list(analysis.reviewFocus)}

## Suggested Remediation
${list(analysis.suggestedRemediations)}

## Testing
${list(analysis.testing)}

## Validation
${validationMarkdown(validationReport)}${splitSection}${checklistSection}${fixPromptSection}`;
}




