const STOPWORDS = new Set([
  'un', 'und', 'unidade', 'kg', 'g', 'mg', 'l', 'ml',
  'cx', 'caixa', 'pc', 'peca', 'pç', 'm', 'cm', 'mm', 'pol',
  'de', 'do', 'da', 'com', 'sem', 'para', 'tipo', 'em',
]);

export function normalizar(texto: string): string {
  if (!texto) return '';
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // unifica unidades coladas: "8 mm" -> "8mm"
    .replace(/(\d)\s*(mm|cm|m|kg|g|l|ml|pol)\b/g, '$1$2')
    .replace(/[.,;:/\\()\-_'"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .sort()
    .join(' ');
}
