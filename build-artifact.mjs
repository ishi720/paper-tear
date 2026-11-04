// Converts dist/index.html into the body-only fragment the artifact host expects.
import { readFileSync, writeFileSync } from 'node:fs';
const html = readFileSync('dist/index.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const pick = (re) => [...head.matchAll(re)].map((m) => m[0]);
const out = [
  ...pick(/<title>[\s\S]*?<\/title>/g),
  ...pick(/<meta name="claude:[^>]*>/g),
  ...pick(/<link[^>]*>/g),
  ...pick(/<style[\s\S]*?<\/style>/g),
  body.trim(),
  ...pick(/<script[\s\S]*?<\/script>/g),
].join('\n');
writeFileSync('dist/artifact.html', out);
console.log('dist/artifact.html', out.length);
