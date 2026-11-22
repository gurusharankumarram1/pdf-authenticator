/** Code that tells why validation failed. */
export type PdfErrorCode =
  | 'INVALID_INPUT'
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'INVALID_HEADER'
  | 'UNSUPPORTED_VERSION'
  | 'MISSING_OBJECT'
  | 'MISSING_EOF'
  | 'MISSING_STARTXREF'
  | 'TRAILING_DATA'
  | 'INVALID_XREF'
  | 'ENCRYPTED';

export interface PdfValidationOptions {
  /** Maximum accepted size in bytes. Defaults to no limit. */
  maxSize?: number;
  /** Adds checks for untrusted uploads: header at the first byte, known version, valid `startxref` and nothing after `%%EOF`. Defaults to `false`. */
  strict?: boolean;
  /** Accepts encrypted (password-protected) documents. Defaults to `true`. */
  allowEncrypted?: boolean;
}

export type PdfValidationResult =
  | {
      valid: true;
      /** Version from the file header, such as `"1.7"`. */
      version: string;
      /** Whether the PDF is encrypted (password-protected). */
      encrypted: boolean;
    }
  | {
      valid: false;
      code: PdfErrorCode;
      message: string;
    };

type Reader = (offset: number, length: number) => string;

interface BufferFactory {
  from(buffer: ArrayBufferLike, byteOffset: number, length: number): { toString(encoding: 'latin1'): string };
}

/** Node.js `Buffer`, used to convert bytes to text faster when available. */
const NodeBuffer = (globalThis as { Buffer?: BufferFactory }).Buffer;

const WS = '\\0\\t\\n\\f\\r ';
const HEADER_LIMIT = 1024;
const HEAD_BYTES = 8192;
const TAIL_BYTES = 2048;
const PROBE_BYTES = 2048;
const MAX_XREF_SUBSECTIONS = 1024;
const XREF_ENTRY_CORE = 18;

const HEADER_RE = new RegExp(`^[${WS}]*%PDF-(\\d\\.\\d)`);
const KNOWN_VERSION_RE = /^(?:1\.[0-7]|2\.0)$/;
const OBJECT_RE = new RegExp(`\\b\\d+[${WS}]+\\d+[${WS}]+obj\\b`);
const STARTXREF_RE = new RegExp(`startxref[${WS}]+(\\d{1,15})[${WS}]*%%EOF`, 'g');
const NON_WS_RE = new RegExp(`[^${WS}]`);
const XREF_TARGET_RE = new RegExp(`^[${WS}]*(?:(xref)|\\d+[${WS}]+\\d+[${WS}]+obj)\\b`);
const TRAILER_RE = new RegExp(`^[${WS}]*trailer\\b`);
const SUBSECTION_RE = new RegExp(`^[${WS}]*\\d{1,10}[ \\t]+(\\d{1,10})[ \\t]*(?:\\r\\n|\\r|\\n)`);
const XREF_ENTRY_RE = /^\d{10} \d{5} [nf]([ \r\n]*)/;
const NAME_END_RE = new RegExp(`[${WS}()<>\\[\\]{}/%]`);
const EOL_RE = /[\r\n]/;
const ENCRYPT_NAME_RE = new RegExp(`/Encrypt(?=[${WS}()<>\\[\\]{}/%]|$)`);

/** Returns `true` when the input is a structurally valid PDF. */
export function isPdf(input: unknown): boolean {
  return validatePdf(input).valid;
}

/** Validates PDF data and reports its version and encryption, or why it is not a valid PDF. */
export function validatePdf(input: unknown, options?: PdfValidationOptions): PdfValidationResult {
  const { maxSize, strict, allowEncrypted } = resolveOptions(options);
  const bytes = toBytes(input);
  if (!bytes) {
    return fail('INVALID_INPUT', 'Expected a Buffer, TypedArray, DataView or ArrayBuffer.');
  }
  const size = bytes.length;
  if (size === 0) {
    return fail('EMPTY', 'Input is empty.');
  }
  if (size > maxSize) {
    return fail('TOO_LARGE', `Input is ${size} bytes, which exceeds the ${maxSize} byte limit.`);
  }
  const read: Reader = (offset, length) => latin1(bytes.subarray(offset, offset + length));

  const head = read(0, HEAD_BYTES);
  const header = HEADER_RE.exec(head);
  const headerOffset = header ? header[0].indexOf('%') : -1;
  if (!header || headerOffset >= HEADER_LIMIT) {
    return fail('INVALID_HEADER', 'Missing "%PDF-x.y" header: not a PDF file.');
  }
  if (strict && headerOffset > 0) {
    return fail('INVALID_HEADER', 'The "%PDF-x.y" header must start at byte 0.');
  }
  const version = header[1]!;
  if (strict && !KNOWN_VERSION_RE.test(version)) {
    return fail('UNSUPPORTED_VERSION', `Unsupported PDF version ${version}.`);
  }
  if (!OBJECT_RE.test(head)) {
    return fail('MISSING_OBJECT', 'No PDF object found after the header.');
  }

  const tail = read(Math.max(0, size - TAIL_BYTES), TAIL_BYTES);
  if (!tail.includes('%%EOF')) {
    return fail('MISSING_EOF', 'Missing "%%EOF" marker: the file is truncated or corrupt.');
  }
  let pointer: RegExpMatchArray | undefined;
  for (const match of tail.matchAll(STARTXREF_RE)) {
    pointer = match;
  }
  if (!pointer) {
    return fail('MISSING_STARTXREF', 'Missing "startxref" offset before "%%EOF": the file is corrupt.');
  }
  const pointerStart = pointer.index!;
  if (strict && NON_WS_RE.test(tail.slice(pointerStart + pointer[0].length))) {
    return fail('TRAILING_DATA', 'Unexpected data after the final "%%EOF" marker.');
  }

  const xrefOffset = Number(pointer[1]);
  const xref = read(xrefOffset, PROBE_BYTES);
  const target = XREF_TARGET_RE.exec(xref);
  if (strict && !target) {
    return fail('INVALID_XREF', 'The "startxref" offset does not point to a cross-reference section.');
  }
  const declared = !target
    ? undefined
    : target[1]
      ? trailerHasEncrypt(read, xrefOffset + target[0].length)
      : dictionaryHasKey(xref, target[0].length, 'Encrypt');
  const encrypted = declared ?? ENCRYPT_NAME_RE.test(tail.slice(0, pointerStart));
  if (encrypted && !allowEncrypted) {
    return fail('ENCRYPTED', 'The PDF is encrypted (password-protected).');
  }
  return { valid: true, version, encrypted };
}

