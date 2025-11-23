export * from "./contracts";
export * from "./orchestrator";
export * from "./policies.defaultPolicy";

// packages/core/src/index.ts

// Kullanacağımız faktör ID'leri
export const FACTORS = {
  PASSKEY: "webauthn:passkey",
  FACE_LIVENESS: "face:liveness",
  VPN_CHECK: "vpn:check",
} as const;

export type FactorId = (typeof FACTORS)[keyof typeof FACTORS];

// Ortak verification sonucu
export interface VerificationResult {
  ok: boolean;
  score: number; // 0.0 - 1.0
  details?: Record<string, unknown>;
}

// Backend’in dönebileceği temel hata tipi (ileride kullanabiliriz)
export interface VerificationError {
  code: string;
  message: string;
}
