# dsh-compaction-settings

A Deepseek Harness plugin that puts the context-compaction policy in the Settings
panel, so you can change it without editing YAML — and without restarting.

Out of the box, compaction keeps **65 536** tokens of headroom free below the
context window. On a large cloud model that is invisible; on a small-context
model — a local LLM, say — it is a large slice of the whole window, and
compaction fires long before the window is anywhere near full. This plugin ships
`headroomTokens: 8192` and exposes all five policy fields in
**Settings ▸ Compaction**, live at the next step boundary.

## What it changes

| Field | Control | Default | Meaning |
| --- | --- | --- | --- |
| `auto` | toggle | `true` | Automatic compaction on/off. Off leaves `/compact` as the only path. |
| `thresholdRatio` | number 0–1 | `0.8` | Window fraction that triggers compaction. |
| `headroomTokens` | integer ≥ 0 | `8192` | Headroom kept free on top of the reserved output. |
| `retainRatio` | number 0.01–0.99 | `0.16` | Share of the message budget kept after a compaction. |
| `maxTokens` | integer ≥ 1 | `8192` | Output cap for the summary the model writes. |

`retainRatio` defaults to the engine's own ratio, so enabling this plugin never
changes retention by surprise.

Worked example, on a 131 072-token model that reserves 8 192 for output: with
the default headroom the trigger becomes
`min(131072 × 0.8, 131072 − 8192 − 65536) = 57344` instead of `104857` —
compaction fires more than a third of the window early. This plugin ships
`headroomTokens: 8192`, which lifts that trigger to `104857`.

## Effective numbers (read-only)

The page header shows the two numbers the engine reads from the routed model,
taken from the `runtime-discovery` snapshot:

| Row | Symbol | Meaning |
| --- | --- | --- |
| Context window | **W** | effective context of the routed model |
| Output tokens | **O** | absolute output reservation resolved from your output policy |

O is shown as the absolute number Runtime discovery wrote to the adapter —
whether your policy is ratio or absolute mode — so this page and Runtime
discovery can never disagree. The default model leads; other discovered models
are listed beneath it. A rescan updates the rows without a reload. Without `runtime-discovery` the
rows show `—` and everything else works unchanged.

Symbols on the page: **W** context window, **O** output tokens, **T** threshold
ratio, **B** headroom tokens, **R** retain ratio. Below the form a live preview
recomputes, from the draft values:

```
Compaction trigger        = floor(min(W × T, W − O − B))
Retained after compaction = floor((W − O) × R)
```

## When a change takes effect

The write lands on every reachable engine immediately. What differs is when the
engine next consults each value:

| Field | Mid-session | New session |
| --- | --- | --- |
| `thresholdRatio` | next step boundary | applied at activation |
| `headroomTokens` | next step boundary | applied at activation |
| `retainRatio` | next step boundary | applied at activation |
| `maxTokens` | next summarization | applied at activation |
| `auto` | next step boundary | applied at activation |

The pressure check runs on `agent/pre-step`, so a change made while a step is in
flight is picked up at the next boundary, and a change made while the agent is
idle waits for the next message. `maxTokens` only matters when a compaction
actually summarizes, so changing it far from the threshold shows nothing at all.
`auto` is the one field the engine itself reads only once, in its constructor; it
stays live at every boundary only because the instance gate described under
**How it works** consults the current value at each call.

## Constraints the engine enforces

The engine computes, for the routed model (**W** = context window, **O** =
reserved output, **T** = `thresholdRatio`, **B** = `headroomTokens`, **R** =
`retainRatio`):

```
messageBudget = W − O
retainTokens  = floor(messageBudget × R)
threshold     = floor(min(W × T, messageBudget − B))
```

and refuses a policy that cannot be satisfied:

- `retainRatio` must stay below `thresholdRatio`. The Settings page blocks the
  save; the Host also drops the field and logs, so the rest still applies.
- `headroomTokens` must leave the threshold above `retainTokens`. On the model
  above, at the default ratios, that means below **103 220**.
- `headroomTokens` must leave a positive pressure budget — below **122 880**
  above.

