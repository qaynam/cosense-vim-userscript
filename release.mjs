// pnpm release <patch|minor|major|x.y.z>
// Bumps package.json, rebuilds dist/, commits "vX.Y.Z" and tags it. Push with:
//   git push --follow-tags
// (npm version can't be used here: npm refuses to run because devEngines asks for pnpm.)
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
const out = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

const kind = process.argv[2];
if (!kind) { console.error('usage: pnpm release <patch|minor|major|x.y.z>'); process.exit(1); }
if (out('git', ['status', '--porcelain', '--untracked-files=no'])) {
  console.error('Working tree has uncommitted changes. Commit them first.'); process.exit(1);
}

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const [ma, mi, pa] = pkg.version.split('.').map(Number);
const next = /^\d+\.\d+\.\d+$/.test(kind) ? kind
  : kind === 'major' ? `${ma + 1}.0.0` : kind === 'minor' ? `${ma}.${mi + 1}.0` : kind === 'patch' ? `${ma}.${mi}.${pa + 1}` : null;
if (!next) { console.error(`unknown bump: ${kind}`); process.exit(1); }
const tag = 'v' + next;

if (!readFileSync('CHANGELOG.md', 'utf8').split('\n').some(l => l.startsWith('## ' + tag))) {
  console.error(`CHANGELOG.md has no "## ${tag}" section. Write the release notes first.`); process.exit(1);
}

pkg.version = next;
writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
sh('node', ['build.mjs']);
sh('git', ['add', 'package.json', 'dist']);
sh('git', ['commit', '-m', tag]);
sh('git', ['tag', tag]);
console.log(`\n${tag} committed and tagged. Push with: git push --follow-tags`);
