import { z } from 'zod';
import { callOpenAICompatJSONStream } from './llmStream';

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

const SYSTEM_PROMPT = `Você recebe o texto BRUTO de um orçamento/proposta comercial brasileira de materiais de construção/elétrica. Sua tarefa é IDENTIFICAR a tabela de itens e devolver uma lista estruturada.

REGRAS:
1. Para cada linha de produto, devolva: descrição (rawTerm), quantidade (número), unidade abreviada como veio no documento (unidadeAbrev) e a unidade HUMANIZADA em pt-BR no plural quando qtd > 1, singular quando qtd = 1 (unidadeHumana).
2. Mapeamento de referência (use, mas adapte se o texto contradisser):
   BR  → barras (1 → barra)
   PC  → peças (1 → peça)
   UN  → unidades (1 → unidade)
   MT  → metros (1 → metro)
   RL  → rolos (1 → rolo)
   PCT → pacotes (1 → pacote)
   CEN → centos (1 → peça)
   CX  → caixas (1 → caixa)
   KG  → quilos (1 → quilo)
   PAR → pares (1 → par)
   L   → litros (1 → litro)
3. Valores monetários vêm em formato BR ("1.234,56" ou "165,95"). Devolva-os normalizados em ponto decimal como string ("1234.56", "165.95"). NUNCA invente valores — copie o que está no documento.
4. Marque isPromocao=true quando a linha tiver indicador "(P)", "*P*", asterisco de promoção, ou similar (geralmente há uma legenda explicando "produtos com preço promocional").
5. Identifique o nome do fornecedor (cabeçalho — geralmente uma razão social com LTDA/SA/ME/EIRELI/COMERCIO/DISTRIBUIDORA).
6. IGNORE linhas de cabeçalho de coluna, rodapé, total geral, CNPJ, endereço, observações, condições de pagamento, dados do cliente.
7. NÃO INCLUA na lista a linha de TOTAL/SUBTOTAL.
8. unidadeAbrev pode ser null se o documento não trouxer abreviação explícita.
9. Responda APENAS JSON válido com este shape exato:
{"supplierName":"...","items":[{"rawTerm":"...","quantidade":0,"unidadeAbrev":"..."|null,"unidadeHumana":"...","valorUnit":"...","valorTotal":"...","isPromocao":false}]}`;

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
    systemPrompt: SYSTEM_PROMPT,
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