The Settings page mirrors **all three** constraints: it blocks the ratio pair
always, and — once Runtime Discovery has supplied W and O — it also blocks a
headroom that would drive the previewed trigger to zero or below the retained
amount. So a config the engine would "warn once per target, then compact nothing"
cannot be saved from the page. The Host keeps the ratio-pair guard as a backstop
for hand-edited profile patches; the two headroom guards live only on the page,
since only Runtime Discovery knows W and O. Keep `headroomTokens` well under the
message budget and `retainRatio` well under `thresholdRatio`.

## Why it needs a plugin

The agent preset mounts its own `compaction-basic` row inside a group declared
`isolate: { compaction: true }`, and the profile-level `compaction-basic` row is
disabled (`enabled: false`). So a `compaction-basic:` override in
`cordis.patch.yml` does not reach an agent — the preset's own row wins, and it
carries no config. There is no patch layer that can express "the compaction policy
for whichever preset is active".

This plugin owns the five values instead and pushes them onto the engine each agent
actually resolved, through `agentPresets.serviceFor(agent, 'compaction')`.

## How it works

- `cordis.patch.yml` inserts the `compaction-settings` profile row with the defaults.
- `index.js` declares the five fields as `.volatile()`. The Loader commits a write
  into the running references and emits `loader/volatile-update`, so the plugin is
  never remounted. On activation, on that event, on `agent/created` and on
  `agent/status`, it installs the values on every reachable engine;
  `agent/disposed` drops a finished agent's engine from the restore bookkeeping.
- The engine's resolved config is `deepFreeze`d, so it is **replaced**, never
  mutated in place — mutating it throws, and the engine re-reads `this.config` on
  each pressure check, which is what makes a replaced object live at the next step.
  The replacement is frozen as well, so the engine's immutability guarantee survives
  being tuned.
- `auto` is read once, in the engine constructor, so a config write alone could
  never turn automatic compaction off for a running session. The engine's own
  listeners call `this.compactIfNeeded(...)` dynamically — the source documents
  that as the override seam — so the plugin installs an instance gate that returns
  the engine's own "nothing summarized" result while `auto` is false. Manual
  `/compact` does not route through that method and stays available.
- Disabling the plugin restores each engine's original config and removes the gate,
  so it stops influencing behavior.
- Every apply that changes state writes `.runtime/apply-report.json` beside the
  module (relocate with `DSH_CS_REPORT`). Plugin log output is not visible in the
  terminal that starts Deepseek Harness, so without it there is no way to tell "no
  engines found" from "values never landed" from "working". An apply that changes
  nothing skips the write, so the per-session retry pass does no needless I/O.
- `client.js` registers a **Settings ▸ Compaction** page. It reads and writes this
  entry through `ctx.remote.settings` — the same wire the shipped settings pages
  use — so the write is schema-validated, revision-checked, and persisted into the
  profile's `cordis.patch.yml`. The same `describe()` call also carries the
  `runtime-discovery` and `agent-default-model` entries, which the page renders as
  the read-only W/O header rows and the live Trigger/Retained preview.

## Files

```
package.json      bundle + client manifest
cordis.patch.yml  inserts the compaction-settings row with its defaults
index.js          Host half: volatile Config + the engine retune
lib/seams.js      the Deepseek Harness service/event names, in one module
client.js         Client half: the Settings page
locale/*.json     Plugin Manager display metadata
test/             host-half tests (node --test, no dependencies)
icon.svg          card icon
LICENSE           MIT
```

## Compatibility

Tested against Deepseek Harness **0.2.1-rc.2** (`@deepseek-ai/dsh`). The plugin
reaches into internal compaction seams, so a Deepseek Harness bump can move
them. It self-flags rather than failing silently: at activation it warns if the
running Deepseek Harness is outside the tested `0.2.x` line (when the version is
discoverable), and it warns if `compactIfNeeded` stops returning a promise.
These are warnings only — the plugin never blocks itself from loading. If you
see one, re-verify the seams in `lib/seams.js` and `index.js` against the
running Deepseek Harness before trusting live retuning.

## Tests

```
npm test
```

Runs `node --test test/*.test.js` — no dependencies. The suite drives the real
`apply()` against a fake engine and harness: the volatile read, the retain/
threshold guard, the config replace-and-freeze, the auto gate (no stacking,
restore), the restore-on-unmount, the reachable-but-zero error path, the report
throttle, and `agent/disposed` cleanup.

## Install

The package is not (yet) published to npm — install it from this repository.

### Prerequisites

