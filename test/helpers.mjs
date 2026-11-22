import { readFileSync } from 'node:fs';

export const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
export const bytes = (text) => Buffer.from(text, 'latin1');

/** Builds a test PDF with a cross-reference table and correct byte offsets. */
export function buildPdf({
  version = '1.4',
  eol = '\n',
  entryEol = ' \n',
  prefix = '',
  suffix = '',
  padding = 0,
  encrypt = false,
  trailerExtra = '',
  xrefShift = 0,
  split = false,
  extraObjects = 0,
} = {}) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    `<< /Length ${padding} >>${eol}stream${eol}${'a'.repeat(padding)}${eol}endstream`,
  ];
  for (let i = 0; i < extraObjects; i++) {
    objects.push('<< >>');
  }
  if (encrypt) {
    objects.push('<< /Filter /Standard /V 1 /R 2 /O (owner) /U (user) /P -4 /EncryptMetadata false >>');
  }

  let body = `%PDF-${version}${eol}%\xE2\xE3\xCF\xD3${eol}`;
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj${eol}${object}${eol}endobj${eol}`;
    return offset;
  });

  const entry = (offset, generation, type) =>
    `${String(offset).padStart(10, '0')} ${String(generation).padStart(5, '0')} ${type}${entryEol}`;
  const xrefOffset = body.length;
  let xref = `xref${eol}`;
  if (split === 'each') {
    xref += `0 1${eol}${entry(0, 65535, 'f')}`;
    xref += offsets.map((offset, index) => `${index + 1} 1${eol}${entry(offset, 0, 'n')}`).join('');
  } else if (split) {
    xref += `0 1${eol}${entry(0, 65535, 'f')}`;
    xref += `1 2${eol}${offsets.slice(0, 2).map((offset) => entry(offset, 0, 'n')).join('')}`;
    xref += `3 ${offsets.length - 2}${eol}${offsets.slice(2).map((offset) => entry(offset, 0, 'n')).join('')}`;
  } else {
    xref += `0 ${offsets.length + 1}${eol}${entry(0, 65535, 'f')}`;
    xref += offsets.map((offset) => entry(offset, 0, 'n')).join('');
  }

  const trailer =
    `trailer${eol}<< /Size ${offsets.length + 1} /Root 1 0 R /ID [<0a1b> <2c3d>]` +
    `${encrypt ? ` /Encrypt ${objects.length} 0 R` : ''}${trailerExtra} >>${eol}`;
  const end = `startxref${eol}${xrefOffset + xrefShift}${eol}%%EOF${eol}`;
  return bytes(prefix + body + xref + trailer + end + suffix);
}

/** Builds a test PDF that stores its cross-reference data as a stream with `entries` rows. */
export function buildXrefStreamPdf({ encrypt = false, entries = 4, name = '/Encrypt' } = {}) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [] /Count 0 >>',
    '<< /Filter /Standard /V 1 /R 2 /O (owner) /U (user) /P -4 >>',
  ];
  let body = '%PDF-1.5\n%\xE2\xE3\xCF\xD3\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });

  const xrefOffset = body.length;
  const row = (type, offset) => String.fromCharCode(type, (offset >> 8) & 0xff, offset & 0xff, 0);
  let rows = row(0, 0) + offsets.map((offset) => row(1, offset)).join('') + row(1, xrefOffset);
  rows += row(0, 0).repeat(Math.max(0, entries - 5));
  const size = rows.length / 4;
  body +=
    `${objects.length + 1} 0 obj\n<< /Type /XRef /Size ${size} /W [1 2 1] /Root 1 0 R` +
    `${encrypt ? ` ${name} 3 0 R` : ''} /Length ${rows.length} >>\nstream\n${rows}\nendstream\nendobj\n`;
  return bytes(`${body}startxref\n${xrefOffset}\n%%EOF\n`);
}

/** Builds a "fast web view" (linearized) test PDF, where the last `startxref` points to a table near the start. */
export function buildLinearizedLayout({ encrypt = false, padding = 20000 } = {}) {
  const head = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n1 0 obj\n<< /Linearized 1 >>\nendobj\n';
  const firstXref =
    'xref\n0 2\n0000000000 65535 f \n0000000015 00000 n \n' +
    `trailer\n<< /Size 2 /Root 1 0 R${encrypt ? ' /Encrypt 2 0 R' : ''} /Prev 1 >>\nstartxref\n0\n%%EOF\n`;
  const rest = `2 0 obj\n<< /Length ${padding} >>\nstream\n${'a'.repeat(padding)}\nendstream\nendobj\n`;
  const mainXref = 'xref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 2 >>\n';
  return bytes(`${head}${firstXref}${rest}${mainXref}startxref\n${head.length}\n%%EOF\n`);
}

/** Seeded random number generator, so random tests use the same data on every run. */
export function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
