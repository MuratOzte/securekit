// packages/web-sdk/src/location.ts

export interface LocationCountryResult {
  ok: boolean;
  score: number;
  ipCountryCode: string | null;
  expectedCountryCode: string | null;
}

function getExpectedCountryCodeFromNavigator(): string | null {
  if (typeof navigator === "undefined") return null;

  const lang = navigator.language || (navigator as any).userLanguage || "en-US";
  const parts = lang.split("-");
  if (parts.length > 1) {
    return parts[1].toUpperCase(); // "TR", "US" vs.
  }
  if (parts[0] === "tr") return "TR";
  if (parts[0] === "de") return "DE";
  if (parts[0] === "en") return "US";
  return null;
}

// node-auth'ın adresini bir env ile de tutabilirsin, şimdilik sabit yazıyorum
const NODE_AUTH_BASE_URL = "http://localhost:3001";

export async function verifyLocationCountry(): Promise<LocationCountryResult> {
  const expectedCountryCode = getExpectedCountryCodeFromNavigator();

  const res = await fetch(`${NODE_AUTH_BASE_URL}/verify/location:country`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expectedCountryCode }),
  });

  if (!res.ok) {
    throw new Error(`verifyLocationCountry failed: ${res.status}`);
  }

  const data = (await res.json()) as LocationCountryResult & {
    raw?: unknown;
  };

  return {
    ok: data.ok,
    score: data.score,
    ipCountryCode: data.ipCountryCode,
    expectedCountryCode: data.expectedCountryCode,
  };
}
