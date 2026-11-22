# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 2.0.0 - Unreleased

### Added

- `validatePdf(input, options)`, which returns the PDF version and encryption status, or an error `code` and `message`.
- Options `maxSize`, `strict` and `allowEncrypted`.
- Detection of encrypted (password-protected) PDFs.
- Strict mode for untrusted uploads.
- Support for every typed array, `DataView` and `SharedArrayBuffer`.
- TypeScript types and an ES module build.

### Changed

- **Breaking:** Node.js 18 or later is required.
- **Breaking:** the package defines an `exports` map, so deep imports such as `pdf-authenticator/index.js` no longer work.
- **Breaking:** the header must include a version (`%PDF-1.7`). `%PDF-` followed by anything was accepted before.
- **Breaking:** a `startxref` offset must come before the final `%%EOF`.
- No Node.js APIs are used, so the package also runs in browsers, Deno, Bun and edge runtimes.
- Input is no longer copied, and validation time no longer grows with file size.

### Fixed

- Valid PDFs smaller than 200 bytes are no longer rejected.
- Characters that are not PDF whitespace, such as the non-breaking space, are no longer skipped before the header.
- `ArrayBuffer` and typed arrays from `vm` contexts, iframes and workers are now recognised.

## 1.0.0 - 2025-11-20

- Initial release with `isPdf(input)`.
