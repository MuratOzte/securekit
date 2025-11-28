export interface SecureKitClientOptions {
    baseUrl: string; // ör: "http://localhost:3001"
}

export interface VerificationResult {
    ok: boolean;
    score: number;
    details?: Record<string, unknown>;
}

export interface VpnCheckDetails {
    ip: string | null;
    ipTimeZone: string | null;
    ipCountry: string | null;
    ipRegion: string | null;
    isVpn: boolean;
    isProxy: boolean;
    isTor: boolean;
    timezoneDriftHours: number | null;
    clientTimeZone: string | null;
    clientTimeOffsetMinutes: number | null;
    source: string | null;
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
}

/**
 * DİKKAT: Burada HİÇBİR ŞEYDEN extend ETMİYORUZ.
 * Sadece ok, score alanlarını tekrar tanımlıyoruz.
 */
export interface LocationCountryResult {
    ok: boolean;
    score: number;
    ipCountryCode: string | null;
    expectedCountryCode: string | null;
    clientCountryCode: string | null;
    details?: LocationCountryResultDetails;
}

// Frontend tarafında kullanacağın client
export class SecureKitClient {
    private baseUrl: string;

    constructor(options: SecureKitClientOptions) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    }

    async health(): Promise<{ ok: boolean }> {
        const res = await fetch(`${this.baseUrl}/health`);
        if (!res.ok) {
            throw new Error(`Health check failed: ${res.status}`);
        }
        return res.json();
    }

    /**
     * VPN/proxy/Tor + timezone tutarlılığı kontrolü.
     * Backend'e client timezone bilgisiyle birlikte istek atar.
     */
    async verifyVpn(): Promise<
        VerificationResult & { details?: VpnCheckDetails }
    > {
        const clientTimeZone =
            Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
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
     * Navigator'dan otomatik ülke kodu tahmini ile location-country kontrolü.
     * Örn: navigator.language "tr-TR" veya "tr" ise "TR" olarak beklenen ülke kodu gönderilir.
     */
    async verifyLocationCountryAuto(): Promise<LocationCountryResult> {
        const autoCountry = this.getNavigatorCountryCode();
        return this.verifyLocationCountry(autoCountry ?? undefined);
    }

    /**
     * Elle beklenen ülke kodu vererek location-country kontrolü.
     * Örn: expectedCountryCode = "TR"
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

    // Dil bilgisinden ülke kodu çıkar (ör: "tr-TR" -> "TR", "tr" -> "TR" varsayımı)
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
