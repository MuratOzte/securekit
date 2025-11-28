// apps/demo-web/src/lib/secureKitClient.ts

import {
  SecureKitClient,
  type LocationCountryVerificationResult,
} from "@securekit/web-sdk";

// node-auth backend adresin:
const NODE_AUTH_BASE_URL = "http://localhost:3001";

export const secureKitClient = new SecureKitClient({
  baseUrl: NODE_AUTH_BASE_URL,
});

/**
 * Tarayıcıdan otomatik ülke kodu çıkar + backend'de IP ülkesini kontrol et.
 * (verifyLocationCountryAuto -> navigator.language kullanır)
 */
export async function checkLocationCountryAuto(): Promise<LocationCountryVerificationResult> {
  const result = await secureKitClient.verifyLocationCountryAuto();
  return result;
}

/**
 * Manuel ülke kodu ile test etmek istersen:
 * Örn: "TR", "US" vs.
 */
export async function checkLocationCountryManual(
  expectedCountryCode: string
): Promise<LocationCountryVerificationResult> {
  const result = await secureKitClient.verifyLocationCountry(
    expectedCountryCode
  );
  return result;
}
