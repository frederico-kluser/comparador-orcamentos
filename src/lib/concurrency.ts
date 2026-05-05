/**
 * Roda `worker` sobre `items` mantendo no máximo `limit` execuções em paralelo.
 *
 * Não é um Promise.all simples — cada slot, ao terminar uma tarefa, puxa
 * imediatamente a próxima da fila. Quando todas as tarefas terminam, retorna.
 *
 * O worker DEVE tratar seus próprios erros (try/catch interno). Erros não
 * tratados rejeitam Promise.all e abortam o pool.
 */
export async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results: R[] = new Array(items.length);
  let nextIdx = 0;

  const consume = async (): Promise<void> => {
    while (true) {
      const i = nextIdx++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };

  const slotCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: slotCount }, consume));
  return results;
}
