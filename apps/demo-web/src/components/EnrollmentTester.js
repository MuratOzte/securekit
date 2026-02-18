import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { secureKitClient } from "../lib/secureKitClient.js";
function buildSampleEvents() {
    return [
        { key: "a", type: "down", t: 0 },
        { key: "a", type: "up", t: 95 },
        { key: "b", type: "down", t: 130 },
        { key: "b", type: "up", t: 230 },
        { key: "c", type: "down", t: 270 },
        { key: "c", type: "up", t: 360 },
        { key: "d", type: "down", t: 405 },
        { key: "d", type: "up", t: 500 },
        { key: "e", type: "down", t: 545 },
        { key: "e", type: "up", t: 645 },
    ];
}
export const EnrollmentTester = () => {
    const [userId, setUserId] = useState("demo-user-1");
    const [consentVersion, setConsentVersion] = useState("v1");
    const [busy, setBusy] = useState("idle");
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);
    const [lastSampleEvents, setLastSampleEvents] = useState(null);
    const run = async (action, task) => {
        setBusy(action);
        setError(null);
        try {
            const response = await task();
            setResult(response);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        }
        finally {
            setBusy("idle");
        }
    };
    const normalizedUserId = userId.trim();
    const normalizedConsentVersion = consentVersion.trim();
    const isBusy = busy !== "idle";
    const requireUserId = () => {
        if (normalizedUserId.length > 0)
            return true;
        setError("userId is required.");
        return false;
    };
    const handleGrantConsent = async () => {
        if (!requireUserId())
            return;
        if (normalizedConsentVersion.length === 0) {
            setError("consentVersion is required.");
            return;
        }
        await run("consent", () => secureKitClient.grantConsent({
            userId: normalizedUserId,
            consentVersion: normalizedConsentVersion,
        }));
    };
    const handleEnroll = async () => {
        if (!requireUserId())
            return;
        const events = buildSampleEvents();
        setLastSampleEvents(events);
        await run("enroll", () => secureKitClient.enrollKeystroke({
            userId: normalizedUserId,
            events,
        }));
    };
    const handleGetProfiles = async () => {
        if (!requireUserId())
            return;
        await run("profiles", () => secureKitClient.getProfiles(normalizedUserId));
    };
    const handleDelete = async () => {
        if (!requireUserId())
            return;
        await run("delete", () => secureKitClient.deleteBiometrics(normalizedUserId));
    };
    return (_jsxs("div", { style: { padding: 16, border: "1px solid #ccc", borderRadius: 8, marginTop: 16 }, children: [_jsx("h2", { children: "Consent + Enrollment Tester" }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }, children: [_jsxs("label", { children: ["userId:", _jsx("input", { value: userId, onChange: (event) => setUserId(event.target.value), style: { marginLeft: 8, minWidth: 180 } })] }), _jsxs("label", { children: ["consentVersion:", _jsx("input", { value: consentVersion, onChange: (event) => setConsentVersion(event.target.value), style: { marginLeft: 8, minWidth: 100 } })] })] }), _jsxs("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" }, children: [_jsx("button", { onClick: handleGrantConsent, disabled: isBusy, children: busy === "consent" ? "Working..." : "Grant Consent" }), _jsx("button", { onClick: handleEnroll, disabled: isBusy, children: busy === "enroll" ? "Working..." : "Enroll Keystroke (sample events)" }), _jsx("button", { onClick: handleGetProfiles, disabled: isBusy, children: busy === "profiles" ? "Working..." : "Get Profiles" }), _jsx("button", { onClick: handleDelete, disabled: isBusy, children: busy === "delete" ? "Working..." : "Delete Biometrics" })] }), error && _jsxs("div", { style: { color: "red", marginTop: 8 }, children: ["Error: ", error] }), _jsxs("div", { style: { marginTop: 12 }, children: [_jsxs("div", { children: ["last userId: ", normalizedUserId || "-"] }), _jsxs("div", { children: ["last consentVersion: ", normalizedConsentVersion || "-"] })] }), lastSampleEvents && (_jsxs("div", { style: { marginTop: 12 }, children: [_jsx("h3", { children: "Client-side Sample Events (raw)" }), _jsx("pre", { style: { maxHeight: 180, overflow: "auto" }, children: JSON.stringify(lastSampleEvents, null, 2) })] })), result && (_jsxs("div", { style: { marginTop: 12 }, children: [_jsx("h3", { children: "Last API Response (JSON)" }), _jsx("pre", { style: { maxHeight: 260, overflow: "auto" }, children: JSON.stringify(result, null, 2) })] }))] }));
};
