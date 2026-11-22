# pdf-authenticator

[![npm version](https://img.shields.io/npm/v/pdf-authenticator.svg)](https://www.npmjs.com/package/pdf-authenticator)
[![CI](https://github.com/gurusharankumarram1/pdf-authenticator/actions/workflows/ci.yml/badge.svg)](https://github.com/gurusharankumarram1/pdf-authenticator/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/pdf-authenticator.svg)](./LICENSE)

Fast, zero-dependency PDF validator for Node.js and browsers.

It checks that a file is really a PDF (not a renamed `.exe` or `.txt`, not truncated or corrupt) and tells you why when it isn't. It also reports the PDF version and whether the file is password-protected.

- Checks the PDF structure, not just the first bytes.
- Returns a clear error code and message for every failure.
- Same speed for a 2 KB or a 2 GB file: only a few KB are inspected.
- TypeScript types, ESM and CommonJS, no dependencies.

## Install

```bash
npm install pdf-authenticator
```

Works in Node.js 18+, browsers, Deno, Bun and edge runtimes.

## Usage

```js
import { isPdf, validatePdf } from 'pdf-authenticator';
// or: const { isPdf, validatePdf } = require('pdf-authenticator');

isPdf(buffer); // true or false

validatePdf(buffer);
// { valid: true, version: '1.7', encrypted: false }
// { valid: false, code: 'INVALID_HEADER', message: 'Missing "%PDF-x.y" header: not a PDF file.' }
```

### Validate an upload (Express + Multer)

```js
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/upload', upload.single('file'), (req, res) => {
  const result = validatePdf(req.file?.buffer, { strict: true, allowEncrypted: false });

  if (!result.valid) {
    return res.status(400).json({ error: result.code, message: result.message });
  }
  res.json({ version: result.version });
});
```

## API

### `isPdf(input)`

Returns `true` if `input` is a valid PDF. Takes a single argument, so it can be passed straight to `filter` or `every`.

### `validatePdf(input, options?)`

Returns `{ valid: true, version, encrypted }` or `{ valid: false, code, message }`.

`input` can be a `Buffer`, `Uint8Array` or any typed array, `DataView`, `ArrayBuffer` or `SharedArrayBuffer`. Any other value returns `INVALID_INPUT`; bad input never throws.

| Option           | Default    | Description                                                     |
| :--------------- | :--------- | :-------------------------------------------------------------- |
| `maxSize`        | `Infinity` | Maximum size in bytes.                                          |
| `strict`         | `false`    | Extra checks for untrusted uploads ([see below](#strict-mode)). |
| `allowEncrypted` | `true`     | Set to `false` to reject password-protected PDFs.               |

Invalid options throw a `TypeError`.

### Error codes

| Code                  | Meaning                                                           |
| :-------------------- | :---------------------------------------------------------------- |
| `INVALID_INPUT`       | Not a Buffer, typed array, `DataView` or `ArrayBuffer`.           |
| `EMPTY`               | The input has zero bytes.                                         |
| `TOO_LARGE`           | Larger than `maxSize`.                                            |
| `INVALID_HEADER`      | No `%PDF-x.y` header: not a PDF.                                  |
| `MISSING_OBJECT`      | No PDF object after the header.                                   |
| `MISSING_EOF`         | No `%%EOF` marker at the end: truncated or corrupt.               |
| `MISSING_STARTXREF`   | No `startxref` offset before `%%EOF`: corrupt.                    |
| `ENCRYPTED`           | Password-protected and `allowEncrypted` is `false`.               |
| `UNSUPPORTED_VERSION` | Strict only: version is not 1.0–1.7 or 2.0.                       |
| `TRAILING_DATA`       | Strict only: data after the final `%%EOF`.                        |
| `INVALID_XREF`        | Strict only: `startxref` does not point to the cross-reference.   |

Types `PdfValidationResult`, `PdfValidationOptions` and `PdfErrorCode` are exported for TypeScript.

## Strict mode

By default, files that PDF readers open are accepted, even with whitespace before the header or bytes after `%%EOF`. With `strict: true`, a file must also have:

- the `%PDF-x.y` header at byte 0, with version 1.0–1.7 or 2.0;
- nothing but whitespace after the final `%%EOF`;
- a `startxref` offset that points to the cross-reference section.

Use it for uploads. It rejects files that hide other content around a PDF and makes the `encrypted` flag reliable.

## Good to know

- Only the bytes you pass in are read. No file system, network or code execution.
- The structure is checked, not every byte, so damage in the middle of a file is not detected.
- A valid PDF is not always a safe PDF. It can still contain JavaScript or malware, so scan untrusted files separately.
- `maxSize` runs after the file is already in memory. Set an upload size limit in your server too, as in the example above.

## Upgrading from 1.x

`isPdf(buffer)` works as before. Breaking changes:

- Node.js 18 or later is required.
- Deep imports such as `pdf-authenticator/index.js` no longer work.
- The header must include a version (`%PDF-1.7`), and a `startxref` offset must come before `%%EOF`.

See the [changelog](./CHANGELOG.md) for details.

## License

[MIT](./LICENSE)
