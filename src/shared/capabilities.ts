import type { AgentCapabilityConfig, AgentConfig, LibraryItem } from './types';

// Old definitions retain their exact tool selections, including individual MCP tools.
export function capabilityConfig(agent: LibraryItem): AgentCapabilityConfig {
  return (
    agent.capabilityConfig ?? {
      mode: 'selected',
      skills: agent.skills,
      tools: agent.tools,
      mcpServers: [],
      knowledgeBases: agent.knowledgeSources,
      allowSkills: true,
      allowMCP: true,
      allowTools: true,
      allowKnowledgeBase: true,
      permissions: {},
      trace: false,
    }
  );
}

export function agentConfig(agent: LibraryItem): AgentConfig {
  const capabilities = capabilityConfig(agent);
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    model: agent.model,
    enabled: agent.enabled,
    skills: [...capabilities.skills],
    tools: [...capabilities.tools],
    mcpServers: [...capabilities.mcpServers],
    knowledgeBases: [...capabilities.knowledgeBases],
    memory: [...(agent.memory ?? [])],
  };
}
