import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { type CrewCustomTool, validateCustomInput } from '../../../shared/crewai';
const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.unknown(), stdout: z.string().max(20000) }).strict(),
  z
    .object({ ok: z.literal(false), error: z.string().max(5000), stdout: z.string().max(20000) })
    .strict(),
]);
// Separate process from the trusted CrewAI worker. No host credentials or protocol access.
export async function executeCustomTool(
  python: string,
  script: string,
  cache: string,
  tool: CrewCustomTool,
  args: unknown,
  signal: AbortSignal,
) {
  const input = validateCustomInput(tool, args);
  signal.throwIfAborted();
  const directory = await mkdtemp(join(cache, 'crewai-tool-'));
  try {
    return await new Promise<string>((resolve, reject) => {
      signal.throwIfAborted();
      const child = spawn(python, ['-I', '-u', script], {
        cwd: directory,
        shell: false,
        detached: process.platform !== 'win32',
        windowsHide: true,
        env: {
          PATH: process.env.PATH ?? '',
          HOME: directory,
          USERPROFILE: directory,
          SYSTEMROOT: process.env.SYSTEMROOT ?? '',
          TEMP: directory,
          TMP: directory,
          OTEL_SDK_DISABLED: 'true',
          CREWAI_TELEMETRY_ENABLED: 'false',
          CREWAI_TRACING_ENABLED: 'false',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '',
        failure: Error | undefined;
      const kill = (force = false) => {
        try {
          if (process.platform !== 'win32' && child.pid)
            process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
          else if (process.platform === 'win32' && child.pid) {
            // taskkill reaps descendants as well; arguments are a numeric PID, never user code.
            const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
              windowsHide: true,
              stdio: 'ignore',
            });
            killer.on('error', () => child.kill());
          } else child.kill();
        } catch {
          /* Already exited. */
        }
      };
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const fail = (error: unknown) => {
        failure ??= error instanceof Error ? error : new Error(String(error));
        kill();
        forceTimer ??= setTimeout(() => kill(true), 500);
      };
      const abort = () => fail(signal.reason ?? new Error('Tool cancelled'));
      const timer = setTimeout(
        () => fail(new Error(`Custom tool exceeded ${tool.timeoutSeconds} seconds`)),
        tool.timeoutSeconds * 1000,
      );
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      child.on('error', fail);
      child.stdin.on('error', fail);
      child.stderr.resume();
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        output += chunk;
        if (Buffer.byteLength(output) > 1_500_000)
          fail(new Error('Custom tool output exceeds size limit'));
      });
      child.on('exit', () => kill(true)); // Do not leave ordinary background children after return.
      child.on('close', (code) => {
        clearTimeout(timer);
        if (forceTimer) clearTimeout(forceTimer);
        signal.removeEventListener('abort', abort);
        if (failure) return reject(failure);
        if (code !== 0)
          return reject(new Error(`Custom tool process exited (${code ?? 'signal'})`));
        try {
          const result = resultSchema.parse(JSON.parse(output));
          if (!result.ok)
            throw new Error(result.error + (result.stdout ? `\nOutput:\n${result.stdout}` : ''));
          resolve(JSON.stringify({ result: result.result, stdout: result.stdout }));
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.end(JSON.stringify({ tool, args: input }) + '\n');
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
