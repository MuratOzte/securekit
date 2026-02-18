// apps/demo-web/src/lib/secureKitClient.ts

import {
    SecureKitClient,
    type LocationCountryResult,
    type LocationVerificationWithDecision,
    type VpnVerificationWithDecision,
    type VpnPolicyConfig,
    type LocationPolicyConfig,
} from '@securekit/web-sdk';

// node-auth backend adresin:
const NODE_AUTH_BASE_URL = 'http://localhost:3001';

/**
 * Global (varsayılan) politikalar – istersen burada oynayabilirsin.
 * Bunlar sadece verifyVpnWithPolicy / verifyLocationCountryWithPolicy için
 * başlangıç değeri, her çağrıda override edilebilir.
 */
const defaultVpnPolicy: VpnPolicyConfig = {
    // Örnek: VPN serbest, Tor yasak, minimum score 0.5
    allowVpn: true,
    allowProxy: true,
    allowTor: false,
    allowRelay: true,
    minScore: 0.5,
};

const defaultLocationPolicy: LocationPolicyConfig = {
    // Örnek: ülke eşleşmesi zorunlu değil, ama minimum score 0.5
    requireCountryMatch: false,
    allowedCountries: ['US'],
    minScore: 0.5,
    treatVpnAsFailure: false,
};

export const secureKitClient = new SecureKitClient({
    baseUrl: NODE_AUTH_BASE_URL,
    vpnPolicy: defaultVpnPolicy,
    locationPolicy: defaultLocationPolicy,
});

/**
 * Tarayıcıdan otomatik ülke kodu çıkar + backend'de IP ülkesini kontrol et.
 * (verifyLocationCountryAuto -> navigator.language kullanır)
 *
 * HAM backend sonucunu döner.
 */
export async function checkLocationCountryAuto(): Promise<LocationCountryResult> {
    const result = await secureKitClient.verifyLocationCountryAuto();
    return result;
}

/**
 * Manuel ülke kodu ile test etmek istersen:
 * Örn: "TR", "US" vs.
 *
 * HAM backend sonucunu döner.
 */
export async function checkLocationCountryManual(
    expectedCountryCode: string
): Promise<LocationCountryResult> {
    const result =
        await secureKitClient.verifyLocationCountry(expectedCountryCode);
    return result;
}

/**
 * Location check + politika kararı birlikte.
 *
 * Örnek:
 *  const { raw, decision } =
 *    await checkLocationCountryWithPolicy("TR", {
 *      requireCountryMatch: true,
 *      allowedCountries: ["TR", "DE"],
 *      minScore: 0.6,
 *      treatVpnAsFailure: true,
 *    });
 */
export async function checkLocationCountryWithPolicy(
    expectedCountryCode?: string,
    policyOverride?: LocationPolicyConfig
): Promise<LocationVerificationWithDecision> {
    return secureKitClient.verifyLocationCountryWithPolicy(
        expectedCountryCode,
        policyOverride
    );
}

/**
 * VPN/proxy/Tor kontrolü – sadece ham backend sonucunu döner.
 */
export async function checkVpnRaw(): Promise<
    VpnVerificationWithDecision['raw']
> {
    const rawWithDecision = await secureKitClient.verifyVpn();
    return rawWithDecision as any; // sadece ham kısım lazım ise
}

/**
 * VPN/proxy/Tor kontrolü + politika kararı birlikte.
 *
 * Örnek:
 *  const { raw, decision } = await checkVpnWithPolicy({
 *    allowVpn: false,
 *    allowProxy: true,
 *    allowTor: false,
 *    minScore: 0.7,
 *  });
 */
export async function checkVpnWithPolicy(
    policyOverride?: VpnPolicyConfig
): Promise<VpnVerificationWithDecision> {
    return secureKitClient.verifyVpnWithPolicy(policyOverride);
}
