import { z } from 'zod';
import { librarySchema } from './schemas';

const configSchema = librarySchema
  .pick({ command: true, args: true, env: true })
  .extend({
    name: z.string().optional(),
    description: z.string().optional(),
    enabled: z.boolean().optional(),
    type: z.literal('stdio').optional(),
  })
  .strict();

export function parseMCPConfig(raw: string) {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('Enter valid MCP JSON with double-quoted keys and values.');
  }
  if (value && typeof value === 'object' && 'mcpServers' in value) {
    const wrapper = z
      .object({ mcpServers: z.record(z.string(), z.unknown()) })
      .strict()
      .parse(value);
    const servers = Object.values(wrapper.mcpServers);
    if (servers.length !== 1) throw new Error('Paste exactly one server inside mcpServers.');
    value = servers[0];
  }
  const result = configSchema.safeParse(value);
  if (!result.success)
    throw new Error(
      'Invalid MCP config. Use command (string), args (string array), and env (string values or ${NAME} references). Only stdio servers are supported.',
    );
  const { command, args, env } = result.data;
  return { command, args, env };
}
