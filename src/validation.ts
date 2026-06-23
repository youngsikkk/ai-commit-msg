import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ValidationCommandResult, ValidationReport } from './types';

const VALIDATION_SCRIPT_PRIORITY = [
  'lint',
  'check-types',
  'typecheck',
  'type-check',
  'test',
  'build'
];

function getPackageRunner(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function buildPackageScriptCommand(scriptName: string): string {
  const runner = getPackageRunner();
  return `${runner} run ${scriptName}`;
}

function trimOutput(output: string, maxChars: number): string {
  const normalized = output.trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return normalized.slice(0, maxChars) + '\n... [validation output truncated]';
}

function runOneCommand(
  workspacePath: string,
  command: string,
  timeoutMs: number,
  maxOutputChars: number
): Promise<ValidationCommandResult> {
  const startedAt = Date.now();

  return new Promise(resolve => {
    exec(
      command,
      {
        cwd: workspacePath,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startedAt;
        const output = trimOutput([stdout, stderr].filter(Boolean).join('\n'), maxOutputChars);

        if (!error) {
          resolve({
            command,
            status: 'passed',
            exitCode: 0,
            durationMs,
            output
          });
          return;
        }

        const maybeCode = (error as NodeJS.ErrnoException & { code?: number | string }).code;
        const exitCode = typeof maybeCode === 'number' ? maybeCode : undefined;
        const timedOut = (error as NodeJS.ErrnoException & { killed?: boolean }).killed;
        const message = timedOut
          ? `Command timed out after ${timeoutMs}ms`
          : error.message;

        resolve({
          command,
          status: 'failed',
          exitCode,
          durationMs,
          output: output || message
        });
      }
    );
  });
}

export async function runValidationCommands(
  workspacePath: string,
  commands: string[],
  timeoutMs: number,
  maxOutputChars: number
): Promise<ValidationReport> {
  const normalizedCommands = commands.map(command => command.trim()).filter(Boolean);

  if (normalizedCommands.length === 0) {
    return {
      enabled: false,
      results: [],
      passed: 0,
      failed: 0,
      skipped: 0,
      summary: 'No validation commands configured'
    };
  }

  const results: ValidationCommandResult[] = [];

  for (const command of normalizedCommands) {
    results.push(await runOneCommand(workspacePath, command, timeoutMs, maxOutputChars));
  }

  const passed = results.filter(result => result.status === 'passed').length;
  const failed = results.filter(result => result.status === 'failed').length;
  const skipped = results.filter(result => result.status === 'skipped').length;
  const summary = failed > 0
    ? `${failed} failed, ${passed} passed`
    : `${passed} passed`;

  return {
    enabled: true,
    results,
    passed,
    failed,
    skipped,
    summary
  };
}

export async function detectValidationCommands(workspacePath: string): Promise<string[]> {
  const packageJsonPath = path.join(workspacePath, 'package.json');

  try {
    const raw = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    const scripts = packageJson.scripts || {};

    return VALIDATION_SCRIPT_PRIORITY
      .filter(scriptName => typeof scripts[scriptName] === 'string')
      .map(scriptName => buildPackageScriptCommand(scriptName));
  } catch {
    return [];
  }
}
