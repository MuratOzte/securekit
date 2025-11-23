// Basit HTTP client arayüzü

export interface SecureKitClientOptions {
  baseUrl: string; // ör: "http://localhost:3001"
}

// Backend'in döndürdüğü temel sonuç tipi
export interface VerificationResult {
  ok: boolean;
  score: number;
  // Ek alanlara da izin verelim:
  [key: string]: unknown;
}

export class SecureKitClient {
  private baseUrl: string;

  constructor(options: SecureKitClientOptions) {
    // sonda / varsa temizle
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  async health(): Promise<{ ok: boolean }> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) {
      throw new Error(`Health check failed: ${res.status}`);
    }
    return res.json();
  }

  async verifyVpn(): Promise<VerificationResult> {
    const res = await fetch(`${this.baseUrl}/verify/vpn:check`, {
      method: "POST",
    });

    if (!res.ok) {
      throw new Error(`VPN check failed: ${res.status}`);
    }

    return res.json();
  }

  async verifyPasskey(proof: unknown): Promise<VerificationResult> {
    const res = await fetch(`${this.baseUrl}/verify/webauthn:passkey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Face liveness failed: ${res.status}`);
    }

    return res.json();
  }
}
