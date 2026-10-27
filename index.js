/**
 * Host half of @koda-ai42/dsh-compaction-settings.
 *
 * The five fields below are the single source of truth for the override. They
 * are declared `.volatile()`, so the Loader commits a write into the running
 * references instead of remounting this plugin, and notifies us through
 * `loader/volatile-update`. We then push the values onto every compaction
 * engine that is reachable right now — the root one and the one each live agent
 * resolved from its own agent preset — so a change is in force on the very next
 * pressure check rather than after a restart.
 *
 * Two mechanics are load-bearing, and both were learned the hard way:
 *
 * 1. The engine's resolved config is `deepFreeze`d, so it must be *replaced*,
 *    never mutated in place. The engine re-reads `this.config` on every pressure
 *    check, so a replaced object takes effect at the next step boundary.
 * 2. `auto` is read once, in the engine constructor, which is why a plain config
 *    write could never turn automatic compaction off for a running session. The
 *    engine's own listeners call `this.compactIfNeeded(...)` dynamically — the
 *    source documents that as the override seam — so we install an instance gate
 *    that consults the live `auto` value at event time.
 *
 * Reading the effective numbers back: `dsh --dump-config`, or the Settings ▸
 * Compaction page, which reads this entry through the settings service.
 *
 * @module @koda-ai42/dsh-compaction-settings
 */
import z from '@deepseek-ai/schemastery';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { EVENTS, SERVICES } from './lib/seams.js';

/** Editable policy fields, each with the default the plugin ships. */
export const Config = z.object({
  /** Enable automatic compaction. `false` leaves compaction manual-only. */
  auto: z.boolean().default(true).volatile(),
  /** Window fraction for the pressure trigger; a value between 0 and 1. */
  thresholdRatio: z.number().min(0).max(1).default(0.8).volatile(),
  /**
   * Share of the message budget kept after compaction. Defaults to the engine's
   * own ratio so enabling this plugin never changes retention by surprise. Must
   * stay below `thresholdRatio`, which the engine also enforces.
   */
  retainRatio: z.number().min(0.01).max(0.99).default(0.16).volatile(),
  /** Pressure headroom kept free beyond the routed output reservation. */
  headroomTokens: z.number().step(1).min(0).default(8192).volatile(),
  /** Summary output cap. */
  maxTokens: z.number().step(1).min(1).default(8192).volatile(),
});

/**
 * Only `agents` is declared. The code also reads `agentPresets` and `compaction`
 * (see `engineFor`), but deliberately through lazy `ctx.get` with fallbacks
 * rather than `inject`: declaring a service that is absent at activation stops
 * the whole plugin from mounting, and these two are not guaranteed present in
 * every composition. The lazy read degrades to the root engine instead.
 */
export const inject = ['agents'];

/** Engine config keys this plugin owns, in log order. */
const POLICY_KEYS = ['auto', 'thresholdRatio', 'retainRatio', 'headroomTokens', 'maxTokens'];

/**
 * Where the apply report is written, beside this module.
 *
 * The Harness does not print plugin `logger.info` output to the terminal, so a log
 * line is not observable from outside the process — which is exactly how a silent
 * failure here stayed hidden. This file is readable from outside, so each apply
 * records what it actually reached: which engines were found, where each came
 * from, and the values read back out of the engine afterwards.
 *
 * `DSH_CS_REPORT` relocates it, which keeps the test suite out of the live
 * installation's runtime directory. Resolved per call so a test can redirect it.
 */
function reportPath() {
  return process.env.DSH_CS_REPORT || join(import.meta.dirname, '.runtime', 'apply-report.json');
}

/**
 * The harness major.minor line this plugin's seams were last verified against.
 * A bump outside it makes the guard below warn instead of silently no-op'ing.
 */
const TESTED_HARNESS_LINE = '0.2';

