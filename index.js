"use strict";
const { Buffer } = require("buffer");

function toBuffer(input) {
  if (!input) return null;
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (input instanceof ArrayBuffer) return Buffer.from(new Uint8Array(input));
  return null;
}

function isPdf(input) {
  try {
    const HEADER_SIZE = 1024;
    const FOOTER_SIZE = 2048;
    const PREFIX_SCAN_SIZE = 8000;

    const buffer = toBuffer(input);
    if (!buffer || buffer.length < 200) return false;

    const header = buffer.toString("latin1", 0, Math.min(HEADER_SIZE, buffer.length));
    if (!header.trimStart().startsWith("%PDF-")) return false;

    const footerStart = Math.max(0, buffer.length - FOOTER_SIZE);
    const footer = buffer.toString("latin1", footerStart, buffer.length);
    if (!footer.includes("%%EOF")) return false;

    const prefix = buffer.toString("latin1", 0, Math.min(PREFIX_SCAN_SIZE, buffer.length));
    return /\b\d+\s+\d+\s+obj\b/.test(prefix);
  } catch (_) {
    return false;
  }
}

module.exports = { isPdf };
