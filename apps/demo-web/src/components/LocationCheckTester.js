import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { checkLocationCountryWithPolicy, } from "../lib/secureKitClient.js";
export const LocationCheckTester = () => {
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const handleAutoCheckWithPolicy = async () => {
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const res = await checkLocationCountryWithPolicy(undefined);
            setResult(res);
        }
        catch (e) {
            console.error(e);
            setError(e instanceof Error ? e.message : "Bilinmeyen hata");
        }
        finally {
            setLoading(false);
        }
    };
    const handleManualTRWithPolicy = async () => {
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const res = await checkLocationCountryWithPolicy("TR");
            setResult(res);
        }
        catch (e) {
            console.error(e);
            setError(e instanceof Error ? e.message : "Bilinmeyen hata");
        }
        finally {
            setLoading(false);
        }
    };
    const decision = result?.decision;
    const raw = result?.raw;
    return (_jsxs("div", { style: { padding: 16, border: "1px solid #ccc", borderRadius: 8 }, children: [_jsx("h2", { children: "Location Country Check Tester (Policy'li)" }), _jsxs("div", { style: { display: "flex", gap: 8, marginTop: 8, marginBottom: 8 }, children: [_jsx("button", { onClick: handleAutoCheckWithPolicy, disabled: loading, children: loading
                            ? "Kontrol ediliyor..."
                            : "Auto (navigator) + policy ile kontrol et" }), _jsx("button", { onClick: handleManualTRWithPolicy, disabled: loading, children: loading
                            ? "Kontrol ediliyor..."
                            : 'Manuel: allowed "TR" + policy' })] }), error && _jsxs("div", { style: { color: "red", marginTop: 8 }, children: ["Hata: ", error] }), result && (_jsxs("div", { style: { marginTop: 8 }, children: [_jsx("h3", { children: "Policy Karari" }), _jsxs("div", { children: ["allowed: ", String(decision?.allowed)] }), _jsxs("div", { children: ["reason: ", decision?.reason] }), _jsxs("div", { children: ["effectiveScore: ", decision?.effectiveScore] }), _jsx("h3", { style: { marginTop: 8 }, children: "Ham Sonuc (backend)" }), _jsxs("div", { children: ["ok: ", String(raw?.ok)] }), _jsxs("div", { children: ["allowed: ", String(raw?.allowed)] }), _jsxs("div", { children: ["countryCode: ", raw?.countryCode ?? "-"] }), _jsxs("div", { children: ["reasons: ", (raw?.reasons ?? []).join(", ") || "-"] }), _jsx("pre", { style: { marginTop: 8, maxHeight: 300, overflow: "auto" }, children: JSON.stringify(result, null, 2) })] }))] }));
};
