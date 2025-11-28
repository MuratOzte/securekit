// apps/demo-web/src/components/LocationCheckTester.tsx

import React, { useState } from "react";
import {
  checkLocationCountryAuto,
  checkLocationCountryManual,
} from "../lib/secureKitClient.js"; // .js uzantısı önemli
import type { LocationCountryVerificationResult } from "@securekit/web-sdk";

export const LocationCheckTester: React.FC = () => {
  const [result, setResult] =
    useState<LocationCountryVerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAutoCheck = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await checkLocationCountryAuto();
      setResult(res);
      console.log("Auto location check result:", res);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  };

  const handleManualTR = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await checkLocationCountryManual("TR");
      setResult(res);
      console.log("Manual (TR) location check result:", res);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? "Bilinmeyen hata");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16, border: "1px solid #ccc", borderRadius: 8 }}>
      <h2>Location Country Check Tester</h2>

      <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 8 }}>
        <button onClick={handleAutoCheck} disabled={loading}>
          {loading ? "Kontrol ediliyor..." : "Auto (navigator) ile kontrol et"}
        </button>

        <button onClick={handleManualTR} disabled={loading}>
          {loading ? "Kontrol ediliyor..." : 'Manuel: expected "TR"'}
        </button>
      </div>

      {error && (
        <div style={{ color: "red", marginTop: 8 }}>Hata: {error}</div>
      )}

      {result && (
        <div style={{ marginTop: 8 }}>
          <div>ok: {String(result.ok)}</div>
          <div>score: {result.score}</div>
          <div>ipCountryCode: {result.ipCountryCode}</div>
          <div>expectedCountryCode: {result.expectedCountryCode}</div>
        </div>
      )}
    </div>
  );
};
