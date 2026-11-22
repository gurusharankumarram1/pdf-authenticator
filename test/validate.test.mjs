import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import vm from 'node:vm';
import { isPdf, validatePdf } from 'pdf-authenticator';
import { buildLinearizedLayout, buildPdf, buildXrefStreamPdf, bytes, fixture, prng } from './helpers.mjs';

const code = (input, options) => validatePdf(input, options).code;

/** Long trailer value that moves the keys before it out of the last 2048 bytes. */
const FAR = ` /Info (${'i'.repeat(3000)})`;

describe('valid PDFs', () => {
  it('accepts real-world files in default and strict mode', () => {
    const fixtures = [
      ['plain.pdf', '1.7', false],
      ['xref-stream.pdf', '1.7', false],
      ['incremental.pdf', '1.7', false],
      ['pypdf-plain.pdf', '1.3', false],
      ['encrypted-aes256.pdf', '1.7', true],
      ['encrypted-rc4.pdf', '1.7', true],
      ['encrypted-xref-stream.pdf', '1.7', true],
      ['pypdf-encrypted.pdf', '1.3', true],
    ];
    for (const [name, version, encrypted] of fixtures) {
      const data = fixture(name);
      assert.deepEqual(validatePdf(data), { valid: true, version, encrypted }, name);
      assert.deepEqual(validatePdf(data, { strict: true }), { valid: true, version, encrypted }, name);
      assert.equal(isPdf(data), true, name);
    }
  });

  it('reports every known version', () => {
    for (const version of ['1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '2.0']) {
      assert.equal(validatePdf(buildPdf({ version }), { strict: true }).version, version);
    }
  });

  it('accepts CRLF, CR and missing final line endings', () => {
    const data = buildPdf();
    for (const sample of [buildPdf({ eol: '\r\n', entryEol: '\r\n' }), buildPdf({ eol: '\r', entryEol: ' \r' }), data.subarray(0, data.length - 1)]) {
      assert.equal(code(sample, { strict: true }), undefined);
    }
  });

  it('accepts documents smaller than 200 bytes', () => {
    const body = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n';
    const data = bytes(`${body}xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF`);
    assert.ok(data.length < 200);
    assert.equal(code(data, { strict: true }), undefined);
  });

  it('accepts what PDF readers tolerate in default mode', () => {
    assert.equal(validatePdf(buildPdf({ prefix: '\r\n \t\n' })).valid, true);
    assert.equal(validatePdf(buildPdf({ suffix: 'a'.repeat(1500) })).valid, true);
    assert.equal(validatePdf(buildPdf({ xrefShift: 7 })).valid, true);
    assert.equal(validatePdf(buildPdf({ xrefShift: 10 ** 9 })).valid, true);
    assert.equal(validatePdf(buildPdf({ version: '3.1' })).version, '3.1');
  });
});

describe('input', () => {
  const pdf = buildPdf();
  const arrayBuffer = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength);

  it('accepts every supported binary type', () => {
    const shared = new SharedArrayBuffer(pdf.length);
    new Uint8Array(shared).set(pdf);
    const even = buildPdf({ suffix: pdf.length % 2 ? '\n' : '' });
    const context = vm.createContext({ source: Array.from(pdf) });
    const inputs = {
      Buffer: pdf,
      Uint8Array: new Uint8Array(pdf),
      ArrayBuffer: arrayBuffer,
      DataView: new DataView(arrayBuffer),
      SharedArrayBuffer: shared,
      Uint16Array: new Uint16Array(even.buffer.slice(even.byteOffset, even.byteOffset + even.byteLength)),
      'Uint8Array from a vm context': vm.runInContext('new Uint8Array(source)', context),
      'ArrayBuffer from a vm context': vm.runInContext('new Uint8Array(source).buffer', context),
    };
    for (const [label, input] of Object.entries(inputs)) {
      assert.equal(isPdf(input), true, label);
    }
  });

  it('reads only the given part of a larger buffer', () => {
    const padded = Buffer.concat([Buffer.from('data-before'), pdf, Buffer.from('data-after')]);
    assert.equal(isPdf(padded), false);
    assert.equal(isPdf(padded.subarray(11, 11 + pdf.length)), true);
    assert.equal(isPdf(new DataView(padded.buffer, padded.byteOffset + 11, pdf.length)), true);
  });

  it('works as a filter callback like version 1', () => {
    assert.deepEqual([pdf, Buffer.from('text'), pdf].filter(isPdf), [pdf, pdf]);
  });

  it('reports INVALID_INPUT for unsupported values without throwing', () => {
    const transferred = new Uint8Array(pdf).buffer;
    const transferredView = new Uint8Array(transferred);
    structuredClone(transferred, { transfer: [transferred] });
    const values = [
      null,
      undefined,
      '%PDF-1.4',
      42,
      true,
      {},
      [37, 80, 68, 70],
      () => {},
      Symbol('pdf'),
      10n,
      Promise.resolve(pdf),
      { [Symbol.toStringTag]: 'ArrayBuffer', length: 2 ** 30 },
      { [Symbol.toStringTag]: 'Uint8Array', length: 4, buffer: arrayBuffer, byteOffset: 0, byteLength: 4 },
      Object.create(Uint8Array.prototype),
      new Proxy(arrayBuffer, {}),
      new Proxy(new Uint8Array(pdf), {}),
      transferred,
      transferredView,
    ];
    for (const value of values) {
      assert.deepEqual(validatePdf(value), {
        valid: false,
        code: 'INVALID_INPUT',
        message: 'Expected a Buffer, TypedArray, DataView or ArrayBuffer.',
      });
    }
  });

  it('reports EMPTY for empty input', () => {
    for (const value of [Buffer.alloc(0), new Uint8Array(0), new ArrayBuffer(0), new DataView(new ArrayBuffer(0))]) {
      assert.deepEqual(validatePdf(value), { valid: false, code: 'EMPTY', message: 'Input is empty.' });
    }
  });
});

