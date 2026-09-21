import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { LibraryService } from '../filesystem/library';
import type { AppEvent, MCPState } from '../../../shared/types';
export interface SecretResolver {
  resolve(name: string): string;
  redact(text: string): string;
}
export class MCPService {
  private clients = new Map<string, { client: Client; transport: StdioClientTransport }>();
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
    if (!config.command.trim())
      throw new Error('Add an executable command before starting this MCP server.');
    const env: Record<string, string> = {};
    const secretValues: string[] = [];
    for (const [name, reference] of Object.entries(config.env)) {
      env[name] = this.secrets.resolve(reference.slice(2, -1));
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
    const client = new Client(
      { name: 'localai-workspace', version: '0.1.0' },
      { capabilities: {} },
    );
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
      stderr: 'pipe',
    });
    this.clients.set(id, { client, transport });
    const log = (message: string) => {
      state.logs.push(redact(message).slice(0, 4000));
      state.logs = state.logs.slice(-100);
      this.emit({ type: 'mcp', id, status: state.status });
    };
    try {
      transport.stderr?.on('data', (chunk: Buffer) => log(chunk.toString()));
      client.onerror = (e) => log(e.message);
      client.onclose = () => {
        if (this.generations.get(id) === generation) {
          state.status = 'stopped';
          this.clients.delete(id);
          this.emit({ type: 'mcp', id, status: state.status });
        }
      };
      await client.connect(transport, { timeout: 15000 });
      const tools = await client.listTools({}, { timeout: 15000 });
      if (this.generations.get(id) !== generation) throw new Error('MCP connection cancelled');
      state.tools = tools.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
      state.status = 'connected';
      log(`Connected. ${state.tools.length} tools discovered.`);
    } catch (e) {
      await transport.close();
      this.clients.delete(id);
      state.status = 'error';
      log((e as Error).message);
      throw new Error(redact((e as Error).message));
    }
  }
  async stop(id: string) {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    const entry = this.clients.get(id);
    this.clients.delete(id);
    if (entry) await entry.client.close();
    this.state(id).status = 'stopped';
    this.emit({ type: 'mcp', id, status: 'stopped' });
  }
  async action(id: string, action: string) {
    if (action === 'stop') return this.stop(id);
    if (action === 'restart') await this.stop(id);
    if (action === 'test' && this.clients.has(id)) {
      await this.clients.get(id)!.client.ping({ timeout: 10000 });
      return;
    }
    await this.start(id);
  }
  async call(id: string, name: string, args: Record<string, unknown>, signal: AbortSignal) {
    const entry = this.clients.get(id);
    if (!entry) throw new Error('Start this MCP server first');
    const result = await entry.client.callTool({ name, arguments: args }, undefined, {
      signal,
      timeout: 60000,
    });
    if (result.isError)
      throw new Error(
        (this.redactors.get(id) ?? ((text) => this.secrets.redact(text)))(
          JSON.stringify(result),
        ).slice(0, 30000),
      );
    return (this.redactors.get(id) ?? ((text: string) => this.secrets.redact(text)))(
      JSON.stringify(result),
    ).slice(0, 30000);
  }
  async autoStart() {
    const configs = await this.library.list('mcp');
    await Promise.allSettled(
      configs
        .filter((c) => c.enabled && c.autoStart)
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
