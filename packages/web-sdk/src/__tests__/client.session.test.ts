import { describe, expect, it, vi } from "vitest";
import type { LocationResult, NetworkResult, VerifySessionResponse } from "@securekit/core";
import { SecureKitClient } from "../index";

const CLEAN_NETWORK: NetworkResult = {
  ok: true,
  score: 95,
  flags: {
    vpn: false,
    tor: false,
    proxy: false,
    relay: false,
    hosting: false,
  },
  reasons: [],
  ipInfo: {
    ip: "1.2.3.4",
    countryCode: "TR",
    timezoneOffsetMin: 180,
    clientOffsetMin: 180,
    driftMin: 0,
  },
};

const CLEAN_LOCATION: LocationResult = {
  ok: true,
  countryCode: "TR",
  allowed: true,
  reasons: [],
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SecureKitClient session methods", () => {
  it("startSession posts to /session/start", async () => {
    const payload = {
      sessionId: "s1",
      expiresAt: "2026-01-01T00:15:00.000Z",
    };
    const fetchMock = vi.fn(async () => jsonResponse(payload));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const result = await client.startSession();

    expect(result).toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/session/start",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("verifySession posts expected body to /verify/session", async () => {
    const responseFixture: VerifySessionResponse = {
      sessionId: "s1",
      riskScore: 10,
      decision: "allow",
      requiredSteps: [],
      reasons: ["RISK_WITHIN_ALLOW_MAX"],
      signalsUsed: {
        network: CLEAN_NETWORK,
        location: CLEAN_LOCATION,
      },
    };
    const fetchMock = vi.fn(async () => jsonResponse(responseFixture));
    const client = new SecureKitClient({
      baseUrl: "http://localhost:3001",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const payload = {
      sessionId: "s1",
      policy: { allowedCountries: ["TR"] },
      signals: { network: CLEAN_NETWORK, location: CLEAN_LOCATION },
    };

    const result = await client.verifySession(payload);

    expect(result).toEqual(responseFixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url.endsWith("/verify/session")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify(payload));
  });
});
