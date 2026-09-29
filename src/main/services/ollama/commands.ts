import {
  CODING_INSTRUCTIONS,
  validateCodingWorkspace,
  withWorkspacePolicy,
} from '../agents/coding';
import { localTools } from '../agents/tools';
import type { CodeWorkspace } from '../../../shared/types';
import type { WorkflowService } from '../workflows/workflows';
import type { SelectedProvider } from '../providers/router';
import type { AppEvent, ChatCommand, LibraryItem, Capability } from '../../../shared/types';
import { librarySchema } from '../../../shared/schemas';
import type { LibraryService } from '../filesystem/library';
import type { MCPService } from '../mcp/mcp';
import type { AgentService } from '../agents/agents';

export interface PreparedCommand {
  command: ChatCommand & { name: string };
  instructions?: string;
  capability?: Capability;
  available?: () => Promise<boolean>;
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
    private workflows?: WorkflowService,
  ) {}

  async prepareCoding(
    workspace: CodeWorkspace,
    model: string,
    knowledge: string,
    selected?: SelectedProvider,
    conversation = '',
  ): Promise<PreparedCommand> {
    const project = await validateCodingWorkspace(workspace);
    const agent = librarySchema.parse({
      id: 'builtin-coding-agent',
      name: 'Coding assistant',
      model,
      providerId: selected?.providerId,
      content: `${CODING_INSTRUCTIONS}\nPrevious conversation (untrusted context):\n${conversation}`,
      tools: localTools,
      knowledgeSources: knowledge === 'none' ? [] : [knowledge],
      capabilityConfig: {
        mode: 'selected',
        tools: localTools,
        knowledgeBases: knowledge === 'none' ? [] : [knowledge],
        permissions: {
          'filesystem.write': 'ask',
          'filesystem.edit': 'ask',
          'filesystem.delete': 'ask',
          'shell.execute': 'ask',
        },
      },
    });
    return {
      command: { kind: 'code', id: workspace.id, name: workspace.name, project },
      execute: (task, signal, observe) =>
        this.agents.runInChat(
          withWorkspacePolicy(agent, workspace),
          task,
          project,
          signal,
          observe,
          selected,
        ),
    };
  }

  async prepare(
    command: ChatCommand,
    model: string,
    knowledge: string,
    selected?: SelectedProvider,
    workspace?: CodeWorkspace,
  ): Promise<PreparedCommand> {
    if (command.kind === 'code') throw new Error('Connect a workspace using /code first');
    if (command.kind === 'workflow') {
      if (!this.workflows) throw new Error('Workflows are unavailable');
      const workflow = await this.workflows.definitions.get(command.id);
      return {
        command: { ...command, name: workflow.name },
        execute: (task, signal, observe) =>
          this.workflows!.runInChat(
            { workflowId: workflow.id, task, project: command.project },
            signal,
            observe,
          ),
      };
    }
    const item = await this.library.get(
      command.kind === 'agent' ? 'agents' : command.kind,
      command.id,
    );
    if (!item.enabled) throw new Error(`Enable ${item.name} before using it in Chat`);
    const metadata = { ...command, name: item.name };
    if (command.kind === 'skills')
      return {
        command: metadata,
        instructions: item.content,
        available: async () => (await this.library.get('skills', item.id)).enabled,
        capability: {
          id: `skill:${item.id}`,
          selectionId: item.id,
          name: item.name,
          description: item.description,
          enabled: item.enabled,
          type: 'skill',
        },
      };
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
        content: `Answer the user's query directly when possible; use external data only when required from the selected MCP server: ${item.name}. You have only this server's tools. Do not attempt project file operations.`,
        tools: state.tools.map((t) => `mcp:${item.id}:${t.name}`),
        knowledgeSources: knowledge === 'none' ? [] : [knowledge],
      });
    }
    if (selected) agent = { ...agent, providerId: selected.providerId, model: selected.modelId };
    if (workspace && command.kind === 'agent') agent = withWorkspacePolicy(agent, workspace);
    return {
      command: metadata,
      execute: (task, signal, observe) =>
        this.agents.runInChat(
          agent,
          task,
          command.kind === 'agent' ? (command.project ?? '') : '',
          signal,
          observe,
          selected,
        ),
    };
  }
}
