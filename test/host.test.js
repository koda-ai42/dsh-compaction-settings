import assert from 'node:assert/strict';
import { unlinkSync } from 'node:fs';
import test from 'node:test';

import { apply, Config } from '../index.js';
import { FakeEngine, RefusingEngine, SyncEngine, isolateReport, logged, makeConfig, makeHarness, readReport } from './fixtures.js';

/**
 * The Host half, driven end to end against a stand-in harness.
 *
 * These tests exercise the real `apply()`: the volatile read, the retain/
 * threshold guard, the config replacement, the auto gate, the restore on
 * unmount, and the apply report. Only the harness is faked, and it is faked to
 * the shape the real one has — prototype `compactIfNeeded`, frozen resolved
 * config, volatile refs read through `.get()`.
 */

test('activation applies the policy to the root engine and records the report', (t) => {
  const report = isolateReport(t);
  const root = new FakeEngine();
  const before = root.config;
  const { ctx, cleanups } = makeHarness({ root });
  const { config } = makeConfig({ thresholdRatio: 0.7, headroomTokens: 4096 });
  apply(ctx, config);

  assert.notEqual(root.config, before, 'the config must be replaced, never mutated');
  assert.ok(Object.isFrozen(root.config), 'the replacement must stay frozen');
  assert.equal(root.config.thresholdRatio, 0.7);
  assert.equal(root.config.headroomTokens, 4096);
  assert.equal(root.config.retainRatio, 0.16);
  assert.deepEqual(root.config.modelPolicies, [], 'unrelated keys survive');
  // The original object is untouched: still the engine's own frozen original.
  assert.equal(before.thresholdRatio, 0.8);

  const written = readReport(report);
  assert.ok(written, 'the apply report must exist');
  assert.equal(written.trigger, 'activation');
  assert.equal(written.applied, 1);
  assert.equal(written.reachable, 1);
  assert.equal(written.engines[0].origin, 'root');
  assert.equal(written.engines[0].config.thresholdRatio, 0.7);
  cleanups.forEach((cleanup) => cleanup());
});

test('retainRatio at or above thresholdRatio is dropped; the rest still lands', (t) => {
  isolateReport(t);
  const root = new FakeEngine();
  const { ctx, logs, cleanups } = makeHarness({ root });
  const { config } = makeConfig({ thresholdRatio: 0.8, retainRatio: 0.9, headroomTokens: 1234 });
  apply(ctx, config);

  assert.equal(root.config.retainRatio, 0.16, 'the offending field must not be pushed');
  assert.equal(root.config.thresholdRatio, 0.8);
  assert.equal(root.config.headroomTokens, 1234, 'the rest of the override still lands');
  assert.ok(logged(logs, 'warn', 'retainRatio'), 'the drop must be logged');
  cleanups.forEach((cleanup) => cleanup());
});

test('the original config is captured once and restored on unmount', (t) => {
  isolateReport(t);
  const root = new FakeEngine();
  const first = root.config;
  const { ctx, handlers, cleanups } = makeHarness({ root });
  const { config, values } = makeConfig();
  apply(ctx, config);

  // A second apply replaces again; the restore point must stay the first one.
  values.thresholdRatio = 0.5;
  handlers['loader/volatile-update']?.([]);
  assert.notEqual(root.config, first);
  assert.equal(root.config.thresholdRatio, 0.5);

  cleanups.forEach((cleanup) => cleanup());
  assert.equal(root.config, first, 'unmount must put the very original back');
});

test('the auto gate never stacks and honors the live auto value', async (t) => {
  isolateReport(t);
  const root = new FakeEngine();
  const { ctx, handlers, cleanups } = makeHarness({ root });
  const { config, values } = makeConfig({ auto: false });
  apply(ctx, config);
  handlers['loader/volatile-update']?.([]);

  assert.ok(
    Object.prototype.hasOwnProperty.call(root, 'compactIfNeeded'),
    'a gate must be installed as an own property',
  );
  assert.equal(await root.compactIfNeeded({}, 'pressure', undefined), null, 'auto:false gates to null');
  assert.equal(root.calls.length, 0, 'the original must not run while gated');

  // Flip auto back on through a settings write; the gate must pass through.
  values.auto = true;
  handlers['loader/volatile-update']?.([]);
  const result = await root.compactIfNeeded({}, 'pressure', undefined);
  assert.deepEqual(result, { summary: 'summarized' });
  assert.equal(root.calls.length, 1, 'one call reaches the original, even after two applies');

  cleanups.forEach((cleanup) => cleanup());
  assert.ok(
    !Object.prototype.hasOwnProperty.call(root, 'compactIfNeeded'),
    'unmount must remove the gate',
  );
  assert.equal(root.compactIfNeeded, FakeEngine.prototype.compactIfNeeded);
});

test('unmount restores every engine and removes every gate', (t) => {
  isolateReport(t);
  const root = new FakeEngine();
  const scoped = new FakeEngine();
  const agents = [{ id: 'a1', engine: scoped }];
  const { ctx, cleanups } = makeHarness({ root, agents });
  const { config } = makeConfig();
  const rootBefore = root.config;
  const scopedBefore = scoped.config;
  apply(ctx, config);

  assert.equal(readReport(process.env.DSH_CS_REPORT).applied, 2);
  cleanups.forEach((cleanup) => cleanup());
  assert.equal(root.config, rootBefore);
  assert.equal(scoped.config, scopedBefore);
  assert.ok(!Object.prototype.hasOwnProperty.call(root, 'compactIfNeeded'));
  assert.ok(!Object.prototype.hasOwnProperty.call(scoped, 'compactIfNeeded'));
});

