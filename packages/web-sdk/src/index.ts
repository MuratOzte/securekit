// packages/web-sdk/src/index.ts

// --------------------------------------------------
// Temel tipler
// --------------------------------------------------

export interface VerificationResult {
    ok: boolean;
    score: number;
    details?: unknown;
}

/**
 * /verify/vpn:check detayları – backend'deki VpnCheckResultDetails ile uyumlu
 */
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

/**
 * /verify/location:country detayları – backend'deki LocationCountryResultDetails ile uyumlu
 */
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

/**
 * /verify/location:country sonucu – backend cevabı
 */
export interface LocationCountryResult {
    ok: boolean;
    score: number;
    ipCountryCode: string | null;
    expectedCountryCode: string | null;
    clientCountryCode: string | null;
    details?: LocationCountryResultDetails;
}

// --------------------------------------------------
// Politika yapı taşları
// --------------------------------------------------

/**
 * VPN politikası:
 * - allowVpn/proxy/tor/relay: false ise, ilgili flag true olduğunda direkt fail.
 * - minScore: backend score'u bu değerin altındaysa fail.
 */
export interface VpnPolicyConfig {
    allowVpn?: boolean; // varsayılan: undefined => sadece skora bak
    allowProxy?: boolean; // varsayılan: undefined => sadece skora bak
    allowTor?: boolean;
    allowRelay?: boolean;
    minScore?: number; // varsayılan: 0.5
}

/**
 * Konum / ülke politikası:
 * - requireCountryMatch: true ise IP ülkesi expected veya client country ile
 *   uyuşmazsa fail.
 * - allowedCountries: sadece bu ülkelere izin ver (örn: ["TR", "DE"])
 * - minScore: backend score'u bu değerin altındaysa fail.
 * - treatVpnAsFailure: true ise, security.vpn/proxy/tor/relay'den biri true ise fail.
 */
export interface LocationPolicyConfig {
    requireCountryMatch?: boolean;
    allowedCountries?: string[];
    minScore?: number; // varsayılan: 0.5
    treatVpnAsFailure?: boolean;
}

/**
 * Politika uygulandıktan sonra verilen karar
 */
export interface PolicyDecision {
    allowed: boolean;
    reason: string; // örn: "ok", "vpn_not_allowed", "score_below_min"
    effectiveScore: number; // politikanın değerlendirdiği score (genelde backend score)
}

/**
 * Vpn sonucu + policy kararı
 */
export interface VpnVerificationWithDecision {
    raw: VerificationResult & { details?: VpnCheckDetails };
    decision: PolicyDecision;
}

/**
 * Location sonucu + policy kararı
 */
export interface LocationVerificationWithDecision {
    raw: LocationCountryResult;
    decision: PolicyDecision;
}

/**
 * Client konfigürasyonu – her uygulama kendi politikasını verebilir
 */
export interface SecureKitClientOptions {
    baseUrl: string; // ör: "http://localhost:3001"

    // İsteğe bağlı global politikalar (override edilebilir)
    vpnPolicy?: VpnPolicyConfig;
    locationPolicy?: LocationPolicyConfig;
}

// --------------------------------------------------
// Yardımcı fonksiyonlar
// --------------------------------------------------

function normalizeCountryCode(code: string | null | undefined): string | null {
    if (!code) return null;
    const trimmed = code.trim();
    if (!trimmed) return null;
    return trimmed.toUpperCase();
}

// --------------------------------------------------
// Ana client
// --------------------------------------------------

export class SecureKitClient {
    private baseUrl: string;
    private vpnPolicy?: VpnPolicyConfig;
    private locationPolicy?: LocationPolicyConfig;

    constructor(options: SecureKitClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
        this.vpnPolicy = options.vpnPolicy;
        this.locationPolicy = options.locationPolicy;
    }

    /**
     * Basit health check
     */
    async health(): Promise<{ ok: boolean }> {
        const res = await fetch(`${this.baseUrl}/health`);
        if (!res.ok) {
            throw new Error(`Health check failed: ${res.status}`);
        }
        return res.json();
    }

    // --------------------------------------------------
    // VPN CHECK – ham sonuç
    // --------------------------------------------------

