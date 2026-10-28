// Builds dist/cosense-vim.user.js (one file with the userscript header).
//   node build.mjs           build once
//   node build.mjs --watch   rebuild on change
//   node build.mjs --check   fail if dist/ is not up to date (used in CI)
import { readFileSync, mkdirSync } from 'node:fs';
import * as esbuild from 'esbuild';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const us = pkg.userscript;
const OUT = 'dist/cosense-vim.user.js';

const pad = k => ('// @' + k).padEnd(17);
const meta = [
  ['name', us.name],
  ['namespace', us.namespace],
  ['version', pkg.version],
  ['description', us.description],
  ['author', pkg.author],
  ['license', pkg.license],
  ['homepageURL', pkg.homepage],
  ['supportURL', us.supportURL],
  ...us.match.map(m => ['match', m]),
  ['icon', us.icon],
  ['grant', us.grant],
  ['run-at', us['run-at']],
  ['updateURL', us.updateURL],
  ['downloadURL', us.downloadURL],
].filter(([, v]) => v);
const banner = ['// ==UserScript==', ...meta.map(([k, v]) => pad(k) + v), '// ==/UserScript==', '',
  `// Generated from src/ by build.mjs — edit the sources, not this file.`, ''].join('\n');

const options = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  charset: 'utf8',
  legalComments: 'none',
  banner: { js: banner },
  define: { __VERSION__: JSON.stringify(pkg.version) },
  logLevel: 'info',
};

const arg = process.argv[2];
mkdirSync('dist', { recursive: true });
if (arg === '--watch') {
  const ctx = await esbuild.context({ ...options, outfile: OUT });
  await ctx.watch();
  console.log('watching src/ …');
} else if (arg === '--check') {
  const res = await esbuild.build({ ...options, write: false, outfile: OUT, logLevel: 'silent' });
  const fresh = res.outputFiles[0].text;
  let current = '';
  try { current = readFileSync(OUT, 'utf8'); } catch (_) { /* missing */ }
  if (fresh !== current) {
    console.error(`${OUT} is out of date. Run "pnpm build" and commit the result.`);
    process.exit(1);
  }
  console.log(`${OUT} is up to date.`);
} else {
  await esbuild.build({ ...options, outfile: OUT });
}
