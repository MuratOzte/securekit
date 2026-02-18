import cors from "cors";
import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type ConsentLog,
  type ConsentRequest,
  type ConsentResponse,
  type DeleteBiometricsRequest,
  type DeleteBiometricsResponse,
  type KeystrokeSample,
  type EnrollKeystrokeRequest,
  type EnrollKeystrokeResponse,
  type GetProfilesResponse,
  type KeystrokeEvent,
  type KeystrokeProfile,
  type LocationResult,
  type NetworkResult,
  type UserProfiles,
  type VerifyKeystrokeRequest,
  type VerifyKeystrokeResponse,
  type VerifyError,
} from "@securekit/core";
import {
  buildKeystrokeProfile,
  DEFAULT_ENROLLMENT_MIN_KEYSTROKES,
  DEFAULT_ENROLLMENT_MIN_ROUNDS,
} from "../../core/src/biometrics/keystrokeProfile";
import {
  runIpCheck as defaultRunIpCheck,
  type IpCheckOutput,
  type RunIpCheckParams,
} from "./services/ipCheck";
import { computeNetworkResult } from "./services/networkScore";
import { verifyKeystrokeAgainstProfile } from "./services/keystrokeVerification";
import { createSessionRouter } from "./routes/session";
import { InMemorySessionStore } from "./session/inMemoryStore";
import type { SessionStore } from "./session/store";
import { createChallengeRouter, resolveChallengeTtlMs } from "./routes/challenge";
import { InMemoryChallengeStore } from "./challenge/inMemoryStore";
import type { ChallengeStore } from "./challenge/store";
import type { Rng } from "./challenge/generateText";
import type { StorageAdapter } from "./storage/adapter";
import { InMemoryAdapter } from "./storage/inMemoryAdapter";

const __filename = fileURLToPath(import.meta.url);

interface VpnClientMetadata {
  clientTimeZone: string | null;
  clientTimeOffsetMinutes: number | null;
}

interface VerificationResult {
  ok: boolean;
  score: number;
  details?: unknown;
}

interface VpnCheckResultDetails extends VpnClientMetadata {
  ip: string | null;
  ipTimeZone: string | null;
  ipCountry: string | null;
  ipRegion: string | null;
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  isRelay: boolean;
  timezoneDriftHours: number | null;
  source: string | null;
  ipInfo?: unknown;
}

interface LocationCountryResultDetails {
  ip: string | null;
  ipCountryCode: string | null;
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
  matchesExpectedCountry: boolean | null;
  matchesClientCountry: boolean | null;
  reason: string | null;
  ipInfo?: unknown;
  security: {
    vpn: boolean | null;
    proxy: boolean | null;
    tor: boolean | null;
    relay: boolean | null;
  };
}

interface LocationCountryResult extends VerificationResult {
  ipCountryCode: string | null;
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
  details?: LocationCountryResultDetails;
}

type RunIpCheckFn = (ip: string, params?: RunIpCheckParams) => Promise<IpCheckOutput>;

export interface CreateAppDeps {
  runIpCheck?: RunIpCheckFn;
  sessionStore?: SessionStore;
  challengeStore?: ChallengeStore;
  storage?: StorageAdapter;
  challengeRng?: Rng;
  nowFn?: () => number;
  nowFnIso?: () => string;
  challengeTtlSeconds?: number;
}

function normalizeCountryCode(code: unknown): string | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

function readNumericValue(input: unknown): number | null {
  return typeof input === "number" && Number.isFinite(input) ? input : null;
}

function getClientIp(req: Request): string | null {
  const xfwd = req.headers["x-forwarded-for"];

  let ip: string | null = null;
  if (typeof xfwd === "string" && xfwd.length > 0) {
    ip = xfwd.split(",")[0]?.trim() || null;
  } else if (Array.isArray(xfwd) && xfwd.length > 0) {
    ip = xfwd[0] ?? null;
  } else {
    ip = req.socket.remoteAddress ?? null;
  }

  if (process.env.NODE_ENV !== "production") {
    if (ip === "::1" || ip === "127.0.0.1") {
      return "8.8.8.8";
    }
  }

  return ip;
}

function parseClientOffsetMin(body: unknown): number | null {
  const source = (body ?? {}) as Record<string, unknown>;
  const candidates = [
    source.clientOffsetMin,
    source.clientTimeOffsetMinutes,
    source.clientTimezoneOffset,
    source.tzOffset,
    source.clientOffset,
  ];

  for (const candidate of candidates) {
    const value = readNumericValue(candidate);
    if (value !== null) return value;
  }

  return null;
}