/**
 * Best-effort harness version, for the drift guard.
 *
 * The harness does not expose its version to plugins through the context, so
 * this reads the two places it can appear: an explicit `DSH_VERSION` the
 * launcher may set, or a resolvable `@deepseek-ai/dsh` manifest (true for a
 * flat npm install, not for the `link:`-installed dev layout). Returns null
 * when neither is available, and the guard stays silent rather than crying wolf.
 */
function harnessVersion() {
  if (process.env.DSH_VERSION) return process.env.DSH_VERSION;
  try {
    return createRequire(import.meta.url)('@deepseek-ai/dsh/package.json').version;
  } catch {
    return null;
  }
}

/** Read a volatile reference down to its value, tolerating a plain value. */
function unwrap(ref) {
  return ref && typeof ref.get === 'function' ? ref.get() : ref;
}

/** Whether `candidate` looks like a compaction engine we may retune. */
function isTunableEngine(candidate) {
  return (
    !!candidate &&
    typeof candidate.compactIfNeeded === 'function' &&
    !!candidate.config &&
    typeof candidate.config === 'object' &&
    typeof candidate.config.thresholdRatio === 'number'
  );
}

/**
 * Shadow `compactIfNeeded` with a gate that honors the live `auto` value.
 *
 * Returning `null` is the engine's own "nothing summarized" result, so both
 * automatic callers treat a gated call as a no-op: the step proceeds, and a
 * provider-reported overflow keeps its original error. That matches what a
 * freshly constructed engine with `auto: false` does, where neither listener was
 * registered at all. Manual `/compact` does not route through this method and
 * stays available.
 *
 * @param engine - compaction engine to gate.
 * @param onDrift - called once if the original's return shape is not a promise,
 *   so a harness bump that moves this seam self-flags instead of silently
 *   changing what the engine's listeners receive.
 * @returns whether a gate was installed, i.e. whether it must be removed later.
 */
function installAutoGate(engine, onDrift) {
  // An own property means a gate is already in place; never stack them.
  if (Object.prototype.hasOwnProperty.call(engine, 'compactIfNeeded')) return false;
  const original = engine.compactIfNeeded;
  let shapeChecked = false;
  engine.compactIfNeeded = function gatedCompactIfNeeded(agent, trigger, signal) {
    if (this.config.auto === false) return Promise.resolve(null);
    const result = original.call(this, agent, trigger, signal);
    // The gate's own contract is a promise (the gated path returns one), and the
    // engine's documented override seam is an async method. A non-thenable here
    // means the harness changed the seam; surface it once rather than let the
    // engine's listeners silently start receiving a different shape.
    if (!shapeChecked) {
      shapeChecked = true;
      if (onDrift && (!result || typeof result.then !== 'function')) onDrift(result);
    }
    return result;
  };
  return true;
}

/** Remove a gate installed by {@link installAutoGate}, if present. */
function removeAutoGate(engine) {
  if (Object.prototype.hasOwnProperty.call(engine, 'compactIfNeeded')) delete engine.compactIfNeeded;
}

