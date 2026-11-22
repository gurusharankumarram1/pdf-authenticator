import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const dist = new URL('../dist/', import.meta.url);

rmSync(dist, { recursive: true, force: true });

for (const [format, type] of [['cjs', 'commonjs'], ['esm', 'module']]) {
  mkdirSync(new URL(`${format}/`, dist), { recursive: true });
  writeFileSync(new URL(`${format}/package.json`, dist), `${JSON.stringify({ type })}\n`);
}
