import type {
  ChallengeTextRequest,
  ChallengeTextResponse,
  ConsentRequest,
  ConsentResponse,
  DeleteBiometricsResponse,
  EnrollKeystrokeRequest,
  EnrollKeystrokeResponse,
  GetProfilesResponse,
  LocationResult,
  NetworkResult,
  SessionPolicy,
  SessionStartResponse,
  VerifySessionRequest,
  VerifySessionResponse,
} from "@securekit/core";
import {
  HttpTransport,
  HttpError,
  type FetchLike,
} from "./transport";

export type {
  ChallengeLang,
  ChallengeLength,
  ChallengeTextRequest,
  ChallengeTextResponse,
  ConsentRequest,
  ConsentResponse,
  ConsumeChallengeRequest,
  ConsumeChallengeResponse,
  DeleteBiometricsResponse,
  LocationResult,
  EnrollKeystrokeRequest,
  EnrollKeystrokeResponse,
  GetProfilesResponse,
  RequiredStep,
  RiskDecision,
  NetworkFlags,
  NetworkIpInfo,
  NetworkResult,
  SessionPolicy,
  SessionStartResponse,
  VerifySessionRequest,
  VerifySessionResponse,
  VerifyStep,
  VerifyError,
} from "@securekit/core";
export { HttpTransport, HttpError } from "./transport";

export interface VerificationResult {
  ok: boolean;
  score: number;
  details?: unknown;
}

export interface VpnCheckDetails {
  ip: string | null;
  ipTimeZone: string | null;
  ipCountry: string | null;
  ipRegion: string | null;
  isVpn: boolean;
  isProxy: boolean;
  isTor: boolean;
  isRelay: boolean;
  timezoneDriftHours: number | null;
  clientTimeZone: string | null;
  clientTimeOffsetMinutes: number | null;
  source: string | null;
  ipInfo?: unknown;
}

export interface LocationCountryResultDetails {
  ip: string | null;
  ipCountryCode: string | null;
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
  matchesExpectedCountry: boolean | null;
  matchesClientCountry: boolean | null;
  reason: string | null;
  ipInfo?: unknown;
  security?: {
    vpn?: boolean | null;
    proxy?: boolean | null;
    tor?: boolean | null;
    relay?: boolean | null;
  };
}

export interface LocationCountryResult {
  ok: boolean;
  score: number;
  ipCountryCode: string | null;
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
  details?: LocationCountryResultDetails;
}

export interface VpnPolicyConfig {
  allowVpn?: boolean;
  allowProxy?: boolean;
  allowTor?: boolean;
  allowRelay?: boolean;
  minScore?: number;
}

export interface LocationPolicyConfig {
  requireCountryMatch?: boolean;
  allowedCountries?: string[];
  minScore?: number;
  treatVpnAsFailure?: boolean;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  effectiveScore: number;
}

export interface VpnVerificationWithDecision {
  raw: VerificationResult & { details?: VpnCheckDetails };
  decision: PolicyDecision;
}

export interface LocationVerificationWithDecision {
  raw: LocationCountryResult;
  decision: PolicyDecision;
}

export interface VerifyNetworkOptions {
  clientOffsetMin?: number | null;
}

export interface VerifyLocationOptions {
  allowedCountries?: string[];
}

export interface SecureKitClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
  vpnPolicy?: VpnPolicyConfig;
  locationPolicy?: LocationPolicyConfig;
}

function normalizeCountryCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const trimmed = code.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

function getLocationFromRaw(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object") return {};
  const candidate = (raw as { location?: unknown }).location;
  if (!candidate || typeof candidate !== "object") return {};
  return candidate as Record<string, unknown>;
}

