/**
 * Leitura de texto de .txt e helpers para identificar lixo de extração CFB/OLE.
 *
 * - UTF-8 explícito (não confia no charset do Blob).
 * - Remove BOM.
 * - `looksLikeCfbGarbage`: detecta strings tipicamente vazadas dos streams
 *   internos do .doc binário quando alguém tenta decodificá-lo como texto
 *   (Root Entry, WordDocument, SummaryInformation, etc.). Usado para abortar
 *   pipelines que receberam lixo no lugar do conteúdo real.
 * - `readDocAsBestEffortText` está marcada @deprecated — produzia mais ruído
 *   do que sinal pra .doc binário (o conteúdo real fica em piece tables CFB,
 *   não acessíveis via byte-scan).
 */

const CFB_TELLTALES = [
  // nomes de stream CFB/OLE típicos do .doc/.xls binário
  'Root Entry',
  'WordDocument',
  'SummaryInformation',
  'DocumentSummaryInformation',
  'CompObj',
  'ObjectPool',
  '_PictureBullets',
  '1Table',
  '0Table',
  // estilos default do Word (PT-BR + EN) que aparecem nos streams de metadata
  'Tabela normal',
  'Fonte parág. padrão',
  'Parágrafo da Lista',
  'Default Paragraph Font',
  'No List',
  'Table Normal',
  // famílias de fonte sempre embutidas — se aparecerem como "itens", é meta
  'Times New Roman',
  'Cambria Math',
  'Wingdings',
  'Calibri',
];

/**
 * Heurística para detectar texto que veio de byte-scan de um .doc binário
 * (lixo de metadata CFB) em vez de conteúdo real. Se 3+ marcadores
 * aparecerem, considera quebrado. Threshold 3 evita falso-positivo num
 * documento real que cite uma fonte ou um nome de estilo isoladamente.
 */
export function looksLikeCfbGarbage(text: string): boolean {
  if (!text) return true;
  let hits = 0;
  for (const t of CFB_TELLTALES) {
    if (text.includes(t)) {
      hits++;
      if (hits >= 3) return true;
    }
  }
  return false;
}

/**
 * Mensagem-padrão pra quando um .doc legado não pode ser processado.
 * Inclui passos acionáveis em PT-BR.
 */
export const DOC_LEGACY_ERROR =
  'Arquivos .doc legados (Word 97-2003, binário CFB/OLE) não são suportados ' +
  'no navegador — o conteúdo real fica em piece tables internas que precisam ' +
  'de parser especializado indisponível em ambiente sandbox.\n\n' +
  'Para resolver: abra o arquivo no Word ou LibreOffice → Arquivo → ' +
  'Salvar Como → escolha "Documento do Word (.docx)" ou "PDF" → envie o ' +
  'arquivo convertido.';

export async function readFileAsUtf8(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = decoder.decode(buffer);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/**
 * Best-effort para .doc binário (Word 97-2003, formato CFB/OLE).
 *
 * Word armazena texto principal como UTF-16 LE dentro do stream
 * "WordDocument". Como não parsamos CFB aqui, fazemos varredura:
 *   1) procura runs de UTF-16 LE imprimíveis (cada char real seguido
 *      de 0x00 ou byte alto Latin Extended);
 *   2) se UTF-16 não rendeu nada, cai pra varredura ASCII/Latin-1.
 *
 * Não é parse real, mas evita o lixo binário que aparecia antes
 * (ex: tabelas FIB, fontes embutidas, ranges de bytes 0x80+ aleatórios).
 */
export async function readDocAsBestEffortText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const utf16 = extractUtf16LeStrings(bytes);
  if (utf16.length > 200) return utf16;

  const latin = extractAsciiStrings(bytes);
  return utf16.length > latin.length ? utf16 : latin;
}

function isPrintableUtf16Code(code: number): boolean {
  // ASCII imprimível
  if (code >= 0x20 && code <= 0x7e) return true;
  // tab/LF/CR
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  // Latin-1 supplement + Latin Extended (cobre acentuados PT)
  if (code >= 0x00a0 && code <= 0x024f) return true;
  // pontuação geral / símbolos comuns
  if (code >= 0x2010 && code <= 0x2030) return true;
  return false;
}

function extractUtf16LeStrings(bytes: Uint8Array): string {
  const out: string[] = [];
  let run: number[] = [];

  const flushRun = () => {
    if (run.length >= 6) out.push(String.fromCharCode(...run));
    run = [];
  };

  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (isPrintableUtf16Code(code)) {
      run.push(code);
    } else {
      flushRun();
    }
  }
  flushRun();

  return out
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractAsciiStrings(bytes: Uint8Array): string {
  const out: string[] = [];
  let run: number[] = [];

  const flush = () => {
    if (run.length >= 6) {
      out.push(new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(run)));
    }
    run = [];
  };

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    const printable =
      (b >= 0x20 && b <= 0x7e) ||
      b === 0x09 ||
      b === 0x0a ||
      b === 0x0d ||
      // continuação UTF-8 ou Latin-1 (mas exigimos sequência longa pra não
      // pegar lixo binário de bytes altos isolados)
      b >= 0xc2;
    if (printable) {
      run.push(b);
    } else {
      flush();
    }
  }
  flush();

  return out
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
