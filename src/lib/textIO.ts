/**
 * Leitura UTF-8 robusta para .txt / .doc / .docx-fallback.
 *
 * - UTF-8 explícito (não confia no charset do Blob).
 * - Remove BOM se presente.
 * - Para .doc binário: extrai apenas texto imprimível (heurística "strings").
 */

export async function readFileAsUtf8(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = decoder.decode(buffer);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

/**
 * Para arquivos .doc legados (formato binário Microsoft CFB/OLE),
 * mammoth não consegue ler. Como POC, fazemos extração de "strings"
 * imprimíveis (similar ao comando `strings` do Unix).
 *
 * Mantém apenas blocos de caracteres imprimíveis com 4+ chars
 * separados por espaços/quebras. Não é parsing real do .doc, mas
 * funciona razoavelmente para textos simples.
 */
export async function readDocAsBestEffortText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const out: string[] = [];
  let run: number[] = [];

  const flush = () => {
    if (run.length >= 4) {
      const decoder = new TextDecoder('utf-8', { fatal: false });
      out.push(decoder.decode(new Uint8Array(run)));
    }
    run = [];
  };

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    // imprimíveis ASCII, latin-1, ou continuação UTF-8
    const printable =
      (b >= 0x20 && b <= 0x7e) ||
      b === 0x09 || b === 0x0a || b === 0x0d ||
      (b >= 0xc0 && b <= 0xfd) ||
      (b >= 0x80 && b <= 0xbf);
    if (printable) {
      run.push(b);
    } else {
      flush();
    }
  }
  flush();

  return out.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
