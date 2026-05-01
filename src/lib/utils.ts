import Decimal from 'decimal.js';

Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export function parseMoedaBR(raw: string): Decimal | null {
  if (!raw) return null;
  // procura números no formato BR: 1.234,56  ou  1234,56  ou  1234
  const match = raw.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+,\d{1,2}|\d+)/);
  if (!match) return null;
  const norm = match[0].replace(/\./g, '').replace(',', '.');
  try {
    return new Decimal(norm);
  } catch {
    return null;
  }
}

export function parseQuantidadeBR(raw: string): number | null {
  if (!raw) return null;
  const match = raw.match(/(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+,\d+|\d+)/);
  if (!match) return null;
  const norm = match[0].replace(/\./g, '').replace(',', '.');
  const n = parseFloat(norm);
  return isNaN(n) ? null : n;
}

export function formatBRL(value: Decimal | string | number): string {
  const d = value instanceof Decimal ? value : new Decimal(value);
  return (
    'R$ ' +
    d
      .toFixed(2)
      .replace('.', ',')
      .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  );
}

export function hashStrings(values: string[]): string {
  // hash simples (djb2) - suficiente para POC
  const joined = values.join('|');
  let h = 5381;
  for (let i = 0; i < joined.length; i++) {
    h = (h * 33) ^ joined.charCodeAt(i);
  }
  return (h >>> 0).toString(16);
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
