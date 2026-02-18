import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from "react";
import { secureKitClient } from "../lib/secureKitClient.js";
function parseAllowedCountries(input) {
    return Array.from(new Set(input
        .split(",")
        .map((part) => part.trim().toUpperCase())
        .filter((part) => part.length > 0)));
}
export const SessionFlowTester = () => {
    const [sessionId, setSessionId] = useState(null);
    const [expiresAt, setExpiresAt] = useState(null);
    const [network, setNetwork] = useState(null);
    const [location, setLocation] = useState(null);
    const [verifyResult, setVerifyResult] = useState(null);
    const [allowedCountriesInput, setAllowedCountriesInput] = useState("TR,US");
    const [busy, setBusy] = useState("idle");
    const [error, setError] = useState(null);
    const allowedCountries = useMemo(() => parseAllowedCountries(allowedCountriesInput), [allowedCountriesInput]);
    const startSession = async () => {
        setBusy("start");
        setError(null);
        setVerifyResult(null);
        try {
            const started = await secureKitClient.startSession();
            setSessionId(started.sessionId);
            setExpiresAt(started.expiresAt);
            setNetwork(null);
            setLocation(null);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        }
        finally {
            setBusy("idle");
        }
    };
    const runNetwork = async () => {
        setBusy("network");
        setError(null);
        try {
            const result = await secureKitClient.verifyNetwork();
            setNetwork(result);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        }
        finally {
            setBusy("idle");
        }
    };
    const runLocation = async () => {
        setBusy("location");
        setError(null);
        try {
            const result = await secureKitClient.verifyLocation({
                allowedCountries: allowedCountries.length > 0 ? allowedCountries : undefined,
            });
            setLocation(result);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        }
        finally {
            setBusy("idle");
        }
    };
    const runVerifySession = async () => {
        if (!sessionId) {
            setError("Start a session first.");
            return;
        }
        setBusy("verify");
        setError(null);
        try {
            const result = await secureKitClient.verifySession({
                sessionId,
                policy: {
                    allowMaxRisk: 30,
                    denyMinRisk: 85,
                    stepUpSteps: ["keystroke"],
                    allowedCountries: allowedCountries.length > 0 ? allowedCountries : undefined,
                },
                signals: {
                    network: network ?? undefined,
                    location: location ?? undefined,
                },
            });
            setVerifyResult(result);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        }
        finally {
            setBusy("idle");
        }
    };
    const isBusy = busy !== "idle";
    return (_jsxs("div", { style: { padding: 16, border: "1px solid #ccc", borderRadius: 8, marginTop: 16 }, children: [_jsx("h2", { children: "Session Flow Tester" }), _jsxs("div", { style: { display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }, children: [_jsx("button", { onClick: startSession, disabled: isBusy, children: busy === "start" ? "Starting..." : "1. Start Session" }), _jsx("button", { onClick: runNetwork, disabled: isBusy || !sessionId, children: busy === "network" ? "Checking..." : "2. Verify Network" }), _jsx("button", { onClick: runLocation, disabled: isBusy || !sessionId, children: busy === "location" ? "Checking..." : "3. Verify Location" }), _jsx("button", { onClick: runVerifySession, disabled: isBusy || !sessionId, children: busy === "verify" ? "Evaluating..." : "4. Verify Session" })] }), _jsxs("label", { style: { display: "block", marginBottom: 8 }, children: ["Allowed Countries (comma-separated):", _jsx("input", { value: allowedCountriesInput, onChange: (event) => setAllowedCountriesInput(event.target.value), style: { marginLeft: 8, minWidth: 180 } })] }), error && _jsxs("div", { style: { color: "red" }, children: ["Error: ", error] }), _jsxs("div", { style: { marginTop: 8 }, children: [_jsxs("div", { children: ["sessionId: ", sessionId ?? "-"] }), _jsxs("div", { children: ["expiresAt: ", expiresAt ?? "-"] }), _jsxs("div", { children: ["network score: ", network ? String(network.score) : "-"] }), _jsxs("div", { children: ["location country: ", location?.countryCode ?? "-"] })] }), verifyResult && (_jsxs("div", { style: { marginTop: 12 }, children: [_jsx("h3", { children: "Session Decision" }), _jsxs("div", { children: ["riskScore: ", verifyResult.riskScore] }), _jsxs("div", { children: ["decision: ", verifyResult.decision] }), _jsxs("div", { children: ["requiredSteps:", " ", verifyResult.requiredSteps.length > 0
                                ? verifyResult.requiredSteps.map((step) => step.step).join(", ")
                                : "-"] }), _jsxs("div", { children: ["reasons: ", verifyResult.reasons.join(", ") || "-"] }), _jsx("pre", { style: { marginTop: 8, maxHeight: 300, overflow: "auto" }, children: JSON.stringify(verifyResult, null, 2) })] }))] }));
};
