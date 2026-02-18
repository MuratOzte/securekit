// apps/demo-web/src/components/LocationCheckTester.tsx

import React, { useState } from "react";
import {
  checkLocationCountryWithPolicy,
} from "../lib/secureKitClient.js"; // .js uzantısı önemli
import type {
  LocationVerificationWithDecision,
} from "@securekit/web-sdk";

export const LocationCheckTester: React.FC = () => {
  const [result, setResult] =
    useState<LocationVerificationWithDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAutoCheckWithPolicy = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // expectedCountryCode vermiyoruz => sadece navigator + IP + policy
      const res = await checkLocationCountryWithPolicy(undefined);
      setResult(res);
      console.log("Auto + policy location check result:", res);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  };

  const handleManualTRWithPolicy = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // "TR" beklenen ülke + global default policy (allowedCountries: ['US'])
      const res = await checkLocationCountryWithPolicy("TR");
      setResult(res);
      console.log("Manual (TR) + policy location check result:", res);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  };

  const decision = result?.decision;
  const raw = result?.raw;

  return (
    <div style={{ padding: 16, border: "1px solid #ccc", borderRadius: 8 }}>
      <h2>Location Country Check Tester (Policy'li)</h2>

      <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 8 }}>
        <button onClick={handleAutoCheckWithPolicy} disabled={loading}>
          {loading
            ? "Kontrol ediliyor..."
            : "Auto (navigator) + policy ile kontrol et"}
        </button>

        <button onClick={handleManualTRWithPolicy} disabled={loading}>
          {loading
            ? "Kontrol ediliyor..."
            : 'Manuel: expected "TR" + policy'}
        </button>
      </div>

      {error && (
        <div style={{ color: "red", marginTop: 8 }}>Hata: {error}</div>
      )}

      {result && (
        <div style={{ marginTop: 8 }}>
          <h3>Policy Kararı</h3>
          <div>allowed: {String(decision?.allowed)}</div>
          <div>reason: {decision?.reason}</div>
          <div>effectiveScore: {decision?.effectiveScore}</div>

          <h3 style={{ marginTop: 8 }}>Ham Sonuç (backend)</h3>
          <div>ok: {String(raw?.ok)}</div>
          <div>score: {raw?.score}</div>
          <div>ipCountryCode: {raw?.ipCountryCode}</div>
          <div>expectedCountryCode: {raw?.expectedCountryCode}</div>
          <div>clientCountryCode: {raw?.clientCountryCode}</div>

          <pre style={{ marginTop: 8, maxHeight: 300, overflow: "auto" }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
};
