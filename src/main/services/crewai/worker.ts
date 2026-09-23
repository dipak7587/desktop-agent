import { spawn } from 'node:child_process';
import { z } from 'zod';
import { crewToolSchema } from '../../../shared/crewai';
export const CREWAI_VERSION = '1.15.22';
const common = { v: z.literal(1) };
export const workerEvent = z.discriminatedUnion('type', [
  z
    .object({
      ...common,
      type: z.literal('ready'),
      version: z.literal(CREWAI_VERSION),
      python: z.string().max(100),
    })
    .strict(),
  z.object({ ...common, type: z.literal('failed'), error: z.string().max(4000) }).strict(),
  z
    .object({
      ...common,
      type: z.literal('model_request'),
      runId: z.string().max(100),
      requestId: z.string().max(100),
      nodeId: z.string().max(100),
      messages: z
        .array(
          z
            .object({
              role: z.enum(['system', 'user', 'assistant']),
              content: z.string().max(200000),
            })
            .strict(),
        )
        .min(1)
        .max(1000),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('tool_request'),
      runId: z.string().max(100),
      requestId: z.string().max(100),
      nodeId: z.string().max(100),
      tool: crewToolSchema,
      args: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      ...common,
      type: z.literal('node_completed'),
      runId: z.string().max(100),
      nodeId: z.string().max(100),
      result: z.string().max(200000),
    })
    .strict(),
  z.object({ ...common, type: z.literal('completed'), runId: z.string().max(100) }).strict(),
]);
export type WorkerEvent = z.infer<typeof workerEvent>;

// No shell, inherited provider credentials, or user-selected scripts.
export async function runWorker(
  python: string,
  script: string,
  cwd: string,
  signal: AbortSignal,
  onEvent: (event: WorkerEvent, signal: AbortSignal) => Promise<Record<string, unknown> | void>,
): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const local = new AbortController();
    const requestSignal = AbortSignal.any([signal, local.signal]);
    const child = spawn(python, ['-I', '-u', script], {
      cwd,
      detached: process.platform !== 'win32',
      windowsHide: true,
      env: {
        PATH: process.env.PATH ?? '',
        HOME: cwd,
        USERPROFILE: cwd,
        SYSTEMROOT: process.env.SYSTEMROOT ?? '',
        TEMP: cwd,
        TMP: cwd,
        OTEL_SDK_DISABLED: 'true',
        CREWAI_TELEMETRY_ENABLED: 'false',
        CREWAI_TRACING_ENABLED: 'false',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let buffer = '',
      failure: Error | undefined,
      pending = Promise.resolve(),
      queued = 0;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (force = false) => {
      try {
        if (process.platform !== 'win32' && child.pid)
          process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM');
        else child.kill(force ? 'SIGKILL' : 'SIGTERM');
      } catch {
        /* Already exited. */
      }
    };
    const fail = (error: unknown) => {
      failure ??= error instanceof Error ? error : new Error(String(error));
      local.abort(failure);
      kill();
      killTimer ??= setTimeout(() => kill(true), 1000);
    };
    const abort = () => fail(signal.reason ?? new Error('CrewAI cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.stdin.on('error', fail);
    child.stderr.resume(); // Framework logs can include private reasoning.
    child.on('error', (error) =>
      fail(
        new Error(
          `Cannot start CrewAI Python (${python}): ${error.message}. Check the Python executable in Settings.`,
        ),
      ),
    );
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 2_000_000)
        return fail(new Error('CrewAI message exceeds size limit'));
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        if (++queued > 16) return fail(new Error('CrewAI sent too many pending messages'));
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        pending = pending
          .then(async () => {
            if (failure) return;
            const event = workerEvent.parse(JSON.parse(line));
            const reply = await new Promise<Record<string, unknown> | void>(
              (resolveReply, rejectReply) => {
                const cancelled = () => rejectReply(requestSignal.reason);
                requestSignal.addEventListener('abort', cancelled, { once: true });
                Promise.resolve()
                  .then(() => {
                    requestSignal.throwIfAborted();
                    return onEvent(event, requestSignal);
                  })
                  .then(resolveReply, rejectReply)
                  .finally(() => requestSignal.removeEventListener('abort', cancelled));
                if (requestSignal.aborted) cancelled();
              },
            );
            requestSignal.throwIfAborted();
            if (reply) {
              const encoded = JSON.stringify({ v: 1, ...reply }) + '\n';
              if (Buffer.byteLength(encoded) > 2_000_000)
                throw new Error('CrewAI input exceeds size limit');
              child.stdin.write(encoded);
            }
          })
          .catch(fail)
          .finally(() => {
            queued--;
          });
      }
    });
    child.on('close', (code) => {
      local.abort(new Error('CrewAI worker closed'));
      void pending.finally(() => {
        signal.removeEventListener('abort', abort);
        if (killTimer) clearTimeout(killTimer);
        if (failure) reject(failure);
        else if (buffer.trim() || code !== 0)
          reject(
            new Error(
              `CrewAI worker exited unexpectedly (${code ?? 'signal'}). Check the Python executable and install crewai==${CREWAI_VERSION}.`,
            ),
          );
        else resolve();
      });
    });
  });
}
