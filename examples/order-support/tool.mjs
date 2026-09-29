// This same function is exported as a custom desktop Tool by setup.mjs.
export function formatDeliveryReply(input) {
  const order = input.order;
  if (
    !order ||
    typeof order !== 'object' ||
    typeof order.order_id !== 'string' ||
    typeof order.found !== 'boolean'
  )
    throw new Error('Pass the order object returned by get_order_status.');
  if (!order.found)
    return { reply: `I could not find order ${order.order_id}. Please check the order ID.` };
  if (order.status === 'shipped')
    return {
      reply: `Your order ${order.order_id} has shipped${order.carrier ? ` with ${order.carrier}` : ''}.${order.expected_delivery ? ` Expected delivery: ${order.expected_delivery}.` : ' A delivery date is not available yet.'}`,
    };
  if (order.status === 'processing')
    return {
      reply: `Your order ${order.order_id} is being prepared. A delivery date is not available yet.`,
    };
  if (order.status === 'delivered')
    return { reply: `Your order ${order.order_id} has been delivered.` };
  throw new Error('Unsupported order status.');
}

export const replyTool = {
  type: 'function',
  function: {
    name: 'format_delivery_reply',
    description:
      'Format a customer reply using the exact order object returned by get_order_status. Never invent order fields.',
    parameters: {
      type: 'object',
      properties: {
        order: { type: 'object', description: 'The full JSON object from get_order_status.' },
      },
      required: ['order'],
    },
  },
};
