import type { AppEvent, ChatCommand, LibraryItem } from '../../../shared/types';
import { librarySchema } from '../../../shared/schemas';
import type { LibraryService } from '../filesystem/library';
import type { MCPService } from '../mcp/mcp';
import type { AgentService } from '../agents/agents';

export interface PreparedCommand {
  command: ChatCommand & { name: string };
  instructions?: string;
  execute?: (
    task: string,
    signal: AbortSignal,
    observe: (event: AppEvent) => void,
  ) => Promise<string>;
}

export class ChatCommands {
  constructor(
    private library: LibraryService,
    private mcp: MCPService,
    private agents: AgentService,
  ) {}

  async prepare(command: ChatCommand, model: string, knowledge: string): Promise<PreparedCommand> {
    const item = await this.library.get(
      command.kind === 'agent' ? 'agents' : command.kind,
      command.id,
    );
    if (!item.enabled) throw new Error(`Enable ${item.name} before using it in Chat`);
    const metadata = { ...command, name: item.name };
    if (command.kind === 'skills') return { command: metadata, instructions: item.content };
    let agent: LibraryItem = item;
    if (command.kind === 'mcp') {
      const state = this.mcp.states().find((s) => s.id === item.id);
      if (state?.status !== 'connected')
        throw new Error(`Start ${item.name} in the MCP menu first`);
      if (!state.tools.length) throw new Error(`${item.name} has no available tools`);
      agent = librarySchema.parse({
        id: item.id,
        name: item.name,
        model,
        content: `Answer the user's query using the selected MCP server: ${item.name}. You have only this server's tools. Do not attempt project file operations.`,
        tools: state.tools.map((t) => `mcp:${item.id}:${t.name}`),
        knowledgeSources: knowledge === 'none' ? [] : [knowledge],
      });
    }
    return {
      command: metadata,
      execute: (task, signal, observe) =>
        this.agents.runInChat(
          agent,
          task,
          command.kind === 'agent' ? (command.project ?? '') : '',
          signal,
          observe,
        ),
    };
  }
}
