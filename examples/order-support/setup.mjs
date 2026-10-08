import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { join } from 'node:path';
import { env, execPath, stdout } from 'node:process';
import { stringify } from 'yaml';
import { instructions } from './agent.mjs';
import { formatDeliveryReply } from './tool.mjs';

// Only writes demo definitions beside this script; does not modify app user data.
const root = fileURLToPath(new URL('./definitions/', import.meta.url));
const save = async (kind, filename, metadata, content) => {
  await mkdir(join(root, kind), { recursive: true });
  await writeFile(
    join(root, kind, filename),
    content === undefined
      ? `${JSON.stringify(metadata, null, 2)}\n`
      : `---\n${stringify(metadata)}---\n\n${content}\n`,
  );
};
await save('mcp', 'order-service-demo.json', {
  id: 'order-service-demo',
  name: 'Order service demo',
  description: 'Read fictional sample orders through a local MCP server.',
  command: execPath,
  args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
  env: {},
  enabled: true,
  autoStart: false,
});
await save(
  'tools',
  'format-delivery-reply.md',
  {
    id: 'format-delivery-reply',
    name: 'Format delivery reply',
    description: 'Format a reply from the exact order object returned by get_order_status.',
    version: '1.0.0',
    enabled: true,
    toolConfig: {
      type: 'javascript',
      parameters: [{ name: 'order', type: 'object', required: true }],
      url: '',
      method: 'GET',
      headers: {},
    },
  },
  `${formatDeliveryReply.toString()}\n\nreturn formatDeliveryReply(input);`,
);
const selectedTools = ['mcp:order-service-demo:get_order_status', 'custom:format-delivery-reply'];
await save(
  'agents',
  'order-support-demo.md',
  {
    id: 'order-support-demo',
    name: 'Order support demo',
    description: 'Look up a fictional order and prepare a customer reply.',
    providerId: env.DEMO_PROVIDER_ID || 'ollama-local',
    model: env.OLLAMA_MODEL || 'qwen3-coder:latest',
    skills: [],
    tools: selectedTools,
    knowledgeSources: [],
    maxIterations: 6,
    enabled: true,
    capabilityConfig: {
      mode: 'selected',
      allowSkills: false,
      allowMCP: true,
      allowTools: true,
      allowKnowledgeBase: false,
      skills: [],
      mcpServers: ['order-service-demo'],
      tools: selectedTools,
      knowledgeBases: [],
      permissions: {},
      trace: true,
    },
  },
  `${instructions}\nIn the desktop app, format_delivery_reply is the custom Tool named Format delivery reply.`,
);
const now = new Date().toISOString();
await save('workflows', 'order-support-demo.json', {
  id: 'order-support-demo',
  name: 'Order support demo',
  description: 'One agent reused in two stages: retrieve facts, then prepare a reply.',
  executionMode: 'sequential',
  agents: [
    {
      id: 'lookup',
      agentId: 'order-support-demo',
      name: 'Look up order',
      prompt:
        'Use get_order_status to look up the order in {{task}}. Return its complete JSON result. Do not format a reply yet. If no ID was given, ask for one.',
      position: { x: 100, y: 120 },
    },
    {
      id: 'reply',
      agentId: 'order-support-demo',
      name: 'Prepare reply',
      prompt:
        'Use Format delivery reply with the exact order JSON from previousAgentOutput. Return the reply verbatim. If the previous stage asked for an ID, repeat that request without calling a tool.',
      position: { x: 500, y: 120 },
    },
  ],
  connections: [
    {
      from: 'lookup',
      to: 'reply',
      mode: 'sequential',
      inputMapping: { sourceOutput: 'result', targetInput: 'previousAgentOutput' },
    },
  ],
  maxDepth: 2,
  maxIterations: 2,
  createdAt: now,
  updatedAt: now,
});
stdout.write(`Desktop definitions created in ${root}\n`);