describe('non-PDF files', () => {
  it('rejects other file types', () => {
    const signatures = {
      PNG: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      JPEG: [0xff, 0xd8, 0xff, 0xe0],
      ZIP: [0x50, 0x4b, 0x03, 0x04],
      EXE: [0x4d, 0x5a, 0x90, 0x00],
      ELF: [0x7f, 0x45, 0x4c, 0x46],
      PostScript: [...Buffer.from('%!PS-Adobe-3.0\n')],
      zeros: [0, 0, 0, 0],
      spaces: [0x20, 0x20, 0x20, 0x20],
    };
    for (const [label, signature] of Object.entries(signatures)) {
      const data = Buffer.concat([Buffer.from(signature), Buffer.alloc(4096, signature[0]), Buffer.from('\n%%EOF\n')]);
      assert.equal(code(data), 'INVALID_HEADER', label);
    }
    for (const text of ['hello world', '<!DOCTYPE html>', 'PDF-1.4', '%PDF', '%PDF-', '%PDF-a.b', '%PDF-1', '%pdf-1.4']) {
      assert.equal(code(bytes(`${text}\n1 0 obj\nendobj\nstartxref\n0\n%%EOF\n`)), 'INVALID_HEADER', text);
    }
  });

  it('rejects a text file with a PDF header added on top', () => {
    assert.equal(code(bytes('%PDF-1.4\nThis is just a text file.\n%%EOF\n')), 'MISSING_OBJECT');
  });

  it('rejects a PDF placed after other content', () => {
    for (const prefix of ['GIF89a', 'MZ\0\0', '\xEF\xBB\xBF']) {
      assert.equal(code(buildPdf({ prefix })), 'INVALID_HEADER', prefix);
    }
  });

  it('allows at most 1023 whitespace bytes before the header', () => {
    assert.equal(validatePdf(buildPdf({ prefix: ' '.repeat(1023) })).valid, true);
    assert.equal(code(buildPdf({ prefix: ' '.repeat(1024) })), 'INVALID_HEADER');
  });

  it('looks for the first object only in the first 8192 bytes', () => {
    const withComment = (length) => {
      const data = buildPdf();
      return Buffer.concat([data.subarray(0, 9), bytes(`%${'c'.repeat(length)}\n`), data.subarray(9)]);
    };
    assert.equal(validatePdf(withComment(6000)).valid, true);
    assert.equal(code(withComment(9000)), 'MISSING_OBJECT');
  });
});

