import { z } from 'zod';
import { callOpenAICompatJSONStream } from './llmStream';
import { CLASSIFY_SYSTEM_PROMPT } from './prompts';

const ClassifiedItemSchema = z.object({
  rawTerm: z.string().min(1),
  quantidade: z.number().nonnegative(),
  unidadeAbrev: z.string().nullable(),
  unidadeHumana: z.string().min(1),
  valorUnit: z.string(),
  valorTotal: z.string(),
  isPromocao: z.boolean(),
});

const ClassifyResponseSchema = z.object({
  supplierName: z.string().min(1),
  items: z.array(ClassifiedItemSchema),
});

export type ClassifiedItem = z.infer<typeof ClassifiedItemSchema>;
export type ClassifyResponse = z.infer<typeof ClassifyResponseSchema>;

export async function classifyDocumentLLM(
  rawText: string,
  fileName: string
): Promise<ClassifyResponse> {
  const apiKey = import.meta.env.VITE_DEEPSEEK_API_KEY;
  const baseUrl = import.meta.env.VITE_DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  const model = import.meta.env.VITE_DEEPSEEK_MODEL_CLASSIFY || 'deepseek-v4-flash';

  if (!apiKey || apiKey.includes('xxxxxxxx')) {
    throw new Error(
      'VITE_DEEPSEEK_API_KEY não configurada. Crie um .env com base em .env.example.'
    );
  }

  // Trunca textos absurdamente grandes para caber no contexto (mantém início e fim).
  const MAX_CHARS = 60_000;
  const trimmed =
    rawText.length > MAX_CHARS
      ? rawText.slice(0, MAX_CHARS / 2) + '\n[...corte de texto...]\n' + rawText.slice(-MAX_CHARS / 2)
      : rawText;

  const userMessage =
    `Arquivo: ${fileName}\n\n` +
    `TEXTO BRUTO DO DOCUMENTO:\n` +
    `<<<\n${trimmed}\n>>>\n\n` +
    `Devolva o JSON conforme as regras.`;

  const content = await callOpenAICompatJSONStream({
    apiKey,
    baseUrl,
    model,
    systemPrompt: CLASSIFY_SYSTEM_PROMPT,
    userMessage,
    maxTokens: 16000,
    logTag: '[classify]',
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('LLM não retornou JSON válido na classificação.');
    parsed = JSON.parse(m[0]);
  }

  const validated = ClassifyResponseSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error('Schema da classificação LLM inválido: ' + validated.error.message);
  }

  return validated.data;
}
