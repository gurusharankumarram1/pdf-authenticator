import { isPdf, validatePdf } from 'pdf-authenticator';
import type { PdfErrorCode, PdfValidationOptions, PdfValidationResult } from 'pdf-authenticator';

declare const unknownValue: unknown;

const options: PdfValidationOptions = { maxSize: 1024, strict: true, allowEncrypted: false };
const flag: boolean = isPdf(new Uint8Array(1));
const untyped: boolean = isPdf(unknownValue);
const filtered: Uint8Array[] = [new Uint8Array(1)].filter(isPdf);
const result: PdfValidationResult = validatePdf(new ArrayBuffer(1), options);

if (result.valid) {
  const version: string = result.version;
  const encrypted: boolean = result.encrypted;
  // @ts-expect-error valid results carry no failure code
  result.code;
} else {
  const code: PdfErrorCode = result.code;
  const message: string = result.message;
  // @ts-expect-error failed results carry no version
  result.version;
}

// @ts-expect-error unknown failure code
const badCode: PdfErrorCode = 'NOPE';
// @ts-expect-error isPdf takes no options; use validatePdf(input, options).valid
isPdf(new Uint8Array(1), options);
// @ts-expect-error strict must be a boolean
validatePdf(new Uint8Array(1), { strict: 'yes' });
// @ts-expect-error maxSize must be a number
validatePdf(new Uint8Array(1), { maxSize: '10mb' });
// @ts-expect-error unknown option
validatePdf(new Uint8Array(1), { lenient: true });

export { badCode, filtered, flag, untyped };
