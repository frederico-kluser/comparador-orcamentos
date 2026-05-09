import type { ReasoningEffort } from './llmStream';

/**
 * Config compartilhada do OpenRouter (4 callers usam: classify, classify-order,
 * matcher, ranking-justify). Centraliza leitura do .env e validação.
 *
 * Modelo padrão: `google/gemini-3-flash-preview` (Gemini 3 Flash Preview com
 * reasoning embutido, controlado por `reasoning.effort`). Cada caller passa o
 * próprio efforte: matcher=medium, classify/order=low, justify=minimal.
 */

export interface OpenRouterConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  defaultEffort: ReasoningEffort;
  httpReferer?: string;
  appTitle?: string;
}

const VALID_EFFORTS = new Set<ReasoningEffort>(['minimal', 'low', 'medium', 'high']);

export function getOpenRouterConfig(): OpenRouterConfig {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey || apiKey.includes('xxxxxxxx')) {
    throw new Error(
      'VITE_OPENROUTER_API_KEY não configurada. Crie um .env com base em .env.example ' +
        'e cole sua chave de https://openrouter.ai/keys'
    );
  }

  const rawEffort = (import.meta.env.VITE_OPENROUTER_REASONING_EFFORT || 'medium').trim() as ReasoningEffort;
  const defaultEffort: ReasoningEffort = VALID_EFFORTS.has(rawEffort) ? rawEffort : 'medium';

  return {
    apiKey,
    baseUrl: import.meta.env.VITE_OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    model: import.meta.env.VITE_OPENROUTER_MODEL || 'google/gemini-3-flash-preview',
    defaultEffort,
    httpReferer: import.meta.env.VITE_OPENROUTER_HTTP_REFERER || undefined,
    appTitle: import.meta.env.VITE_OPENROUTER_APP_TITLE || undefined,
  };
}

export function isLLMConfigured(): boolean {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  return !!apiKey && !apiKey.includes('xxxxxxxx');
}