describe('corrupt PDFs', () => {
  it('reports each failure with a code and message', () => {
    const cases = [
      [bytes('%PDF-1.4\n'), undefined, 'MISSING_OBJECT', 'No PDF object found after the header.'],
      [bytes('%PDF-1.4\n1 0 obj\n'), undefined, 'MISSING_EOF', 'Missing "%%EOF" marker: the file is truncated or corrupt.'],
      [bytes('%PDF-1.4\n1 0 obj\n%%EOF'), undefined, 'MISSING_STARTXREF', 'Missing "startxref" offset before "%%EOF": the file is corrupt.'],
      [buildPdf({ version: '5.0' }), { strict: true }, 'UNSUPPORTED_VERSION', 'Unsupported PDF version 5.0.'],
      [buildPdf({ suffix: 'extra' }), { strict: true }, 'TRAILING_DATA', 'Unexpected data after the final "%%EOF" marker.'],
      [buildPdf({ xrefShift: 5 }), { strict: true }, 'INVALID_XREF', 'The "startxref" offset does not point to a cross-reference section.'],
    ];
    for (const [input, options, expectedCode, message] of cases) {
      assert.deepEqual(validatePdf(input, options), { valid: false, code: expectedCode, message });
    }
  });

  it('rejects every truncation of a real file', () => {
    for (const name of ['plain.pdf', 'xref-stream.pdf', 'encrypted-aes256.pdf']) {
      const data = fixture(name);
      const end = data.lastIndexOf('%%EOF') + 5;
      for (let length = 0; length < end; length++) {
        assert.equal(isPdf(data.subarray(0, length)), false, `${name} cut to ${length} bytes`);
      }
    }
  });

  it('looks for %%EOF only in the last 2048 bytes', () => {
    assert.equal(validatePdf(buildPdf({ suffix: ' '.repeat(2000) })).valid, true);
    assert.equal(code(buildPdf({ suffix: ' '.repeat(2100) })), 'MISSING_EOF');
  });

  it('rejects a missing or malformed startxref', () => {
    const body = '%PDF-1.4\n1 0 obj\n<< >>\nendobj\n';
    for (const end of ['%%EOF', 'startxref\n%%EOF', 'startxref\nabc\n%%EOF', 'startxref\n-12\n%%EOF', `startxref\n${'9'.repeat(16)}\n%%EOF`, 'startxref\n12\nextra\n%%EOF']) {
      assert.equal(code(bytes(`${body}${end}\n`)), 'MISSING_STARTXREF', end);
    }
  });

  it('handles a cross-reference keyword at the very end of the data', () => {
    const body = '%PDF-1.4\n1 0 obj\n<< >>\nendobj\n';
    const data = bytes(`${body}startxref\n${body.length + 19}\n%%EOF\nxref`);
    assert.equal(data.subarray(body.length + 19).toString(), 'xref');
    assert.deepEqual(validatePdf(data), { valid: true, version: '1.4', encrypted: false });
  });

  it('uses the last startxref in the file', () => {
    const data = buildPdf({ suffix: 'startxref\n1\n%%EOF\n' });
    assert.equal(validatePdf(data).valid, true);
    assert.equal(code(data, { strict: true }), 'INVALID_XREF');
  });

  it('never throws on random or damaged data', () => {
    const random = prng(20261113);
    const base = [fixture('plain.pdf'), fixture('encrypted-xref-stream.pdf'), buildPdf({ split: true }), buildLinearizedLayout()];
    for (let round = 0; round < 4000; round++) {
      let data;
      if (round % 4 === 0) {
        data = Buffer.from(Array.from({ length: Math.floor(random() * 600) }, () => Math.floor(random() * 256)));
      } else {
        data = Buffer.from(base[round % base.length]);
        for (let changes = 1 + Math.floor(random() * 8); changes > 0; changes--) {
          data[Math.floor(random() * data.length)] = Math.floor(random() * 256);
        }
        if (round % 3 === 0) {
          data = data.subarray(0, Math.floor(random() * data.length));
        }
      }
      for (const strict of [false, true]) {
        const result = validatePdf(data, { strict, allowEncrypted: round % 2 === 0 });
        assert.equal(result.valid, result.code === undefined);
      }
    }
  });

  it('stays fast on crafted input', () => {
    const inputs = [
      `%PDF-1.4\n${'1 '.repeat(4000)}`,
      `%PDF-1.4\n${'1'.repeat(8180)}`,
      `%PDF-1.4\n${`1${' '.repeat(200)}`.repeat(40)}`,
      `%PDF-1.4\n1 0 obj\n${'startxref\n1'.repeat(400)}\n%%EOF`,
      `%PDF-1.4\n1 0 obj\nxref\n${'0 0\n'.repeat(50_000)}startxref\n17\n%%EOF`,
      `%PDF-1.4\n1 0 obj\ntrailer\n<<${'('.repeat(1900)}startxref\n17\n%%EOF`,
      `%PDF-1.4\n1 0 obj\ntrailer\n<<${'<'.repeat(1900)}startxref\n17\n%%EOF`,
      `%PDF-1.4\n1 0 obj\ntrailer\n<<${'/'.repeat(1900)}startxref\n17\n%%EOF`,
    ];
    const started = performance.now();
    for (const text of inputs) {
      validatePdf(bytes(text), { strict: true });
      validatePdf(bytes(text));
    }
    assert.ok(performance.now() - started < 1000);
  });
});

