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

    // Approximate hint box used to keep it on-screen (over-estimating the
    // height only nudges the tip a little higher, which is harmless).
    const TIP_W = 360;
    const TIP_H = 360;
    const GAP = 14;
    const MARGIN = 8;
    const AUTO_HIDE_MS = 6000;

    const css = [
      ".mih_tip{position:fixed;z-index:9999;pointer-events:none;display:flex;flex-direction:column;gap:6px;min-width:220px;max-width:360px;padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-3,#ffffff);border:1px solid var(--dsw-alias-border-l1,#e4e7ec);box-shadow:0 12px 32px rgba(16,24,40,.18);color:var(--dsw-alias-label-primary,#1d2939);animation:mih_in .12s ease-out}",
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
     * Identify the model under the pointer from the DOM of the two model
     * surfaces, returning the visible group name and model name, or null.
     *
     * @param {Element} target - the deepest element under the cursor.
     * @returns {{groupName: string|null, modelName: string}|null}
     */
    function resolveHover(target) {
      // Composer model seat: a model option is a `menuitemradio` button that
      // carries a `title` (effort rows carry none) inside a provider group.
      const menuitem = target.closest('button[role="menuitemradio"]');
      if (menuitem !== null) {
        const modelName = (menuitem.getAttribute("title") || "").trim();
        if (modelName === "") return null;
        let groupName = null;
        const section = menuitem.closest('section[role="group"]');
        if (section !== null) {
          const headingId = section.getAttribute("aria-labelledby");
          const heading = headingId !== null ? document.getElementById(headingId) : null;
          groupName = heading !== null ? heading.textContent.trim() : null;
        }
        return { groupName, modelName };
      }

      // `/model` popup (popupSelect): an option is a `div[role="option"]`
      // whose first span is the model name and second span the group name
      // (optionally followed by " · description").
      const option = target.closest('div[role="option"]');
      if (option !== null) {
        const spans = Array.from(option.children).filter((child) => child.tagName === "SPAN");
        const modelName = (spans[0]?.textContent || "").trim();
        if (modelName === "") return null;
        const detail = (spans[1]?.textContent || "").trim();
        const groupName = detail.split(" · ")[0].trim() || null;
        return { groupName, modelName };
      }

      return null;
    }

    function positionTip(event) {
      let left = event.clientX + GAP;
      let top = event.clientY + GAP;
      if (left + TIP_W > window.innerWidth - MARGIN) left = event.clientX - TIP_W - GAP;
      if (top + TIP_H > window.innerHeight - MARGIN) top = window.innerHeight - TIP_H - MARGIN;
      if (left < MARGIN) left = MARGIN;
      if (top < MARGIN) top = MARGIN;
      return { left, top };
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
      const mapRef = react.useRef(new Map());
      const currentKeyRef = react.useRef(null);
      const hideTimerRef = react.useRef(null);

      const hide = react.useCallback(() => {
        if (hideTimerRef.current !== null) {
          clearTimeout(hideTimerRef.current);
          hideTimerRef.current = null;
        }
        currentKeyRef.current = null;
        setTip(null);
      }, []);

      // Load the settings-derived (groupName, modelName) → config map, and
      // refresh it when the window regains focus so a hot-reloaded
      // settings.yaml is picked up without a full page reload.
      const load = react.useCallback(() => {
        fetch(API, { headers: { Accept: "application/json" } })
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
          .then((body) => {
            const map = new Map();
            for (const row of Array.isArray(body.models) ? body.models : []) {
              if (!row || typeof row.groupName !== "string" || typeof row.modelName !== "string") continue;
              map.set(`${row.groupName}\u0000${row.modelName}`, row);
            }
            mapRef.current = map;
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

          const row = mapRef.current.get(key);
          if (row === undefined) {
            hide();
            return;
          }
          currentKeyRef.current = key;
          const { left, top } = positionTip(event);
          setTip({ row, left, top });

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
        { className: "mih_tip", role: "tooltip", style: { left: tip.left, top: tip.top } },
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
