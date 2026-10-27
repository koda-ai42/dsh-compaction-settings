/**
 * The harness seams this plugin couples to, in one place.
 *
 * Every string the Host half reads off the live harness — the services it
 * resolves and the events it listens to — lives here, so a harness bump that
 * renames one of them is a single-file edit rather than a hunt through the
 * apply logic. The names were verified against the harness this plugin ships
 * with (see the compatibility note in README.md).
 *
 * @module @koda-ai42/dsh-compaction-settings/lib/seams
 */

/** Services resolved through `ctx.get(...)`. */
export const SERVICES = {
  /** The root compaction engine, and the fallback when a preset scopes none. */
  compaction: 'compaction',
  /** Resolves the compaction engine one agent actually runs. */
  agentPresets: 'agentPresets',
};

/** Events subscribed through `ctx.on(...)`. */
export const EVENTS = {
  /** A volatile config write landed; the refs already hold the new values. */
  volatileUpdate: 'loader/volatile-update',
  /** A new session mounted; its preset engine appears on the next microtask. */
  agentCreated: 'agent/created',
  /** An agent's status changed; retune the engine it resolves. */
  agentStatus: 'agent/status',
  /** An agent is gone; its preset-scoped engine dies with it. */
  agentDisposed: 'agent/disposed',
};