describe('strict mode', () => {
  it('requires the header at the first byte', () => {
    assert.deepEqual(validatePdf(buildPdf({ prefix: '\n' }), { strict: true }), {
      valid: false,
      code: 'INVALID_HEADER',
      message: 'The "%PDF-x.y" header must start at byte 0.',
    });
  });

  it('rejects unknown versions', () => {
    for (const version of ['0.9', '1.8', '2.1', '3.0']) {
      assert.equal(code(buildPdf({ version }), { strict: true }), 'UNSUPPORTED_VERSION', version);
    }
  });

  it('rejects data after the final %%EOF', () => {
    assert.equal(code(buildPdf({ suffix: 'PK\x03\x04hidden-zip' }), { strict: true }), 'TRAILING_DATA');
    assert.equal(code(buildPdf({ suffix: '\r\n \t\0\f' }), { strict: true }), undefined);
  });

  it('requires startxref to point to the cross-reference section', () => {
    for (const xrefShift of [-40, 7, 10 ** 9]) {
      assert.equal(code(buildPdf({ xrefShift }), { strict: true }), 'INVALID_XREF', String(xrefShift));
    }
    const data = buildPdf();
    const shifted = Buffer.concat([data.subarray(0, 20), Buffer.from('% added comment\n'), data.subarray(20)]);
    assert.equal(code(shifted, { strict: true }), 'INVALID_XREF');
    assert.equal(code(buildPdf({ xrefShift: -1 }), { strict: true }), undefined);
  });
});

