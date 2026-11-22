'use strict';

const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { describe, it } = require('node:test');
const vm = require('node:vm');

const root = join(__dirname, '..');
const pkg = require('../package.json');
const pdf = readFileSync(join(__dirname, 'fixtures', 'plain.pdf'));
const API = ['isPdf', 'validatePdf'];

describe('entry points', () => {
  it('exposes the API to CommonJS', () => {
    const api = require('pdf-authenticator');
    assert.deepEqual(Object.keys(api).sort(), API);
    assert.equal(api.isPdf(pdf), true);
  });

  it('exposes the same API to ES modules', async () => {
    const api = await import('pdf-authenticator');
    assert.deepEqual(Object.keys(api).sort(), API);
    assert.equal(api.isPdf(pdf), true);
  });

  it('gives the same results without Node.js globals', async () => {
    const context = vm.createContext({});
    const api = { exports: {} };
    const source = readFileSync(join(root, 'dist', 'cjs', 'index.js'), 'utf8');
    vm.runInContext(`(function (exports, module) {${source}\n})`, context)(api.exports, api);
    assert.equal(vm.runInContext('typeof Buffer + typeof process + typeof require', context), 'undefinedundefinedundefined');
    const input = vm.runInContext(`new Uint8Array(${JSON.stringify([...pdf])})`, context);
    assert.equal(api.exports.isPdf(input.buffer), true);

    const native = require('pdf-authenticator');
    const { buildLinearizedLayout, buildPdf, buildXrefStreamPdf } = await import('./helpers.mjs');
    const far = ` /Info (${'i'.repeat(3000)})`;
    const samples = [
      ...readdirSync(join(__dirname, 'fixtures')).filter((name) => name.endsWith('.pdf')).map((name) => readFileSync(join(__dirname, 'fixtures', name))),
      buildPdf({ padding: 20_000 }),
      Buffer.concat([buildPdf().subarray(0, 9), Buffer.from(`%${'c'.repeat(6000)}\n`), buildPdf().subarray(9)]),
      buildPdf({ encrypt: true, split: 'each', extraObjects: 600, trailerExtra: far }),
      buildPdf({ encrypt: true, prefix: '\n\n', eol: '\r\n', entryEol: '\r\n' }),
      buildPdf({ xrefShift: 9, suffix: 'trailing', version: '1.9' }),
      buildXrefStreamPdf({ encrypt: true, entries: 900, name: '/Enc#72ypt' }),
      buildLinearizedLayout({ encrypt: true }),
      buildPdf().subarray(0, 300),
      Buffer.from(Array.from({ length: 9000 }, (_, index) => index % 256)),
      Buffer.alloc(0),
    ];
    assert.equal(samples.length, 18);
    for (const [index, sample] of samples.entries()) {
      for (const options of [undefined, { strict: true }, { allowEncrypted: false }, { maxSize: 2000 }]) {
        const expected = JSON.stringify(native.validatePdf(sample, options));
        assert.equal(JSON.stringify(api.exports.validatePdf(sample, options)), expected, `sample ${index}`);
      }
    }
  });
});

describe('package manifest', () => {
  const targets = (value) => (typeof value === 'string' ? [value] : Object.values(value).flatMap(targets));

  it('points every entry at a built file', () => {
    for (const file of [pkg.main, pkg.types, ...targets(pkg.exports)]) {
      assert.ok(existsSync(join(root, file)), file);
    }
  });

  it('has no runtime dependencies', () => {
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.peerDependencies, undefined);
  });

  it('publishes only the build output, readme and license', () => {
    const output = execSync('npm pack --dry-run --json --ignore-scripts', { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const [report] = Object.values(JSON.parse(output));
    const paths = report.files.map((file) => file.path).sort();
    const built = ['cjs', 'esm'].flatMap((format) => ['index.d.ts', 'index.js', 'package.json'].map((file) => `dist/${format}/${file}`));
    assert.deepEqual(paths, ['LICENSE', 'README.md', ...built, 'package.json'].sort());
  });
});
