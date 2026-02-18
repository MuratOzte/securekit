import { randomUUID } from "node:crypto";
import express, { type Request, type Response } from "express";
import type {
  LocationResult,
  SessionStartResponse,
  VerifyError,
  VerifySessionRequest,
  VerifySessionResponse,
} from "@securekit/core";
import { aggregateRisk } from "../../../core/src/risk/aggregate";
import { decideNext } from "../../../core/src/risk/decide";
import { resolveSessionPolicy } from "../../../core/src/risk/policy";
import type { SessionStore } from "../session/store";
import type { SessionLookupResult, SessionRecord } from "../session/types";

const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;

function resolveTtlMsFromEnv(): number {
  const raw = process.env.SESSION_TTL_SECONDS;
  if (!raw) return DEFAULT_SESSION_TTL_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SESSION_TTL_MS;
  }

  return Math.round(parsed * 1000);
}

function getNowMs(store: SessionStore): number {
  if (typeof store.getNowMs === "function") return store.getNowMs();
  return Date.now();
}

function getSessionTtlMs(store: SessionStore): number {
  if (typeof store.getTtlMs === "function") return store.getTtlMs();
  return resolveTtlMsFromEnv();
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeCountryCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const normalized = code.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAllowList(countries: string[] | undefined): string[] | undefined {
  if (!Array.isArray(countries)) return undefined;

  const normalized = countries
    .map((country) => normalizeCountryCode(country))
    .filter((country): country is string => Boolean(country));

  if (normalized.length === 0) return [];
  return Array.from(new Set(normalized));
}

function applyAllowedCountries(
  location: LocationResult | undefined,
  allowedCountries: string[] | undefined
): LocationResult | undefined {
  if (!location) return undefined;

  const reasons = new Set(location.reasons ?? []);
  const normalizedAllowList = normalizeAllowList(allowedCountries);
  const normalizedCountryCode = normalizeCountryCode(location.countryCode);

  if (!normalizedAllowList || normalizedAllowList.length === 0) {
    reasons.delete("COUNTRY_NOT_ALLOWED");
    return {
      ...location,
      countryCode: normalizedCountryCode,
      allowed: true,
      reasons: Array.from(reasons),
    };
  }

  const allowed = Boolean(normalizedCountryCode && normalizedAllowList.includes(normalizedCountryCode));
  if (allowed) {
    reasons.delete("COUNTRY_NOT_ALLOWED");
  } else {
    reasons.add("COUNTRY_NOT_ALLOWED");
  }

  return {
    ...location,
    countryCode: normalizedCountryCode,
    allowed,
    reasons: Array.from(reasons),
  };
}

function makeError(error: VerifyError): { error: VerifyError } {
  return { error };
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
): void {
  const payload: VerifyError = details === undefined ? { code, message } : { code, message, details };
  res.status(status).json(makeError(payload));
}

async function lookupSession(store: SessionStore, sessionId: string): Promise<SessionLookupResult> {
  if (typeof store.lookup === "function") {
    return store.lookup(sessionId);
  }

  const record = await store.get(sessionId);
  if (!record) return { state: "missing" };
  return { state: "active", record };
}

function parseVerifySessionRequest(body: unknown): VerifySessionRequest | null {
  if (!isObject(body)) return null;

  const sessionIdValue = body.sessionId;
  if (typeof sessionIdValue !== "string") return null;

  const sessionId = sessionIdValue.trim();
  if (!sessionId) return null;

  const request: VerifySessionRequest = { sessionId };

  if (isObject(body.policy)) {
    request.policy = body.policy as VerifySessionRequest["policy"];
  }

  if (isObject(body.signals)) {
    const signals: VerifySessionRequest["signals"] = {};
    type SessionSignals = NonNullable<VerifySessionRequest["signals"]>;

    if (isObject(body.signals.network)) {
      signals.network = body.signals.network as SessionSignals["network"];
    }

    if (isObject(body.signals.location)) {
      signals.location = body.signals.location as SessionSignals["location"];
    }

    request.signals = signals;
  }

  return request;
}

function mergeSignals(record: SessionRecord, request: VerifySessionRequest): SessionRecord["signals"] {
  return {
    ...record.signals,
    ...(request.signals?.network ? { network: request.signals.network } : {}),
    ...(request.signals?.location ? { location: request.signals.location } : {}),
  };
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function createSessionRouter(args: { sessionStore: SessionStore }) {
  const router = express.Router();
  const { sessionStore } = args;

  router.post("/session/start", async (_req: Request, res: Response) => {
    const nowMs = getNowMs(sessionStore);
    const ttlMs = getSessionTtlMs(sessionStore);

    const record: SessionRecord = {
      sessionId: randomUUID(),
      createdAt: nowMs,
      expiresAt: nowMs + ttlMs,
      signals: {},
    };

    await sessionStore.set(record);

    const response: SessionStartResponse = {
      sessionId: record.sessionId,
      expiresAt: new Date(record.expiresAt).toISOString(),
    };

    res.status(200).json(response);
  });

  router.post("/verify/session", async (req: Request, res: Response) => {
    const requestBody = parseVerifySessionRequest(req.body);
    if (!requestBody) {
      sendError(res, 400, "INVALID_REQUEST", "A valid verify session request body is required.");
      return;
    }

    const lookup = await lookupSession(sessionStore, requestBody.sessionId);
    if (lookup.state === "missing") {
      sendError(res, 404, "SESSION_NOT_FOUND", "Session was not found.");
      return;
    }

    if (lookup.state === "expired") {
      sendError(res, 410, "SESSION_EXPIRED", "Session has expired.");
      return;
    }

    const nowMs = getNowMs(sessionStore);
    const mergedSignals = mergeSignals(lookup.record, requestBody);

    const updated = await sessionStore.update(requestBody.sessionId, (record) => ({
      ...record,
      signals: mergedSignals,
      lastUpdatedAt: nowMs,
    }));

    if (!updated) {
      const refreshed = await lookupSession(sessionStore, requestBody.sessionId);
      if (refreshed.state === "expired") {
        sendError(res, 410, "SESSION_EXPIRED", "Session has expired.");
        return;
      }

      sendError(res, 404, "SESSION_NOT_FOUND", "Session was not found.");
      return;
    }

    const policy = resolveSessionPolicy(requestBody.policy);
    const signalsUsed = {
      network: updated.signals.network,
      location: applyAllowedCountries(updated.signals.location, policy.allowedCountries),
    };

    const aggregate = aggregateRisk({
      network: signalsUsed.network,
      location: signalsUsed.location,
      policy,
    });

    const decision = decideNext({
      riskScore: aggregate.riskScore,
      policy,
    });

    const response: VerifySessionResponse = {
      sessionId: updated.sessionId,
      riskScore: aggregate.riskScore,
      decision: decision.decision,
      requiredSteps: decision.requiredSteps,
      reasons: uniq([...aggregate.reasons, ...decision.reasons]),
      signalsUsed,
    };

    res.status(200).json(response);
  });

  return router;
}
