import pdf = require('pdf-authenticator');

const result: pdf.PdfValidationResult = pdf.validatePdf(new Uint8Array(1), { strict: true });
const code: pdf.PdfErrorCode | undefined = result.valid ? undefined : result.code;
const flag: boolean = pdf.isPdf(new DataView(new ArrayBuffer(1)));

export = { code, flag };
