import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validatePdf } from 'pdf-authenticator';
import { bytes } from './helpers.mjs';

const MB = 1024 * 1024;
const HEAD = '%PDF-1.7\n%\xE2\xE3\xCF\xD3\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< /Length 0 >>\nstream\n';

/** Builds a valid PDF of exactly `size` bytes, filled with zeros between its start and end. */
function largePdf(size, { encrypt = false } = {}) {
  const tailFor = (xrefOffset) =>
    '\nendstream\nendobj\n' +
    'xref\n0 3\n0000000000 65535 f \n0000000015 00000 n \n0000000050 00000 n \n' +
    `trailer\n<< /Size 3 /Root 1 0 R${encrypt ? ' /Encrypt 2 0 R' : ''} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  let tail = tailFor(size);
  tail = tailFor(size - tail.length + 18);
  const data = Buffer.alloc(size);
  bytes(HEAD).copy(data, 0);
  bytes(tail).copy(data, size - tail.length);
  return data;
}

describe('large inputs', () => {
  it('validates a 64 MB buffer', () => {
    const data = largePdf(64 * MB);
    const expected = { valid: true, version: '1.7', encrypted: false };
    assert.deepEqual(validatePdf(data), expected);
    assert.deepEqual(validatePdf(data, { strict: true }), expected);
    assert.equal(validatePdf(data, { maxSize: 64 * MB - 1 }).code, 'TOO_LARGE');
    assert.equal(validatePdf(data.subarray(0, 32 * MB)).code, 'MISSING_EOF');
  });

  it('reads only a few kilobytes of a large encrypted file', (t) => {
    const data = largePdf(64 * MB, { encrypt: true });
    const from = Buffer.from;
    let decoded = 0;
    t.mock.method(Buffer, 'from', function (value, offset, length) {
      if (value === data.buffer) {
        decoded += length;
      }
      return from.apply(this, arguments);
    });
    assert.deepEqual(validatePdf(data, { strict: true }), { valid: true, version: '1.7', encrypted: true });
    assert.ok(decoded > 0 && decoded <= 16 * 1024, `decoded ${decoded} bytes`);
  });
});
