import { HttpError, SecureKitClient, } from "@securekit/web-sdk";
const DEFAULT_BASE_URL = "/api/securekit";
const defaultVpnPolicy = {
    allowVpn: true,
    allowProxy: true,
    allowTor: false,
    allowRelay: true,
    minScore: 0.5,
};
function normalizeBaseUrl(value) {
    return value.replace(/\/+$/, "");
}
function toFetchUrl(input) {
    if (typeof input === "string")
        return input;
    if (input instanceof URL)
        return input.toString();
    return input.url;
}
function resolveFallbackUrl(url) {
    const normalized = url.trim();
    if (normalized.startsWith("/api/securekit")) {
        const suffix = normalized.slice("/api/securekit".length);
        return `http://127.0.0.1:3001${suffix}`;
    }
    if (normalized.startsWith("http://localhost:3001")) {
        return normalized.replace("http://localhost:3001", "http://127.0.0.1:3001");
    }
    if (normalized.startsWith("http://127.0.0.1:3001")) {
        return normalized.replace("http://127.0.0.1:3001", "http://localhost:3001");
    }
    return null;
}
async function fetchWithFallback(input, init) {
    const primaryUrl = toFetchUrl(input);
    try {
        return await fetch(input, init);
    }
    catch (error) {
        if (!(error instanceof TypeError)) {
            throw error;
        }
        const fallbackUrl = resolveFallbackUrl(primaryUrl);
        if (!fallbackUrl) {
            throw error;
        }
        return fetch(fallbackUrl, init);
    }
}
function shouldUseProxyFallbackInBrowser(baseUrl) {
    if (typeof window === "undefined")
        return false;
    const normalized = normalizeBaseUrl(baseUrl);
    const isHttpTarget = /^http:\/\//i.test(normalized);
    const isLocalTarget = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(normalized);
    const isLocalPage = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    if (isHttpTarget && window.location.protocol === "https:") {
        return true;
    }
    if (isLocalTarget && !isLocalPage) {
        return true;
    }
    return false;
}
export function resolveSecureKitBaseUrl() {
    const raw = import.meta.env.VITE_SECUREKIT_BASE_URL;
    if (typeof raw === "string" && raw.trim().length > 0) {
        const normalized = normalizeBaseUrl(raw.trim());
        if (shouldUseProxyFallbackInBrowser(normalized)) {
            return DEFAULT_BASE_URL;
        }
        return normalized;
    }
    return DEFAULT_BASE_URL;
}
export function createSecureKitClient(baseUrl = resolveSecureKitBaseUrl()) {
    return new SecureKitClient({
        baseUrl: normalizeBaseUrl(baseUrl),
        vpnPolicy: defaultVpnPolicy,
        fetchImpl: (input, init) => fetchWithFallback(input, init),
    });
}
let cachedClient = null;
let cachedBaseUrl = null;
export function getSecureKitClient() {
    const baseUrl = resolveSecureKitBaseUrl();
    if (!cachedClient || cachedBaseUrl !== baseUrl) {
        cachedClient = createSecureKitClient(baseUrl);
        cachedBaseUrl = baseUrl;
    }
    return cachedClient;
}
export const secureKitClient = getSecureKitClient();
function buildUrl(baseUrl, path) {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${normalizeBaseUrl(baseUrl)}${normalizedPath}`;
}
async function parseResponseBody(response) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
        return response.json();
    }
    const text = await response.text();
    return text;
}
export async function postSecureKitJson(path, body, baseUrl = resolveSecureKitBaseUrl()) {
    const response = await fetchWithFallback(buildUrl(baseUrl, path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await parseResponseBody(response);
    if (!response.ok) {
        const message = typeof payload === "string" ? payload : `HTTP ${response.status}`;
        throw new HttpError(response.status, message, payload);
    }
    return payload;
}
export async function deleteSecureKitJson(path, body, baseUrl = resolveSecureKitBaseUrl()) {
    const response = await fetchWithFallback(buildUrl(baseUrl, path), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await parseResponseBody(response);
    if (!response.ok) {
        const message = typeof payload === "string" ? payload : `HTTP ${response.status}`;
        throw new HttpError(response.status, message, payload);
    }
    return payload;
}
function extractServerErrorMessage(body) {
    if (!body || typeof body !== "object")
        return null;
    const root = body;
    if (typeof root.message === "string" && root.message.trim().length > 0) {
        return root.message;
    }
    if (typeof root.error?.message === "string" && root.error.message.trim().length > 0) {
        return root.error.message;
    }
    return null;
}
export function formatSecureKitError(error, baseUrl = resolveSecureKitBaseUrl()) {
    if (error instanceof HttpError) {
        const serverMessage = extractServerErrorMessage(error.body);
        return `Request failed (HTTP ${error.status}) at ${baseUrl}${serverMessage ? `: ${serverMessage}` : "."}`;
    }
    if (error instanceof TypeError) {
        return `Could not reach SecureKit at ${baseUrl}. Check VITE_SECUREKIT_BASE_URL and backend status.`;
    }
    if (error instanceof Error) {
        return error.message;
    }
    return "Unknown error";
}
export async function checkLocationCountryAuto() {
    return getSecureKitClient().verifyLocation();
}
export async function checkLocationCountryManual(expectedCountryCode) {
    return getSecureKitClient().verifyLocation({
        allowedCountries: [expectedCountryCode],
    });
}
export async function checkLocationCountryWithPolicy(expectedCountryCode) {
    const allowedCountries = expectedCountryCode ? [expectedCountryCode] : undefined;
    const client = getSecureKitClient();
    const [raw, network] = await Promise.all([
        client.verifyLocation({ allowedCountries }),
        client.verifyNetwork(),
    ]);
    return {
        raw,
        network,
        decision: {
            allowed: raw.allowed && network.ok,
            reason: raw.reasons[0] ?? network.reasons[0] ?? "ok",
            effectiveScore: network.score,
        },
    };
}
export async function checkVpnRaw() {
    return getSecureKitClient().verifyNetwork();
}
export async function checkVpnWithPolicy(policyOverride) {
    return getSecureKitClient().verifyVpnWithPolicy(policyOverride);
}
