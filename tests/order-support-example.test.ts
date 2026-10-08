import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LibraryService } from '../src/main/services/filesystem/library';
import { CustomToolService } from '../src/main/services/tools/custom';
import { validateWorkflow } from '../src/shared/workflows';

it('loads matching order demo definitions and executes the desktop custom Tool', async () => {
  const root = resolve('examples/order-support/definitions');
  const library = new LibraryService(root);
  const mcp = await library.get('mcp', 'order-service-demo');
  const agent = await library.get('agents', 'order-support-demo');
  const workflow = validateWorkflow(
    JSON.parse(await readFile(resolve(root, 'workflows/order-support-demo.json'), 'utf8')),
  );
  expect(agent.tools).toContain(`mcp:${mcp.id}:get_order_status`);
  expect(workflow.agents.every((node) => node.agentId === agent.id)).toBe(true);
  const service = new CustomToolService(
    library,
    { resolve: () => '', redact: (value) => value },
    () => 5000,
  );
  const result = JSON.parse(
    await service.run('format-delivery-reply', {
      order: {
        found: true,
        order_id: 'ORD-123',
        status: 'shipped',
        expected_delivery: '2026-10-01',
        carrier: 'Demo Express',
      },
    }),
  );
  expect(result.reply).toBe(
    'Your order ORD-123 has shipped with Demo Express. Expected delivery: 2026-10-01.',
  );
});
