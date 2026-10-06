// Client half of `dsh-model-info-hint` (browser).
//
// Shows a non-blocking hint with a model's full configuration — accepted input
// types, context window, max output tokens, reasoning efforts, and the owning
// provider's protocol / base URL / credential env — whenever the mouse cursor
// rests on a model in the model picker (both the composer model seat and the
// `/model` popup).
//
// It reads the (group name, model name) pair off the hovered list item, then
// resolves it against the map served by lib/index.js (which reads
// `~/.dsh/settings.yaml`). Plain JS + react.createElement (no JSX, no bundler),
// mirroring dsh-archived-conversation; `react` and `react-dom/client` come
// from the DSH shell bundle.

window.__ModuleLoader__.load({
  id: "dsh-model-info-hint",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");
    const { createRoot } = require("react-dom/client");
    const createElement = react.createElement;

    // No extra services are required: this plugin only needs the DOM, `fetch`,
    // and the shell-provided React runtime.
    const inject = [];

    const API = "/model-info-hint/api/models";

    // Bounds for the hint box. TIP_W/MIN_TIP_W mirror the `.mih_tip` max-width
    // and min-width: the tip is anchored by the edge facing the model list, so
    // these only bound the side preference and cap the box inside the viewport
    // — they never set the gap themselves.
    const TIP_W = 360;
    const MIN_TIP_W = 220;
    // Over-estimating the height only nudges the tip a little higher, which is harmless.
    const TIP_H = 360;
    const GAP = 14;
    const MARGIN = 8;
    const AUTO_HIDE_MS = 6000;

    const css = [
      ".mih_tip{position:fixed;z-index:9999;pointer-events:none;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;min-width:220px;max-width:360px;padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-3,#ffffff);border:1px solid var(--dsw-alias-border-l1,#e4e7ec);box-shadow:0 12px 32px rgba(16,24,40,.18);color:var(--dsw-alias-label-primary,#1d2939);animation:mih_in .12s ease-out}",
      ".mih_title{font-size:11px;line-height:16px;font-weight:500;color:var(--dsw-alias-label-tertiary,#667085)}",
      ".mih_model{font-size:14px;line-height:20px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".mih_input{display:flex;align-items:flex-start;gap:10px;width:100%}",
      ".mih_label{flex:0 0 auto;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary,#667085)}",
      ".mih_chips{display:flex;flex-wrap:wrap;gap:6px}",
      ".mih_chip{font-size:12px;line-height:18px;padding:0 9px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#4c8dff) 12%,transparent);color:var(--dsw-alias-state-business-primary,#4c8dff);font-weight:500}",
      ".mih_rows{display:flex;flex-direction:column;gap:4px;width:100%;border-top:1px solid var(--dsw-alias-border-l1,#e4e7ec);padding-top:6px}",
      ".mih_row{display:flex;align-items:flex-start;gap:10px;width:100%}",
      ".mih_value{flex:1 1 auto;min-width:0;font-size:12px;line-height:20px;color:var(--dsw-alias-label-primary,#1d2939);word-break:break-word;font-variant-numeric:tabular-nums}",
      "@keyframes mih_in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}",
    ].join("");

    function ensureCss() {
      if (typeof document === "undefined") return;
      if (document.querySelector('style[data-plugin-css="dsh-model-info-hint"]') !== null) return;
      const tag = document.createElement("style");
      tag.dataset.plugin = "dsh-model-info-hint";
      tag.dataset.pluginCss = "dsh-model-info-hint";
      tag.textContent = css;
      document.head.appendChild(tag);
    }

    /**
     * Read the visible provider (group) name off a list row.
     *
     * Both model surfaces group their rows with the shell's `MenuGroup`
     * primitive, which renders `section[role="group"]` named by its heading
     * through `aria-labelledby` — so one lookup serves the composer menu and
     * the `/model` popup alike. The popup used to carry the provider inside
     * the row's second span as a `"group · description"` detail string; that
     * detail is now reserved for load-failure rows, and model rows receive
     * their provider structurally instead.
     *
     * @param {Element} item - the hovered row.
     * @returns {string|null} the group heading text, or null when ungrouped.
     */
    function groupNameOf(item) {
      const section = item.closest('section[role="group"]');
      if (section === null) return null;
      const headingId = section.getAttribute("aria-labelledby");
      const heading = headingId !== null ? document.getElementById(headingId) : null;
      const text = heading !== null ? heading.textContent.trim() : "";
      return text === "" ? null : text;
    }

    /**
     * Read a model row's name off the `/model` popup. The popup renders it as
     * a `labelText` span inside the row's first span; a row that carries no
     * such span falls back to its first span's text.
     *
     * @param {Element} option - the hovered popup option.
     * @returns {string} the visible model name, or "" when the row has none.
     */
    function modelNameOf(option) {
      const label = option.querySelector('[class*="labelText"]');
      if (label !== null) return (label.textContent || "").trim();
      const first = Array.from(option.children).find((child) => child.tagName === "SPAN");
      return first !== undefined ? (first.textContent || "").trim() : "";
    }

    /**
     * Identify the model under the pointer from the DOM of the two model
     * surfaces, returning the visible group name, the model name, and the
     * DOM elements used for positioning — the hovered item and the enclosing
     * list surface (menu / listbox) — or null when no model is hovered.
     *
     * @param {Element} target - the deepest element under the cursor.
     * @returns {{groupName: string|null, modelName: string, item: Element, surface: Element|null}|null}
     */
    /**
     * The popup panel that owns a row. Both model surfaces wrap their contents
     * in the shell's `MenuSurface`, which marks the panel with
     * `data-menu-material`. The panel is what has to stay clear, because it
     * carries the search box as well as the model rows — sizing the hint
     * against the inner scroll area instead would leave it overlapping the
     * panel's own padding and search row. The inner `menu` / `listbox` is the
     * fallback if that marker ever goes away.
     *
     * @param {Element} item - the hovered row.
     * @param {string} fallback - selector for the inner scroll area.
     * @returns {Element|null}
     */
    function panelOf(item, fallback) {
      return item.closest("[data-menu-material]") ?? item.closest(fallback);
    }

    function resolveHover(target) {
      // Composer model seat: a model option is a `menuitemradio` button that
      // carries a `title` (effort rows carry none) inside a provider group.
      const menuitem = target.closest('button[role="menuitemradio"]');
      if (menuitem !== null) {
        const modelName = (menuitem.getAttribute("title") || "").trim();
        if (modelName === "") return null;
        // Keep the hint clear of the whole panel, search box included.
        const surface = panelOf(menuitem, '[role="menu"]');
        return { groupName: groupNameOf(menuitem), modelName, item: menuitem, surface };
      }

      // `/model` popup (popupSelect): an option is a `div[role="option"]`
      // whose model name is its first span; the provider arrives through the
      // same `MenuGroup` section the composer menu uses.
      const option = target.closest('div[role="option"]');
      if (option !== null) {
        const modelName = modelNameOf(option);
        if (modelName === "") return null;
        const surface = panelOf(option, '[role="listbox"]');
        return { groupName: groupNameOf(option), modelName, item: option, surface };
      }

      return null;
    }

    /** Clamp one coordinate into the viewport, tolerating a min above the max. */
    function clamp(value, min, max) {
      return Math.min(Math.max(value, min), Math.max(min, max));
    }

    /**
     * Place the hint outside the model picker panel, so it covers neither the
     * other candidate models nor the panel's own search row: prefer the side
     * with the most free room, vertically centered on the hovered item and
     * clamped to the viewport. Falls back to cursor-relative placement only
     * when no panel could be detected.
     *
     * The hint's size is passed in rather than estimated: the caller measures
     * the rendered box first, because a `max-width` bounds only the content box
     * unless `box-sizing` says otherwise, and any error there lands straight in
     * the gap on the panel's side.
     *
     * Only `left` is ever set. A `right`-anchored box is placed against its
     * containing block, which is not guaranteed to be the viewport that the
     * panel's rect was measured in — under a mismatch the hint lands nowhere
     * near the panel. `left` and `getBoundingClientRect` share one horizontal
     * origin (the same assumption the cursor-relative fallback already makes).
     *
     * @param {{surface: object|null, item: object|null, x: number, y: number}} anchor
     * @param {number} width - the hint's measured width.
     * @param {number} height - the hint's measured height.
     * @returns {{left: number, top: number, maxWidth?: number}}
     */
    function placeTip(anchor, width, height) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const surface = anchor.surface;

      if (surface !== null) {
        const spaceRight = vw - MARGIN - (surface.right + GAP);
        const spaceLeft = surface.left - GAP - MARGIN;
        /** Room on one side, bounded by the tip's own min/max width. */
        const maxWidth = Math.min(TIP_W, Math.max(MIN_TIP_W, Math.max(spaceLeft, spaceRight)));
        const centerY = anchor.item !== null ? anchor.item.top + anchor.item.height / 2 : anchor.y;
        const top = clamp(centerY - height / 2, MARGIN, vh - height - MARGIN);
        const limit = Math.max(MARGIN, vw - MARGIN - width);
        if (spaceRight >= spaceLeft) {
          return { left: clamp(surface.right + GAP, MARGIN, limit), top, maxWidth };
        }
        // The facing edge is the hint's right one, so GAP lands exactly on the panel.
        return { left: clamp(surface.left - GAP - width, MARGIN, limit), top, maxWidth };
      }

      let left = anchor.x + GAP;
      let top = anchor.y + GAP;
      if (left + width > vw - MARGIN) left = anchor.x - width - GAP;
      if (top + height > vh - MARGIN) top = vh - height - MARGIN;
      return {
        left: clamp(left, MARGIN, Math.max(MARGIN, vw - MARGIN - width)),
        top: Math.max(top, MARGIN),
      };
    }

    function formatTokens(value) {
      return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "";
    }

    function reasoningText(value) {
      if (value === false) return "不支持推理";
      if (Array.isArray(value) && value.length > 0) return value.join(" · ");
      return null;
    }

    /** One label/value row, or null when the value is absent. */
    function kv(label, value) {
      if (value === null || value === undefined || value === "") return null;
      return createElement(
        "div",
        { className: "mih_row", key: label },
        createElement("span", { className: "mih_label" }, label),
        createElement("span", { className: "mih_value", title: String(value) }, String(value)),
      );
    }

    function ModelInfoHint() {
      const [tip, setTip] = react.useState(null);
      const mapRef = react.useRef({ byKey: new Map(), byName: new Map() });
      const currentKeyRef = react.useRef(null);
      const hideTimerRef = react.useRef(null);
      const tipRef = react.useRef(null);

      const hide = react.useCallback(() => {
        if (hideTimerRef.current !== null) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        currentKeyRef.current = null;
        setTip(null);
      }, []);

      // Load the settings-derived (groupName, modelName) → config index, and
      // refresh it when the window regains focus so a hot-reloaded
      // settings.yaml is picked up without a full page reload.
      const load = react.useCallback(() => {
        fetch(API, { headers: { Accept: "application/json" } })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
          .then((body) => {
            const byKey = new Map();
            const names = new Map();
            const rows = [];
            for (const row of Array.isArray(body.models) ? body.models : []) {
              if (!row || typeof row.groupName !== "string" || typeof row.modelName !== "string") continue;
              byKey.set(`${row.groupName}\u0000${row.modelName}`, row);
              names.set(row.modelName, (names.get(row.modelName) ?? 0) + 1);
              rows.push(row);
            }
            // A bare model name is a safe fallback key only while it is
            // unambiguous: the same id may be offered by several providers.
            const byName = new Map();
            for (const row of rows) if (names.get(row.modelName) === 1) byName.set(row.modelName, row);
            mapRef.current = { byKey, byName };
          })
          .catch(() => {});
      }, []);

      react.useEffect(() => {
        load();
        window.addEventListener("focus", load);
        return () => window.removeEventListener("focus", load);
      }, [load]);

      // One delegated mouseover drives the hint; keydown/scroll/click clear
      // it so a dismissed menu never leaves the hint stranded.
      react.useEffect(() => {
        const onOver = (event) => {
          const target = event.target;
          if (!(target instanceof Element)) {
            hide();
            return;
          }
          const hit = resolveHover(target);
          if (hit === null) {
            hide();
            return;
          }
          const key = `${hit.groupName}\u0000${hit.modelName}`;
          if (key === currentKeyRef.current) return;

          const index = mapRef.current;
          const row = index.byKey.get(key) ?? index.byName.get(hit.modelName);
          if (row === undefined) {
            hide();
            return;
          }
          currentKeyRef.current = key;
          const anchor = {
            surface: hit.surface !== null ? hit.surface.getBoundingClientRect() : null,
            item: hit.item !== null ? hit.item.getBoundingClientRect() : null,
            x: event.clientX,
            y: event.clientY,
          };
          // `draft` only covers the first paint; the layout effect below replaces
          // it with a placement measured from the rendered box.
          setTip({ row, anchor, draft: placeTip(anchor, TIP_W, TIP_H) });

          if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
          hideTimerRef.current = setTimeout(() => setTip(null), AUTO_HIDE_MS);
        };

        const clear = () => hide();

        document.addEventListener("mouseover", onOver, true);
        document.addEventListener("keydown", clear, true);
        document.addEventListener("scroll", clear, true);
        document.addEventListener("mousedown", clear, true);
        return () => {
          document.removeEventListener("mouseover", onOver, true);
          document.removeEventListener("keydown", clear, true);
          document.removeEventListener("scroll", clear, true);
          document.removeEventListener("mousedown", clear, true);
        };
      }, [hide]);

      // The hint is painted at its provisional spot and then placed here from
      // its own measured box. A layout effect runs before the browser paints,
      // so the provisional position is never visible.
      react.useLayoutEffect(() => {
        const node = tipRef.current;
        if (tip === null || node === null) return;
        const rect = node.getBoundingClientRect();
        const slot = placeTip(tip.anchor, rect.width, rect.height);
        node.style.left = `${slot.left}px`;
        node.style.top = `${slot.top}px`;
        if (slot.maxWidth !== undefined) node.style.maxWidth = `${slot.maxWidth}px`;
      }, [tip]);

      if (tip === null) return null;

      const row = tip.row;
      const chips = (Array.isArray(row.input) ? row.input : []).map((type) =>
        createElement("span", { className: "mih_chip", key: type }, String(type)),
      );
      const rows = [
        kv("服务商", row.groupName),
        kv("模型 ID", row.model),
        kv("上下文窗口", row.contextWindow != null ? `${formatTokens(row.contextWindow)} tokens` : null),
        kv("最大输出", row.maxTokens != null ? `${formatTokens(row.maxTokens)} tokens` : null),
        kv("协议", row.api),
        kv("Base URL", row.baseURL),
        kv("认证环境变量", row.apiKeyEnv),
        kv("推理级别", reasoningText(row.reasoningEfforts)),
      ].filter(Boolean);

      return createElement(
        "div",
        {
          ref: tipRef,
          className: "mih_tip",
          role: "tooltip",
          // Provisional; the layout effect replaces it with the measured placement.
          style: { left: tip.draft.left, top: tip.draft.top, maxWidth: tip.draft.maxWidth },
        },
        createElement("div", { className: "mih_title" }, "模型配置"),
        createElement("div", { className: "mih_model" }, row.modelName),
        createElement(
          "div",
          { className: "mih_input" },
          createElement("span", { className: "mih_label" }, "输入类型"),
          createElement("div", { className: "mih_chips" }, chips),
        ),
        rows.length > 0 ? createElement("div", { className: "mih_rows" }, rows) : null,
      );
    }

    function apply(ctx) {
      ensureCss();
      const container = document.createElement("div");
      container.setAttribute("data-mih-root", "");
      document.body.appendChild(container);
      const root = createRoot(container);
      root.render(createElement(ModelInfoHint));
      ctx.effect(() => () => {
        root.unmount();
        container.remove();
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
