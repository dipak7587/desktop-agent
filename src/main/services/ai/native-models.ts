import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { ChatGoogle } from '@langchain/google';
import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Settings } from '../../../shared/types';
import { providerURLSchema } from '../../../shared/schemas';
import { providerBaseUrl, providerFetch } from '../ollama/provider';

/** Official model integrations own protocols, streaming, tool IDs and tool results.
 * The application only supplies its captured settings and guarded transport. */
export function nativeChatModel(
  settings: Settings,
  model: string,
  options: { disableStreaming?: boolean; format?: unknown } = {},
): BaseChatModel {
  const transport: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    return providerFetch(
      settings,
      request.url,
      {
        method: request.method,
        headers: request.headers,
        body:
          request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.text(),
        signal: request.signal,
      },
      'response',
    );
  };
  const common = {
    model,
    temperature: settings.temperature,
    maxRetries: 0,
    disableStreaming: options.disableStreaming ?? false,
  };
  if (settings.provider === 'ollama')
    return new ChatOllama({
      ...common,
      baseUrl: providerURLSchema.parse(settings.ollamaUrl),
      numCtx: settings.contextSize,
      headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
      fetch: transport,
      format: options.format as string | undefined,
    });
  const baseURL = providerBaseUrl(settings);
  if (settings.provider === 'anthropic')
    return new ChatAnthropic({
      ...common,
      apiKey: settings.apiKey || 'unused',
      maxTokens: 4096,
      clientOptions: { baseURL, fetch: transport, maxRetries: 0 },
    });
  if (settings.provider === 'google') {
    const url = new URL(baseURL);
    return new ChatGoogle({
      ...common,
      model: model.replace(/^models\//, ''),
      apiKey: settings.apiKey || 'unused',
      platformType: 'gai',
      endpoint: url.origin,
      apiVersion: url.pathname.replace(/^\//, '') || 'v1beta',
      apiClient: {
        hasApiKey: () => true,
        getProjectId: async () => '',
        fetch: async (request: Request) => {
          request.headers.set('x-goog-api-key', settings.apiKey);
          return transport(request);
        },
      },
    });
  }
  return new ChatOpenAI({
    ...common,
    apiKey: settings.apiKey || 'unused',
    useResponsesApi: false,
    configuration: {
      baseURL,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        // The SDK defaults to bearer auth; preserve the profile's explicit mode.
        if (settings.authMethod === 'none' || settings.authMethod === 'header' || !settings.apiKey)
          request.headers.delete('authorization');
        if (settings.authMethod === 'header' && settings.apiKey)
          request.headers.set(settings.authHeader || 'x-api-key', settings.apiKey);
        return transport(request);
      },
      maxRetries: 0,
    },
    ...(options.format === 'json'
      ? { modelKwargs: { response_format: { type: 'json_object' } } }
      : {}),
  });
}