function computeLegacyLocationScore(args: {
  ipCountryCode: string | null;
  expectedCountryCode: string | null;
  clientCountryCode: string | null;
  network: NetworkResult;
}): { score: number; reason: string | null } {
  const { ipCountryCode, expectedCountryCode, clientCountryCode, network } = args;

  const matchesExpectedCountry =
    expectedCountryCode && ipCountryCode ? ipCountryCode === expectedCountryCode : null;

  const matchesClientCountry =
    clientCountryCode && ipCountryCode ? ipCountryCode === clientCountryCode : null;

  let score = 0.7;
  let reason: string | null = "no_expected_country";

  if (expectedCountryCode) {
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
  if (network.flags.vpn) penalty += 0.4;
  if (network.flags.proxy) penalty += 0.3;
  if (network.flags.tor) penalty += 0.5;
  if (network.flags.relay) penalty += 0.2;

  score = Math.max(0, Math.min(1, score - penalty));

  if (network.flags.vpn || network.flags.proxy || network.flags.tor || network.flags.relay) {
    if (reason === "match_expected" || reason === "match_client_country") {
      reason = "country_match_but_ip_security_risky";
    } else if (!reason || reason === "no_expected_country") {
      reason = "ip_security_risky";
    }
  }

  return { score, reason };
}

export class SecureKitClient {
  private readonly transport: HttpTransport;
  private readonly vpnPolicy?: VpnPolicyConfig;
  private readonly locationPolicy?: LocationPolicyConfig;

  constructor(options: SecureKitClientOptions) {
    this.transport = new HttpTransport({
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
    });
    this.vpnPolicy = options.vpnPolicy;
    this.locationPolicy = options.locationPolicy;
  }

  async health(): Promise<{ ok: boolean }> {
    return this.transport.get<{ ok: boolean }>("/health");
  }

  async verifyNetwork(options: VerifyNetworkOptions = {}): Promise<NetworkResult> {
    const clientOffsetMin =
      typeof options.clientOffsetMin === "number"
        ? options.clientOffsetMin
        : this.getClientOffsetMin();

    return this.transport.post<NetworkResult>("/verify/network", {
      clientOffsetMin,
    });
  }

  async verifyLocation(options: VerifyLocationOptions = {}): Promise<LocationResult> {
    const body = options.allowedCountries
      ? { allowedCountries: options.allowedCountries }
      : {};

    return this.transport.post<LocationResult>("/verify/location", body);
  }

  async getTextChallenge(options: ChallengeTextRequest = {}): Promise<ChallengeTextResponse> {
    const body = {
      lang: options.lang,
      length: options.length,
      sessionId: options.sessionId,
    };

    return this.transport.post<ChallengeTextResponse>("/challenge/text", body);
  }

  async startSession(): Promise<SessionStartResponse> {
    return this.transport.post<SessionStartResponse>("/session/start");
  }

  async verifySession(args: {
    sessionId: string;
    policy?: SessionPolicy;
    signals?: VerifySessionRequest["signals"];
  }): Promise<VerifySessionResponse> {
    return this.transport.post<VerifySessionResponse>("/verify/session", args);
  }

  async grantConsent(args: ConsentRequest): Promise<ConsentResponse> {
    return this.transport.post<ConsentResponse>("/consent", args);
  }

  async enrollKeystroke(args: EnrollKeystrokeRequest): Promise<EnrollKeystrokeResponse> {
    return this.transport.post<EnrollKeystrokeResponse>("/enroll/keystroke", args);
  }

  async getProfiles(userId: string): Promise<GetProfilesResponse> {
    return this.transport.get<GetProfilesResponse>(`/user/${encodeURIComponent(userId)}/profiles`);
  }

  async deleteBiometrics(userId: string): Promise<DeleteBiometricsResponse> {
    return this.transport.delete<DeleteBiometricsResponse>("/user/biometrics", {
      userId,
    });
  }

  /** @deprecated Use verifyNetwork instead. */
  async verifyVpn(): Promise<VerificationResult & { details?: VpnCheckDetails }> {
    const clientTimeZone = this.getClientTimeZone();
    const clientTimeOffsetMinutes = this.getClientOffsetMin();

    const network = await this.verifyNetwork({
      clientOffsetMin: clientTimeOffsetMinutes,
    });

    const location = getLocationFromRaw(network.raw);

    return {
      ok: network.ok,
      score: network.score,
      details: {
        ip: network.ipInfo.ip ?? null,
        ipTimeZone:
          typeof location.time_zone === "string" ? (location.time_zone as string) : null,
        ipCountry: network.ipInfo.countryCode ?? null,
        ipRegion:
          typeof location.region === "string"
            ? (location.region as string)
            : typeof location.city === "string"
              ? (location.city as string)
              : null,
        isVpn: network.flags.vpn === true,
        isProxy: network.flags.proxy === true,
        isTor: network.flags.tor === true,
        isRelay: network.flags.relay === true,
        timezoneDriftHours:
          typeof network.ipInfo.driftMin === "number"
            ? network.ipInfo.driftMin / 60
            : null,
        clientTimeZone,
        clientTimeOffsetMinutes,
        source: "vpnapi.io+ip_check.py",
        ipInfo: network.raw ?? null,
      },
    };
  }

  async verifyVpnWithPolicy(
    policyOverride?: VpnPolicyConfig
  ): Promise<VpnVerificationWithDecision> {
    const raw = await this.verifyVpn();
    const mergedPolicy: VpnPolicyConfig = {
      ...(this.vpnPolicy ?? {}),
      ...(policyOverride ?? {}),
    };
    const decision = this.evaluateVpnPolicy(raw, mergedPolicy);
    return { raw, decision };
  }

  private evaluateVpnPolicy(
    result: VerificationResult & { details?: VpnCheckDetails },
    policy?: VpnPolicyConfig
  ): PolicyDecision {
    const minScore = policy?.minScore ?? 0.5;
    const details = result.details;

    const isVpn = details?.isVpn === true;
    const isProxy = details?.isProxy === true;
    const isTor = details?.isTor === true;
    const isRelay = details?.isRelay === true;

    if (policy) {
      if (policy.allowVpn === false && isVpn) {
        return {
          allowed: false,
          reason: "vpn_not_allowed",
          effectiveScore: result.score,
        };
      }
      if (policy.allowProxy === false && isProxy) {
        return {
          allowed: false,
          reason: "proxy_not_allowed",
          effectiveScore: result.score,
        };
      }
      if (policy.allowTor === false && isTor) {
        return {
          allowed: false,
          reason: "tor_not_allowed",
          effectiveScore: result.score,
        };
      }
      if (policy.allowRelay === false && isRelay) {
        return {
          allowed: false,
          reason: "relay_not_allowed",
          effectiveScore: result.score,
        };
      }
    }

    if (result.score < minScore) {
      return {
        allowed: false,
        reason: "score_below_min",
        effectiveScore: result.score,
      };
    }

    return {
      allowed: true,
      reason: "ok",
      effectiveScore: result.score,
    };
  }

  /** @deprecated Use verifyLocation instead. */
  async verifyLocationCountryAuto(): Promise<LocationCountryResult> {
    const autoCountry = this.getNavigatorCountryCode();
    return this.verifyLocationCountry(autoCountry ?? undefined);
  }

  /** @deprecated Use verifyLocation instead. */
  async verifyLocationCountry(
    expectedCountryCode?: string
  ): Promise<LocationCountryResult> {
    const normalizedExpected = normalizeCountryCode(expectedCountryCode ?? null);
    const normalizedClient = normalizeCountryCode(this.getNavigatorCountryCode());

    const allowedCountries = normalizedExpected
      ? [normalizedExpected]
      : normalizedClient
        ? [normalizedClient]
        : undefined;

    const [location, network] = await Promise.all([
      this.verifyLocation({ allowedCountries }),
      this.verifyNetwork(),
    ]);

    const ipCountryCode = normalizeCountryCode(location.countryCode ?? null);
    const matchesExpectedCountry =
      normalizedExpected && ipCountryCode ? ipCountryCode === normalizedExpected : null;
    const matchesClientCountry =
      normalizedClient && ipCountryCode ? ipCountryCode === normalizedClient : null;

    const { score, reason } = computeLegacyLocationScore({
      ipCountryCode,
      expectedCountryCode: normalizedExpected,
      clientCountryCode: normalizedClient,
      network,
    });

    return {
      ok: score >= 0.5,
      score,
      ipCountryCode,
      expectedCountryCode: normalizedExpected,
      clientCountryCode: normalizedClient,
      details: {
        ip: network.ipInfo.ip ?? null,
        ipCountryCode,
        expectedCountryCode: normalizedExpected,
        clientCountryCode: normalizedClient,
        matchesExpectedCountry,
        matchesClientCountry,
        reason,
        ipInfo: network.raw ?? null,
        security: {
          vpn: network.flags.vpn === true,
          proxy: network.flags.proxy === true,
          tor: network.flags.tor === true,
          relay: network.flags.relay === true,
        },
      },
    };
  }

  async verifyLocationCountryWithPolicy(
    expectedCountryCode?: string,
    policyOverride?: LocationPolicyConfig
  ): Promise<LocationVerificationWithDecision> {
    const raw = await this.verifyLocationCountry(expectedCountryCode);
    const mergedPolicy: LocationPolicyConfig = {
      ...(this.locationPolicy ?? {}),
      ...(policyOverride ?? {}),
    };
    const decision = this.evaluateLocationPolicy(raw, mergedPolicy);
    return { raw, decision };
  }

  private evaluateLocationPolicy(
    result: LocationCountryResult,
    policy?: LocationPolicyConfig
  ): PolicyDecision {
    const minScore = policy?.minScore ?? 0.5;
    const details = result.details;

    const ipCountry = normalizeCountryCode(result.ipCountryCode);
    const expected = normalizeCountryCode(
      result.expectedCountryCode ?? details?.expectedCountryCode ?? undefined
    );
    const client = normalizeCountryCode(
      result.clientCountryCode ?? details?.clientCountryCode ?? undefined
    );

    if (policy?.requireCountryMatch) {
      if (expected && ipCountry && ipCountry !== expected) {
        return {
          allowed: false,
          reason: "ip_country_mismatch_expected",
          effectiveScore: result.score,
        };
      }
      if (!expected && client && ipCountry && ipCountry !== client) {
        return {
          allowed: false,
          reason: "ip_country_mismatch_client",
          effectiveScore: result.score,
        };
      }
    }

    if (policy?.allowedCountries && ipCountry) {
      const allowedNormalized = policy.allowedCountries
        .map((country) => normalizeCountryCode(country))
        .filter((country): country is string => Boolean(country));

      if (allowedNormalized.length > 0 && !allowedNormalized.includes(ipCountry)) {
        return {
          allowed: false,
          reason: "ip_country_not_allowed",
          effectiveScore: result.score,
        };
      }
    }

    if (policy?.treatVpnAsFailure && details?.security) {
      const security = details.security;
      if (security.vpn || security.proxy || security.tor || security.relay) {
        return {
          allowed: false,
          reason: "ip_security_not_allowed",
          effectiveScore: result.score,
        };
      }
    }

    if (result.score < minScore) {
      return {
        allowed: false,
        reason: "score_below_min",
        effectiveScore: result.score,
      };
    }

    return {
      allowed: true,
      reason: "ok",
      effectiveScore: result.score,
    };
  }

  async verifyPasskey(proof: unknown): Promise<VerificationResult> {
    try {
      return await this.transport.post<VerificationResult>("/verify/webauthn:passkey", {
        proof,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        throw new Error(`Passkey verify failed: ${error.status}`);
      }
      throw error;
    }
  }

  async verifyFaceLiveness(payload: {
    proof?: { tasksOk?: boolean };
    metrics?: { quality?: number };
  }): Promise<VerificationResult> {
    try {
      return await this.transport.post<VerificationResult>("/verify/face:liveness", payload);
    } catch (error) {
      if (error instanceof HttpError) {
        throw new Error(`Face liveness failed: ${error.status}`);
      }
      throw error;
    }
  }

  private getClientTimeZone(): string | null {
    if (typeof Intl === "undefined") return null;
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  }

  private getClientOffsetMin(): number | null {
    if (typeof Date === "undefined") return null;
    return -new Date().getTimezoneOffset();
  }

  private getNavigatorCountryCode(): string | null {
    if (typeof navigator === "undefined") return null;

    const anyNav = navigator as Navigator & {
      language?: string;
      languages?: string[];
    };

    const lang =
      anyNav.language ||
      (Array.isArray(anyNav.languages) ? anyNav.languages[0] : undefined);

    if (!lang || typeof lang !== "string") return null;

    const parts = lang.split("-");
    if (parts.length >= 2) {
      const country = parts[1];
      if (country && country.length >= 2) {
        return country.toUpperCase();
      }
    }

    if (lang.length === 2) {
      return lang.toUpperCase();
    }

    return null;
  }
}