function parseVpnClientMetadata(req: Request): VpnClientMetadata {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const clientTimeZone =
    typeof body.clientTimeZone === "string"
      ? body.clientTimeZone
      : typeof body.clientTimezone === "string"
        ? body.clientTimezone
        : null;

  return {
    clientTimeZone,
    clientTimeOffsetMinutes: parseClientOffsetMin(body),
  };
}

function parseAllowedCountries(body: unknown): string[] | undefined {
  const input = (body ?? {}) as { allowedCountries?: unknown };
  if (!Array.isArray(input.allowedCountries)) return undefined;

  const normalized = input.allowedCountries
    .map((country) => normalizeCountryCode(country))
    .filter((country): country is string => Boolean(country));

  return normalized.length > 0 ? Array.from(new Set(normalized)) : [];
}

function parseMockScenario(body: unknown): RunIpCheckParams["scenario"] | undefined {
  const source = (body ?? {}) as { scenario?: unknown };
  if (source.scenario === "clean" || source.scenario === "risky") {
    return source.scenario;
  }

  return undefined;
}

function parseLegacyCountryInputs(body: unknown): {
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
} {
  const source = (body ?? {}) as Record<string, unknown>;
  return {
    expectedCountryCode: normalizeCountryCode(source.expectedCountryCode),
    clientCountryCode: normalizeCountryCode(source.clientCountryCode),
  };
}

function extractCountryCode(ipCheck: IpCheckOutput): string | null {
  const direct = normalizeCountryCode(ipCheck.ip_country_code);
  if (direct) return direct;

  return normalizeCountryCode(ipCheck.ip_info?.location?.country_code);
}

function extractIpTimeZone(ipCheck: IpCheckOutput): string | null {
  const timezone = ipCheck.ip_info?.location?.time_zone;
  return typeof timezone === "string" ? timezone : null;
}

function extractIpRegion(ipCheck: IpCheckOutput): string | null {
  const location = ipCheck.ip_info?.location;
  if (!location) return null;

  if (typeof location.region === "string") return location.region;
  if (typeof location.city === "string") return location.city;
  return null;
}

