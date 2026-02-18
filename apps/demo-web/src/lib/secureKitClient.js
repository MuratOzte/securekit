import { SecureKitClient, } from "@securekit/web-sdk";
const NODE_AUTH_BASE_URL = "http://localhost:3001";
const defaultVpnPolicy = {
    allowVpn: true,
    allowProxy: true,
    allowTor: false,
    allowRelay: true,
    minScore: 0.5,
};
export const secureKitClient = new SecureKitClient({
    baseUrl: NODE_AUTH_BASE_URL,
    vpnPolicy: defaultVpnPolicy,
});
export async function checkLocationCountryAuto() {
    return secureKitClient.verifyLocation();
}
export async function checkLocationCountryManual(expectedCountryCode) {
    return secureKitClient.verifyLocation({
        allowedCountries: [expectedCountryCode],
    });
}
export async function checkLocationCountryWithPolicy(expectedCountryCode) {
    const allowedCountries = expectedCountryCode ? [expectedCountryCode] : undefined;
    const [raw, network] = await Promise.all([
        secureKitClient.verifyLocation({ allowedCountries }),
        secureKitClient.verifyNetwork(),
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
    return secureKitClient.verifyNetwork();
}
export async function checkVpnWithPolicy(policyOverride) {
    return secureKitClient.verifyVpnWithPolicy(policyOverride);
}
