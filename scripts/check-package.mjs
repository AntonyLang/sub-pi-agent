import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.env.npm_execpath, 'Run this check through npm run check:package');
const packed = spawnSync(process.execPath, [process.env.npm_execpath,'pack','--dry-run','--json','--ignore-scripts'],
  { cwd: root, encoding: 'utf8' });
assert.equal(packed.status, 0, packed.stderr);
const [{ files }] = JSON.parse(packed.stdout);
assert.ok(files.some(f => f.path === 'bin/cli.js'));
assert.ok(files.some(f => f.path === 'bin/server/index.js'));
assert.ok(files.some(f => f.path === 'LICENSE'));
for (const { path: relative } of files) {
  assert.match(relative, /^(package\.json|README\.md|LICENSE|bin\/cli\.js|bin\/server\/[^/]+\.(js|d\.ts)|examples\/[^/]+)$/);
  const text = readFileSync(path.join(root, relative), 'utf8');
  assert.doesNotMatch(text, /C:[\\/]Users[\\/]|E:[\\/]Antony[\\/]|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{30,}/);
}
const pkg = JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
assert.equal(pkg.bin[pkg.name], 'bin/cli.js');
assert.equal(pkg.publishConfig.access, 'public');
console.log(`Package verified: ${files.length} files; no runtime data, personal paths or token-shaped secrets.`);
