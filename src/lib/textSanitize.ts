/**
 * Limpeza de texto extraído de .docx / .doc / .pdf / .txt.
 *
 * Problemas tratados:
 *  - mojibake UTF-8 decodificado como Latin-1 (ex.: "Ã©" no lugar de "é");
 *  - replacement char (U+FFFD), controles, zero-width;
 *  - NBSP, smart quotes, em/en dash, bullets, ellipsis — normalizados.
 */

// "Ã" ou "Â" seguidos de byte 0x80..0xbf — assinatura clássica de mojibake
const MOJIBAKE_RX = /Ã[-¿]|Â[-¿]/;

function fixMojibake(text: string): string {
  if (!MOJIBAKE_RX.test(text)) return text;

  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) return text;
    bytes[i] = code;
  }

  let fixed: string;
  try {
    fixed = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return text;
  }

  const before = (text.match(/[ÂÃ]/g) || []).length;
  const after = (fixed.match(/[ÂÃ]/g) || []).length;
  const fffd = (fixed.match(/�/g) || []).length;

  if (after < before / 2 && fffd < Math.max(2, before / 4)) return fixed;
  return text;
}

export function sanitizeText(input: string): string {
  if (!input) return '';

  let s = input.normalize('NFC');
  s = fixMojibake(s);

  // BOM, zero-width (ZWSP/ZWNJ/ZWJ/word-joiner), soft hyphen
  s = s.replace(/[﻿​‌‍⁠­]/g, '');
  // replacement char (parser engoliu byte inválido)
  s = s.replace(/�/g, '');

  // espaços não-padrão (NBSP, narrow NBSP, em/en spaces, ideográfico) -> ' '
  s = s.replace(/[  -   　]/g, ' ');

  // smart quotes simples e duplas -> ASCII
  s = s.replace(/[‘’‚‛]/g, "'");
  s = s.replace(/[“”„‟]/g, '"');

  // hífens longos / minus -> '-'
  s = s.replace(/[‐-―−]/g, '-');

  // ellipsis -> '...'
  s = s.replace(/…/g, '...');

  // bullets / midpoint -> espaço
  s = s.replace(/[•‣▪●·]/g, ' ');

  // private use area (Word às vezes usa pra símbolos custom) -> espaço
  s = s.replace(/[-]/g, ' ');

  // controles ASCII (preserva \t \n \r)
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ');

  return s;
}
