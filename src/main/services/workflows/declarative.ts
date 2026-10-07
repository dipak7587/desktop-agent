import { setTimeout as delay } from 'node:timers/promises';
import {
  validateDeclarative,
  type DeclarativeWorkflow,
  type WorkflowStep,
  type HookName,
} from '../../../shared/declarative-workflows';

type Outputs = Record<string, { output: unknown }>;
interface Context extends Record<string, unknown> {
  steps: Outputs;
  hooks: Outputs;
}
export interface WorkflowAdapter {
  agent(id: string, input: unknown, signal: AbortSignal, path: string): Promise<unknown>;
  tool(
    id: string,
    input: unknown,
    agent: string | undefined,
    signal: AbortSignal,
    path: string,
  ): Promise<unknown>;
  event?(
    path: string,
    step: WorkflowStep,
    status: 'running' | 'completed' | 'failed',
    output?: unknown,
  ): void;
}
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function expression(source: string, context: Context): unknown {
  const text = source.trim();
  // A small declarative expression language; never evaluate JavaScript.
  const tokens =
    text.match(
      /"(?:[^"\\]|\\.)*"|'[^']*'|===|!==|==|!=|>=|<=|&&|\|\||[!><()]|-?\d+(?:\.\d+)?|[A-Za-z_][\w.-]*/g,
    ) ?? [];
  // Compare consumed tokens so unrecognized characters cannot be skipped.
  let rest = text;
  for (const token of tokens) {
    rest = rest.trimStart();
    if (!rest.startsWith(token)) throw new Error(`Invalid expression: ${source}`);
    rest = rest.slice(token.length);
  }
  if (rest.trim()) throw new Error(`Invalid expression: ${source}`);
  let index = 0;
  const atom = (): unknown => {
    const token = tokens[index++];
    if (!token) throw new Error(`Invalid expression: ${source}`);
    if (token === '!') return !atom();
    if (token === '(') {
      const result = logical();
      if (tokens[index++] !== ')') throw new Error('Unclosed expression');
      return result;
    }
    if (token.startsWith('"')) return JSON.parse(token);
    if (token.startsWith("'")) return token.slice(1, -1);
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (/^-?\d/.test(token)) return Number(token);
    let value: unknown = context;
    for (const key of token.split('.')) {
      if (
        forbidden.has(key) ||
        value === null ||
        typeof value !== 'object' ||
        !Object.hasOwn(value, key)
      )
        throw new Error(`Unresolved reference: ${token}`);
      value = (value as Record<string, unknown>)[key];
    }
    return value;
  };
  const comparison = (): unknown => {
    const left = atom(),
      op = tokens[index];
    if (!['==', '===', '!=', '!==', '>', '<', '>=', '<='].includes(op)) return left;
    index++;
    const right = atom();
    if (op === '==' || op === '===') return left === right;
    if (op === '!=' || op === '!==') return left !== right;
    if (typeof left !== 'number' || typeof right !== 'number')
      throw new Error('Ordered comparisons require numbers');
    return op === '>'
      ? left > right
      : op === '<'
        ? left < right
        : op === '>='
          ? left >= right
          : left <= right;
  };
  const and = (): unknown => {
    let value = comparison();
    while (tokens[index] === '&&') {
      index++;
      const right = comparison();
      value = Boolean(value) && Boolean(right);
    }
    return value;
  };
  const logical = (): unknown => {
    let value = and();
    while (tokens[index] === '||') {
      index++;
      const right = and();
      value = Boolean(value) || Boolean(right);
    }
    return value;
  };
  const result = logical();
  if (index !== tokens.length) throw new Error(`Invalid expression: ${source}`);
  return result;
}
export function resolveValue(value: unknown, context: Context): unknown {
  if (typeof value === 'string') {
    const exact = /^\s*{{([\s\S]*?)}}\s*$/.exec(value);
    if (exact) return expression(exact[1], context);
    return value.replace(/{{([\s\S]*?)}}/g, (_, source: string) => {
      const result = expression(source, context);
      return typeof result === 'string' ? result : JSON.stringify(result);
    });
  }
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, context));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (forbidden.has(key)) throw new Error('Unsafe input property');
        return [key, resolveValue(item, context)];
      }),
    );
  return value;
}
export function workflowInputs(
  definition: DeclarativeWorkflow,
  supplied: Record<string, unknown>,
): Record<string, unknown> {
  const input = { ...supplied };
  for (const [key, spec] of Object.entries(definition.inputs ?? {})) {
    if (input[key] === undefined && spec.default !== undefined)
      input[key] = structuredClone(spec.default);
    if (input[key] === undefined) {
      if (spec.required !== false) throw new Error(`Missing workflow input: ${key}`);
      continue;
    }
    const value = input[key];
    const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
    if (type !== spec.type || (type === 'number' && !Number.isFinite(value)))
      throw new Error(`Workflow input ${key} must be ${spec.type}`);
  }
  return input;
}
export async function executeDeclarative(
  definition: DeclarativeWorkflow,
  supplied: Record<string, unknown>,
  adapter: WorkflowAdapter,
  options: {
    signal: AbortSignal;
    maxExecutions?: number;
    maxDepth?: number;
    env?: Record<string, string | undefined>;
  },
): Promise<unknown> {
  definition = validateDeclarative(definition, options.maxDepth);
  let executions = 0;
  const context: Context = {
    input: workflowInputs(definition, supplied),
    steps: {},
    hooks: {},
    workflow: definition,
    agents: definition.agents ?? {},
    tools: definition.tools ?? {},
    env: options.env ?? {},
  };
  const child = (ctx: Context): Context => ({
    ...ctx,
    steps: { ...ctx.steps },
    hooks: { ...ctx.hooks },
  });
  const hooks = async (
    set: WorkflowStep['hooks'],
    names: HookName[],
    ctx: Context,
    path: string,
    depth: number,
  ) => {
    for (const name of names)
      if (set?.[name]) await sequence(set[name]!, ctx, `${path}.${name}`, depth + 1, true);
  };
  const parallel = async <T>(
    items: T[],
    limit: number,
    work: (item: T, i: number) => Promise<unknown>,
  ) => {
    const output: unknown[] = new Array(items.length);
    let next = 0,
      failure: unknown,
      failed = false;
    await Promise.all(
      Array.from({ length: Math.min(items.length, limit) }, async () => {
        while (!failed && next < items.length) {
          const i = next++;
          try {
            output[i] = await work(items[i], i);
          } catch (error) {
            failure = error;
            failed = true;
          }
        }
      }),
    );
    if (failed) throw failure;
    return output;
  };
  const sequence = async (
    steps: WorkflowStep[],
    ctx: Context,
    path: string,
    depth: number,
    isHook = false,
  ): Promise<unknown[]> => {
    const results: unknown[] = [];
    for (const [i, step] of steps.entries())
      results.push(await execute(step, ctx, `${path}.${step.id ?? i}`, depth, isHook));
    return results;
  };
  const execute = async (
    step: WorkflowStep,
    ctx: Context,
    path: string,
    depth: number,
    isHook = false,
  ): Promise<unknown> => {
    options.signal.throwIfAborted();
    if (depth > (options.maxDepth ?? 20)) throw new Error('Maximum workflow depth reached');
    const name = step.id ?? path.split('.').at(-1)!;
    const outputMap = isHook ? ctx.hooks : ctx.steps;
    delete outputMap[name];
    adapter.event?.(path, step, 'running');
    try {
      await hooks(step.hooks, ['before', 'pre', 'preStep'], ctx, path, depth);
      let output: unknown;
      for (let attempt = 1; ; attempt++) {
        options.signal.throwIfAborted();
        if (++executions > (options.maxExecutions ?? 100))
          throw new Error('Maximum workflow executions reached');
        try {
          if (step.type === 'agent' || step.type === 'tool') {
            const id = resolveValue(step.type === 'agent' ? step.agent : step.tool, ctx);
            if (typeof id !== 'string' || !id)
              throw new Error('Resolved agent/tool must be a nonempty string');
            const input = resolveValue(step.input ?? {}, ctx);
            const agent = resolveValue(step.agent ?? definition.config?.defaultAgent, ctx);
            if (agent !== undefined && typeof agent !== 'string')
              throw new Error('Tool agent must resolve to a string');
            output =
              step.type === 'agent'
                ? await adapter.agent(id, input, options.signal, path)
                : await adapter.tool(id, input, agent as string | undefined, options.signal, path);
          } else if (step.type === 'sequence')
            output = await sequence(step.steps!, ctx, path, depth + 1);
          else if (step.type === 'parallel') {
            const branches = step.steps!.map(() => child(ctx));
            output = await parallel(step.steps!, step.maxConcurrency ?? 4, (item, i) =>
              execute(item, branches[i], `${path}.${item.id ?? i}`, depth + 1),
            );
            step.steps!.forEach((item, i) => {
              if (item.id) ctx.steps[item.id] = { output: (output as unknown[])[i] };
            });
          } else if (step.type === 'condition') {
            const condition = resolveValue(step.if, ctx);
            if (typeof condition !== 'boolean')
              throw new Error('Condition must resolve to a boolean');
            output = await sequence(
              condition ? step.then! : (step.else ?? []),
              ctx,
              path,
              depth + 1,
            );
          } else if (step.type === 'switch') {
            const key = String(resolveValue(step.value, ctx));
            output = await sequence(
              Object.hasOwn(step.cases!, key) ? step.cases![key] : (step.cases!.default ?? []),
              ctx,
              path,
              depth + 1,
            );
          } else if (step.type === 'loop') {
            const items = resolveValue(step.over, ctx);
            if (!Array.isArray(items)) throw new Error('Loop over must resolve to an array');
            if (items.length > (options.maxExecutions ?? 100))
              throw new Error('Loop exceeds maximum workflow executions');
            if (
              [
                'steps',
                'hooks',
                'input',
                'workflow',
                'agents',
                'tools',
                'env',
                'iteration',
                'error',
              ].includes(step.as!)
            )
              throw new Error('Loop variable shadows runtime context');
            await hooks(step.hooks, ['beforeLoop'], ctx, path, depth);
            output = await parallel(
              items,
              step.mode === 'parallel' ? (step.maxConcurrency ?? 4) : 1,
              async (item, i) => {
                const scope = { ...child(ctx), [step.as!]: item, iteration: i };
                await hooks(step.hooks, ['beforeIteration'], scope, `${path}[${i}]`, depth);
                const results = await sequence(step.steps!, scope, `${path}[${i}]`, depth + 1);
                await hooks(step.hooks, ['afterIteration'], scope, `${path}[${i}]`, depth);
                return results;
              },
            );
            outputMap[name] = { output };
            await hooks(step.hooks, ['afterLoop'], ctx, path, depth);
          } else if (step.type === 'repeat') {
            const scope = child(ctx);
            let done = false;
            for (let i = 0; i < step.maxIterations!; i++) {
              scope.iteration = i;
              output = await sequence(step.steps!, scope, `${path}[${i}]`, depth + 1);
              const condition = resolveValue(step.until, scope);
              if (typeof condition !== 'boolean')
                throw new Error('Repeat until must resolve to a boolean');
              if (condition) {
                done = true;
                break;
              }
            }
            if (!done) throw new Error('Repeat reached maxIterations before until became true');
          }
          break;
        } catch (error) {
          const kind =
            error instanceof Error && 'code' in error
              ? String(error.code)
              : step.type === 'tool'
                ? 'tool_error'
                : '';
          if (
            options.signal.aborted ||
            attempt >= (step.retry?.maxAttempts ?? 1) ||
            (step.retry?.on && !step.retry.on.includes(kind))
          )
            throw error;
          await delay(step.retry?.delayMs ?? 0, undefined, { signal: options.signal });
        }
      }
      options.signal.throwIfAborted();
      outputMap[name] = { output };
      await hooks(
        step.hooks,
        ['after', 'post', 'postStep', 'success', 'onSuccess'],
        ctx,
        path,
        depth,
      );
      adapter.event?.(path, step, 'completed', output);
      return output;
    } catch (error) {
      adapter.event?.(path, step, 'failed', error instanceof Error ? error.message : String(error));
      if (!options.signal.aborted)
        await hooks(
          step.hooks,
          ['error', 'onError'],
          { ...ctx, error: { message: error instanceof Error ? error.message : String(error) } },
          path,
          depth,
        );
      throw error;
    }
  };
  try {
    await hooks(definition.hooks, ['preWorkflow', 'before'], context, 'workflow', 0);
    const result = await sequence(definition.steps, context, 'steps', 1);
    await hooks(
      definition.hooks,
      ['postWorkflow', 'after', 'success', 'onSuccess'],
      context,
      'workflow',
      0,
    );
    return result.at(-1);
  } catch (error) {
    if (!options.signal.aborted)
      await hooks(
        definition.hooks,
        ['error', 'onError'],
        { ...context, error: { message: error instanceof Error ? error.message : String(error) } },
        'workflow',
        0,
      );
    throw error;
  }
}
