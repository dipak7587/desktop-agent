import type { AgentCapabilityConfig, LibraryItem } from './types';

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