function makeError(error: VerifyError): { error: VerifyError } {
  return { error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredStringField(
  source: Record<string, unknown>,
  field: string,
  fieldErrors: Record<string, string>
): string {
  const value = source[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    fieldErrors[field] = `${field} is required.`;
    return "";
  }

  return value.trim();
}

function parseConsentRequest(body: unknown): {
  request: ConsentRequest | null;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  if (!isRecord(body)) {
    fieldErrors.body = "Request body must be an object.";
    return { request: null, fieldErrors };
  }

  const userId = readRequiredStringField(body, "userId", fieldErrors);
  const consentVersion = readRequiredStringField(body, "consentVersion", fieldErrors);

  if (Object.keys(fieldErrors).length > 0) {
    return { request: null, fieldErrors };
  }

  return {
    request: {
      userId,
      consentVersion,
    },
    fieldErrors,
  };
}

function parseKeystrokeEvent(
  input: unknown,
  index: number,
  fieldErrors: Record<string, string>,
  prefix = "events"
): KeystrokeEvent | null {
  if (!isRecord(input)) {
    fieldErrors[`${prefix}[${index}]`] = "Each event must be an object.";
    return null;
  }

  const key = input.key;
  if (key !== undefined && (typeof key !== "string" || key.length === 0)) {
    fieldErrors[`${prefix}[${index}].key`] = "key must be a non-empty string when provided.";
  }

  const code = input.code;
  if (code !== undefined && (typeof code !== "string" || code.trim().length === 0)) {
    fieldErrors[`${prefix}[${index}].code`] = "code must be a non-empty string when provided.";
  }

  const type = input.type;
  const validType = type === "down" || type === "up";
  if (!validType) {
    fieldErrors[`${prefix}[${index}].type`] = "type must be 'down' or 'up'.";
  }

  const t = input.t;
  const validTime = typeof t === "number" && Number.isFinite(t);
  if (!validTime) {
    fieldErrors[`${prefix}[${index}].t`] = "t must be a finite number.";
  }

  const isRepeat = input.isRepeat;
  if (isRepeat !== undefined && typeof isRepeat !== "boolean") {
    fieldErrors[`${prefix}[${index}].isRepeat`] = "isRepeat must be a boolean when provided.";
  }

  const location = input.location;
  if (location !== undefined && !(typeof location === "number" && Number.isFinite(location))) {
    fieldErrors[`${prefix}[${index}].location`] = "location must be a finite number when provided.";
  }

  const expectedIndex = input.expectedIndex;
  if (
    expectedIndex !== undefined &&
    !(typeof expectedIndex === "number" && Number.isFinite(expectedIndex) && Number.isInteger(expectedIndex))
  ) {
    fieldErrors[`${prefix}[${index}].expectedIndex`] =
      "expectedIndex must be an integer when provided.";
  }

  if (!validType || !validTime) {
    return null;
  }

  return {
    ...(typeof key === "string" && key.length > 0 ? { key } : {}),
    ...(typeof code === "string" && code.trim().length > 0 ? { code: code.trim() } : {}),
    type: type as KeystrokeEvent["type"],
    t: t as number,
    ...(typeof isRepeat === "boolean" ? { isRepeat } : {}),
    ...(typeof location === "number" && Number.isFinite(location) ? { location } : {}),
    ...((typeof expectedIndex === "number" &&
      Number.isFinite(expectedIndex) &&
      Number.isInteger(expectedIndex))
      ? { expectedIndex }
      : {}),
  };
}

function parseEnrollKeystrokeRequest(body: unknown): {
  request: EnrollKeystrokeRequest | null;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  if (!isRecord(body)) {
    fieldErrors.body = "Request body must be an object.";
    return { request: null, fieldErrors };
  }

  const userId = readRequiredStringField(body, "userId", fieldErrors);

  const parseEvents = (value: unknown, fieldPath: string): KeystrokeEvent[] | null => {
    if (!Array.isArray(value) || value.length === 0) {
      fieldErrors[fieldPath] = `${fieldPath} must be a non-empty array.`;
      return null;
    }

    const parsedEvents: KeystrokeEvent[] = [];
    value.forEach((event, index) => {
      const parsed = parseKeystrokeEvent(event, index, fieldErrors, fieldPath);
      if (parsed) parsedEvents.push(parsed);
    });

    return parsedEvents;
  };

  let sample: KeystrokeSample | undefined;
  if (body.sample !== undefined) {
    if (!isRecord(body.sample)) {
      fieldErrors.sample = "sample must be an object when provided.";
    } else {
      const sampleEvents = parseEvents(body.sample.events, "sample.events");
      if (sampleEvents) {
        sample = {
          events: sampleEvents,
        };

        if (typeof body.sample.expectedText === "string") {
          sample.expectedText = body.sample.expectedText;
        }
        if (typeof body.sample.challengeId === "string" && body.sample.challengeId.trim().length > 0) {
          sample.challengeId = body.sample.challengeId.trim();
        }
        if (body.sample.source === "legacy" || body.sample.source === "collector_v1") {
          sample.source = body.sample.source;
        }
        if (typeof body.sample.typedLength === "number" && Number.isFinite(body.sample.typedLength)) {
          sample.typedLength = body.sample.typedLength;
        }
        if (typeof body.sample.errorCount === "number" && Number.isFinite(body.sample.errorCount)) {
          sample.errorCount = body.sample.errorCount;
        }
        if (
          typeof body.sample.backspaceCount === "number" &&
          Number.isFinite(body.sample.backspaceCount)
        ) {
          sample.backspaceCount = body.sample.backspaceCount;
        }
        if (
          typeof body.sample.ignoredEventCount === "number" &&
          Number.isFinite(body.sample.ignoredEventCount)
        ) {
          sample.ignoredEventCount = body.sample.ignoredEventCount;
        }
        if (typeof body.sample.imeCompositionUsed === "boolean") {
          sample.imeCompositionUsed = body.sample.imeCompositionUsed;
        }
      }
    }
  }

  const events = sample?.events ?? parseEvents(body.events, "events") ?? [];

  let challengeId: string | undefined;
  if (body.challengeId !== undefined) {
    if (typeof body.challengeId !== "string" || body.challengeId.trim().length === 0) {
      fieldErrors.challengeId = "challengeId must be a non-empty string when provided.";
    } else {
      challengeId = body.challengeId.trim();
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { request: null, fieldErrors };
  }

  return {
    request: {
      userId,
      challengeId,
      events: sample ? undefined : events,
      ...(sample ? { sample } : {}),
      ...(typeof body.expectedText === "string" ? { expectedText: body.expectedText } : {}),
      ...(typeof body.typedLength === "number" && Number.isFinite(body.typedLength)
        ? { typedLength: body.typedLength }
        : {}),
      ...(typeof body.errorCount === "number" && Number.isFinite(body.errorCount)
        ? { errorCount: body.errorCount }
        : {}),
      ...(typeof body.backspaceCount === "number" && Number.isFinite(body.backspaceCount)
        ? { backspaceCount: body.backspaceCount }
        : {}),
      ...(typeof body.imeCompositionUsed === "boolean"
        ? { imeCompositionUsed: body.imeCompositionUsed }
        : {}),
    },
    fieldErrors,
  };
}

function parseVerifyKeystrokeRequest(body: unknown): {
  request: VerifyKeystrokeRequest | null;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  if (!isRecord(body)) {
    fieldErrors.body = "Request body must be an object.";
    return { request: null, fieldErrors };
  }

  const userId = readRequiredStringField(body, "userId", fieldErrors);

  if (!isRecord(body.sample)) {
    fieldErrors.sample = "sample is required and must be an object.";
    return { request: null, fieldErrors };
  }

  const sampleEvents: KeystrokeEvent[] = [];
  if (!Array.isArray(body.sample.events) || body.sample.events.length === 0) {
    fieldErrors["sample.events"] = "sample.events must be a non-empty array.";
  } else {
    body.sample.events.forEach((event, index) => {
      const parsed = parseKeystrokeEvent(event, index, fieldErrors, "sample.events");
      if (parsed) sampleEvents.push(parsed);
    });
  }

  let policy: VerifyKeystrokeRequest["policy"] | undefined;
  if (body.policy !== undefined) {
    if (!isRecord(body.policy)) {
      fieldErrors.policy = "policy must be an object when provided.";
    } else {
      policy = body.policy as VerifyKeystrokeRequest["policy"];
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { request: null, fieldErrors };
  }

  const sample: KeystrokeSample = {
    events: sampleEvents,
    ...(typeof body.sample.expectedText === "string" ? { expectedText: body.sample.expectedText } : {}),
    ...(typeof body.sample.challengeId === "string" && body.sample.challengeId.trim().length > 0
      ? { challengeId: body.sample.challengeId.trim() }
      : {}),
    ...(typeof body.sample.typedLength === "number" && Number.isFinite(body.sample.typedLength)
      ? { typedLength: body.sample.typedLength }
      : {}),
    ...(typeof body.sample.errorCount === "number" && Number.isFinite(body.sample.errorCount)
      ? { errorCount: body.sample.errorCount }
      : {}),
    ...(typeof body.sample.backspaceCount === "number" && Number.isFinite(body.sample.backspaceCount)
      ? { backspaceCount: body.sample.backspaceCount }
      : {}),
    ...(typeof body.sample.ignoredEventCount === "number" &&
    Number.isFinite(body.sample.ignoredEventCount)
      ? { ignoredEventCount: body.sample.ignoredEventCount }
      : {}),
    ...(typeof body.sample.imeCompositionUsed === "boolean"
      ? { imeCompositionUsed: body.sample.imeCompositionUsed }
      : {}),
    ...(typeof body.sample.source === "string" &&
    (body.sample.source === "legacy" || body.sample.source === "collector_v1")
      ? { source: body.sample.source }
      : {}),
  };

  return {
    request: {
      userId,
      ...(typeof body.sessionId === "string" && body.sessionId.trim().length > 0
        ? { sessionId: body.sessionId.trim() }
        : {}),
      ...(typeof body.challengeId === "string" && body.challengeId.trim().length > 0
        ? { challengeId: body.challengeId.trim() }
        : {}),
      sample,
      ...(policy ? { policy } : {}),
    },
    fieldErrors,
  };
}

function parseDeleteBiometricsRequest(body: unknown): {
  request: DeleteBiometricsRequest | null;
  fieldErrors: Record<string, string>;
} {
  const fieldErrors: Record<string, string> = {};
  if (!isRecord(body)) {
    fieldErrors.body = "Request body must be an object.";
    return { request: null, fieldErrors };
  }

  const userId = readRequiredStringField(body, "userId", fieldErrors);

  if (Object.keys(fieldErrors).length > 0) {
    return { request: null, fieldErrors };
  }

  return {
    request: { userId },
    fieldErrors,
  };
}

function sendValidationError(
  res: Response,
  message: string,
  fieldErrors: Record<string, string> = {}
): void {
  const details = Object.keys(fieldErrors).length > 0 ? { fieldErrors } : undefined;
  const error: VerifyError = details
    ? { code: "VALIDATION_ERROR", message, details }
    : { code: "VALIDATION_ERROR", message };

  res.status(400).json(makeError(error));
}

function sendInternalError(res: Response, message: string, details?: unknown): void {
  const error: VerifyError =
    details === undefined
      ? { code: "INTERNAL_ERROR", message }
      : { code: "INTERNAL_ERROR", message, details };
  res.status(500).json(makeError(error));
}

function sendConsentRequired(res: Response): void {
  res.status(403).json(
    makeError({
      code: "CONSENT_REQUIRED",
      message: "Consent required before enrollment.",
    })
  );
}

function buildEmptyProfiles(userId: string, nowIso: string): UserProfiles {
  return {
    userId,
    keystroke: null,
    faceEmbedding: null,
    voiceEmbedding: null,
    updatedAt: nowIso,
  };
}

async function resolveNetworkCheck(args: {
  ip: string;
  clientOffsetMin: number | null;
  scenario?: RunIpCheckParams["scenario"];
  runIpCheck: RunIpCheckFn;
}): Promise<{ ipCheck: IpCheckOutput; network: NetworkResult }> {
  const ipCheck = await args.runIpCheck(args.ip, {
    clientOffsetMin: args.clientOffsetMin,
    scenario: args.scenario,
  });

  const network = computeNetworkResult(ipCheck, args.clientOffsetMin, args.ip);
  return { ipCheck, network };
}

function buildLocationResultFromIpCheck(args: {
  ipCheck: IpCheckOutput;
  allowedCountries?: string[];
}): LocationResult {
  const countryCode = extractCountryCode(args.ipCheck);
  const allowList = args.allowedCountries;
  const hasAllowList = Array.isArray(allowList) && allowList.length > 0;

  let allowed = true;
  const reasons: string[] = [];

  if (!countryCode) {
    reasons.push("COUNTRY_UNKNOWN");
  }

  if (hasAllowList) {
    if (!countryCode || !allowList.includes(countryCode)) {
      allowed = false;
      reasons.push("COUNTRY_NOT_ALLOWED");
    }
  }

  if (!hasAllowList && reasons.length === 1 && reasons[0] === "COUNTRY_UNKNOWN") {
    reasons.length = 0;
  }

  return {
    ok: allowed,
    countryCode,
    allowed,
    reasons,
  };
}

function mapNetworkToLegacyVpnResult(args: {
  network: NetworkResult;
  ipCheck: IpCheckOutput;
  clientMeta: VpnClientMetadata;
}): VerificationResult & { details: VpnCheckResultDetails } {
  const timezoneDriftHours =
    typeof args.network.ipInfo.driftMin === "number" ? args.network.ipInfo.driftMin / 60 : null;

  const details: VpnCheckResultDetails = {
    ip: args.network.ipInfo.ip ?? null,
    ipTimeZone: extractIpTimeZone(args.ipCheck),
    ipCountry: args.network.ipInfo.countryCode ?? null,
    ipRegion: extractIpRegion(args.ipCheck),
    isVpn: args.network.flags.vpn === true,
    isProxy: args.network.flags.proxy === true,
    isTor: args.network.flags.tor === true,
    isRelay: args.network.flags.relay === true,
    timezoneDriftHours,
    clientTimeZone: args.clientMeta.clientTimeZone,
    clientTimeOffsetMinutes: args.clientMeta.clientTimeOffsetMinutes,
    source: "vpnapi.io+ip_check.py",
    ipInfo: args.ipCheck.ip_info ?? null,
  };

  return {
    ok: args.network.ok,
    score: args.network.score,
    details,
  };
}

function mapLocationToLegacyResult(args: {
  ip: string;
  location: LocationResult;
  network: NetworkResult;
  ipCheck: IpCheckOutput;
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
}): LocationCountryResult {
  const ipCountryCode = args.location.countryCode ?? null;

  const matchesExpectedCountry =
    args.expectedCountryCode && ipCountryCode ? ipCountryCode === args.expectedCountryCode : null;

  const matchesClientCountry =
    args.clientCountryCode && ipCountryCode ? ipCountryCode === args.clientCountryCode : null;

  let score = 0.7;
  let reason: string | null = "no_expected_country";

  if (args.expectedCountryCode) {
    if (matchesExpectedCountry === true) {
      score = 1.0;
      reason = "match_expected";
    } else if (matchesExpectedCountry === false) {
      score = 0.2;
      reason = "expected_country_mismatch";
    }
  } else if (matchesClientCountry !== null) {
    if (matchesClientCountry === true) {
      score = 1.0;
      reason = "match_client_country";
    } else {
      score = 0.2;
      reason = "client_country_mismatch";
    }
  }

  let penalty = 0;
  if (args.network.flags.vpn) penalty += 0.4;
  if (args.network.flags.proxy) penalty += 0.3;
  if (args.network.flags.tor) penalty += 0.5;
  if (args.network.flags.relay) penalty += 0.2;

  score = Math.max(0, Math.min(1, score - penalty));

  if (args.network.flags.vpn || args.network.flags.proxy || args.network.flags.tor || args.network.flags.relay) {
    if (reason === "match_expected" || reason === "match_client_country") {
      reason = "country_match_but_ip_security_risky";
    } else if (!reason || reason === "no_expected_country") {
      reason = "ip_security_risky";
    }
  }

  return {
    ok: score >= 0.5,
    score,
    ipCountryCode,
    expectedCountryCode: args.expectedCountryCode,
    clientCountryCode: args.clientCountryCode,
    details: {
      ip: args.ip,
      ipCountryCode,
      expectedCountryCode: args.expectedCountryCode,
      clientCountryCode: args.clientCountryCode,
      matchesExpectedCountry,
      matchesClientCountry,
      reason,
      ipInfo: args.ipCheck.ip_info ?? null,
      security: {
        vpn: args.network.flags.vpn === true,
        proxy: args.network.flags.proxy === true,
        tor: args.network.flags.tor === true,
        relay: args.network.flags.relay === true,
      },
    },
  };
}

function resolvePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed);
}

export function createApp(deps: CreateAppDeps = {}) {
  const app = express();
  const runIpCheck = deps.runIpCheck ?? defaultRunIpCheck;
  const sessionStore = deps.sessionStore ?? new InMemorySessionStore();
  const challengeStore = deps.challengeStore ?? new InMemoryChallengeStore();
  const storage = deps.storage ?? new InMemoryAdapter();
  const challengeRng = deps.challengeRng ?? (() => Math.random());
  const nowFn = deps.nowFn ?? (() => Date.now());
  const nowFnIso = deps.nowFnIso ?? (() => new Date().toISOString());
  const challengeTtlMs = resolveChallengeTtlMs(deps.challengeTtlSeconds);
  const enrollmentMinRounds = resolvePositiveIntEnv(
    "KEYSTROKE_ENROLL_MIN_ROUNDS",
    DEFAULT_ENROLLMENT_MIN_ROUNDS
  );
  const enrollmentMinKeystrokes = resolvePositiveIntEnv(
    "KEYSTROKE_ENROLL_MIN_KEYSTROKES",
    DEFAULT_ENROLLMENT_MIN_KEYSTROKES
  );

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use(
    createSessionRouter({
      sessionStore,
      storage,
      nowFnIso,
    })
  );
  app.use(
    createChallengeRouter({
      challengeStore,
      rng: challengeRng,
      nowFn,
      ttlMs: challengeTtlMs,
    })
  );

  app.post("/consent", async (req: Request, res: Response) => {
    const { request: parsed, fieldErrors } = parseConsentRequest(req.body);
    if (!parsed) {
      sendValidationError(res, "Invalid consent request.", fieldErrors);
      return;
    }

    const grantedAt = nowFnIso();
    const log: ConsentLog = {
      userId: parsed.userId,
      consentVersion: parsed.consentVersion,
      grantedAt,
    };

    try {
      await storage.appendConsentLog(log);

      const response: ConsentResponse = {
        ok: true,
        userId: parsed.userId,
        consentVersion: parsed.consentVersion,
        grantedAt,
      };

      res.status(200).json(response);
    } catch (error) {
      sendInternalError(
        res,
        "Failed to persist consent.",
        error instanceof Error ? error.message : error
      );
    }
  });

  app.post("/enroll/keystroke", async (req: Request, res: Response) => {
    const { request: parsed, fieldErrors } = parseEnrollKeystrokeRequest(req.body);
    if (!parsed) {
      sendValidationError(res, "Invalid keystroke enrollment request.", fieldErrors);
      return;
    }

    try {
      const latestConsent = await storage.getLatestConsent(parsed.userId);
      if (!latestConsent) {
        sendConsentRequired(res);
        return;
      }

      const nowIso = nowFnIso();
      const existingProfiles = await storage.getProfiles(parsed.userId);
      const built = buildKeystrokeProfile({
        userId: parsed.userId,
        nowIso,
        existingProfile: existingProfiles?.keystroke ?? null,
        sample: parsed.sample,
        events: parsed.events,
        expectedText: parsed.expectedText,
        typedLength: parsed.typedLength,
        errorCount: parsed.errorCount,
        backspaceCount: parsed.backspaceCount,
        imeCompositionUsed: parsed.imeCompositionUsed,
        enrollmentTargets: {
          minRounds: enrollmentMinRounds,
          minKeystrokes: enrollmentMinKeystrokes,
        },
      });

      const profile: KeystrokeProfile = built.profile;

      const nextProfiles: UserProfiles = {
        userId: parsed.userId,
        keystroke: profile,
        faceEmbedding: existingProfiles?.faceEmbedding ?? null,
        voiceEmbedding: existingProfiles?.voiceEmbedding ?? null,
        updatedAt: nowIso,
      };

      await storage.saveProfiles(parsed.userId, nextProfiles);

      const response: EnrollKeystrokeResponse = {
        ok: true,
        profile,
        sampleMetrics: built.sampleMetrics,
        enrollmentProgress: built.enrollmentProgress,
        reasons: built.reasons,
      };

      res.status(200).json(response);
    } catch (error) {
      sendInternalError(
        res,
        "Failed to enroll keystroke profile.",
        error instanceof Error ? error.message : error
      );
    }
  });

  app.post("/verify/keystroke", async (req: Request, res: Response) => {
    const { request: parsed, fieldErrors } = parseVerifyKeystrokeRequest(req.body);
    if (!parsed) {
      sendValidationError(res, "Invalid keystroke verification request.", fieldErrors);
      return;
    }

    try {
      const verified = await verifyKeystrokeAgainstProfile({
        userId: parsed.userId,
        sample: parsed.sample,
        policy: parsed.policy,
        storage,
        nowIso: nowFnIso(),
      });

      const response: VerifyKeystrokeResponse = {
        ok: true,
        userId: parsed.userId,
        similarityScore: verified.signal.similarityScore,
        distance: verified.signal.distance,
        decision: verified.signal.decision,
        reasons: verified.signal.reasons,
        sampleMetrics: verified.signal.sampleMetrics,
        profile: verified.profile ?? null,
        profileUpdated: verified.profileUpdated,
        signalsUsed: {
          keystroke: verified.signal,
        },
      };

      res.status(200).json(response);
    } catch (error) {
      sendInternalError(
        res,
        "Failed to verify keystroke sample.",
        error instanceof Error ? error.message : error
      );
    }
  });

  app.get("/user/:userId/profiles", async (req: Request, res: Response) => {
    const userId = typeof req.params.userId === "string" ? req.params.userId.trim() : "";
    if (!userId) {
      sendValidationError(res, "Invalid user profile request.", {
        userId: "userId is required.",
      });
      return;
    }

    try {
      const profiles = (await storage.getProfiles(userId)) ?? buildEmptyProfiles(userId, nowFnIso());
      const response: GetProfilesResponse = {
        ok: true,
        profiles,
      };
      res.status(200).json(response);
    } catch (error) {
      sendInternalError(
        res,
        "Failed to read user profiles.",
        error instanceof Error ? error.message : error
      );
    }
  });

  app.delete("/user/biometrics", async (req: Request, res: Response) => {
    const { request: parsed, fieldErrors } = parseDeleteBiometricsRequest(req.body);
    if (!parsed) {
      sendValidationError(res, "Invalid delete biometrics request.", fieldErrors);
      return;
    }

    const deleteConsentRaw = req.query.deleteConsent;
    const deleteConsent =
      typeof deleteConsentRaw === "string"
        ? deleteConsentRaw.toLowerCase() === "true"
        : Array.isArray(deleteConsentRaw)
          ? deleteConsentRaw.some((value) => String(value).toLowerCase() === "true")
          : false;

    try {
      await storage.deleteProfiles(parsed.userId);

      if (deleteConsent) {
        const storageWithDeleteConsent = storage as StorageAdapter & {
          deleteConsentLogs?: (userId: string) => Promise<void>;
        };

        if (typeof storageWithDeleteConsent.deleteConsentLogs === "function") {
          await storageWithDeleteConsent.deleteConsentLogs(parsed.userId);
        }
      }

      const response: DeleteBiometricsResponse = {
        ok: true,
        userId: parsed.userId,
      };

      res.status(200).json(response);
    } catch (error) {
      sendInternalError(
        res,
        "Failed to delete biometrics.",
        error instanceof Error ? error.message : error
      );
    }
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post("/verify/webauthn:passkey", (req: Request, res: Response) => {
    const { proof } = req.body ?? {};
    const ok = !!proof;

    const result: VerificationResult = {
      ok,
      score: ok ? 1 : 0,
    };

    res.json(result);
  });

  app.post("/verify/face:liveness", (req: Request, res: Response) => {
    const { proof, metrics } = req.body ?? {};
    const ok = proof?.tasksOk === true && (metrics?.quality ?? 0) > 0.8;

    const result: VerificationResult = {
      ok,
      score: ok ? 1 : 0,
    };

    res.json(result);
  });

  app.post("/verify/network", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const clientOffsetMin = parseClientOffsetMin(req.body);
    const scenario = parseMockScenario(req.body);

    if (!ip) {
      res.status(400).json(
        makeError({
          code: "IP_NOT_FOUND",
          message: "Client IP could not be determined.",
        })
      );
      return;
    }

    try {
      const { network } = await resolveNetworkCheck({
        ip,
        clientOffsetMin,
        scenario,
        runIpCheck,
      });

      res.json(network);
    } catch (error) {
      res.status(502).json(
        makeError({
          code: "IP_CHECK_FAILED",
          message: "Failed to run IP verification pipeline.",
          details: error instanceof Error ? error.message : error,
        })
      );
    }
  });

  app.post("/verify/location", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const allowedCountries = parseAllowedCountries(req.body);
    const scenario = parseMockScenario(req.body);

    if (!ip) {
      res.status(400).json(
        makeError({
          code: "IP_NOT_FOUND",
          message: "Client IP could not be determined.",
        })
      );
      return;
    }

    try {
      const ipCheck = await runIpCheck(ip, { scenario });
      const location = buildLocationResultFromIpCheck({
        ipCheck,
        allowedCountries,
      });

      res.json(location);
    } catch (error) {
      res.status(502).json(
        makeError({
          code: "IP_CHECK_FAILED",
          message: "Failed to run IP verification pipeline.",
          details: error instanceof Error ? error.message : error,
        })
      );
    }
  });

  app.post("/verify/vpn:check", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const clientMeta = parseVpnClientMetadata(req);

    if (!ip) {
      const result: VerificationResult & { details: VpnCheckResultDetails } = {
        ok: false,
        score: 0,
        details: {
          ip: null,
          ipTimeZone: null,
          ipCountry: null,
          ipRegion: null,
          isVpn: false,
          isProxy: false,
          isTor: false,
          isRelay: false,
          timezoneDriftHours: null,
          clientTimeZone: clientMeta.clientTimeZone,
          clientTimeOffsetMinutes: clientMeta.clientTimeOffsetMinutes,
          source: "ip_missing",
          ipInfo: null,
        },
      };

      res.status(400).json(result);
      return;
    }

    try {
      const { ipCheck, network } = await resolveNetworkCheck({
        ip,
        clientOffsetMin: clientMeta.clientTimeOffsetMinutes,
        runIpCheck,
      });

      const result = mapNetworkToLegacyVpnResult({
        network,
        ipCheck,
        clientMeta,
      });

      res.json(result);
    } catch (_error) {
      const details: VpnCheckResultDetails = {
        ip,
        ipTimeZone: null,
        ipCountry: null,
        ipRegion: null,
        isVpn: false,
        isProxy: false,
        isTor: false,
        isRelay: false,
        timezoneDriftHours: null,
        clientTimeZone: clientMeta.clientTimeZone,
        clientTimeOffsetMinutes: clientMeta.clientTimeOffsetMinutes,
        source: "ip_check_failed",
        ipInfo: null,
      };

      res.status(500).json({
        ok: false,
        score: 0,
        details,
      } satisfies VerificationResult & { details: VpnCheckResultDetails });
    }
  });

  app.post("/verify/location:country", async (req: Request, res: Response) => {
    const ip = getClientIp(req);
    const { expectedCountryCode, clientCountryCode } = parseLegacyCountryInputs(req.body);
    const scenario = parseMockScenario(req.body);

    if (!ip) {
      const result: LocationCountryResult = {
        ok: false,
        score: 0,
        ipCountryCode: null,
        expectedCountryCode,
        clientCountryCode,
        details: {
          ip: null,
          ipCountryCode: null,
          expectedCountryCode,
          clientCountryCode,
          matchesExpectedCountry: null,
          matchesClientCountry: null,
          reason: "no_ip",
          ipInfo: null,
          security: {
            vpn: null,
            proxy: null,
            tor: null,
            relay: null,
          },
        },
      };

      res.status(400).json(result);
      return;
    }

    try {
      const allowedCountries = expectedCountryCode
        ? [expectedCountryCode]
        : clientCountryCode
          ? [clientCountryCode]
          : undefined;

      const ipCheck = await runIpCheck(ip, {
        expectedCountryCode: expectedCountryCode ?? clientCountryCode,
        scenario,
      });

      const location = buildLocationResultFromIpCheck({
        ipCheck,
        allowedCountries,
      });

      const network = computeNetworkResult(ipCheck, parseClientOffsetMin(req.body), ip);

      const result = mapLocationToLegacyResult({
        ip,
        location,
        network,
        ipCheck,
        expectedCountryCode,
        clientCountryCode,
      });

      res.json(result);
    } catch (_error) {
      const result: LocationCountryResult = {
        ok: false,
        score: 0,
        ipCountryCode: null,
        expectedCountryCode,
        clientCountryCode,
        details: {
          ip,
          ipCountryCode: null,
          expectedCountryCode,
          clientCountryCode,
          matchesExpectedCountry: null,
          matchesClientCountry: null,
          reason: "ip_check_failed",
          ipInfo: null,
          security: {
            vpn: null,
            proxy: null,
            tor: null,
            relay: null,
          },
        },
      };

      res.status(500).json(result);
    }
  });

  return app;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === path.resolve(__filename);
}

if (isDirectRun()) {
  const PORT = Number(process.env.PORT) || 3001;
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`node-auth listening on http://localhost:${PORT}`);
  });
}
