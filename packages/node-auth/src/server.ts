import cors from "cors";
import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { LocationResult, NetworkResult, VerifyError } from "@securekit/core";
import {
  runIpCheck as defaultRunIpCheck,
  type IpCheckOutput,
  type RunIpCheckParams,
} from "./services/ipCheck";
import { computeNetworkResult } from "./services/networkScore";

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

async function resolveNetworkCheck(args: {
  ip: string;
  clientOffsetMin: number | null;
  runIpCheck: RunIpCheckFn;
}): Promise<{ ipCheck: IpCheckOutput; network: NetworkResult }> {
  const ipCheck = await args.runIpCheck(args.ip, {
    clientOffsetMin: args.clientOffsetMin,
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

export function createApp(deps: CreateAppDeps = {}) {
  const app = express();
  const runIpCheck = deps.runIpCheck ?? defaultRunIpCheck;

  app.use(cors());
  app.use(express.json({ limit: "2mb" }));

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
      const ipCheck = await runIpCheck(ip);
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
