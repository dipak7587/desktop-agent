import { afterEach, expect, it, vi } from 'vitest';
import { createAgent, tool } from 'langchain';
import { z } from 'zod';
import { createChatModel } from '../src/main/services/ai/langchain-model';
import { createLLMProvider } from '../src/main/services/ollama/provider';
import { settingsSchema } from '../src/shared/schemas';

afterEach(() => vi.unstubAllGlobals());

it.each(['ollama', 'openai', 'anthropic', 'google'] as const)(
  'executes native %s tool calls using the official integration',
  async (provider) => {
    const requests: { url: string; body: Record<string, unknown>; headers: Headers }[] = [];
    const ids = ['call-first', 'call-second'];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        requests.push({ url, body, headers: new Headers(init.headers) });
        const first = requests.length === 1;
        const calls = ids.map((id, index) => ({
          id,
          type: 'function',
          function: { name: 'double', arguments: JSON.stringify({ value: index + 2 }) },
        }));
        if (provider === 'ollama')
          return Response.json({
            model: 'test-model',
            created_at: new Date().toISOString(),
            done: true,
            message: {
              role: 'assistant',
              content: first ? '' : 'Done',
              ...(first
                ? {
                    tool_calls: calls.map((c) => ({
                      ...c,
                      function: { ...c.function, arguments: JSON.parse(c.function.arguments) },
                    })),
                  }
                : {}),
            },
          });
        if (provider === 'openai')
          return Response.json({
            id: `completion-${requests.length}`,
            object: 'chat.completion',
            model: 'test-model',
            choices: [
              {
                index: 0,
                finish_reason: first ? 'tool_calls' : 'stop',
                message: {
                  role: 'assistant',
                  content: first ? null : 'Done',
                  ...(first ? { tool_calls: calls } : {}),
                },
              },
            ],
          });
        if (provider === 'anthropic')
          return Response.json({
            id: `msg-${requests.length}`,
            type: 'message',
            role: 'assistant',
            model: 'test-model',
            content: first
              ? calls.map((c) => ({
                  type: 'tool_use',
                  id: c.id,
                  name: c.function.name,
                  input: JSON.parse(c.function.arguments),
                }))
              : [{ type: 'text', text: 'Done' }],
            stop_reason: first ? 'tool_use' : 'end_turn',
            usage: { input_tokens: 3, output_tokens: 3 },
          });
        return Response.json({
          candidates: [
            {
              content: {
                role: 'model',
                parts: first
                  ? calls.map((c) => ({
                      functionCall: {
                        id: c.id,
                        name: c.function.name,
                        args: JSON.parse(c.function.arguments),
                      },
                    }))
                  : [{ text: 'Done' }],
              },
              finishReason: 'STOP',
            },
          ],
        });
      }),
    );
    const settings = settingsSchema.parse({ provider, apiKey: 'test-key' });
    const model = createChatModel({
      provider: createLLMProvider(() => settings),
      model: 'test-model',
      disableStreaming: true,
    });
    expect(model._llmType()).not.toBe('localai-provider');
    const execute = vi.fn(async ({ value }: { value: number }) => String(value * 2));
    const agent = createAgent({
      model,
      tools: [
        tool(execute, {
          name: 'double',
          description: 'Double a number',
          schema: z.object({ value: z.number() }),
        }),
      ],
    });
    const result = await agent.invoke({
      messages: [{ role: 'user', content: 'Double two and three' }],
    });
    expect(result.messages.at(-1)?.text).toBe('Done');
    expect(execute).toHaveBeenCalledTimes(2);
    const replies = result.messages.filter((m) => m.type === 'tool');
    expect(replies.map((m) => m.text).sort()).toEqual(['4', '6']);
    const request = JSON.stringify(requests[1].body);
    expect(request).toContain('4');
    expect(request).toContain('6');
    if (provider === 'openai' || provider === 'anthropic')
      for (const id of ids) expect(request).toContain(id);
    expect(JSON.stringify(requests[0].body)).toContain('number');
    expect(requests).toHaveLength(2);
  },
);

it.each(['none', 'header', 'bearer'] as const)(
  'preserves custom provider %s authentication without leaking SDK defaults',
  async (authMethod) => {
    let headers!: Headers;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        headers = new Headers(init.headers);
        expect(init.redirect).toBe('error');
        return Response.json({
          choices: [
            { index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'OK' } },
          ],
        });
      }),
    );
    const settings = {
      ...settingsSchema.parse({
        provider: 'custom',
        apiBaseUrl: 'https://gateway.example/v1',
        apiKey: 'private-key',
      }),
      authMethod,
      authHeader: 'x-custom-key',
    };
    await createChatModel({ provider: createLLMProvider(() => settings), model: 'm' }).invoke(
      'Hello',
    );
    expect(headers.get('authorization')).toBe(
      authMethod === 'bearer' ? 'Bearer private-key' : null,
    );
    expect(headers.get('x-custom-key')).toBe(authMethod === 'header' ? 'private-key' : null);
  },
);

it.each(['ollama', 'openai'] as const)(
  'uses SDK parsing for %s UTF-8 streams split at every byte',
  async (provider) => {
    const wire =
      provider === 'ollama'
        ? '{"model":"test","message":{"role":"assistant","content":"héllo"},"done":false}\n{"model":"test","message":{"role":"assistant","content":""},"done":true}\n'
        : 'data: {"id":"stream","choices":[{"index":0,"delta":{"role":"assistant","content":"héllo"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                for (const byte of new TextEncoder().encode(wire))
                  controller.enqueue(Uint8Array.of(byte));
                controller.close();
              },
            }),
            {
              headers: {
                'Content-Type':
                  provider === 'ollama' ? 'application/x-ndjson' : 'text/event-stream',
              },
            },
          ),
      ),
    );
    const model = createChatModel({
      provider: createLLMProvider(() => settingsSchema.parse({ provider })),
      model: 'test',
    });
    let output = '';
    for await (const chunk of await model.stream('Hello')) output += chunk.text;
    expect(output).toBe('héllo');
  },
);
