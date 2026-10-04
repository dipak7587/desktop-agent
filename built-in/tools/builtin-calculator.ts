import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export const calculator = tool(
  async ({ a, b, operation }) => {
    let result: number;
    switch (operation) {
      case 'add':
        result = a + b;
        break;
      case 'subtract':
        result = a - b;
        break;
      case 'multiply':
        result = a * b;
        break;
      case 'divide':
        if (b === 0) throw new Error('Cannot divide by zero.');
        result = a / b;
        break;
    }
    if (!Number.isFinite(result)) throw new Error('Result exceeds the supported numeric range.');
    return result;
  },
  {
    name: 'calculator',
    description:
      'Add, subtract, multiply, or divide two numbers. Runs locally without network access.',
    schema: z.object({
      a: z.number().describe('First number'),
      b: z.number().describe('Second number'),
      operation: z.enum(['add', 'subtract', 'multiply', 'divide']).describe('Arithmetic operation'),
    }),
  },
);
