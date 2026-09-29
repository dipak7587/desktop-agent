import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Fictional fixtures: no customer account or external order service is accessed.
const orders = {
  'ORD-123': { status: 'shipped', expected_delivery: '2026-10-01', carrier: 'Demo Express' },
  'ORD-456': { status: 'processing', expected_delivery: null, carrier: null },
  'ORD-789': { status: 'delivered', expected_delivery: null, carrier: 'Demo Express' },
};

const server = new McpServer({ name: 'order-service-demo', version: '1.0.0' });
server.registerTool(
  'get_order_status',
  {
    description: 'Look up a fictional demo order by ID. Returns found:false for unknown orders.',
    inputSchema: { order_id: z.string().regex(/^ORD-\d+$/) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  async ({ order_id }) => ({
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          Object.hasOwn(orders, order_id)
            ? { found: true, order_id, ...orders[order_id] }
            : { found: false, order_id, message: 'Order not found in the demo data.' },
        ),
      },
    ],
  }),
);
await server.connect(new StdioServerTransport());
