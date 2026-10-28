// cosense exists but its getters throw until it finishes booting (real-world race)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEnv, sleep } from './helpers.js';

function lazyCosense(readyRef, { neverProject = false } = {}) {
  return () => {
    const nil = () => { if (!readyRef.ready) throw new TypeError("Cannot read properties of null (reading 'name')"); };
    return {
      get Layout() { return readyRef.ready ? 'page' : null; },
      Project: { get name() { if (neverProject) throw new TypeError('null project'); nil(); return 'proj'; } },
      Page: { get lines() { nil(); return [{ id: 'id0', text: 'テスト' }, { id: 'id1', text: '' }, { id: 'id2', text: 'hello world foo' }]; }, get title() { nil(); return 'テスト'; }, show() {} },
      on() {}, off() {},
    };
  };
}

test('waits until cosense state is readable (slow boot)', async () => {
  const ref = { ready: false };
  const env = makeEnv({ lines: ['テスト', '', 'hello world foo'], cosenseOverride: lazyCosense(ref) });
  env.eval();
  await sleep(600);
  assert.equal(env.vim, undefined, 'must not boot before cosense is ready');
  ref.ready = true;
  await sleep(400);
  assert.ok(env.vim?.active, 'booted after ready');
  assert.deepEqual(env.errors, []);
  env.close();
});

test('falls back to the URL when Project never resolves', { timeout: 20000 }, async () => {
  const ref = { ready: true };
  const env = makeEnv({ lines: ['テスト', '', 'x'], cosenseOverride: lazyCosense(ref, { neverProject: true }) });
  env.eval();
  await sleep(16000);
  assert.ok(env.vim?.active);
  assert.deepEqual(env.errors, []);
  env.close();
});
