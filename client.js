/* Browser half of @koda-ai42/dsh-compaction-settings.
 *
 * Registers one Settings page that reads and writes this plugin's own entry
 * through the settings service (`ctx.remote.settings`), the same wire the
 * shipped settings pages use: the Host validates the write, persists it into the
 * profile patch, and the Host half of this bundle retunes the live compaction
 * engine from it.
 */
window.__ModuleLoader__.load({
  id: '@koda-ai42/dsh-compaction-settings',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    // The very switch the General section's "Show coding view" row renders, so
    // this control is the host's rather than a copy of it. Shipped client
    // packages require this module without declaring it: it is part of the
    // client graph the harness already loads.
    const { Switch } = require('@deepseek-ai/dsh-client-ui-primitives');

    /** Locale namespace this plugin owns. */
    const L10N = 'compactionSettings';
    /** Profile entry id — the settings namespace this page edits. */
    const ENTRY_NS = 'compaction-settings';
    /** Entries this page reads the read-only effective numbers from. */
    const DISCOVERY_NS = 'runtime-discovery';
    const DEFAULT_MODEL_NS = 'agent-default-model';

    const DICTS = {
      en: {
        nav: 'Compaction',
        title: 'Context compaction',
        description:
          'Override how the conversation is condensed when the context fills up. Changes are saved to your profile and take effect on the next step — no restart.',
        'auto.label': 'Auto-compaction',
        'auto.hint': 'Turns automatic compaction on/off. Takes effect at the next step.',
        'thresholdRatio.label': 'Threshold ratio (T)',
        'thresholdRatio.hint': 'Fraction of the context window (W) that triggers compaction, between 0 and 1.',
        'retainRatio.label': 'Retain ratio (R)',
        'retainRatio.hint':
          'Share of the message budget (W − O) kept verbatim after a compaction. Must stay below the threshold ratio.',
        'headroomTokens.label': 'Headroom tokens (B)',
        'headroomTokens.hint':
          'Tokens kept free on top of the reserved output (O). The Deepseek Harness default of 65536 compacts small-context models early.',
        'maxTokens.label': 'Summary max tokens',
        'maxTokens.hint': 'Output cap for the summary the model writes.',
        'window.label': 'Context window (W)',
        'window.hint': 'Effective context of the routed model in tokens.',
        'output.label': 'Output tokens (O)',
        'output.hint': 'Resolved by Runtime Discovery from output policy.',
        'budgets.missing': 'No runtime data yet — run Runtime discovery to see the effective window and output.',
        'budgets.others': 'Other models',
        'preview.trigger': 'Compaction trigger',
        'preview.triggerFormula': 'floor(min(W × T, W − O − B)) in tokens',
        'preview.retained': 'Retained after compaction',
        'preview.retainedFormula': 'floor((W − O) × R) in tokens',
        apply: 'Apply',
        applyDisabled: 'Edit a value first',
        applying: 'Applying…',
        saved: 'Saved and applied.',
        reset: 'Restore defaults',
        loading: 'Loading…',
        missing: 'This plugin’s entry is not editable from this profile.',
        'invalid.empty': 'Enter a value.',
        'invalid.number': 'Enter a number.',
        'invalid.int': 'Enter a whole number.',
        'invalid.range': 'Value out of range.',
        'invalid.retainAbove': 'Must be below the threshold ratio.',
        'invalid.noBudget': 'Headroom leaves no room for messages; lower it.',
        'invalid.retainOverTrigger': 'Retention would reach the compaction trigger; lower the headroom or the retain ratio.',
        note: 'W and O are read from Runtime Discovery; T, B and R are set above.',
      },
      zh: {
        nav: '上下文压缩',
        title: '上下文压缩',
        description: '覆盖上下文写满时的压缩方式。修改会保存到配置文件，并在下一步立即生效，无需重启。',
        'auto.label': '自动压缩',
        'auto.hint': '开启或关闭自动压缩。下一步生效。',
        'thresholdRatio.label': '触发阈值比例 (T)',
        'thresholdRatio.hint': '触发压缩的上下文窗口 (W) 比例，取值 0 到 1。',
        'retainRatio.label': '保留比例 (R)',
        'retainRatio.hint': '压缩后原样保留的消息预算 (W − O) 份额，必须小于触发阈值比例。',
        'headroomTokens.label': '预留余量 token (B)',
        'headroomTokens.hint': '在输出预留 (O) 之外额外保留的空间。默认 65536 会让小上下文模型提前压缩。',
        'maxTokens.label': '摘要最大 token',
        'maxTokens.hint': '生成摘要时的输出上限。',
        'window.label': '上下文窗口 (W)',
        'window.hint': '当前路由模型的有效上下文（token）。',
        'output.label': '输出 token (O)',
        'output.hint': '由运行时探测按输出策略解析得出。',
        'budgets.missing': '暂无运行时数据 — 运行运行时探测后即可显示有效窗口与输出。',
        'budgets.others': '其他模型',
        'preview.trigger': '压缩触发点',
        'preview.triggerFormula': 'floor(min(W × T, W − O − B))，单位 token',
        'preview.retained': '压缩后保留',
        'preview.retainedFormula': 'floor((W − O) × R)，单位 token',
        apply: '应用',
        applyDisabled: '先修改数值',
        applying: '应用中…',
        saved: '已保存并生效。',
        reset: '恢复默认',
        loading: '加载中…',
        missing: '当前配置文件中无法编辑该插件条目。',
        'invalid.empty': '请输入数值。',
        'invalid.number': '请输入数字。',
        'invalid.int': '请输入整数。',
        'invalid.range': '数值超出范围。',
        'invalid.retainAbove': '必须小于触发阈值比例。',
        'invalid.noBudget': '预留余量过大，消息预算已无空间，请调小。',
        'invalid.retainOverTrigger': '保留量已达到压缩触发点，请调小预留余量或保留比例。',
        note: 'W 与 O 来自运行时探测；T、B 与 R 在上方设置。',
      },
    };

    /** The editable fields and their validation bounds. */
    const FIELDS = [
      { key: 'auto', kind: 'toggle', fallback: true },
      { key: 'thresholdRatio', kind: 'number', min: 0, max: 1, step: 0.01, mode: 'decimal', fallback: 0.8 },
      { key: 'headroomTokens', kind: 'number', min: 0, max: 100000000, step: 1, int: true, mode: 'numeric', fallback: 8192 },
      { key: 'retainRatio', kind: 'number', min: 0.01, max: 0.99, step: 0.01, mode: 'decimal', fallback: 0.16 },
      { key: 'maxTokens', kind: 'number', min: 1, max: 100000000, step: 1, int: true, mode: 'numeric', fallback: 8192 },
    ];

    /** Parse and validate one draft field against its schema bounds. */
    function parseField(field, raw) {
      if (field.kind === 'toggle') return { ok: true, value: !!raw };
      const text = String(raw ?? '').trim();
      if (!text) return { ok: false, message: 'invalid.empty' };
      const num = Number(text);
      if (!Number.isFinite(num)) return { ok: false, message: 'invalid.number' };
      if (field.int && !Number.isInteger(num)) return { ok: false, message: 'invalid.int' };
      if (num < field.min || num > field.max) return { ok: false, message: 'invalid.range' };
      return { ok: true, value: num };
    }

    /** Draft form values, held as strings for the numeric inputs. */
    function draftFrom(value) {
      const source = value && typeof value === 'object' ? value : {};
      const draft = {};
      for (const field of FIELDS) {
        const current = source[field.key];
        draft[field.key] = field.kind === 'toggle' ? !!current : String(current ?? field.fallback);
      }
      return draft;
    }

    /** Find one settings row by entry id, tolerating a namespaced ns. */
    function findRow(rows, ns) {
      return rows.find((item) => item.ns === ns || String(item.ns).endsWith(':' + ns));
    }

    /**
     * Pull the effective W (context) and O (output) out of the runtime-discovery
     * snapshot.
     *
     * The snapshot records already hold the numbers the Host wrote into the
     * adapter — effective context, and the output resolved to an absolute token
     * count from the user's policy — so this page displays them rather than
     * recomputing from the ratio. The two pages therefore can never disagree.
     * The default model's record leads; the rest form the breakdown.
     */
    function extractBudgets(discoveryValue, defaultModelValue) {
      const records = (Array.isArray(discoveryValue?.discovery?.models) ? discoveryValue.discovery.models : [])
        .filter((record) => record && Number.isSafeInteger(record.context) && Number.isSafeInteger(record.output));
      const wanted = defaultModelValue && defaultModelValue.model;
      const primary = records.find((record) => record.modelId === wanted) || records[0] || null;
      return { primary, others: primary ? records.filter((record) => record !== primary) : [] };
    }

    /**
     * The engine's two budgets for W/O combined with the current draft values.
     *
     * Mirrors `resolveCompactSpec`: the trigger is the lower of the window
     * fraction and the message budget minus headroom; retention scales the
     * message budget by R. Returns null when W/O are unknown or a draft field
     * is mid-edit, so the preview never shows a number built from half a form.
     */
    function computePreview(budgets, parsed) {
      const w = budgets && budgets.primary ? budgets.primary.context : null;
      const o = budgets && budgets.primary ? budgets.primary.output : null;
      if (!Number.isSafeInteger(w) || !Number.isSafeInteger(o)) return null;
      const { thresholdRatio, headroomTokens, retainRatio } = parsed;
      if (
        typeof thresholdRatio !== 'number' ||
        typeof headroomTokens !== 'number' ||
        typeof retainRatio !== 'number'
     ) {
        return null;
      }
      const messageBudget = w - o;
      return {
        trigger: Math.floor(Math.min(w * thresholdRatio, messageBudget - headroomTokens)),
        retained: Math.floor(messageBudget * retainRatio),
      };
    }

    /** Token count with thousands separators; an unknown count shows as an em dash. */
    function fmtTokens(value) {
      return Number.isSafeInteger(value) ? String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '—';
    }

    // The Models section's primary/secondary button rules, copied so the Apply
    // here is the same control the rest of Settings uses: same fill, radius,
    // height, hover, focus ring and 40%-faded disabled state, all driven by the
    // theme's own tokens. Rendered as a component-local <style> so the pseudo
    // classes work and the rules leave with the page.
    const CSS = `
      .dshcs-btn{box-sizing:border-box;border-radius:var(--dsw-radius-md);height:36px;font:inherit;cursor:pointer;border:none;justify-content:center;align-items:center;gap:4px;padding:0 14px;font-size:14px;line-height:22px;display:inline-flex}
      .dshcs-btn:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline:none}
      .dshcs-btn:disabled{opacity:.4;cursor:default}
      .dshcs-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
      .dshcs-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
      .dshcs-secondary{border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary);background:transparent}
      .dshcs-secondary:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid)}
    `;

    const styles = {
      page: { maxWidth: 620, padding: '4px 2px 32px', color: 'var(--dsw-alias-label-primary)' },
      title: { margin: '0 0 6px', fontSize: 17, fontWeight: 600 },
      description: { margin: '0 0 20px', fontSize: 13, lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)' },
      card: {
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: 10,
        padding: '4px 16px',
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 20,
        padding: '14px 0',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      // The first row sits directly under the card's own border; a second line
      // there reads as a stray rule, so only later rows are divided.
      rowFirst: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 20,
        padding: '14px 0',
      },
      rowText: { minWidth: 0 },
      label: { fontSize: 13.5, fontWeight: 500 },
      hint: { marginTop: 3, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
      input: {
        appearance: 'none',
        WebkitAppearance: 'none',
        MozAppearance: 'none',
        fontFamily: 'inherit',
        width: 120,
        padding: '6px 9px',
        fontSize: 13,
        color: 'var(--dsw-alias-label-primary)',
        background: 'var(--dsw-alias-bg-base)',
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: 6,
        outline: 'none',
        fontVariantNumeric: 'tabular-nums',
      },
      inputBad: { borderColor: 'var(--dsw-alias-state-error-primary)' },
      // A read-only effective number: same tabular figures as an input, but no
      // box, so it reads as data the page reports rather than a field to edit.
      // The nowrap keeps the token count on the label's own row.
      readonly: { fontSize: 13.5, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', color: 'var(--dsw-alias-label-secondary)' },
      breakdown: {
        marginTop: 3,
        fontSize: 11.5,
        lineHeight: 1.6,
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
        color: 'var(--dsw-alias-label-secondary)',
      },
      foot: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, minHeight: 40 },
      status: { fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' },
      statusBad: { color: 'var(--dsw-alias-state-error-primary)' },
      statusGood: { color: 'var(--dsw-alias-state-success-primary)' },
      note: { marginTop: 14, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
    };

    return {
      inject: ['slots', 'locale', 'remote', 'remote.settings'],
      apply(ctx) {
        const t = ctx.locale.bind(L10N);

        ctx.effect(() => ctx.locale.register(L10N, DICTS), 'compaction-settings: dictionaries');

        function CompactionSection() {
          const [server, setServer] = React.useState(null);
          const [ns, setNs] = React.useState(ENTRY_NS);
          const [revision, setRevision] = React.useState(0);
          const [draft, setDraft] = React.useState(null);
          // The read-only effective numbers: { primary, others } from the
          // runtime-discovery snapshot, or null before the first describe.
          const [budgets, setBudgets] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const [status, setStatus] = React.useState({ kind: 'loading' });

          const load = React.useCallback(async () => {
            try {
              const response = await ctx.remote.settings.describe();
              if (!response || response.ok === false) {
                setStatus({ kind: 'error', text: response?.error?.message || t('missing') });
                return;
              }
              const rows = (response.value && response.value.namespaces) || [];
              const row = rows.find((item) => item.ns === ENTRY_NS || String(item.ns).endsWith(':' + ENTRY_NS));
              if (!row) {
                setStatus({ kind: 'error', text: t('missing') });
                return;
              }
              setServer(row.value && typeof row.value === 'object' ? row.value : {});
              setNs(row.ns);
              setRevision(row.revision);
              setDraft(draftFrom(row.value));
              setBudgets(
                extractBudgets(findRow(rows, DISCOVERY_NS)?.value, findRow(rows, DEFAULT_MODEL_NS)?.value),
              );
              setStatus({ kind: 'idle' });
            } catch (error) {
              setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
            }
          }, []);

          // A runtime-discovery rescan rewrites its snapshot; refresh only the
          // read-only numbers so an in-flight draft is never clobbered.
          const refreshBudgets = React.useCallback(async () => {
            try {
              const response = await ctx.remote.settings.describe();
              const rows = (response && response.value && response.value.namespaces) || [];
              setBudgets(
                extractBudgets(findRow(rows, DISCOVERY_NS)?.value, findRow(rows, DEFAULT_MODEL_NS)?.value),
              );
            } catch {
              // The preview simply keeps the last known numbers.
            }
          }, []);

          React.useEffect(() => {
            load();
            let off;
            try {
              off = ctx.remote.$on('settings/document-updated', (ns) => {
                const s = String(ns);
                if (s === ENTRY_NS || s.endsWith(':' + ENTRY_NS)) load();
                else if (
                  s === DISCOVERY_NS || s.endsWith(':' + DISCOVERY_NS) ||
                  s === DEFAULT_MODEL_NS || s.endsWith(':' + DEFAULT_MODEL_NS)
                ) refreshBudgets();
              });
            } catch {
              off = undefined;
            }
            return () => {
              if (typeof off === 'function') off();
            };
          }, [load, refreshBudgets]);

          // Validation of the whole draft, plus the pending change set.
          const parsed = {};
          const errors = {};
          const ops = [];
          // The two engine budgets from W/O plus the draft values; null while a
          // draft field is mid-edit or runtime data is missing.
          let preview = null;
          if (draft) {
            for (const field of FIELDS) {
              const result = parseField(field, draft[field.key]);
              if (!result.ok) errors[field.key] = t(result.message);
              else parsed[field.key] = result.value;
            }
            // The engine rejects retention at or above the trigger, and then warns
            // once per model target while compacting nothing. Refuse the pair here
            // so a draft that would silently disable compaction cannot be saved.
            if (
              typeof parsed.retainRatio === 'number' &&
              typeof parsed.thresholdRatio === 'number' &&
              parsed.retainRatio >= parsed.thresholdRatio
            ) {
              errors.retainRatio = t('invalid.retainAbove');
            }
            preview = computePreview(budgets, parsed);
            // The two token-level constraints `resolveCompactSpec` adds on top of
            // the ratio check: headroom must leave a positive pressure budget
            // (trigger > 0) and must keep the trigger above what is retained
            // (trigger > retained). Without these the engine would "warn once per
            // target, then compact nothing" — a silent no-op. Only checkable while
            // W/O are known and all three budget fields parse; otherwise the
            // engine's own guard is the backstop.
            if (preview && errors.headroomTokens === undefined) {
              if (preview.trigger <= 0) {
                errors.headroomTokens = t('invalid.noBudget');
              } else if (preview.retained >= preview.trigger) {
                errors.headroomTokens = t('invalid.retainOverTrigger');
              }
            }
            for (const field of FIELDS) {
              if (parsed[field.key] !== undefined && parsed[field.key] !== (server || {})[field.key]) {
                ops.push({ op: 'set', path: [field.key], value: parsed[field.key] });
              }
            }
          }
          const dirty = ops.length > 0;
          const invalid = Object.keys(errors).length > 0;
          // The first real validation message, already localized; what the Apply
          // tooltip should explain instead of a generic range error.
          const firstError = Object.values(errors)[0];
          const primary = budgets && budgets.primary;
          const windowHint = primary ? t('window.hint') : t('budgets.missing');

          const save = async () => {
            if (!server || !dirty || invalid || busy) return;
            setBusy(true);
            setStatus({ kind: 'idle' });
            try {
              const response = await ctx.remote.settings.mutate(ns, ops, revision);
              if (!response || response.ok === false) {
                setStatus({ kind: 'error', text: response?.error?.message || t('missing') });
              } else {
                setStatus({ kind: 'saved' });
                await load();
              }
            } catch (error) {
              setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
            } finally {
              setBusy(false);
            }
          };

          if (!draft) {
            return h('div', { style: styles.page }, h('div', { style: styles.status }, t(status.kind === 'error' ? 'missing' : 'loading')));
          }

          return h(
            'div',
            { style: styles.page },
            h('style', null, CSS),
            h('h2', { style: styles.title }, t('title')),
            h('p', { style: styles.description }, t('description')),
            h(
              'div',
              { style: styles.card },
              // Read-only effective numbers, straight from the runtime-discovery
              // snapshot: the same values the engine reads off the routed adapter.
              h(
                'div',
                { style: styles.rowFirst },
                h(
                  'div',
                  { style: styles.rowText },
                  h('div', { style: styles.label }, t('window.label')),
                  h('div', { style: styles.hint }, windowHint),
                ),
                h('div', { style: styles.readonly }, primary ? fmtTokens(primary.context) : '—'),
              ),
              h(
                'div',
                { style: styles.row },
                h(
                  'div',
                  { style: styles.rowText },
                  h('div', { style: styles.label }, t('output.label')),
                  h('div', { style: styles.hint }, t('output.hint')),
                ),
                h('div', { style: styles.readonly }, primary ? fmtTokens(primary.output) : '—'),
              ),
              budgets && budgets.others.length
                ? h(
                    'div',
                    { style: styles.row },
                    h('div', { style: styles.rowText }, h('div', { style: styles.label }, t('budgets.others'))),
                    h(
                      'div',
                      { style: styles.breakdown },
                      budgets.others.map((record) =>
                        h(
                          'div',
                          { key: record.key || record.modelId },
                          `${record.label || record.modelId} · ${fmtTokens(record.context)} · ${fmtTokens(record.output)}`,
                        ),
                      ),
                    ),
                  )
                : null,
              FIELDS.map((field) =>
                h(
                  'div',
                  { key: field.key, style: styles.row },
                  h(
                    'div',
                    { style: styles.rowText },
                    h('div', { style: styles.label }, t(field.key + '.label')),
                    h('div', { style: styles.hint }, errors[field.key] ? h('span', { style: styles.statusBad }, errors[field.key]) : t(field.key + '.hint')),
                  ),
                  field.kind === 'toggle'
                    ? h(Switch, {
                        checked: !!draft[field.key],
                        disabled: busy,
                        label: t(field.key + '.label'),
                        onChange: (next) => setDraft({ ...draft, [field.key]: next }),
                      })
                    : h('input', {
                        // A text input has no spinner buttons. parseField already
                        // owns the range and integer checks the native stepper
                        // used to hint at, so nothing is lost but the arrows.
                        type: 'text',
                        inputMode: field.mode ?? 'decimal',
                        value: draft[field.key],
                        disabled: busy,
                        spellCheck: false,
                        autoComplete: 'off',
                        style: { ...styles.input, ...(errors[field.key] ? styles.inputBad : {}) },
                        onChange: (event) => setDraft({ ...draft, [field.key]: event.target.value }),
                        onKeyDown: (event) => {
                          if (event.key === 'Enter') save();
                        },
                      }),
                ),
              ),
            ),
            // The live budgets in the same card format as the panel above:
            // title and formula on the left, the number right-aligned.
            preview
              ? h(
                  'div',
                  { style: { ...styles.card, marginTop: 14 } },
                  h(
                    'div',
                    { style: styles.rowFirst },
                    h(
                      'div',
                      { style: styles.rowText },
                      h('div', { style: styles.label }, t('preview.trigger')),
                      h('div', { style: styles.hint }, t('preview.triggerFormula')),
                    ),
                    h('div', { style: styles.readonly }, fmtTokens(preview.trigger)),
                  ),
                  h(
                    'div',
                    { style: styles.row },
                    h(
                      'div',
                      { style: styles.rowText },
                      h('div', { style: styles.label }, t('preview.retained')),
                      h('div', { style: styles.hint }, t('preview.retainedFormula')),
                    ),
                    h('div', { style: styles.readonly }, fmtTokens(preview.retained)),
                  ),
                )
              : null,
            h(
              'div',
              { style: styles.foot },
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshcs-btn dshcs-primary',
                  title: dirty ? (invalid ? firstError : '') : t('applyDisabled'),
                  disabled: !dirty || invalid || busy,
                  onClick: save,
                },
                busy ? t('applying') : t('apply'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshcs-btn dshcs-secondary',
                  disabled: busy,
                  onClick: () => setDraft(draftFrom(Object.fromEntries(FIELDS.map((field) => [field.key, field.fallback])))),
                },
                t('reset'),
              ),
              status.kind === 'saved' ? h('span', { style: { ...styles.status, ...styles.statusGood } }, t('saved')) : null,
              status.kind === 'error' ? h('span', { style: { ...styles.status, ...styles.statusBad } }, status.text) : null,
            ),
            h('p', { style: styles.note }, t('note')),
          );
        }

        // Settings nav-rail icon. The shell chooses the rail glyph from a fixed
        // id→icon table and falls back to the gear for unknown ids; it ignores
        // the register `icon` option. So we tag this section's nav cell (matched
        // by its label text) and paint a currentColor mask glyph over the gear —
        // the same technique other installed plugins use. It lives in this plugin,
        // so it survives updates and themes white-on-dark automatically.
        (function installNavIcon() {
          if (typeof document === 'undefined') return;
          const ATTR = 'data-dshcs-nav';
          const STYLE_ID = 'dshcs-nav-icon-style';
          const GLYPH =
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 15 6 6m-6-6v4.8m0-4.8h4.8"/><path d="M9 19.8V15m0 0H4.2M9 15l-6 6"/><path d="M15 4.2V9m0 0h4.8M15 9l6-6"/><path d="M9 4.2V9m0 0H4.2M9 9 3 3"/></svg>';
          const MASK = 'url("data:image/svg+xml,' + encodeURIComponent(GLYPH) + '")';
          const CSS =
            '[' + ATTR + ']>svg{display:none!important}' +
            '[' + ATTR + ']::before{content:"";flex:none;width:16px;height:16px;background-color:currentColor;-webkit-mask:' + MASK + ' center/contain no-repeat;mask:' + MASK + ' center/contain no-repeat}';
          const tag = () => {
            const label = (ctx.locale.bind(L10N)('nav') || '').trim();
            if (!label) return;
            const cells = document.querySelectorAll('button');
            for (let i = 0; i < cells.length; i += 1) {
              const cell = cells[i];
              if (!cell.hasAttribute(ATTR) && (cell.textContent || '').trim() === label) cell.setAttribute(ATTR, '');
            }
          };
          ctx.effect(() => {
            if (!document.getElementById(STYLE_ID)) {
              const el = document.createElement('style');
              el.id = STYLE_ID;
              el.textContent = CSS;
              (document.head || document.documentElement).appendChild(el);
            }
            tag();
            if (typeof MutationObserver === 'undefined') return undefined;
            const mo = new MutationObserver(tag);
            mo.observe(document.body, { childList: true, subtree: true, characterData: true });
            return () => mo.disconnect();
          }, 'compaction-settings: settings nav icon');
        })();

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'compaction',
              order: 30,
              label: () => ctx.locale.bind(L10N)('nav'),
            },
            CompactionSection,
          ),
        );
      },
    };
  },
});