test('an engine that refuses the override is an error, not an empty success', (t) => {
  const report = isolateReport(t);
  const root = new RefusingEngine();
  const { ctx, logs, cleanups } = makeHarness({ root });
  const { config } = makeConfig();
  apply(ctx, config);

  assert.ok(logged(logs, 'error', 'refused the override'), 'the refusal must be logged');
  assert.ok(logged(logs, 'error', 'none accepted'), 'reachable-but-zero must be an error');
  const written = readReport(report);
  assert.equal(written.applied, 0);
  assert.equal(written.reachable, 1);
  assert.equal(written.engines[0].accepted, false);
  cleanups.forEach((cleanup) => cleanup());
});

test('non-tunable engines are skipped', (t) => {
  isolateReport(t);
  const { ctx, logs, cleanups } = makeHarness({ root: { config: { thresholdRatio: 0.8 } } });
  const { config } = makeConfig();
  apply(ctx, config);
  assert.ok(logged(logs, 'error', 'none accepted'), 'a non-tunable root is a failure');
  cleanups.forEach((cleanup) => cleanup());

  const noConfig = { compactIfNeeded: async () => null };
  const second = makeHarness({ root: noConfig });
  apply(second.ctx, makeConfig().config);
  assert.ok(logged(second.logs, 'error', 'none accepted'));
  second.cleanups.forEach((cleanup) => cleanup());
});

test('agent preset engines are retuned through agentPresets', (t) => {
  const report = isolateReport(t);
  const root = new FakeEngine();
  const scoped = new FakeEngine();
  const { ctx, cleanups } = makeHarness({ root, agents: [{ id: 'a1', engine: scoped }] });
  const { config } = makeConfig({ headroomTokens: 2048 });
  apply(ctx, config);

  assert.equal(scoped.config.headroomTokens, 2048, 'the preset engine gets the override');
  const origins = readReport(report).engines.map((engine) => engine.origin);
  assert.deepEqual(origins, ['root', 'agent:a1']);
  cleanups.forEach((cleanup) => cleanup());
});

test('agent/status retunes that agent’s engine', (t) => {
  isolateReport(t);
  const root = new FakeEngine();
  const { ctx, handlers, agentEngines, cleanups } = makeHarness({ root });
  const { config } = makeConfig({ maxTokens: 4242 });
  apply(ctx, config);

  // A session mounts its preset engine after activation; a status event retunes it.
  const late = new FakeEngine();
  agentEngines.set('late', late);
  handlers['agent/status']?.({ agent: { id: 'late' } });
  assert.equal(late.config.maxTokens, 4242);
  cleanups.forEach((cleanup) => cleanup());
});

test('the report is only rewritten when the apply state changes', (t) => {
  const report = isolateReport(t);
  const root = new FakeEngine();
  const { ctx, handlers, cleanups } = makeHarness({ root });
  const { config, values } = makeConfig();
  apply(ctx, config);
  assert.ok(readReport(report), 'activation writes the report');

  // Remove it, then fire a no-op re-apply: identical state must not rewrite.
  unlinkSync(report);
  handlers['loader/volatile-update']?.([]);
  assert.equal(readReport(report), null, 'an unchanged apply must not rewrite the report');

  // A real change writes through again.
  values.headroomTokens = 1024;
  handlers['loader/volatile-update']?.([]);
  const second = readReport(report);
  assert.ok(second, 'a changed apply must rewrite the report');
  assert.equal(second.engines[0].config.headroomTokens, 1024);
  cleanups.forEach((cleanup) => cleanup());
});

test('agent/disposed drops the dead engine without disturbing the root restore', (t) => {
  isolateReport(t);
  const root = new FakeEngine();
  const scoped = new FakeEngine();
  const rootBefore = root.config;
  const { ctx, handlers, cleanups } = makeHarness({ root, agents: [{ id: 'a1', engine: scoped }] });
  const { config } = makeConfig();
  apply(ctx, config);
  assert.equal(scoped.config.headroomTokens, 8192);

  // Disposing the agent drops its engine from the restore map; unmount then
  // still restores the root cleanly and throws nothing.
  handlers['agent/disposed']?.({ agent: { id: 'a1' } });
  cleanups.forEach((cleanup) => cleanup());
  assert.equal(root.config, rootBefore, 'the root engine is still restored on unmount');
});

test('a non-promise from the engine seam is flagged once, result still passes through', async (t) => {
  isolateReport(t);
  const root = new SyncEngine();
  const { ctx, logs, cleanups } = makeHarness({ root });
  const { config } = makeConfig({ auto: true });
  apply(ctx, config);

  const result = await root.compactIfNeeded({}, 'pressure', undefined);
  assert.deepEqual(result, { summary: 'sync' }, 'the original result still passes through');
  assert.ok(logged(logs, 'warn', 'non-promise'), 'a seam that stopped returning a promise must self-flag');
  cleanups.forEach((cleanup) => cleanup());
});

test('the Config schema ships the documented defaults and bounds', () => {
  const unwrap = (ref) => (ref && typeof ref.get === 'function' ? ref.get() : ref);
  const built = Config({});
  assert.equal(unwrap(built.auto), true);
  assert.equal(unwrap(built.thresholdRatio), 0.8);
  assert.equal(unwrap(built.retainRatio), 0.16);
  assert.equal(unwrap(built.headroomTokens), 8192);
  assert.equal(unwrap(built.maxTokens), 8192);
  assert.throws(() => Config({ thresholdRatio: 1.5 }));
  assert.throws(() => Config({ retainRatio: 0 }));
  assert.throws(() => Config({ headroomTokens: -1 }));
  assert.throws(() => Config({ maxTokens: 0 }));
  assert.throws(() => Config({ headroomTokens: 1.5 }));
});
