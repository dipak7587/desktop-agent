---
id: format-delivery-reply
name: Format delivery reply
description: Format a reply from the exact order object returned by get_order_status.
version: 1.0.0
enabled: true
toolConfig:
  type: javascript
  parameters:
    - name: order
      type: object
      required: true
  url: ""
  method: GET
  headers: {}
---

function formatDeliveryReply(input) {
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

return formatDeliveryReply(input);