- Node.js **>= 20.11** (`import.meta.dirname`).
- A running Deepseek Harness. The install step below links the profile's own
  `@deepseek-ai/schemastery` copy into the clone, so nothing extra has to be
  installed.

### Steps

Clone this repository wherever you keep local packages — the example below
uses `~/dsh-plugins/dsh-compaction-settings`:

```bash
git clone https://github.com/koda-ai42/dsh-compaction-settings.git ~/dsh-plugins/dsh-compaction-settings
```

The host half needs `@deepseek-ai/schemastery` for `z.…volatile()`. A bundle
installed by path is linked into the profile, and linked packages do not
resolve peer dependencies from the profile — so point Node at the profile's
own copy once:

```bash
cd ~/dsh-plugins/dsh-compaction-settings
mkdir -p node_modules/@deepseek-ai
ln -s ~/.dsh/profiles/web/node_modules/@deepseek-ai/schemastery node_modules/@deepseek-ai/schemastery
```

(Use your profile's directory in place of `web`.)

Then, from a running Deepseek Harness, install the bundle by that path. This
writes
the profile's `package.json` dependency and creates the symlink. Pass the
**absolute** path — the tool argument is not shell-expanded, so a leading `~`
would be taken literally:

```
plugin_manager  action: install_bundle  target: /home/you/dsh-plugins/dsh-compaction-settings
```

**A new bundle's host module is imported at boot.** The module-resolution
table is compiled when the profile starts, so a host module added to a
running Deepseek Harness reports `failed to import` until the next start.
Restart Deepseek Harness and the entry activates; the Settings page then appears
after a browser page refresh. Editing `index.js` of an already installed bundle
needs a restart too; editing `client.js` only needs the refresh.

## Verify

```
# entry present and enabled
plugin_manager  list_plugins

# the five volatile fields are exposed as a form
cordis_inspect_query  Config.listConfigs  { "name": "@koda-ai42/dsh-compaction-settings" }
```

Then open **Settings ▸ Compaction**, change a value, and press **Apply**. The Host
does not print plugin log lines to the terminal, so each apply writes a report
instead, at `.runtime/apply-report.json` beside this module:

```json
{
  "at": "2026-10-15T15:04:11.204Z",
  "trigger": "settings-write",
  "values": { "auto": true, "thresholdRatio": 0.8, "retainRatio": 0.16, "headroomTokens": 8192, "maxTokens": 8192 },
  "applied": 1,
  "reachable": 1,
  "engines": [
    { "origin": "root", "type": "BasicCompactionEngine", "gated": true, "accepted": true,
      "config": { "auto": true, "thresholdRatio": 0.8, "retainRatio": 0.16, "headroomTokens": 8192, "maxTokens": 8192 } }
  ]
}
```

`applied` must be at least 1. Each `engines[].config` is read back **from the engine
after the swap**, so it shows what the engine actually holds rather than what this
plugin intended — that distinction is what hid the original bug. `reachable: 0` means
no compaction engine was found at all. `trigger` names the path that ran it:
`activation`, `settings-write`, `agent-created`, or `agent-created-retry`.

When a threshold change actually triggers a compaction the engine logs:

```
compaction (step pressure): shadowed N surface nodes (seqs A-B, ~T tokens)
```

## Known limits

- The engine freezes its resolved config so nothing can edit what it holds. This
  plugin keeps that rule: the replacement it installs is frozen too, so no code —
  this plugin included — can mutate a live config. The one privilege it takes is
  **swapping** the whole object, and that cannot be removed without giving up live
  retuning. So the engine's `config` property stays writable by design; the guarantee
  is "the object you hold never changes", not "nobody can retune this engine".
- The `auto` gate and the config replacement both reach into another plugin's
  service instance. They use seams the engine documents, but they break if a future
  Deepseek Harness renames `compactIfNeeded`, stops dispatching through `this`, or
  makes the config property read-only. The plugin now self-flags the two it can
  detect (a non-promise from `compactIfNeeded`, a Deepseek Harness outside the
  tested line) rather than no-op'ing silently, but it cannot detect every possible
  seam change.
- With `auto: false`, overflow recovery is off too — matching a fresh engine built
  with `auto: false`. A full window then surfaces the provider's context-exceeded
  error and you recover with `/compact`.
- Values live in this plugin's own config, not under `compaction-basic:` in the
  profile patch. `dsh --dump-config` therefore shows them under
  `compaction-settings`.
