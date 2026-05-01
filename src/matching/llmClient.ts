import { z } from 'zod';

/**
 * Cliente LLM minimalista para OpenRouter via fetch direto.
 *
 * ATENÇÃO: nesta POC a chave da API é exposta no client (lida de VITE_OPENROUTER_API_KEY).
 * Para deploy em produção, mover esta chamada para uma Vercel Serverless Function
 * em /api/llm-match.ts, lendo OPENROUTER_API_KEY (sem prefixo VITE_) do servidor.
 */

export const matchResultSchema = z.object({
  chosenId: z.string(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
export type MatchResult = z.infer<typeof matchResultSchema>;

const SYSTEM_PROMPT = `Você é um assistente que faz correspondência de produtos em orçamentos comerciais brasileiros. Sua tarefa: dado um termo do orçamento de um fornecedor e uma lista de produtos canônicos da ordem de compra, escolher qual produto canônico corresponde ao termo.

REGRAS:
1. Você DEVE escolher um dos IDs da lista de candidatos, OU retornar "none" se nenhum corresponder claramente.
2. NÃO invente IDs. NÃO sugira produtos fora da lista.
3. confidence (0.0 a 1.0) reflete sua certeza.
4. Considere unidades, especificações técnicas (M8, 1/2", etc.) e sinônimos do comércio brasileiro.

Responda EXCLUSIVAMENTE em JSON válido com o formato:
{"chosenId": "...", "confidence": 0.0, "reasoning": "..."}

EXEMPLOS:
Termo: "PARAFUSO SEXT M8X40 ZN"
Candidatos:
- id: "p1", descricao: "Parafuso sextavado M8 x 40mm zincado"
- id: "p2", descricao: "Parafuso allen M8 x 40mm"
Resposta: {"chosenId":"p1","confidence":0.97,"reasoning":"Sextavado M8x40 zincado bate com p1."}

Termo: "FITA ISOLANTE 19MM"
Candidatos:
- id: "p10", descricao: "Cabo flexível 2,5mm"
- id: "p11", descricao: "Conector RJ-45"
Resposta: {"chosenId":"none","confidence":0.95,"reasoning":"Nenhum candidato é fita isolante."}`;

export async function callLLMMatch(
  supplierTerm: string,
  candidates: { id: string; descricao: string }[]
): Promise<MatchResult> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  const model = import.meta.env.VITE_OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite';

  if (!apiKey || apiKey.includes('xxxxxxxx')) {
    throw new Error(
      'VITE_OPENROUTER_API_KEY não configurada. Crie um arquivo .env baseado em .env.example.'
    );
  }

  const userMessage =
    `Termo do fornecedor: "${supplierTerm}"\n\nCandidatos:\n` +
    candidates.map((c) => `- id: "${c.id}", descricao: "${c.descricao}"`).join('\n');

  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Comparador de Orcamentos',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 300,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`OpenRouter HTTP ${resp.status}: ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('Resposta LLM vazia.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    // tenta extrair JSON bruto se o modelo embrulhou em markdown
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('LLM não retornou JSON válido.');
    parsed = JSON.parse(m[0]);
  }

  const validated = matchResultSchema.safeParse(parsed);
  if (!validated.success) {
    throw new Error('Resposta LLM com schema inválido: ' + validated.error.message);
  }

  // valida que chosenId está na lista
  if (
    validated.data.chosenId !== 'none' &&
    !candidates.some((c) => c.id === validated.data.chosenId)
  ) {
    return {
      chosenId: 'none',
      confidence: 0,
      reasoning: 'LLM retornou ID inexistente; rejeitado.',
    };
  }

  return validated.data;
}

export function isLLMConfigured(): boolean {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  return !!apiKey && !apiKey.includes('xxxxxxxx');
}
