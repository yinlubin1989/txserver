import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

const requireModule = createRequire(import.meta.url);
const directory = path.dirname(fileURLToPath(import.meta.url));
export function loadModule(file, overrides = {}) {
  const cache = new Map();
  function load(filename) {
    const absolute = path.resolve(directory, filename);
    if (cache.has(absolute)) return cache.get(absolute).exports;
    const mod = { exports: {} };
    cache.set(absolute, mod);
    const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const resolve = name => Object.hasOwn(overrides, name) ? overrides[name] : name.startsWith('.') ? load(path.resolve(path.dirname(absolute), `${name}.ts`)) : requireModule(name);
    new Function('require', 'module', 'exports', code)(resolve, mod, mod.exports);
    return mod.exports;
  }
  return load(file);
}