describe('encryption', () => {
  it('detects encryption in every cross-reference layout', () => {
    const encrypted = {
      'classic table': buildPdf({ encrypt: true }),
      'classic table beyond the last 2048 bytes': buildPdf({ encrypt: true, padding: 50_000, trailerExtra: FAR }),
      '19-byte entries in several subsections': buildPdf({ encrypt: true, entryEol: '\n', split: true, trailerExtra: FAR }),
      '21-byte entries in several subsections': buildPdf({ encrypt: true, entryEol: ' \r\n', split: true, trailerExtra: FAR }),
      'hundreds of subsections': buildPdf({ encrypt: true, split: 'each', extraObjects: 600, trailerExtra: FAR }),
      'CRLF line endings': buildPdf({ encrypt: true, eol: '\r\n', entryEol: '\r\n', trailerExtra: FAR }),
      'CR line endings': buildPdf({ encrypt: true, eol: '\r', entryEol: ' \r', split: true, trailerExtra: FAR }),
      'cross-reference stream': buildXrefStreamPdf({ encrypt: true }),
      'cross-reference stream beyond the last 2048 bytes': buildXrefStreamPdf({ encrypt: true, entries: 900 }),
      'hex code in the key name': buildXrefStreamPdf({ encrypt: true, entries: 900, name: '/Enc#72ypt' }),
      'fast web view (linearized) file': buildLinearizedLayout({ encrypt: true }),
      'wrong startxref with the trailer in the last 2048 bytes': buildPdf({ encrypt: true, xrefShift: 9 }),
      'whitespace before the header': buildPdf({ encrypt: true, prefix: '\n\n\n' }),
    };
    for (const [label, data] of Object.entries(encrypted)) {
      assert.equal(validatePdf(data).encrypted, true, label);
      assert.equal(code(data, { allowEncrypted: false }), 'ENCRYPTED', label);
    }
  });

  it('reports ENCRYPTED only when encryption is not allowed', () => {
    const data = fixture('encrypted-aes256.pdf');
    assert.deepEqual(validatePdf(data, { allowEncrypted: false }), {
      valid: false,
      code: 'ENCRYPTED',
      message: 'The PDF is encrypted (password-protected).',
    });
    assert.equal(validatePdf(data, { allowEncrypted: true }).valid, true);
    for (const name of ['plain.pdf', 'xref-stream.pdf', 'incremental.pdf', 'pypdf-plain.pdf']) {
      assert.equal(validatePdf(fixture(name), { allowEncrypted: false }).valid, true, name);
    }
  });

  it('ignores /Encrypt that is not a trailer key', () => {
    const lookalikes = {
      'longer key': ' /EncryptMetadata false',
      'nested dictionary': ' /Info << /Encrypt 9 0 R >>',
      array: ' /Names [/Encrypt /Other]',
      string: ' /Title (uses /Encrypt and (nested /Encrypt ) text)',
      'string with escapes': ' /Title (escaped \\) /Encrypt 9 0 R \\( paren)',
      'hex string': ' /Key <2F456E6372797074>',
      comment: '\n% /Encrypt 9 0 R\n',
    };
    for (const [label, trailerExtra] of Object.entries(lookalikes)) {
      assert.equal(validatePdf(buildPdf({ trailerExtra, padding: 20_000 }), { strict: true }).encrypted, false, label);
    }
    assert.equal(validatePdf(buildLinearizedLayout(), { strict: true }).encrypted, false);
  });

  it('falls back to the last 2048 bytes when a table has too many subsections', () => {
    assert.equal(validatePdf(buildPdf({ encrypt: true, split: 'each', extraObjects: 1200 })).encrypted, true);
    assert.deepEqual(validatePdf(buildPdf({ encrypt: true, split: 'each', extraObjects: 1200, trailerExtra: FAR }), { strict: true }), {
      valid: true,
      version: '1.4',
      encrypted: false,
    });
  });
});

describe('options', () => {
  const pdf = buildPdf();

  it('applies maxSize before reading the content', () => {
    assert.equal(validatePdf(pdf, { maxSize: pdf.length }).valid, true);
    assert.deepEqual(validatePdf(pdf, { maxSize: pdf.length - 1 }), {
      valid: false,
      code: 'TOO_LARGE',
      message: `Input is ${pdf.length} bytes, which exceeds the ${pdf.length - 1} byte limit.`,
    });
    assert.equal(code(Buffer.alloc(100), { maxSize: 10 }), 'TOO_LARGE');
    assert.equal(code(Buffer.alloc(0), { maxSize: 10 }), 'EMPTY');
  });

  it('uses defaults for missing options and ignores unknown keys', () => {
    for (const options of [undefined, null, {}, { maxSize: undefined, strict: undefined, allowEncrypted: undefined }, { unknown: 1 }]) {
      assert.equal(validatePdf(pdf, options).valid, true);
    }
  });

  it('throws TypeError for invalid options', () => {
    const invalid = [
      [{ maxSize: 0 }, 'options.maxSize must be a positive number.'],
      [{ maxSize: NaN }, 'options.maxSize must be a positive number.'],
      [{ maxSize: '1024' }, 'options.maxSize must be a positive number.'],
      [{ strict: 'true' }, 'options.strict must be a boolean.'],
      [{ allowEncrypted: 0 }, 'options.allowEncrypted must be a boolean.'],
      [true, 'options must be an object.'],
      ['strict', 'options must be an object.'],
      [[], 'options must be an object.'],
    ];
    for (const [options, message] of invalid) {
      assert.throws(() => validatePdf(pdf, options), { name: 'TypeError', message });
      assert.throws(() => validatePdf(null, options), { name: 'TypeError', message });
    }
  });
});
