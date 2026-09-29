import test from 'node:test';
import assert from 'node:assert/strict';
import { connectOrderService } from './workflow.mjs';
import { formatDeliveryReply } from './tool.mjs';

test('real MCP discovery and lookup → custom reply tool', async () => {
  const service = await connectOrderService();
  try {
    assert.deepEqual(
      service.tools.map((tool) => tool.function.name),
      ['get_order_status'],
    );
    const order = await service.lookup({ order_id: 'ORD-123' });
    assert.equal(order.status, 'shipped');
    assert.equal(
      formatDeliveryReply({ order }).reply,
      'Your order ORD-123 has shipped with Demo Express. Expected delivery: 2026-10-01.',
    );
    for (const order_id of ['ORD-456', 'ORD-789', 'ORD-999']) {
      const result = await service.lookup({ order_id });
      const reply = formatDeliveryReply({ order: result }).reply;
      assert.ok(reply.includes(order_id));
      assert.ok(!reply.includes('2026-10-01'), 'Do not invent a delivery date');
      if (order_id === 'ORD-999') assert.equal(result.found, false);
    }
    await assert.rejects(service.lookup({ order_id: 'invalid' }));
  } finally {
    await service.client.close();
  }
});
