// Host half of `dsh-model-info-hint`.
//
// Serves one same-origin JSON endpoint that reports, for every model the user
// has configured, its full configuration — accepted input types (text, image,
// …), context window, max output tokens, reasoning efforts, plus the owning
// provider's protocol, base URL, and credential environment variable. The data
// source is the user's settings document — by default `~/.dsh/settings.yaml`
// (or `$DSH_HOME/settings.yaml`) — read through DSH's settings service, which
// is the same file-backed store the harness itself uses (so it honors
// `$DSH_HOME`, hot-reload, and both `.yaml`/`.json` documents).
//
// Model routing in that document typically looks like:
//
//   llm-pi-ai:
//     providers:
//       <provider>:
//         displayName: <shown name>       # optional; defaults to the key
//         api: openai-completions         # optional wire protocol
//         baseURL: https://example/v1     # optional endpoint
//         apiKeyEnv: MY_API_KEY           # optional credential env var name
//         defaultInput: [text, image]     # optional provider fallback
//         models:
//           - id: <model>
//             name: <shown name>          # optional; defaults to the id
//             contextWindow: 400000       # optional
//             maxTokens: 32768            # optional
//             input: [text, image]        # optional per-model override
//             reasoningEfforts: { high: high, low: low }  # optional
//
// The lookup is generic: it scans every registered settings namespace's
// resolved value for a `providers` dict, so it works for any adapter that
// stores model routes under that shape.

export const name = "model-info-hint";
export const inject = ["settings", "webServer"];

const API_PREFIX = "/model-info-hint/api";
const DEFAULT_INPUT = ["text"];

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/**
 * Coerce an array of modality values to strings. Returns undefined when the
 * list is absent OR empty: the schema-resolved settings value represents a
 * model with no `input` override as `[]`, which must still fall back to the
 * provider's `defaultInput`.
 */
function asStrings(list) {
  if (!Array.isArray(list)) return undefined;
  const strings = list.map((item) => String(item));
  return strings.length > 0 ? strings : undefined;
}

/** A non-empty string value, or undefined. */
function asString(value) {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A finite number value, or undefined. */
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Normalize a model's `reasoningEfforts` to a JSON-friendly shape:
 *  - `false`  → the model is explicitly non-reasoning;
 *  - object   → the offered level keys, in declaration order;
 *  - absent   → null (inherited from the catalog / not declared).
 */
function describeReasoningEfforts(efforts) {
  if (efforts === false) return false;
  if (efforts !== null && typeof efforts === "object" && !Array.isArray(efforts)) {
    const keys = Object.keys(efforts).filter((key) => typeof key === "string");
    if (keys.length > 0) return keys;
  }
  return null;
}

/**
 * Build the (provider, model) → config map from the settings document.
 *
 * Each row carries both the machine ids (provider key / model id) and the
 * display names the browser actually renders (group name / model name), so the
 * client can match a hovered list item by its visible text, plus every
 * configuration field worth showing in the hover hint.
 *
 * @param {object} ctx - host context carrying the `settings` service.
 * @returns {object[]}
 */
export function buildModelInfoMap(ctx) {
  const rows = [];
  for (const descriptor of ctx.settings.describe()) {
    const section = descriptor.value;
    if (section === null || typeof section !== "object") continue;
    const providers = section.providers;
    if (providers === null || typeof providers !== "object") continue;

    for (const [providerKey, route] of Object.entries(providers)) {
      if (route === null || typeof route !== "object") continue;
      const groupName = asString(route.displayName) ?? providerKey;
      const defaultInput = asStrings(route.defaultInput) ?? DEFAULT_INPUT;

      // Provider-level facts shared by every model on this route.
      const api = asString(route.api);
      const baseURL = asString(route.baseURL);
      const apiKeyEnv = asString(route.apiKeyEnv);

      const models = Array.isArray(route.models) ? route.models : [];
      for (const entry of models) {
        if (entry === null || typeof entry !== "object" || typeof entry.id !== "string") continue;
        const modelName = asString(entry.name) ?? entry.id;
        rows.push({
          provider: providerKey,
          model: entry.id,
          groupName,
          modelName,
          input: asStrings(entry.input) ?? defaultInput,
          contextWindow: asNumber(entry.contextWindow),
          maxTokens: asNumber(entry.maxTokens),
          reasoningEfforts: describeReasoningEfforts(entry.reasoningEfforts),
          api,
          baseURL,
          apiKeyEnv,
        });
      }
    }
  }
  return rows;
}

export function apply(ctx) {
  const route = ctx.webServer.register({
    kind: "prefix",
    path: API_PREFIX,
    async handler(req, res) {
      const url = new URL(req.url ?? "/", "http://localhost");
      const rest = url.pathname.startsWith(API_PREFIX)
        ? url.pathname.slice(API_PREFIX.length)
        : url.pathname;
      try {
        if (req.method !== "GET" || rest !== "/models") {
          return sendJson(res, 404, { error: "not found" });
        }
        return sendJson(res, 200, { models: buildModelInfoMap(ctx) });
      } catch (error) {
        ctx.logger?.error(`model-info-hint: ${error?.stack ?? error}`);
        return sendJson(res, 500, { error: String(error?.message ?? error) });
      }
    },
  });
  ctx.effect(() => route);
}
