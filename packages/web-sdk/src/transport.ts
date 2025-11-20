import type { Transport, ChallengeRunContext } from "@securekit/core";

export function httpTransport(baseUrl: string): Transport {
  return {
    async verify(use: string, payload: { proof: unknown; metrics?: unknown; context: ChallengeRunContext }) {
      const res = await fetch(`${baseUrl}/verify/${encodeURIComponent(use)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      return res.json();
    }
  };
}
