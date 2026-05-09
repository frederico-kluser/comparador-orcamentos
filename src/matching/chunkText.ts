/**
 * Chunking de texto longo para passar inteiro à LLM, sem cortar o meio.
 *
 * Estratégia:
 *  - corta SEMPRE em fronteiras de linha (\n) — nunca no meio de uma linha;
 *  - acrescenta `overlapLines` linhas do chunk anterior no início do próximo
 *    para que itens que caíram exatamente na borda apareçam em pelo menos
 *    um chunk inteiro;
 *  - se o texto cabe em `maxCharsPerChunk`, devolve [{ text, 0, 1 }] e o
 *    chamador segue o caminho single-call (sem custo extra).
 *
 * Dedup ocorre depois — qualquer item retornado por mais de um chunk é
 * removido na junção dos resultados.
 */

export interface TextChunk {
  text: string;
  index: number; // 0-based
  total: number;
}

export function chunkText(
  text: string,
  maxCharsPerChunk = 80_000,
  overlapLines = 5
): TextChunk[] {
  if (text.length <= maxCharsPerChunk) {
    return [{ text, index: 0, total: 1 }];
  }

  const lines = text.split('\n');
  const out: { lines: string[] }[] = [];
  let current: string[] = [];
  let size = 0;

  for (const line of lines) {
    const lineSize = line.length + 1; // +1 \n
    if (size + lineSize > maxCharsPerChunk && current.length > 0) {
      out.push({ lines: current });
      // overlap: as últimas N linhas do chunk anterior abrem o próximo
      const tail = current.slice(-overlapLines);
      current = [...tail];
      size = tail.reduce((s, l) => s + l.length + 1, 0);
    }
    current.push(line);
    size += lineSize;
  }
  if (current.length > 0) out.push({ lines: current });

  const total = out.length;
  return out.map((c, i) => ({
    text: c.lines.join('\n'),
    index: i,
    total,
  }));
}
