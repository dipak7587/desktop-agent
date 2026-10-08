/* global AbortSignal */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath, URL } from 'node:url';
import { resolve } from 'node:path';
import { execPath, argv } from 'node:process';
import process from 'node:process';
import { runAgent } from './agent.mjs';
import { formatDeliveryReply, replyTool } from './tool.mjs';

export async function connectOrderService() {
  const client = new Client({ name: 'order-support-workflow', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: execPath,
    args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    return {
      client,
      tools: tools.map(({ name, description, inputSchema }) => ({
        type: 'function',
        function: { name, description, parameters: inputSchema },
      })),
      async lookup(args) {
        const result = await client.callTool({ name: 'get_order_status', arguments: args });
        const text = result.content
          .filter((item) => item.type === 'text')
          .map((item) => item.text)
          .join('\n');
        if (result.isError) throw new Error(text);
        return JSON.parse(text);
      },
    };
  } catch (error) {
    await transport.close();
    throw error;
  }
}

export async function runWorkflow(task, log = () => {}) {
  const signal = AbortSignal.timeout(180_000);
  const service = await connectOrderService();
  let order;
  let reply;
  try {
    log('Stage 1/2: agent looks up the order through MCP');
    const lookupSummary = await runAgent({
      task: `Look up the order in this customer request and return the complete lookup JSON. Do not format a customer reply; that happens in a later stage. Customer request: ${task}`,
      tools: service.tools,
      signal,
      log,
      execute: async (_name, args) => {
        order = await service.lookup(args);
        return order;
      },
    });
    // Asking for a missing order ID is a valid completion, not a fabricated lookup.
    if (!order) return { status: 'needs_input', reply: lookupSummary };
    log('Stage 2/2: same agent formats the reply using the previous result');
    await runAgent({
      task: `Prepare the customer reply using format_delivery_reply. Previous stage output:\n${JSON.stringify(order)}`,
      tools: [replyTool],
      signal,
      log,
      execute: async (_name, args) => {
        // Preserve the verified facts even if a model tries to alter tool arguments.
        if (
          !args.order ||
          Object.keys(order).some((key) => args.order[key] !== order[key]) ||
          Object.keys(args.order).some((key) => !Object.hasOwn(order, key))
        ) {
          throw new Error('The agent changed the verified order data.');
        }
        const output = formatDeliveryReply({ order });
        reply = output.reply;
        return output;
      },
    });
    if (!reply) throw new Error('The agent did not call the reply tool.');
    return { status: 'completed', order, reply };
  } finally {
    await service.client.close();
  }
}

if (argv[1] && fileURLToPath(import.meta.url) === resolve(argv[1])) {
  try {
    const task = argv.slice(2).join(' ') || 'Where is my order ORD-123?';
    process.stdout.write(`Customer: ${task}\n\n`);
    const result = await runWorkflow(task, (line) => process.stdout.write(`${line}\n`));
    process.stdout.write(`\nWorkflow: ${result.status}\n${result.reply}\n`);
  } catch (error) {
    process.stderr.write(
      `Order demo failed: ${error.message}\nCheck that Ollama is running and OLLAMA_MODEL names an installed tool-capable model.\n`,
    );
    process.exitCode = 1;
  }
}