export function apply(ctx, config) {
  /** The override values as plain data, read fresh from the live refs. */
  const readValues = () => {
    const values = {
      auto: unwrap(config.auto),
      thresholdRatio: unwrap(config.thresholdRatio),
      retainRatio: unwrap(config.retainRatio),
      headroomTokens: unwrap(config.headroomTokens),
      maxTokens: unwrap(config.maxTokens),
    };
    // The engine rejects retention at or above the trigger and would then warn
    // once per model target while compacting nothing. Drop the offending field so
    // the rest of the override still lands, and say so.
    if (
      typeof values.retainRatio === 'number' &&
      typeof values.thresholdRatio === 'number' &&
      values.retainRatio >= values.thresholdRatio
    ) {
      ctx.logger.warn(
        'compaction-settings: retainRatio (%s) must stay below thresholdRatio (%s); keeping the engine retain ratio',
        values.retainRatio,
        values.thresholdRatio,
      );
      delete values.retainRatio;
    }
    return values;
  };

  /** The compaction engine one agent actually resolves, else the root one. */
  const engineFor = (agent) => {
    const presets = ctx.get(SERVICES.agentPresets);
    const scoped = agent && presets ? presets.serviceFor(agent, SERVICES.compaction) : undefined;
    return scoped || ctx.get(SERVICES.compaction);
  };

  /** Pre-override state per engine, so unmounting can put things back. */
  const originals = new Map();

  /**
   * The engine each live agent resolves, by agent id. Lets `agent/disposed` drop
   * exactly that agent's `originals` entry without re-resolving (the preset is
   * already gone by then, which would fall back to the root engine).
   */
  const agentEngines = new Map();

  /** The last report's state, so an unchanged apply skips the sync write. */
  let lastReportState;

  /** Install the policy on one engine; report whether it took. */
  const applyTo = (engine, values) => {
    if (!isTunableEngine(engine)) return false;
    if (!originals.has(engine)) originals.set(engine, { config: engine.config, gated: false });
    const snapshot = originals.get(engine);
    // The resolved config is deep-frozen: mutating it throws, so build a new
    // object and hand the engine a fresh reference instead. Freeze it too, so the
    // engine keeps the guarantee it was built with — nothing may edit the config it
    // holds, this plugin included. The one privilege we take is swapping the whole
    // object, which is what makes live retuning possible. The freeze is shallow and
    // that suffices: the nested values came from the engine's own deep freeze.
    // Freeze only after the copy: freezing first makes the copy itself throw.
    const next = { ...engine.config };
    for (const key of POLICY_KEYS) {
      if (values[key] !== undefined) next[key] = values[key];
    }
    Object.freeze(next);
    try {
      engine.config = next;
    } catch (error) {
      originals.delete(engine);
      ctx.logger.error(
        'compaction-settings: a compaction engine refused the override: %s',
        error && error.message ? error.message : String(error),
      );
      return false;
    }
    if (installAutoGate(engine, (value) =>
      ctx.logger.warn(
        'compaction-settings: compactIfNeeded returned a non-promise (%s); the harness compaction seam may have changed — verify this plugin against the running harness',
        typeof value,
      ),
    )) {
      snapshot.gated = true;
    }
    return true;
  };

  /** Read the policy values back out of an engine, to prove the swap landed. */
  const readBack = (engine) => {
    const config = engine && engine.config ? engine.config : {};
    const out = {};
    for (const key of POLICY_KEYS) out[key] = config[key];
    return out;
  };

  /**
   * Persist the apply report, but only when the apply actually changed something.
   *
   * The report is written synchronously, and `agent-created` fires a second
   * microtask pass per new session; rewriting identical content on every session
   * would be needless sync I/O. The state fingerprint ignores the `at` timestamp
   * and the `trigger` label, so a no-op retry does not touch the disk while any
   * real change (values, which engines, what landed) still writes through. A
   * failure here must never break the apply.
   */
  const writeReport = (report) => {
    try {
      const { at: _at, trigger: _trigger, ...state } = report;
      const fingerprint = JSON.stringify(state);
      if (fingerprint === lastReportState) return;
      lastReportState = fingerprint;
      const path = reportPath();
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    } catch (error) {
      ctx.logger.warn(
        'compaction-settings: could not write the apply report: %s',
        error && error.message ? error.message : String(error),
      );
    }
  };

  /**
   * Retune every reachable engine once, then record what was actually reached.
   *
   * @param trigger - why this apply ran; recorded so a report can be attributed.
   */
  const applyEverywhere = (trigger) => {
    const values = readValues();
    const seen = new Set();
    const engines = [];
    let applied = 0;
    let failure;
    const consider = (engine, origin) => {
      if (!engine || seen.has(engine)) return;
      seen.add(engine);
      const accepted = applyTo(engine, values);
      if (accepted) applied += 1;
      engines.push({
        origin,
        type: engine.constructor && engine.constructor.name ? engine.constructor.name : typeof engine,
        gated: Object.prototype.hasOwnProperty.call(engine, 'compactIfNeeded'),
        accepted,
        config: readBack(engine),
      });
    };
    try {
      consider(ctx.get(SERVICES.compaction), 'root');
      for (const agent of ctx.agents.list()) {
        const engine = engineFor(agent);
        consider(engine, `agent:${agent.id ?? '?'}`);
        if (engine && agent && agent.id != null) agentEngines.set(agent.id, engine);
      }
    } catch (error) {
      failure = error && error.message ? error.message : String(error);
      ctx.logger.error('compaction-settings: applying the override failed', error);
    }
    writeReport({
      at: new Date().toISOString(),
      trigger,
      values,
      applied,
      reachable: seen.size,
      engines,
      ...(failure === undefined ? {} : { failure }),
    });
    ctx.logger.info(
      'compaction-settings: auto=%s thresholdRatio=%s retainRatio=%s headroomTokens=%s maxTokens=%s applied to %s of %s engine(s)',
      values.auto,
      values.thresholdRatio,
      values.retainRatio,
      values.headroomTokens,
      values.maxTokens,
      applied,
      seen.size,
    );
    // Reachable engines that all refused is a failure, not an empty success.
    if (seen.size > 0 && applied === 0) {
      ctx.logger.error(
        'compaction-settings: %s compaction engine(s) were reachable but none accepted the override',
        seen.size,
      );
    }
    return applied;
  };

  /**
   * Retune after a new agent mounts its preset's own engine, which happens after
   * this listener returns, so the pass is repeated once on the microtask queue.
   */
  const applyForNewAgent = () => {
    applyEverywhere('agent-created');
    Promise.resolve()
      .then(() => applyEverywhere('agent-created-retry'))
      .catch(() => {});
  };

  ctx.effect(() => {
    // Self-flag harness drift once, at activation: the seams this plugin pokes
    // are internal, so a silent no-op on a moved seam is the failure mode to
    // avoid. Warning only — never block, so a bump can never stop the plugin.
    const version = harnessVersion();
    if (version && !version.startsWith(`${TESTED_HARNESS_LINE}.`)) {
      ctx.logger.warn(
        'compaction-settings: tested against harness %s.x but running %s — the compaction seams may have moved; verify before trusting live retuning',
        TESTED_HARNESS_LINE,
        version,
      );
    }
    applyEverywhere('activation');
    return () => {
      // Disabling this plugin must stop influencing behavior.
      for (const [engine, snapshot] of originals) {
        try {
          engine.config = snapshot.config;
        } catch (error) {
          ctx.logger.warn(
            'compaction-settings: could not restore an engine config: %s',
            error && error.message ? error.message : String(error),
          );
        }
        if (snapshot.gated) removeAutoGate(engine);
      }
      originals.clear();
      agentEngines.clear();
    };
  }, 'compaction-settings: apply the override on activation');

  // A settings write lands here; the refs already hold the new values.
  ctx.on(EVENTS.volatileUpdate, () => {
    applyEverywhere('settings-write');
  });

  // New sessions mount their preset's own engine after this listener returns,
  // so each also retunes when it first starts running.
  ctx.on(EVENTS.agentCreated, () => {
    try {
      applyForNewAgent();
    } catch (error) {
      ctx.logger.warn('compaction-settings: agent/created apply failed', error);
    }
  });

  ctx.on(EVENTS.agentStatus, ({ agent }) => {
    try {
      applyTo(engineFor(agent), readValues());
    } catch {
      // A retune that fails leaves that agent on its configured defaults. The
      // activation and volatile-update paths log the same failure loudly.
    }
  });

  // A disposed agent's preset engine dies with it, so its `originals` entry is
  // now a dead reference. Drop it to keep the restore map from growing without
  // bound across a long-lived session. The root engine is never dropped, and an
  // engine still claimed by another live agent is kept so its restore survives.
  ctx.on(EVENTS.agentDisposed, ({ agent }) => {
    const id = agent && agent.id;
    if (id == null) return;
    const engine = agentEngines.get(id);
    agentEngines.delete(id);
    if (!engine || engine === ctx.get(SERVICES.compaction)) return;
    for (const other of agentEngines.values()) if (other === engine) return;
    originals.delete(engine);
  });
}
