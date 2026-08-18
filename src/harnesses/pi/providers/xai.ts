/**
 * xAI provider for pi.
 *
 * Registers an `xai` provider with:
 * - API-key auth via XAI_API_KEY
 * - optional xAI subscription OAuth device-code login via `/login xai`
 * - fixed Grok 4.6 / Grok 4.6 Fast entries so they are available even
 *   before live model discovery works
 * - live `/v1/models` discovery when credentials are available
 *
 * Install target for a collection manager:
 *   ~/.pi/agent/extensions/xai.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai";

interface ProviderModelConfig {
  id: string;
  name: string;
  reasoning: boolean;
  input: ("text" | "image")[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  thinkingLevelMap?: Record<string, string | null>;
  compat?: Record<string, unknown>;
}

interface XaiModel {
  id: string;
  context_length?: number;
  prompt_text_token_price?: number;
  cached_prompt_text_token_price?: number;
  prompt_image_token_price?: number;
  completion_text_token_price?: number;
}

const PROVIDER_ID = "xai";
const XAI_BASE_URL = "https://api.x.ai/v1";
const XAI_MODELS_URL = `${XAI_BASE_URL}/models`;

// Public OAuth client used by xAI's device-code flow. Not a secret.
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_DEVICE_AUTH_URL = "https://auth.x.ai/oauth2/device/code";
const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
const XAI_SCOPES = "openid profile email offline_access grok-cli:access api:access";
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 300_000;

const xaiCompat = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
};

// Pi thinking levels → xAI `reasoning_effort` values. xAI's documented
// OpenAI-compatible efforts are low / medium / high; xhigh and max are exposed
// in pi but clamped to high until xAI exposes stronger values.
const xaiThinkingLevelMap = {
  off: null,
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "high",
  max: "high",
};

export const XAI_MODELS: ProviderModelConfig[] = [
  {
    id: "grok-4.6",
    name: "Grok 4.6",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256_000,
    maxTokens: 64_000,
    thinkingLevelMap: { ...xaiThinkingLevelMap },
    compat: { ...xaiCompat },
  },
  {
    id: "grok-4.6-fast",
    name: "Grok 4.6 Fast",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 256_000,
    maxTokens: 64_000,
    thinkingLevelMap: { ...xaiThinkingLevelMap },
    compat: { ...xaiCompat },
  },
];

function formUrlEncoded(obj: Record<string, string>): string {
  return new URLSearchParams(obj).toString();
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

async function postForm(url: string, body: Record<string, string>, signal?: AbortSignal): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: formUrlEncoded(body),
    signal,
  });
}

async function throwIfNotOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  const text = await res.text().catch(() => "");
  throw new Error(`xAI ${label} failed (${res.status})${text ? `: ${text}` : ""}`);
}

async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const deviceRes = await postForm(XAI_DEVICE_AUTH_URL, {
    client_id: XAI_CLIENT_ID,
    scope: XAI_SCOPES,
  });
  await throwIfNotOk(deviceRes, "device code request");

  const device = (await deviceRes.json()) as {
    device_code?: string;
    user_code?: string;
    verification_uri?: string;
    expires_in?: number;
    interval?: number;
  };

  if (!device.device_code || !device.user_code || !device.verification_uri) {
    throw new Error("xAI device code response missing device_code / user_code / verification_uri");
  }

  callbacks.onDeviceCode({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    intervalSeconds: device.interval ?? Math.round(POLL_INTERVAL_MS / 1000),
    expiresInSeconds: device.expires_in ?? Math.round(POLL_TIMEOUT_MS / 1000),
  });

  const intervalMs = (device.interval ?? POLL_INTERVAL_MS / 1000) * 1000;
  const deadline = Date.now() + (device.expires_in ? device.expires_in * 1000 : POLL_TIMEOUT_MS);
  let currentInterval = intervalMs;

  while (Date.now() < deadline) {
    await sleep(currentInterval);

    const tokenRes = await postForm(XAI_TOKEN_URL, {
      grant_type: DEVICE_GRANT_TYPE,
      client_id: XAI_CLIENT_ID,
      device_code: device.device_code,
    });

    if (tokenRes.ok) {
      const tokens = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };
      return {
        access: tokens.access_token,
        refresh: tokens.refresh_token ?? "",
        expires: Date.now() + tokens.expires_in * 1000,
      };
    }

    const err = (await tokenRes.json().catch(() => ({}))) as { error?: string; error_description?: string };
    if (err.error === "authorization_pending") continue;
    if (err.error === "slow_down") {
      currentInterval += 5000;
      continue;
    }
    if (err.error === "access_denied" || err.error === "authorization_denied") {
      throw new Error("xAI device authorization was denied");
    }
    if (err.error === "expired_token") {
      throw new Error("xAI device code expired - please re-run /login");
    }
    throw new Error(`xAI device token exchange failed (${tokenRes.status})${err.error_description ? `: ${err.error_description}` : ""}`);
  }

  throw new Error("xAI device authorization timed out - please re-run /login");
}

async function refreshToken(credentials: OAuthCredentials, signal: AbortSignal): Promise<OAuthCredentials> {
  if (!credentials.refresh) throw new Error("xAI refresh token missing - please /login again");

  const res = await postForm(
    XAI_TOKEN_URL,
    {
      grant_type: "refresh_token",
      refresh_token: credentials.refresh,
      client_id: XAI_CLIENT_ID,
    },
    signal,
  );
  await throwIfNotOk(res, "token refresh");

  const tokens = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    access: tokens.access_token,
    refresh: tokens.refresh_token ?? credentials.refresh,
    expires: Date.now() + tokens.expires_in * 1000,
  };
}

function priceToCostPerMillion(price: number | undefined | null): number {
  // xAI reports prices as $0.0001 per 1M tokens; 12500 → $1.25/M.
  if (typeof price !== "number" || price <= 0) return 0;
  return Number((price / 10_000).toFixed(4));
}

function isReasoningModel(id: string): boolean {
  if (id.includes("non-reasoning") || id.includes("grok-composer")) return false;
  return id.includes("reasoning") || /^grok-4(\.|-|$)/.test(id) || id.includes("multi-agent");
}

function buildModelFromApi(model: XaiModel): ProviderModelConfig | null {
  if (!model.id || typeof model.completion_text_token_price !== "number") return null;

  const reasoning = isReasoningModel(model.id);
  return {
    id: model.id,
    name: model.id,
    reasoning,
    input: typeof model.prompt_image_token_price === "number" && model.prompt_image_token_price > 0 ? ["text", "image"] : ["text"],
    cost: {
      input: priceToCostPerMillion(model.prompt_text_token_price),
      output: priceToCostPerMillion(model.completion_text_token_price),
      cacheRead: priceToCostPerMillion(model.cached_prompt_text_token_price),
      cacheWrite: 0,
    },
    contextWindow: model.context_length ?? 256_000,
    maxTokens: model.id.includes("grok-build") ? 256_000 : 64_000,
    thinkingLevelMap: reasoning ? { ...xaiThinkingLevelMap } : undefined,
    compat: { ...xaiCompat },
  };
}

async function fetchLiveModels(apiKey: string | undefined): Promise<ProviderModelConfig[]> {
  if (!apiKey) return [];

  try {
    const res = await fetch(XAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    await throwIfNotOk(res, "model list fetch");
    const payload = (await res.json()) as { data?: XaiModel[] } | XaiModel[];
    const data = Array.isArray(payload) ? payload : payload.data ?? [];
    return data.map(buildModelFromApi).filter((model): model is ProviderModelConfig => Boolean(model));
  } catch {
    return [];
  }
}

export default async function xaiProvider(pi: ExtensionAPI) {
  const byId = new Map(XAI_MODELS.map((model) => [model.id, model]));
  for (const model of await fetchLiveModels(process.env.XAI_API_KEY?.trim())) {
    byId.set(model.id, model);
  }

  pi.registerProvider(PROVIDER_ID, {
    name: "xAI",
    baseUrl: XAI_BASE_URL,
    api: "openai-completions",
    apiKey: "$XAI_API_KEY",
    authHeader: true,
    models: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    oauth: {
      name: "xAI",
      login,
      refreshToken,
      getApiKey: (credentials: OAuthCredentials) => credentials.access,
    },
  });
}
