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
import { capabilityConfig } from '../../../shared/capabilities';
import type { LibraryService } from '../filesystem/library';
import type { MCPService } from '../mcp/mcp';
import type { AgentService } from '../agents/agents';
import { BUILTIN_CODING_AGENT_ID } from '../../../shared/code-agent-templates';

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

  async closeCodeSession(conversationId: string) {
    await this.agents.closeCodeSession(conversationId);
  }

  /** No MCP chip: expose only tools from enabled, connected MCP servers. */
  async prepareAllMCP(
    model: string,
    knowledge: string,
    selected?: SelectedProvider,
  ): Promise<PreparedCommand> {
    const states = this.mcp.states();
    const servers = (await this.library.list('mcp')).filter(
      (server) =>
        server.enabled &&
        states.some(
          (state) =>
            state.id === server.id && state.status === 'connected' && state.tools.length > 0,
        ),
    );
    if (!servers.length)
      throw new Error(
        'No enabled MCP servers with tools are connected. Start a server in the MCP menu first.',
      );
    const tools = servers.flatMap((server) =>
      states
        .find((state) => state.id === server.id)!
        .tools.map((tool) => `mcp:${server.id}:${tool.name}`),
    );
    const agent = librarySchema.parse({
      id: 'builtin-all-mcp',
      name: 'All connected MCP servers',
      model: selected?.modelId ?? model,
      providerId: selected?.providerId,
      content:
        "Use the available MCP tools to find information relevant to the user's query and answer from their results. Choose relevant servers and tools based on their descriptions; do not call unrelated tools. Report unavailable information and tool failures honestly. You have only MCP tools; do not attempt project file operations.",
      tools,
      knowledgeSources: knowledge === 'none' ? [] : [knowledge],
    });
    return {
      command: { kind: 'mcp', id: agent.id, name: agent.name },
      execute: (task, signal, observe) =>
        this.agents.runInChat(agent, task, '', signal, observe, selected),
    };
  }

  async prepareCoding(
    workspace: CodeWorkspace,
    model: string,
    knowledge: string,
    selected?: SelectedProvider,
    conversation = '',
    conversationId = workspace.id,
  ): Promise<PreparedCommand> {
    if (selected?.local === false)
      throw new Error(
        'Code requires a local model. Select Ollama or a local compatible endpoint in Settings.',
      );
    const project = await validateCodingWorkspace(workspace);
    const agent = librarySchema.parse({
      id: BUILTIN_CODING_AGENT_ID,
      name: 'Coding assistant',
      model,
      providerId: selected?.providerId,
      content: CODING_INSTRUCTIONS,
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
          {
            conversationId,
            workspaceId: workspace.id,
            providerId: selected?.providerId ?? '',
            configurationKey: selected?.configurationKey,
            history: conversation,
            access: {
              allowedAgentIds: workspace.allowedAgentIds,
              allowedSkills: workspace.allowedSkills,
              allowedTools: workspace.allowedTools,
              allowedMCPServers: workspace.allowedMCPServers,
              allowedKnowledgeBases: workspace.allowedKnowledgeBases,
            },
          },
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
    if (command.kind === 'skills') {
      const config = capabilityConfig(item);
      const hasCapabilities =
        config.mode !== 'none' &&
        (config.mode === 'auto' ||
          (config.allowSkills && config.skills.length > 0) ||
          (config.allowTools && config.tools.some((tool) => !tool.startsWith('mcp:'))) ||
          (config.allowMCP &&
            (config.mcpServers.length > 0 ||
              config.tools.some((tool) => tool.startsWith('mcp:')))) ||
          (config.allowKnowledgeBase && config.knowledgeBases.length > 0));
      if (hasCapabilities) {
        if (config.allowMCP) {
          const servers = (await this.library.list('mcp')).filter(
            (server) =>
              server.enabled &&
              (config.mode === 'auto' ||
                config.mcpServers.includes(server.id) ||
                config.tools.some((tool) => tool.startsWith(`mcp:${server.id}:`))),
          );
          for (const server of servers)
            if (
              !this.mcp
                .states()
                .some((state) => state.id === server.id && state.status === 'connected')
            )
              await this.mcp.start(server.id);
        }
        const agent = {
          ...item,
          model: selected?.modelId ?? model,
          providerId: selected?.providerId,
          content: `Follow the selected skill: ${item.name}.\n${item.content}\nUse its permitted skills, tools, MCP, and knowledge sources when needed. Base KB-specific answers on retrieved passages and cite sources.`,
        };
        return {
          command: metadata,
          execute: (task, signal, observe) =>
            this.agents.runInChat(agent, task, command.project ?? '', signal, observe, selected),
        };
      }
    }
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
      if (!this.mcp.states().some((s) => s.id === item.id && s.status === 'connected'))
        await this.mcp.start(item.id);
      const state = this.mcp.states().find((s) => s.id === item.id);
      if (state?.status !== 'connected')
        throw new Error(`Could not connect to ${item.name}. Check its MCP configuration.`);
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
    if (command.kind === 'tools') {
      agent = librarySchema.parse({
        id: item.id,
        name: item.name,
        model,
        content: `Answer using the selected tool: ${item.name}. Only this tool is available. Report tool failures honestly.`,
        tools: [`custom:${item.id}`],
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
