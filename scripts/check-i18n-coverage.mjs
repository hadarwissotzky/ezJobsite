import { readFileSync } from 'node:fs';
const src = readFileSync(process.argv[2], 'utf8');
const grab = (name) => {
  const i = src.indexOf(`const ${name}: Record<string, string> = {`);
  const j = src.indexOf('\n};', i);
  return [...src.slice(i, j).matchAll(/^\s*'([^']+)':/gm)].map((m) => m[1]);
};
const en = grab('EN'), es = grab('ES');
const missing = en.filter((k) => !es.includes(k));
const extra = es.filter((k) => !en.includes(k));
console.log(`  EN keys: ${en.length}   ES keys: ${es.length}`);
console.log(`  missing from Spanish: ${missing.length ? missing.join(', ') : 'NONE'}`);
console.log(`  in Spanish but not English: ${extra.length ? extra.join(', ') : 'none'}`);
process.exit(missing.length ? 1 : 0);
