import { describe, it, test, expect, vi, afterEach } from 'vitest';
import { normalizeModelConfig } from '@extension/storage';
import { createChatModel } from '../helper';
import { ProviderTypeEnum, type ProviderConfig, type ModelConfig } from '@extension/storage';

// Local Blackwell flash lane — a ChatOpenAI-compatible endpoint that is NOT an
// o-series/GPT-5 model, so reasoning_effort must reach the wire only via opt-in.
const flashProvider: ProviderConfig = {
  name: 'blackwell-flash',
  type: ProviderTypeEnum.CustomOpenAI,
  apiKey: 'local-no-key-needed',
  baseUrl: 'http://192.168.68.90:8011/v1',
  modelNames: ['blackwell-qwen38-flash'],
};

const openaiProvider: ProviderConfig = {
  name: 'OpenAI',
  type: ProviderTypeEnum.OpenAI,
  apiKey: 'sk-test',
};

const flashConfig = (reasoningEffort?: ModelConfig['reasoningEffort']): ModelConfig => ({
  provider: 'flash',
  modelName: 'blackwell-qwen38-flash',
  ...(reasoningEffort ? { reasoningEffort } : {}),
});
test('legacy nested reasoning_Effort stores get projected onto the top-level knob', () => {
  const legacy = normalizeModelConfig({
    provider: 'custom_openai_2',
    modelName: 'blackwell-qwen38-flash',
    parameters: { temperature: 0.1, reasoning_Effort: 'low' },
  });
  expect(legacy.reasoningEffort).toBe('low');
  expect(legacy.parameters).toStrictEqual({ temperature: 0.1 });
  // untouching a modern configuration
  const modern = normalizeModelConfig({
    provider: 'custom_openai_2',
    modelName: 'blackwell-qwen38-flash',
    reasoningEffort: 'low',
    parameters: { temperature: 0.1 },
  });
  expect(modern.reasoningEffort).toBe('low');
  expect(modern.parameters).toStrictEqual({ temperature: 0.1 });
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

describe('createChatModel request shape (custom OpenAI endpoints)', () => {
  it('forwards reasoning_effort AND keeps sampling params when a non-o model opts in via reasoningEffort', async () => {
    captureFetch();
    const model = createChatModel(flashProvider, flashConfig('low'));
    await model.invoke('hello');
    const req = lastRequest();
    expect(req.model).toBe('blackwell-qwen38-flash');
    expect(req.reasoning_effort).toBe('low');
    // opt-in must not strip the usual sampling parameters
    expect(req.temperature).toBe(0.1);
    expect(req.top_p).toBe(0.1);
    expect(req.max_tokens).toBe(4096);
  });

  it('omits reasoning_effort entirely when no reasoning effort is configured (backward compatible)', async () => {
    captureFetch();
    const model = createChatModel(flashProvider, flashConfig());
    await model.invoke('hello');
    const req = lastRequest();
    expect(req.model).toBe('blackwell-qwen38-flash');
    expect(req.reasoning_effort).toBeUndefined();
    expect(req.temperature).toBe(0.1);
    expect(req.top_p).toBe(0.1);
  });

  it('keeps native o-series/GPT-5 reasoning-only encoding (no sampling params)', async () => {
    captureFetch();
    const model = createChatModel(openaiProvider, {
      provider: 'openai',
      modelName: 'o3',
      reasoningEffort: 'low',
    });
    await model.invoke('hello');
    const req = lastRequest();
    expect(req.reasoning_effort).toBe('low');
    expect(req.temperature).toBeUndefined();
    // Observed on the wire (verified via dump): LangChain's o-series native branch omits both
    // the sampling params and the token-cap field; only model + reasoning_effort are sent.
    expect(req.top_p).toBeUndefined();
  });

  it('holds mapping minimal to none for gpt-5.1', async () => {
    captureFetch();
    const model = createChatModel(openaiProvider, {
      provider: 'openai',
      modelName: 'gpt-5.1',
      reasoningEffort: 'minimal',
    });
    await model.invoke('hello');
    const req = lastRequest();
    expect(req.reasoning_effort).toBe('none');
  });
});