    /**
     * VPN/proxy/Tor + timezone tutarlılığı kontrolü.
     *
     * SDK burada:
     *  - clientTimeZone (örn: "Europe/Istanbul")
     *  - clientTimeOffsetMinutes (UTC'den kaç dakika ileride/geride)
     * hesaplayıp backend'e gönderir.
     *
     * Dönen değer backend'in ürettiği ham skordur (henüz politika uygulanmamış).
     */
    async verifyVpn(): Promise<
        VerificationResult & { details?: VpnCheckDetails }
    > {
        const clientTimeZone =
            Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;

        // JS: getTimezoneOffset() "kaç dakika GERİDESİN" diye verir (İstanbul için +180).
        // Backend ile uyum için işaretini çeviriyoruz:
        //   İstanbul (UTC+3) => clientTimeOffsetMinutes = 180
        const clientTimeOffsetMinutes = -new Date().getTimezoneOffset();

        const res = await fetch(`${this.baseUrl}/verify/vpn:check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientTimeZone,
                clientTimeOffsetMinutes,
            }),
        });

        if (!res.ok) {
            throw new Error(`VPN check failed: ${res.status}`);
        }

        return res.json();
    }

    /**
     * VPN check + politika kararı birlikte:
     *
     *  const { raw, decision } = await client.verifyVpnWithPolicy({
     *    allowVpn: false,
     *    allowProxy: true,
     *    allowTor: false,
     *    minScore: 0.6,
     *  });
     */
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
        const details = (result.details ?? {}) as VpnCheckDetails;

        const isVpn = !!details.isVpn;
        const isProxy = !!details.isProxy;
        const isTor = !!details.isTor;
        const isRelay = !!details.isRelay;

        // Politika: VPN/Proxy/Tor/Relay yasak mı?
        if (policy) {
            if (policy.allowVpn === false && isVpn) {
                return {
                    allowed: false,
                    reason: 'vpn_not_allowed',
                    effectiveScore: result.score,
                };
            }
            if (policy.allowProxy === false && isProxy) {
                return {
                    allowed: false,
                    reason: 'proxy_not_allowed',
                    effectiveScore: result.score,
                };
            }
            if (policy.allowTor === false && isTor) {
                return {
                    allowed: false,
                    reason: 'tor_not_allowed',
                    effectiveScore: result.score,
                };
            }
            if (policy.allowRelay === false && isRelay) {
                return {
                    allowed: false,
                    reason: 'relay_not_allowed',
                    effectiveScore: result.score,
                };
            }
        }

        // Score eşiği
        if (result.score < minScore) {
            return {
                allowed: false,
                reason: 'score_below_min',
                effectiveScore: result.score,
            };
        }

        return {
            allowed: true,
            reason: 'ok',
            effectiveScore: result.score,
        };
    }

    // --------------------------------------------------
    // LOCATION:COUNTRY – ham sonuçlar
    // --------------------------------------------------

    /**
     * Navigator'dan otomatik ülke kodu tahmini ile location-country kontrolü.
     *
     * Örn:
     *  - navigator.language "tr-TR" ise => "TR"
     *  - navigator.language "tr" ise   => "TR" varsayımı
     *
     * Elde edilen ülke kodu, expectedCountryCode parametresi verilmemişse
     * hem expectedCountryCode hem clientCountryCode olarak backend'e gider.
     */
    async verifyLocationCountryAuto(): Promise<LocationCountryResult> {
        const autoCountry = this.getNavigatorCountryCode();
        return this.verifyLocationCountry(autoCountry ?? undefined);
    }

    /**
     * Elle beklenen ülke kodu vererek location-country kontrolü.
     *
     * Örn:
     *  await client.verifyLocationCountry("TR")
     *
     * Backend'e:
     *  - expectedCountryCode: parametre
     *  - clientCountryCode: navigator'dan tahmin (varsa)
     * gönderilir.
     */
    async verifyLocationCountry(
        expectedCountryCode?: string
    ): Promise<LocationCountryResult> {
        const navigatorCountry = this.getNavigatorCountryCode();

        const body: {
            expectedCountryCode: string | null;
            clientCountryCode?: string | null;
        } = {
            expectedCountryCode: expectedCountryCode ?? null,
        };

        if (navigatorCountry) {
            body.clientCountryCode = navigatorCountry;
        }

        const res = await fetch(`${this.baseUrl}/verify/location:country`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            throw new Error(`Location country check failed: ${res.status}`);
        }

        return res.json();
    }

    /**
     * Location-country + politika kararı birlikte:
     *
     *  const { raw, decision } =
     *    await client.verifyLocationCountryWithPolicy("TR", {
     *      requireCountryMatch: true,
     *      allowedCountries: ["TR", "DE"],
     *      minScore: 0.6,
     *      treatVpnAsFailure: true,
     *    });
     */
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
            result.expectedCountryCode ??
                details?.expectedCountryCode ??
                undefined
        );
        const client = normalizeCountryCode(
            result.clientCountryCode ?? details?.clientCountryCode ?? undefined
        );

        // 1) Ülke eşleşmesi zorunlu mu?
        if (policy?.requireCountryMatch) {
            // Öncelik expectedCountryCode
            if (expected && ipCountry && ipCountry !== expected) {
                return {
                    allowed: false,
                    reason: 'ip_country_mismatch_expected',
                    effectiveScore: result.score,
                };
            }
            // expected yoksa clientCountry'ye göre değerlendir
            if (!expected && client && ipCountry && ipCountry !== client) {
                return {
                    allowed: false,
                    reason: 'ip_country_mismatch_client',
                    effectiveScore: result.score,
                };
            }
        }

        // 2) Sadece belirli ülkelere izin ver
        if (policy?.allowedCountries && ipCountry) {
            const allowedNormalized = policy.allowedCountries
                .map((c) => normalizeCountryCode(c))
                .filter((c): c is string => !!c);

            if (
                allowedNormalized.length > 0 &&
                !allowedNormalized.includes(ipCountry)
            ) {
                return {
                    allowed: false,
                    reason: 'ip_country_not_allowed',
                    effectiveScore: result.score,
                };
            }
        }

        // 3) VPN / proxy / tor riskini politika seviyesinde deny yap
        if (policy?.treatVpnAsFailure && details?.security) {
            const s = details.security;
            if (s.vpn || s.proxy || s.tor || s.relay) {
                return {
                    allowed: false,
                    reason: 'ip_security_not_allowed',
                    effectiveScore: result.score,
                };
            }
        }

        // 4) Score eşiği
        if (result.score < minScore) {
            return {
                allowed: false,
                reason: 'score_below_min',
                effectiveScore: result.score,
            };
        }

        return {
            allowed: true,
            reason: 'ok',
            effectiveScore: result.score,
        };
    }

    // --------------------------------------------------
    // Diğer stub endpoint'ler
    // --------------------------------------------------

    /**
     * WebAuthn / passkey doğrulaması – şimdilik backend stub
     */
    async verifyPasskey(proof: unknown): Promise<VerificationResult> {
        const res = await fetch(`${this.baseUrl}/verify/webauthn:passkey`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proof }),
        });

        if (!res.ok) {
            throw new Error(`Passkey verify failed: ${res.status}`);
        }

        return res.json();
    }

    /**
     * Face liveness doğrulaması – şimdilik backend stub
     */
    async verifyFaceLiveness(payload: {
        proof?: { tasksOk?: boolean };
        metrics?: { quality?: number };
    }): Promise<VerificationResult> {
        const res = await fetch(`${this.baseUrl}/verify/face:liveness`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!res.ok) {
            throw new Error(`Face liveness failed: ${res.status}`);
        }

        return res.json();
    }

    // --------------------------------------------------
    // Navigator'dan ülke kodu çıkarma helper'ı
    // --------------------------------------------------

    /**
     * Dil bilgisinden ülke kodu çıkar:
     *  - "tr-TR"  -> "TR"
     *  - "en-US"  -> "US"
     *  - "tr"     -> "TR" (varsayım)
     */
    private getNavigatorCountryCode(): string | null {
        if (typeof navigator === 'undefined') return null;

        const anyNav = navigator as Navigator & {
            language?: string;
            languages?: string[];
        };

        const lang =
            anyNav.language ||
            (Array.isArray(anyNav.languages) ? anyNav.languages[0] : undefined);

        if (!lang || typeof lang !== 'string') return null;

        // "tr-TR", "en-US" gibi ise
        const parts = lang.split('-');
        if (parts.length >= 2) {
            const country = parts[1];
            if (country && country.length >= 2) {
                return country.toUpperCase();
            }
        }

        // "tr", "en" gibi ise: 2 karakterli kodu ülke kodu say
        if (lang.length === 2) {
            return lang.toUpperCase();
        }

        return null;
    }
}
