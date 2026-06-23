import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface ValidationResult {
  command: string;
  status: 'passed' | 'failed';
  durationMs: number;
  output: string;
}

export interface ValidationReport {
  results: ValidationResult[];
  passed: number;
  failed: number;
  summary: string;
}

const VALIDATION_SCRIPT_PRIORITY = [
  'lint',
  'check-types',
  'typecheck',
  'type-check',
  'test',
  'build'
];

function packageRunner(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function detectValidationCommands(workspacePath: string): string[] {
  const packageJsonPath = path.join(workspacePath, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return [];
  }

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as {
      scripts?: Record<string, unknown>;
    };
    const scripts = packageJson.scripts || {};

    return VALIDATION_SCRIPT_PRIORITY
      .filter(scriptName => typeof scripts[scriptName] === 'string')
      .map(scriptName => `${packageRunner()} run ${scriptName}`);
  } catch {
    return [];
  }
}

function trimOutput(output: string): string {
  const normalized = output.trim();
  return normalized.length <= 4000
    ? normalized
    : normalized.slice(0, 4000) + '\n... [validation output truncated]';
}

function runOne(command: string, workspacePath: string): Promise<ValidationResult> {
  const startedAt = Date.now();

  return new Promise(resolve => {
    exec(
      command,
      {
        cwd: workspacePath,
        timeout: 120000,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        const output = trimOutput([stdout, stderr].filter(Boolean).join('\n'));

        resolve({
          command,
          status: error ? 'failed' : 'passed',
          durationMs,
          output: output || (error instanceof Error ? error.message : '')
        });
      }
    );
  });
}

export async function runValidationCommands(commands: string[], workspacePath: string): Promise<ValidationReport> {
  const results: ValidationResult[] = [];

  for (const command of commands) {
    results.push(await runOne(command, workspacePath));
  }

  const passed = results.filter(result => result.status === 'passed').length;
  const failed = results.filter(result => result.status === 'failed').length;

  return {
    results,
    passed,
    failed,
    summary: failed > 0 ? `${failed} failed, ${passed} passed` : `${passed} passed`
  };
}
