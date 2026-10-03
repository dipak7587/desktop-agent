import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { env, stderr } from 'node:process';
const server = new McpServer({ name: 'integration-test', version: '1.0.0' });
server.registerTool(
  'fail',
  { description: 'Return an MCP error for integration testing', inputSchema: {} },
  async () => ({
    isError: true,
    content: [{ type: 'text', text: 'Tool failed ' + (env.TEST_SECRET ?? '') }],
  }),
);
server.registerTool(
  'echo',
  { description: 'Echo a message for integration testing', inputSchema: { message: z.string() } },
  async ({ message }) => ({
    content: [{ type: 'text', text: message + ' ' + (env.TEST_SECRET ?? '') }],
  }),
);
await server.connect(new StdioServerTransport());
stderr.write('Started with ' + (env.TEST_SECRET ?? '') + '\n');
