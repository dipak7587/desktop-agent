import { mcpConfigFromItem } from '../../../shared/mcp-schema';
import { MCPAdapter } from '@langchain/mcp-adapters';
import { isToolMessage } from '@langchain/core/messages';
import type { DynamicStructuredTool } from '@langchain/core/tools';
import type { LibraryService } from '../filesystem/library';
import type { AppEvent, MCPState } from '../../../shared/types';
export interface SecretResolver {
  resolve(name: string): string;
  redact(text: string): string;
}
export class MCPService {
  private clients = new Map<string, { adapter: MCPAdapter; tools: DynamicStructuredTool[] }>();
  private statesMap = new Map<string, MCPState>();
  private generations = new Map<string, number>();
  private redactors = new Map<string, (text: string) => string>();
  constructor(
    private library: LibraryService,
    private secrets: SecretResolver,
    private emit: (e: AppEvent) => void,
  ) {}
  states() {
    return [...this.statesMap.values()];
  }
  private state(id: string) {
    if (!this.statesMap.has(id))
      this.statesMap.set(id, { id, status: 'stopped', tools: [], logs: [] });
    return this.statesMap.get(id)!;
  }
  async start(id: string) {
    if (this.clients.has(id)) return;
    const config = await this.library.get('mcp', id);
    if (!config.enabled) throw new Error('Enable this MCP server before starting it');
    if (
      (config.connection?.type === 'stdio' && !config.connection.command.trim()) ||
      (!config.connection && !config.command.trim())
    )
      throw new Error('Add an executable command before starting this MCP server.');
    const server = mcpConfigFromItem({ ...config });
    const connection = server.connection;
    const env: Record<string, string> = {};
    const secretValues: string[] = [];
    for (const [name, value] of Object.entries(
      connection.type === 'stdio' ? (connection.env ?? {}) : (connection.headers ?? {}),
    )) {
      const reference = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
      env[name] = reference ? this.secrets.resolve(reference[1]) : value;
      secretValues.push(env[name]);
    }
    const redact = (text: string) =>
      secretValues.reduce(
        (s, v) => (v ? s.split(v).join('[REDACTED]') : s),
        this.secrets.redact(text),
      );
    this.redactors.set(id, redact);
    const state = this.state(id);
    state.status = 'connecting';
    const generation = (this.generations.get(id) ?? 0) + 1;
    this.generations.set(id, generation);
    const adapter = new MCPAdapter({
      servers: {
        [id]:
          connection.type === 'stdio'
            ? {
                transport: 'stdio',
                command: connection.command,
                args: connection.args ?? [],
                cwd: connection.cwd,
                env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
                stderr: 'ignore',
                restart: {
                  enabled: server.runtime?.reconnect ?? false,
                  maxAttempts: server.runtime?.reconnectAttempts,
                },
              }
            : {
                transport: 'http',
                mode: 'legacy',
                url: connection.url,
                headers: env,
                automaticSSEFallback: false,
              },
      },
      prefixToolNameWithServerName: false,
      additionalToolNamePrefix: '',
      defaultToolTimeout: server.runtime?.timeoutMs ?? 60000,
      onConnectionError: 'throw',
    });
    const entry = { adapter, tools: [] as DynamicStructuredTool[] };
    this.clients.set(id, entry);
    const log = (message: string) => {
      state.logs.push(redact(message).slice(0, 4000));
      state.logs = state.logs.slice(-100);
      this.emit({ type: 'mcp', id, status: state.status });
    };
    try {
      entry.tools = await adapter.listTools(id);
      if (this.generations.get(id) !== generation) throw new Error('MCP connection cancelled');
      const client = await adapter.getClient(id);
      if (this.generations.get(id) !== generation) throw new Error('MCP connection cancelled');
      if (!client) throw new Error('MCP connection unavailable');
      const onClose = client.onclose;
      client.onerror = (error) => log(error.message);
      client.onclose = () => {
        onClose?.();
        if (this.generations.get(id) === generation) {
          state.status = 'stopped';
          this.clients.delete(id);
          this.emit({ type: 'mcp', id, status: state.status });
        }
      };
      state.tools = entry.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.schema as Record<string, unknown>,
      }));
      state.status = 'connected';
      log(`Connected. ${state.tools.length} tools discovered.`);
    } catch (e) {
      await adapter.close();
      if (this.generations.get(id) === generation) {
        this.clients.delete(id);
        state.status = 'error';
        log((e as Error).message);
      }
      throw new Error(redact((e as Error).message));
    }
  }
  async stop(id: string) {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    const entry = this.clients.get(id);
    this.clients.delete(id);
    if (entry) await entry.adapter.close();
    this.state(id).status = 'stopped';
    this.emit({ type: 'mcp', id, status: 'stopped' });
  }
  async action(id: string, action: string) {
    if (action === 'stop') return this.stop(id);
    if (action === 'restart') await this.stop(id);
    if (action === 'test' && this.clients.has(id)) {
      const client = await this.clients.get(id)!.adapter.getClient(id);
      if (!client) throw new Error('MCP connection unavailable');
      await client.ping({ timeout: 10000 });
      return;
    }
    await this.start(id);
  }
  async call(id: string, name: string, args: Record<string, unknown>, signal: AbortSignal) {
    const entry = this.clients.get(id);
    if (!entry) throw new Error('Start this MCP server first');
    const tool = entry.tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error('This MCP tool is unavailable');
    const redact = this.redactors.get(id) ?? ((text: string) => this.secrets.redact(text));
    try {
      signal.throwIfAborted();
      // Invoke the adapter's executable LangChain tool, including its result conversion.
      const result = await tool.invoke(
        { type: 'tool_call', id: `mcp:${id}:${name}`, name: tool.name, args },
        { signal, timeout: 60000 },
      );
      signal.throwIfAborted();
      const text = redact(
        JSON.stringify(
          isToolMessage(result) ? { content: result.content, artifact: result.artifact } : result,
        ),
      ).slice(0, 30000);
      if (isToolMessage(result) && result.status === 'error') throw new Error(text);
      return text;
    } catch (error) {
      throw new Error(redact((error as Error).message).slice(0, 30000));
    }
  }

  async autoStart() {
    const configs = await this.library.list('mcp');
    await Promise.allSettled(
      configs
        .filter((c) => c.enabled && (c.runtime?.autoConnect ?? c.autoStart))
        .map(async (c) => {
          try {
            await this.start(c.id);
          } catch (error) {
            const state = this.state(c.id);
            state.status = 'error';
            state.logs.push(this.secrets.redact((error as Error).message));
            this.emit({ type: 'mcp', id: c.id, status: 'error' });
          }
        }),
    );
  }
  async stopAll() {
    await Promise.allSettled([...this.clients.keys()].map((id) => this.stop(id)));
  }
}
