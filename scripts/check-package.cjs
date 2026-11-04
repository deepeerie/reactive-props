'use strict';

// Test the actual tarball in an isolated consumer, not source-tree resolution.
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const consumer = mkdtempSync(path.join(tmpdir(), 'reactive-props-consumer-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (command, args, cwd = consumer) => execFileSync(command, args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  const [packed] = JSON.parse(run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', consumer], root));
  const files = packed.files.map(file => file.path);
  for (const expected of ['dist/index.js', 'dist/index.d.ts', 'LICENSE']) {
    assert.ok(files.includes(expected), `Missing package file: ${expected}`);
  }
  assert.ok(!files.some(file => file.startsWith('node_modules/')));
  writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(consumer, packed.filename)]);

  const common = `
    const state = new ReactiveWrapper({ user: { count: 1 }, items: [{ id: 1 }] });
    const values = [];
    state.user.count$.subscribe(value => values.push(value));
    state.user.count$.next(2);
    state.user.count = 3;
    state.items.push({ id: 2 });
    assert.deepEqual(values, [1, 2, 3]);
    assert.equal(state.user.count, 3);
    assert.equal(state.items.length, 2);
    assert.equal(reactive({ count: 1 }).count, 1);
    state.dispose();
  `;
  writeFileSync(path.join(consumer, 'consumer.cjs'), `
    const assert = require('node:assert/strict');
    const { reactive, ReactiveWrapper } = require('reactive-props');
    ${common}
  `);
  writeFileSync(path.join(consumer, 'consumer.mjs'), `
    import assert from 'node:assert/strict';
    import { reactive, ReactiveWrapper } from 'reactive-props';
    ${common}
  `);
  assert.equal(run(process.execPath, ['consumer.cjs']), '', 'CommonJS import produced output');
  assert.equal(run(process.execPath, ['consumer.mjs']), '', 'ESM import produced output');

  const typed = `
    import { reactive, ReactiveWrapper, type ReactiveWrapperType } from 'reactive-props';
    const state = new ReactiveWrapper({ user: { id: 1 }, items: [{ id: 1 }] });
    state.user.id$.next(2);
    state.user$.next({ id: 3 });
    state.items.push({ id: 2 });
    state.items[0].id$.next(3);
    state.updateData({ user: { id: 4 } });
    const other: ReactiveWrapperType<{ count: number }> = reactive({ count: 1 });
    other.count$.next(2);
    // @ts-expect-error The published declarations reject wrong types.
    state.user.id$.next('incorrect');
  `;
  writeFileSync(path.join(consumer, 'consumer.mts'), typed);
  writeFileSync(path.join(consumer, 'consumer.cts'), typed);
  writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { target: 'ES2020', module: 'Node16', moduleResolution: 'Node16', strict: true, noEmit: true },
    files: ['consumer.mts', 'consumer.cts'],
  }));
  run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json']);
  console.log('Package check passed: isolated install, CommonJS, ESM, and public TypeScript declarations.');
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
