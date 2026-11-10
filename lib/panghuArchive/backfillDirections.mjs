import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';
import mongoose from 'mongoose';
import nextEnvironment from '@next/env';

const { loadEnvConfig } = nextEnvironment;

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../..');
const requireModule = createRequire(import.meta.url);
const quiet = { info() {}, log() {}, warn() {}, error() {} };
const cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const loaded = { exports: {} }; cache.set(filename, loaded);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const resolve = name => name.startsWith('.') ? load(path.resolve(path.dirname(filename), name + '.ts')) : requireModule(name);
  new Function('require', 'module', 'exports', 'console', code)(resolve, loaded, loaded.exports, quiet);
  return loaded.exports;
}
let scanned = 0; let updated = 0;
try {
  if (process.env.PANGHU_ARCHIVE_ALLOW_DIRECTION_BACKFILL !== 'yes') throw new Error();
  const args = process.argv.slice(2);
  if (args.some(value => !/^--(?:batch-size|max-batches)=[1-9]\d*$/.test(value)) || new Set(args.map(value => value.split('=')[0])).size !== args.length) throw new Error();
  const option = (name, fallback) => Number(args.find(value => value.startsWith(name + '='))?.split('=')[1] ?? fallback);
  const batchSize = option('--batch-size', 100); const maxBatches = option('--max-batches', 1000);
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500 || !Number.isSafeInteger(maxBatches) || maxBatches > 10000) throw new Error();
  process.env.NODE_ENV = 'production'; loadEnvConfig(root, false, quiet, true);
  const { backfillRecordDirections } = load(path.join(directory, 'storage.ts'));
  let complete = false;
  for (let batch = 0; batch < maxBatches; batch++) {
    const result = await backfillRecordDirections(batchSize);
    scanned += result.scanned; updated += result.updated;
    if (result.complete) { complete = true; break; }
  }
  console.log(JSON.stringify({ complete, scanned, updated }));
  if (!complete) process.exitCode = 2;
} catch {
  console.error(JSON.stringify({ complete: false, scanned, updated, error: '方向回填未完成；检查显式授权开关、参数和私有配置后重试。' })); process.exitCode = 1;
} finally { await mongoose.disconnect().catch(() => undefined); }
