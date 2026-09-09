import { describe, it, expect, vi, afterEach } from 'vitest';
import { createChatModel } from '../helper';
import { ProviderTypeEnum, type ModelConfig } from '@extension/storage';

const flashProvider = {
  type: ProviderTypeEnum.CustomOpenAI,
  apiKey: 'local-no-key-needed',
  modelNames: ['blackwell-qwen38-flash'],
  baseUrl: 'http://127.0.0.1:9/v1',
};

const flashConfig = (reasoningEffort?: ModelConfig['reasoningEffort']): ModelConfig => ({
  provider: 'flash',
  modelName: 'blackwell-qwen38-flash',
  ...(reasoningEffort ? { reasoningEffort } : {}),
});

let captured: (RequestInit | undefined)[] = [];

function captureFetch() {
  captured = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.push(init);
      return new Response(
        JSON.stringify({
          id: 'test',
          object: 'chat.completion',
          choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastRequest(): Record<string, unknown> {
  const body = captured[captured.length - 1]?.body;
  return typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : ({} as Record<string, unknown>);
}

describe('createChatModel request shape (custom OpenAI endpoint)', () => {
  it('forwards reasoning_effort to the wire for custom providers configured with reasoningEffort', async () => {
    captureFetch();
    const model = createChatModel(flashProvider as never, flashConfig('low'));
    await model.invoke('hello');
    const req = lastRequest();
    expect(req.model).toBe('blackwell-qwen38-flash');
    expect(req.reasoning_effort).toBe('low');
  });

  it('omits reasoning_effort when no reasoning effort is configured (backward compatible custom lane)', async () => {
    captureFetch();
    const model = createChatModel(flashProvider as never, flashConfig());
    await model.invoke('hello');
    const req = lastRequest();
    expect(req.model).toBe('blackwell-qwen38-flash');
    expect(req.reasoning_effort).toBeUndefined();
  });

  it('still sends reasoning_effort for native OpenAI o-series models', async () => {
    captureFetch();
    const openaiProvider = {
      type: ProviderTypeEnum.OpenAI,
      apiKey: 'sk-test',
      modelNames: ['o3'],
      baseUrl: 'http://127.0.0.1:9/v1',
    };
    const model = createChatModel(openaiProvider as never, {
      provider: 'openai',
      modelName: 'o3',
      reasoningEffort: 'low',
    });
    await model.invoke('hello');
    const req = lastRequest();
    expect(req.reasoning_effort).toBe('low');
  });
});
