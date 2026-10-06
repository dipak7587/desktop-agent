import ts from 'typescript';
import { expandEnvironment } from '../../../shared/environment';
import { analyzeToolSource, toolModuleBase } from './typescript';
import { spawn } from 'node:child_process';
import { toolItemFromSource } from './files';
import type { LibraryItem } from '../../../shared/types';
import type { LibraryService } from '../filesystem/library';
import type { SecretResolver } from '../mcp/mcp';

/** User-authored code is trusted local code, isolated from the app process, not an OS sandbox. */
export class CustomToolService {
  private active = new Set<AbortController>();
  constructor(
    private library: LibraryService,
    private secrets: SecretResolver,
    private timeout: () => number,
  ) {}
  async runSource(source: string, input: Record<string, unknown>) {
    const item = toolItemFromSource(source, { id: 'preview', enabled: true });
    return this.run(item.id, input, undefined, undefined, item);
  }
  async run(
    id: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
    project?: string,
    preview?: LibraryItem,
  ) {
    if (this.active.size >= 3) throw new Error('At most three custom tools may run at once');
    const controller = new AbortController();
    this.active.add(controller);
    const combined = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(this.timeout()),
      ...(signal ? [signal] : []),
    ]);
    try {
      combined.throwIfAborted();
      const item = preview ?? (await this.library.get('tools', id));
      if (!item.enabled) throw new Error('Enable this Tool before running it');
      const config = item.toolConfig;
      if (!config) throw new Error('Configure the Tool before running it');
      if (JSON.stringify(input).length > 100000) throw new Error('Tool input exceeds 100 KB');
      for (const parameter of config.type === 'langchain' ? [] : config.parameters) {
        const value = input[parameter.name];
        if (value === undefined && !parameter.required) continue;
        const type = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
        if (type !== parameter.type)
          throw new Error(`Parameter ${parameter.name} must be ${parameter.type}`);
      }
      let output: string;
      if (config.type === 'api') {
        const url = new URL(expandEnvironment(config.url, (name) => this.secrets.resolve(name)));
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
          throw new Error('Use an HTTP(S) URL without credentials');
        const headers = Object.fromEntries(
          Object.entries(config.headers).map(([key, value]) => [
            key,
            value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) =>
              this.secrets.resolve(name),
            ),
          ]),
        );
        if (config.method === 'GET')
          for (const [key, value] of Object.entries(input))
            url.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        const response = await fetch(url, {
          method: config.method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: config.method === 'GET' ? undefined : JSON.stringify(input),
          signal: combined,
          redirect: 'error',
        });
        const reader = response.body?.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        if (reader)
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 100000) throw new Error('API response exceeds 100 KB');
              chunks.push(value);
            }
          } finally {
            await reader.cancel();
          }
        output = Buffer.concat(chunks).toString('utf8');
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${output.slice(0, 2000)}`);
      } else {
        output = await new Promise<string>((resolve, reject) => {
          const source =
            item.toolSource ?? (config.type === 'langchain' ? item.content : undefined);
          const analysis = source ? analyzeToolSource(source) : undefined;
          const payload = analysis
            ? {
                code: ts.transpileModule(analysis.source, {
                  compilerOptions: {
                    target: ts.ScriptTarget.ES2023,
                    module: ts.ModuleKind.CommonJS,
                    esModuleInterop: true,
                  },
                }).outputText,
                input,
                exportName: analysis.exportName,
                moduleBase: toolModuleBase,
                schema: analysis.inputSchema,
              }
            : { code: item.content, input };
          const wrapper = `let raw='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>raw+=c);process.stdin.on('end',async()=>{try{const {code,input,exportName,moduleBase,schema}=JSON.parse(raw);let result;if(exportName){const Module=require('node:module');const path=require('node:path');const instance=new Module(moduleBase);instance.filename=moduleBase;instance.paths=Module._nodeModulePaths(path.dirname(moduleBase));instance._compile(code,moduleBase);const selected=instance.exports[exportName];if(!selected||typeof selected.invoke!=='function')throw new Error('Exported LangChain tool is unavailable');for(const [key,property] of Object.entries(schema.properties||{})){if(property.format==='date-time'&&typeof input[key]==='string')input[key]=new Date(input[key]);}result=await selected.invoke(input);}else{const fn=new (Object.getPrototypeOf(async function(){}).constructor)('input','require',code);result=await fn(input,require);}process.stdout.write(exportName&&typeof result==='string'?JSON.stringify(result):JSON.stringify(result??null));}catch(e){console.error(e.message);process.exitCode=1;}});`;
          const child = spawn(process.execPath, ['-e', wrapper], {
            cwd: project,
            signal: combined,
            killSignal: 'SIGKILL',
            env: {
              PATH: process.env.PATH,
              TMPDIR: process.env.TMPDIR,
              ...this.secrets.executionEnvironment?.(),
              ...Object.fromEntries(
                Object.entries(item.env).map(([key, value]) => [
                  key,
                  expandEnvironment(value, (name) => this.secrets.resolve(name)),
                ]),
              ),
              ELECTRON_RUN_AS_NODE: '1',
            },
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          let stdout = '',
            stderr = '';
          let size = 0;
          const collect = (data: Buffer, error: boolean) => {
            size += data.length;
            if (size > 100000) {
              child.kill('SIGKILL');
              reject(new Error('Tool output exceeds 100 KB'));
              return;
            }
            if (error) stderr += data.toString();
            else stdout += data.toString();
          };
          child.stdout.on('data', (data: Buffer) => collect(data, false));
          child.stderr.on('data', (data: Buffer) => collect(data, true));
          child.on('error', reject);
          child.stdin.on('error', reject);
          child.on('close', (code) =>
            code === 0
              ? resolve(stdout)
              : reject(new Error(stderr || 'Node.js tool failed or timed out')),
          );
          child.stdin.end(JSON.stringify(payload));
        });
      }
      return this.secrets.redact(output);
    } catch (error) {
      throw new Error(this.secrets.redact((error as Error).message));
    } finally {
      this.active.delete(controller);
    }
  }
  stopAll() {
    for (const controller of this.active) controller.abort();
  }
}