/** Applies defaults and throws `TypeError` for invalid options. */
function resolveOptions(options: unknown): Required<PdfValidationOptions> {
  if (options === undefined || options === null) {
    return { maxSize: Infinity, strict: false, allowEncrypted: true };
  }
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('options must be an object.');
  }
  const { maxSize = Infinity, strict = false, allowEncrypted = true } = options as Record<string, unknown>;
  if (typeof maxSize !== 'number' || !(maxSize > 0)) {
    throw new TypeError('options.maxSize must be a positive number.');
  }
  if (typeof strict !== 'boolean') {
    throw new TypeError('options.strict must be a boolean.');
  }
  if (typeof allowEncrypted !== 'boolean') {
    throw new TypeError('options.allowEncrypted must be a boolean.');
  }
  return { maxSize, strict, allowEncrypted };
}

function fail(code: PdfErrorCode, message: string): PdfValidationResult {
  return { valid: false, code, message };
}

/** Returns the input's bytes without copying, or `null` when the input is not usable binary data. */
function toBytes(input: unknown): Uint8Array | null {
  try {
    const view = ArrayBuffer.isView(input) ? input : new DataView(input as ArrayBuffer);
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  } catch {
    return null;
  }
}

/** Skips the cross-reference table and checks the trailer after it for encryption; `undefined` when the table cannot be read. */
function trailerHasEncrypt(read: Reader, position: number): boolean | undefined {
  for (let i = 0; i < MAX_XREF_SUBSECTIONS; i++) {
    const text = read(position, PROBE_BYTES);
    const trailer = TRAILER_RE.exec(text);
    if (trailer) {
      return dictionaryHasKey(text, trailer[0].length, 'Encrypt');
    }
    const subsection = SUBSECTION_RE.exec(text);
    if (!subsection) {
      return undefined;
    }
    position += subsection[0].length;
    const count = Number(subsection[1]);
    if (count > 0) {
      const entry = XREF_ENTRY_RE.exec(text.slice(subsection[0].length));
      if (!entry) {
        return undefined;
      }
      position += count * (XREF_ENTRY_CORE + entry[1]!.length);
    }
  }
  return undefined;
}

/** Reports whether the first `<< >>` dictionary from `from` contains `key` directly, not inside a nested value. */
function dictionaryHasKey(text: string, from: number, key: string): boolean {
  let index = text.indexOf('<<', from);
  if (index < 0) {
    return false;
  }
  let depth = 0;
  while (index < text.length) {
    const char = text[index];
    const pair = char === text[index + 1];
    if (char === '<' && !pair) {
      const end = text.indexOf('>', index);
      if (end < 0) {
        return false;
      }
      index = end + 1;
    } else if (char === '<' || char === '[') {
      depth++;
      index += char === '<' ? 2 : 1;
    } else if ((char === '>' && pair) || char === ']') {
      if (--depth <= 0) {
        return false;
      }
      index += char === '>' ? 2 : 1;
    } else if (char === '(') {
      index = skipLiteralString(text, index);
    } else if (char === '%') {
      index = scan(text, index, EOL_RE);
    } else if (char === '/') {
      const end = scan(text, index + 1, NAME_END_RE);
      if (depth === 1 && decodeName(text.slice(index + 1, end)) === key) {
        return true;
      }
      index = end;
    } else {
      index++;
    }
  }
  return false;
}

/** Returns the index of the first character from `index` that matches `stop`. */
function scan(text: string, index: number, stop: RegExp): number {
  while (index < text.length && !stop.test(text[index]!)) {
    index++;
  }
  return index;
}

/** Returns the index just after the `( )` string that starts at `index`. */
function skipLiteralString(text: string, index: number): number {
  let depth = 0;
  for (; index < text.length; index++) {
    const char = text[index];
    if (char === '\\') {
      index++;
    } else if (char === '(') {
      depth++;
    } else if (char === ')' && --depth === 0) {
      return index + 1;
    }
  }
  return text.length;
}

/** Converts hex codes in a PDF name to characters, such as `/Enc#72ypt` to `/Encrypt`. */
function decodeName(name: string): string {
  return name.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Converts bytes to text with one character per byte, so text positions match byte positions. */
function latin1(bytes: Uint8Array): string {
  if (NodeBuffer) {
    return NodeBuffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  }
  let text = '';
  for (let i = 0; i < bytes.length; i += 4096) {
    text += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096) as unknown as number[]);
  }
  return text;
}
