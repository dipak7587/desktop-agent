import { createHash } from 'node:crypto';
import { tool } from 'langchain';
import type { AppEvent, RunState } from '../../../shared/types';
import type { CapabilityRouter } from '../agents/capabilities';

/** Stable, collision-resistant names accepted by native tool-calling providers. */
export function capabilityToolName(id: string) {
  return `${id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 47)}_${createHash('sha256').update(id).digest('hex').slice(0, 12)}`;
}

interface ToolContext {
  run: RunState;
  signal: AbortSignal;
  router: CapabilityRouter;
  redact: (text: string) => string;
  emit: (event: AppEvent) => void;
  persist?: (run: RunState) => void;
  resolveToolName?: (id: string) => string;
}

/** Bind permitted application capabilities to native LangChain tools. */
export function createCapabilityTools(context: ToolContext) {
  const { run, signal, router } = context;
  let previousResults = '';
  // Serialize side effects within a model turn: approvals, file hashes and run history
  // use the same ordered execution semantics as the desktop application.
  let pending: Promise<unknown> = Promise.resolve();
  return router.catalog().map((capability) =>
    tool(
      (args: Record<string, unknown>) => {
        const result = pending.then(async () => {
          signal.throwIfAborted();
          const record: RunState['tools'][number] = {
            toolId: capability.id,
            toolName: context.resolveToolName?.(capability.id) ?? capability.name,
            status: 'running',
            input: JSON.parse(context.redact(JSON.stringify(args))),
          };
          run.tools.push(record);
          context.persist?.(run);
          context.emit({
            type: 'agent',
            id: run.id,
            status: 'Running Tool',
            content: `Running ${capability.name}`,
          });
          let output: unknown;
          try {
            output = await router.execute(capability.id, args, previousResults);
            signal.throwIfAborted();
            if (output && typeof output === 'object' && 'blocked' in output && 'reason' in output) {
              record.status = 'failed';
              record.error = String(output.reason);
            } else if (
              output &&
              typeof output === 'object' &&
              'exitCode' in output &&
              output.exitCode !== 0
            ) {
              record.status = 'failed';
              record.error = `Command failed (exit code ${output.exitCode})`;
            } else if (
              output &&
              typeof output === 'object' &&
              'rejected' in output &&
              output.rejected
            ) {
              record.status = 'failed';
              record.error = 'User rejected the operation.';
            } else record.status = 'completed';
          } catch (error) {
            record.status = 'failed';
            record.error = context.redact(
              signal.aborted ? 'Execution interrupted' : (error as Error).message,
            );
            output = { error: record.error };
          } finally {
            context.persist?.(run);
          }
          signal.throwIfAborted();
          const text = context.redact(JSON.stringify(output) ?? 'null').slice(0, 30000);
          record.output = text;
          context.persist?.(run);
          previousResults = `${previousResults}\n${text}`.slice(-12000);
          context.emit({
            type: 'agent',
            id: run.id,
            status: 'Planning',
            content: `${capability.name}\n${text.slice(0, 15000)}`,
          });
          return text;
        });
        pending = result.catch(() => {});
        return result;
      },
      {
        name: capabilityToolName(capability.id),
        description: `${capability.name} (${capability.id}). ${capability.description ?? ''}`,
        schema: router.schema(capability.id),
      },
    ),
  );
}
