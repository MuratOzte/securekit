import {
  SecureKitClient,
  type LocationResult,
  type NetworkResult,
  type VpnPolicyConfig,
  type VpnVerificationWithDecision,
} from "@securekit/web-sdk";

const NODE_AUTH_BASE_URL = "http://localhost:3001";

const defaultVpnPolicy: VpnPolicyConfig = {
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

export type LocationCheckWithDecision = {
  raw: LocationResult;
  network: NetworkResult;
  decision: {
    allowed: boolean;
    reason: string;
    effectiveScore: number;
  };
};

export async function checkLocationCountryAuto(): Promise<LocationResult> {
  return secureKitClient.verifyLocation();
}

export async function checkLocationCountryManual(
  expectedCountryCode: string
): Promise<LocationResult> {
  return secureKitClient.verifyLocation({
    allowedCountries: [expectedCountryCode],
  });
}

export async function checkLocationCountryWithPolicy(
  expectedCountryCode?: string
): Promise<LocationCheckWithDecision> {
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

export async function checkVpnRaw(): Promise<NetworkResult> {
  return secureKitClient.verifyNetwork();
}

export async function checkVpnWithPolicy(
  policyOverride?: VpnPolicyConfig
): Promise<VpnVerificationWithDecision> {
  return secureKitClient.verifyVpnWithPolicy(policyOverride);
}
