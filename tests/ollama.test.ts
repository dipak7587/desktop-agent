import { it, expect } from 'vitest';
import { parseNDJSON, OllamaLLMProvider } from '../src/main/services/ollama/provider';
import { settingsSchema } from '../src/shared/schemas';
it('parses partial UTF-8 and final unterminated stream records', async () => {
  const data = new TextEncoder().encode('{"message":{"content":"héllo"}}\n{"done":true}');
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const b of data) c.enqueue(new Uint8Array([b]));
      c.close();
    },
  });
  const records = [];
  for await (const r of parseNDJSON(stream)) records.push(r);
  expect(records).toEqual([{ message: { content: 'héllo' } }, { done: true }]);
});
it('discovers and streams from real Ollama when explicitly enabled', async () => {
  if (!process.env.LOCALAI_LIVE_TEST) return;
  const provider = new OllamaLLMProvider(() => settingsSchema.parse({}));
  const models = await provider.listModels();
  expect(models.length).toBeGreaterThan(0);
  let content = '';
  for await (const chunk of provider.chat({
    model:
      models.find((m) => m.capabilities?.includes('completion'))?.name ??
      models.find((m) => !m.name.includes('embed'))!.name,
    messages: [{ role: 'user', content: 'Reply with exactly: Local connection works.' }],
    signal: AbortSignal.timeout(120000),
  }))
    content += chunk.message?.content ?? '';
  expect(content.length).toBeGreaterThan(0);
}, 150000);
