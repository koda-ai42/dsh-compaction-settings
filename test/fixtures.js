import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Stand-ins for the harness halves this plugin touches.
 *
 * The shapes mirror the real ones on purpose: the engine is a class whose
 * `compactIfNeeded` lives on the prototype (the plugin's gate detection keys on
 * own properties, so a plain object with an own method would read as
 * "already gated"), and its resolved config is frozen the way the real
 * engine's deep freeze leaves it.
 */

/** A compaction engine shaped like the real one. */
export class FakeEngine {
  constructor(config = {}) {
    /** Every call that reached the original method, for gate assertions. */
    this.calls = [];
    this.config = Object.freeze({
      auto: true,
      thresholdRatio: 0.8,
      retainRatio: 0.16,
      headroomTokens: 65536,
      maxTokens: 65536,
      // An unrelated key: it must survive every override untouched.
      modelPolicies: [],
      ...config,
    });
  }

  async compactIfNeeded(agent, trigger, signal) {
    this.calls.push({ agent, trigger, signal });
    return { summary: 'summarized' };
  }
}

/** An engine whose `config` property refuses assignment, like a frozen slot. */
export class RefusingEngine extends FakeEngine {
  constructor(config = {}) {
    super(config);
    Object.defineProperty(this, 'config', { value: this.config, writable: false });
  }
}

/** An engine whose `compactIfNeeded` returns a plain value, not a promise. */
export class SyncEngine extends FakeEngine {
  compactIfNeeded(agent) {
    this.calls.push({ agent });
    return { summary: 'sync' };
  }
}

/**
 * Settings as the loader hands them over: one volatile ref per field, read
 * through `.get()`. Mutate `values` to simulate a settings write.
 */
export function makeConfig(overrides = {}) {
  const values = {
    auto: true,
    thresholdRatio: 0.8,
    retainRatio: 0.16,
    headroomTokens: 8192,
    maxTokens: 8192,
    ...overrides,
  };
  const config = {};
  for (const key of Object.keys(values)) {
    config[key] = { get: () => values[key] };
  }
  return { config, values };
}

/**
 * A minimal harness: `ctx` with logger/effect/on/get/agents, the two services
 * this plugin reads, and the event handlers it registers, so a test can fire
 * `loader/volatile-update`, `agent/created`, `agent/status` or `agent/disposed`
 * by hand.
 *
 * @param root - the root compaction engine (or any stand-in).
 * @param agents - `[{ id, engine }]`; the engine is what agentPresets resolves.
 * @param presets - when false, the `agentPresets` service is absent.
 */
export function makeHarness({ root, agents = [], presets = true } = {}) {
  const services = { compaction: root };
  const agentEngines = new Map(agents.map((agent) => [agent.id, agent.engine]));
  if (presets) {
    services.agentPresets = {
      serviceFor: (agent, name) => (name === 'compaction' ? agentEngines.get(agent && agent.id) : undefined),
    };
  }
  const logs = { info: [], warn: [], error: [] };
  const handlers = {};
  const cleanups = [];
  const ctx = {
    logger: {
      info: (...args) => logs.info.push(args),
      warn: (...args) => logs.warn.push(args),
      error: (...args) => logs.error.push(args),
    },
    effect: (fn) => {
      const cleanup = fn();
      if (typeof cleanup === 'function') cleanups.push(cleanup);
    },
    on: (name, handler) => {
      handlers[name] = handler;
    },
    get: (name) => services[name],
    agents: { list: () => agents.map((agent) => ({ id: agent.id })) },
  };
  return { ctx, handlers, cleanups, logs, services, agentEngines };
}

/** Redirect the apply report into a temp dir for the duration of a test. */
export function isolateReport(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cs-'));
  const path = join(dir, 'apply-report.json');
  const previous = process.env.DSH_CS_REPORT;
  process.env.DSH_CS_REPORT = path;
  t.after(() => {
    if (previous === undefined) delete process.env.DSH_CS_REPORT;
    else process.env.DSH_CS_REPORT = previous;
    rmSync(dir, { recursive: true, force: true });
  });
  return path;
}

/** Parse the report the last apply wrote, or null when there is none. */
export function readReport(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Whether any logged line matches, joined so %s templates resolve by hand. */
export function logged(logs, level, needle) {
  return logs[level].some((args) =>
    args.some((part) => String(part).includes(needle)),
  );
}
