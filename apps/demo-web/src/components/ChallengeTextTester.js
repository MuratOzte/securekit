import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { secureKitClient } from "../lib/secureKitClient.js";
async function fetchChallenge(lang, length) {
    return secureKitClient.getTextChallenge({ lang, length });
}
export const ChallengeTextTester = () => {
    const [result, setResult] = useState(null);
    const [busy, setBusy] = useState("idle");
    const [error, setError] = useState(null);
    const [nowMs, setNowMs] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => {
            setNowMs(Date.now());
        }, 1000);
        return () => {
            window.clearInterval(timer);
        };
    }, []);
    const remainingSeconds = useMemo(() => {
        if (!result)
            return null;
        const expiresAtMs = Date.parse(result.expiresAt);
        if (!Number.isFinite(expiresAtMs))
            return null;
        return Math.max(0, Math.ceil((expiresAtMs - nowMs) / 1000));
    }, [result, nowMs]);
    const run = async (action, lang, length) => {
        setBusy(action);
        setError(null);
        try {
            const response = await fetchChallenge(lang, length);
            setResult(response);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        }
        finally {
            setBusy("idle");
        }
    };
    const isBusy = busy !== "idle";
    return (_jsxs("div", { style: { padding: 16, border: "1px solid #ccc", borderRadius: 8, marginTop: 16 }, children: [_jsx("h2", { children: "Challenge Text Tester" }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { onClick: () => run("en-short", "en", "short"), disabled: isBusy, children: busy === "en-short" ? "Loading..." : "Get EN short" }), _jsx("button", { onClick: () => run("tr-short", "tr", "short"), disabled: isBusy, children: busy === "tr-short" ? "Loading..." : "Get TR short" }), _jsx("button", { onClick: () => run("en-medium", "en", "medium"), disabled: isBusy, children: busy === "en-medium" ? "Loading..." : "Get EN medium" })] }), error && _jsxs("div", { style: { color: "red", marginTop: 8 }, children: ["Error: ", error] }), result && (_jsxs("div", { style: { marginTop: 12 }, children: [_jsxs("div", { children: ["challengeId: ", result.challengeId] }), _jsxs("div", { children: ["lang: ", result.lang] }), _jsxs("div", { children: ["text: ", result.text] }), _jsxs("div", { children: ["expiresAt: ", result.expiresAt] }), _jsxs("div", { children: ["remaining: ", remainingSeconds === null ? "-" : `${remainingSeconds}s`] })] }))] }));
};
