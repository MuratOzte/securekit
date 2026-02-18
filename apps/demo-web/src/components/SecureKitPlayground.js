import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { createSecureKitClient, deleteSecureKitJson, formatSecureKitError, postSecureKitJson, resolveSecureKitBaseUrl, } from "../lib/secureKitClient.js";
function parseAllowedCountries(input) {
    return Array.from(new Set(input
        .split(",")
        .map((part) => part.trim().toUpperCase())
        .filter((part) => part.length > 0)));
}
function createSeededRng(seed) {
    let state = seed >>> 0;
    return () => {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}
function createDeterministicEvents(text = "securekitdemo", seed = 1337) {
    const rng = createSeededRng(seed);
    const events = [];
    let t = 0;
    for (const char of text) {
        const flightMs = 35 + Math.floor(rng() * 40);
        const holdMs = 70 + Math.floor(rng() * 55);
        t += flightMs;
        events.push({ key: char, type: "down", t });
        t += holdMs;
        events.push({ key: char, type: "up", t });
    }
    return events;
}
function usePersistentState(key, initialValue) {
    const [value, setValue] = useState(() => {
        if (typeof window === "undefined")
            return initialValue;
        try {
            const raw = window.localStorage.getItem(key);
            if (!raw)
                return initialValue;
            return JSON.parse(raw);
        }
        catch {
            return initialValue;
        }
    });
    useEffect(() => {
        if (typeof window === "undefined")
            return;
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        }
        catch {
            // ignore storage errors in playground
        }
    }, [key, value]);
    return [value, setValue];
}
function pretty(value) {
    return JSON.stringify(value, null, 2);
}
const panelStyle = {
    border: "1px solid #d1d5db",
    borderRadius: 8,
    padding: 16,
    marginTop: 16,
    textAlign: "left",
};
const rowStyle = {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
    marginTop: 8,
};
const preStyle = {
    marginTop: 12,
    padding: 12,
    background: "#f8fafc",
    borderRadius: 8,
    maxHeight: 260,
    overflow: "auto",
    fontSize: 12,
};
export const SecureKitPlayground = () => {
    const baseUrl = resolveSecureKitBaseUrl();
    const client = useMemo(() => createSecureKitClient(baseUrl), [baseUrl]);
    const [mockScenario, setMockScenario] = usePersistentState("securekit.playground.mockScenario", "clean");
    const [clientOffsetInput, setClientOffsetInput] = usePersistentState("securekit.playground.clientOffset", String(-new Date().getTimezoneOffset()));
    const [allowedCountriesInput, setAllowedCountriesInput] = usePersistentState("securekit.playground.allowedCountries", "TR,US");
    const [sessionPolicyCountriesInput, setSessionPolicyCountriesInput] = usePersistentState("securekit.playground.sessionPolicyCountries", "TR,US");
    const [sessionId, setSessionId] = usePersistentState("securekit.playground.sessionId", "");
    const [sessionExpiresAt, setSessionExpiresAt] = usePersistentState("securekit.playground.sessionExpiresAt", "");
    const [userId, setUserId] = usePersistentState("securekit.playground.userId", "demo-user-1");
    const [consentVersion, setConsentVersion] = usePersistentState("securekit.playground.consentVersion", "v1");
    const [includeNetworkSignal, setIncludeNetworkSignal] = usePersistentState("securekit.playground.includeNetworkSignal", true);
    const [includeLocationSignal, setIncludeLocationSignal] = usePersistentState("securekit.playground.includeLocationSignal", true);
    const [autoRunNetwork, setAutoRunNetwork] = usePersistentState("securekit.playground.autoRunNetwork", true);
    const [autoRunLocation, setAutoRunLocation] = usePersistentState("securekit.playground.autoRunLocation", true);
    const [deleteConsent, setDeleteConsent] = usePersistentState("securekit.playground.deleteConsent", false);
    const [healthBusy, setHealthBusy] = useState("idle");
    const [healthError, setHealthError] = useState(null);
    const [healthResult, setHealthResult] = useState(null);
    const [networkBusy, setNetworkBusy] = useState("idle");
    const [networkError, setNetworkError] = useState(null);
    const [networkResult, setNetworkResult] = useState(null);
    const [locationBusy, setLocationBusy] = useState("idle");
    const [locationError, setLocationError] = useState(null);
    const [locationResult, setLocationResult] = useState(null);
    const [sessionBusy, setSessionBusy] = useState("idle");
    const [sessionError, setSessionError] = useState(null);
    const [sessionResult, setSessionResult] = useState(null);
    const [consentBusy, setConsentBusy] = useState("idle");
    const [consentError, setConsentError] = useState(null);
    const [consentResult, setConsentResult] = useState(null);
    const [enrollBusy, setEnrollBusy] = useState("idle");
    const [enrollError, setEnrollError] = useState(null);
    const [enrollResult, setEnrollResult] = useState(null);
    const [profilesBusy, setProfilesBusy] = useState("idle");
    const [profilesError, setProfilesError] = useState(null);
    const [profilesResult, setProfilesResult] = useState(null);
    const [deleteBusy, setDeleteBusy] = useState("idle");
    const [deleteError, setDeleteError] = useState(null);
    const [deleteResult, setDeleteResult] = useState(null);
    const [lastEnrollmentEvents, setLastEnrollmentEvents] = useState(null);
    const allowedCountries = useMemo(() => parseAllowedCountries(allowedCountriesInput), [allowedCountriesInput]);
    const sessionPolicyCountries = useMemo(() => parseAllowedCountries(sessionPolicyCountriesInput), [sessionPolicyCountriesInput]);
    const resolveClientOffsetMin = () => {
        const parsed = Number(clientOffsetInput);
        return Number.isFinite(parsed) ? parsed : null;
    };
    const requestNetwork = async () => {
        return postSecureKitJson("/verify/network", {
            clientOffsetMin: resolveClientOffsetMin(),
            scenario: mockScenario,
        }, baseUrl);
    };
    const requestLocation = async () => {
        return postSecureKitJson("/verify/location", {
            allowedCountries: allowedCountries.length > 0 ? allowedCountries : undefined,
            scenario: mockScenario,
        }, baseUrl);
    };
    const runHealth = async () => {
        setHealthBusy("loading");
        setHealthError(null);
        setHealthResult(null);
        try {
            const result = await client.health();
            setHealthResult(result);
        }
        catch (error) {
            setHealthError(formatSecureKitError(error, baseUrl));
        }
        finally {
            setHealthBusy("idle");
        }
    };
    const runNetwork = async () => {
        setNetworkBusy("loading");
        setNetworkError(null);
        try {
            const result = await requestNetwork();
            setNetworkResult(result);
        }
        catch (error) {
            setNetworkError(formatSecureKitError(error, baseUrl));
        }
        finally {
            setNetworkBusy("idle");
        }
    };
    const runLocation = async () => {
        setLocationBusy("loading");
        setLocationError(null);
        try {
            const result = await requestLocation();
            setLocationResult(result);
        }
        catch (error) {
            setLocationError(formatSecureKitError(error, baseUrl));
        }
        finally {
            setLocationBusy("idle");
        }
    };
    const startSession = async () => {
        setSessionBusy("loading");
        setSessionError(null);
        try {
            const started = await client.startSession();
            setSessionId(started.sessionId);
            setSessionExpiresAt(started.expiresAt);
            return started.sessionId;
        }
        catch (error) {
            setSessionError(formatSecureKitError(error, baseUrl));
            return null;
        }
        finally {
            setSessionBusy("idle");
        }
    };
    const runOptionalSignals = async () => {
        const out = {};
        if (autoRunNetwork) {
            const n = await requestNetwork();
            out.network = n;
            setNetworkResult(n);
        }
        if (autoRunLocation) {
            const l = await requestLocation();
            out.location = l;
            setLocationResult(l);
        }
        return out;
    };
    const verifySession = async (sessionIdToUse, freshSignals) => {
        const normalizedSessionId = sessionIdToUse.trim();
        if (!normalizedSessionId) {
            setSessionError("Session ID is required. Start a session first.");
            return;
        }
        setSessionBusy("loading");
        setSessionError(null);
        setSessionResult(null);
        try {
            const effectiveNetwork = freshSignals?.network ?? networkResult ?? undefined;
            const effectiveLocation = freshSignals?.location ?? locationResult ?? undefined;
            const signals = {};
            if (includeNetworkSignal && effectiveNetwork) {
                signals.network = effectiveNetwork;
            }
            if (includeLocationSignal && effectiveLocation) {
                signals.location = effectiveLocation;
            }
            const result = await client.verifySession({
                sessionId: normalizedSessionId,
                policy: {
                    allowMaxRisk: 30,
                    denyMinRisk: 85,
                    stepUpSteps: ["keystroke"],
                    allowedCountries: sessionPolicyCountries.length > 0 ? sessionPolicyCountries : undefined,
                },
                signals: Object.keys(signals).length > 0 ? signals : undefined,
            });
            setSessionResult(result);
        }
        catch (error) {
            setSessionError(formatSecureKitError(error, baseUrl));
        }
        finally {
            setSessionBusy("idle");
        }
    };
    const runFullSessionFlow = async () => {
        setSessionError(null);
        const startedId = await startSession();
        if (!startedId)
            return;
        setSessionBusy("loading");
        try {
            const freshSignals = await runOptionalSignals();
            await verifySession(startedId, freshSignals);
        }
        catch (error) {
            setSessionError(formatSecureKitError(error, baseUrl));
        }
        finally {
            setSessionBusy("idle");
        }
    };
    const runConsent = async () => {
        const normalizedUserId = userId.trim();
        const normalizedConsentVersion = consentVersion.trim();
        if (!normalizedUserId) {
            setConsentError("userId is required.");
            return;
        }
        if (!normalizedConsentVersion) {
            setConsentError("consentVersion is required.");
            return;
        }
        setConsentBusy("loading");
        setConsentError(null);
        setConsentResult(null);
        try {
            const result = await client.grantConsent({
                userId: normalizedUserId,
                consentVersion: normalizedConsentVersion,
            });
            setConsentResult(result);
        }
        catch (error) {
            setConsentError(formatSecureKitError(error, baseUrl));
        }
        finally {
            setConsentBusy("idle");
        }
    };
    const runEnroll = async () => {
        const normalizedUserId = userId.trim();
        if (!normalizedUserId) {
            setEnrollError("userId is required.");
            return;
        }
        const events = createDeterministicEvents();
        setLastEnrollmentEvents(events);
        setEnrollBusy("loading");
        setEnrollError(null);
        setEnrollResult(null);
        try {
            const result = await client.enrollKeystroke({
                userId: normalizedUserId,
                events,
            });
            setEnrollResult(result);
        }
        catch (error) {
            setEnrollError(formatSecureKitError(error, baseUrl));
        }
        finally {
            setEnrollBusy("idle");
        }
    };
    const runProfiles = async () => {
        const normalizedUserId = userId.trim();
        if (!normalizedUserId) {
            setProfilesError("userId is required.");
            return;
        }
        setProfilesBusy("loading");
        setProfilesError(null);
        setProfilesResult(null);
        try {
            const result = await client.getProfiles(normalizedUserId);
            setProfilesResult(result);
        }
        catch (error) {
            setProfilesError(formatSecureKitError(error, baseUrl));
        }
        finally {
            setProfilesBusy("idle");
        }
    };
    const runDeleteBiometrics = async () => {
        const normalizedUserId = userId.trim();
        if (!normalizedUserId) {
            setDeleteError("userId is required.");
            return;
        }
        setDeleteBusy("loading");
        setDeleteError(null);
        setDeleteResult(null);
        try {
            const path = deleteConsent ? "/user/biometrics?deleteConsent=true" : "/user/biometrics";
            const result = await deleteSecureKitJson(path, { userId: normalizedUserId }, baseUrl);
            setDeleteResult(result);
        }
        catch (error) {
            setDeleteError(formatSecureKitError(error, baseUrl));
        }
        finally {
            setDeleteBusy("idle");
        }
    };
    return (_jsxs("div", { style: { padding: 16 }, children: [_jsx("h1", { children: "SecureKit Playground" }), _jsxs("p", { style: { marginTop: 4 }, children: ["Base URL: ", _jsx("code", { children: baseUrl })] }), _jsxs("div", { style: panelStyle, children: [_jsx("h2", { style: { marginTop: 0 }, children: "General" }), _jsxs("div", { style: rowStyle, children: [_jsxs("label", { children: ["Mock scenario:", _jsxs("select", { value: mockScenario, onChange: (event) => setMockScenario(event.target.value), style: { marginLeft: 8 }, children: [_jsx("option", { value: "clean", children: "clean" }), _jsx("option", { value: "risky", children: "risky" })] })] }), _jsx("button", { onClick: runHealth, disabled: healthBusy !== "idle", children: healthBusy === "loading" ? "Checking..." : "GET /health" })] }), healthError && _jsx("div", { style: { color: "red", marginTop: 8 }, children: healthError }), healthResult && _jsx("pre", { style: preStyle, children: pretty(healthResult) })] }), _jsxs("div", { style: panelStyle, children: [_jsx("h2", { style: { marginTop: 0 }, children: "1) Network Check" }), _jsxs("div", { style: rowStyle, children: [_jsxs("label", { children: ["clientOffsetMin:", _jsx("input", { value: clientOffsetInput, onChange: (event) => setClientOffsetInput(event.target.value), style: { marginLeft: 8, width: 100 } })] }), _jsx("button", { onClick: runNetwork, disabled: networkBusy !== "idle", children: networkBusy === "loading" ? "Running..." : "POST /verify/network" })] }), networkError && _jsx("div", { style: { color: "red", marginTop: 8 }, children: networkError }), networkResult && _jsx("pre", { style: preStyle, children: pretty(networkResult) })] }), _jsxs("div", { style: panelStyle, children: [_jsx("h2", { style: { marginTop: 0 }, children: "2) Location Check" }), _jsxs("div", { style: rowStyle, children: [_jsxs("label", { children: ["allowedCountries:", _jsx("input", { value: allowedCountriesInput, onChange: (event) => setAllowedCountriesInput(event.target.value), style: { marginLeft: 8, minWidth: 240 }, placeholder: "TR,US" })] }), _jsx("button", { onClick: runLocation, disabled: locationBusy !== "idle", children: locationBusy === "loading" ? "Running..." : "POST /verify/location" })] }), locationError && _jsx("div", { style: { color: "red", marginTop: 8 }, children: locationError }), locationResult && _jsx("pre", { style: preStyle, children: pretty(locationResult) })] }), _jsxs("div", { style: panelStyle, children: [_jsx("h2", { style: { marginTop: 0 }, children: "3) Session Flow" }), _jsxs("div", { style: rowStyle, children: [_jsx("button", { onClick: () => void startSession(), disabled: sessionBusy !== "idle", children: sessionBusy === "loading" ? "Working..." : "POST /session/start" }), _jsx("button", { onClick: () => void runFullSessionFlow(), disabled: sessionBusy !== "idle", children: sessionBusy === "loading" ? "Working..." : "Start + Optional Checks + Verify" }), _jsx("button", { onClick: () => void verifySession(sessionId), disabled: sessionBusy !== "idle" || sessionId.trim().length === 0, children: sessionBusy === "loading" ? "Working..." : "POST /verify/session" })] }), _jsxs("div", { style: rowStyle, children: [_jsxs("label", { children: ["sessionId:", _jsx("input", { value: sessionId, onChange: (event) => setSessionId(event.target.value), style: { marginLeft: 8, minWidth: 260 } })] }), _jsxs("label", { children: ["expiresAt: ", _jsx("code", { children: sessionExpiresAt || "-" })] })] }), _jsx("div", { style: rowStyle, children: _jsxs("label", { children: ["session policy allowedCountries:", _jsx("input", { value: sessionPolicyCountriesInput, onChange: (event) => setSessionPolicyCountriesInput(event.target.value), style: { marginLeft: 8, minWidth: 220 } })] }) }), _jsxs("div", { style: rowStyle, children: [_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: autoRunNetwork, onChange: (event) => setAutoRunNetwork(event.target.checked) }), "auto-run network before verify"] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: autoRunLocation, onChange: (event) => setAutoRunLocation(event.target.checked) }), "auto-run location before verify"] })] }), _jsxs("div", { style: rowStyle, children: [_jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: includeNetworkSignal, onChange: (event) => setIncludeNetworkSignal(event.target.checked) }), "include network signal in /verify/session"] }), _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: includeLocationSignal, onChange: (event) => setIncludeLocationSignal(event.target.checked) }), "include location signal in /verify/session"] })] }), sessionError && _jsx("div", { style: { color: "red", marginTop: 8 }, children: sessionError }), sessionResult && _jsx("pre", { style: preStyle, children: pretty(sessionResult) })] }), _jsxs("div", { style: panelStyle, children: [_jsx("h2", { style: { marginTop: 0 }, children: "4) Consent + Keystroke Enrollment" }), _jsxs("div", { style: rowStyle, children: [_jsxs("label", { children: ["userId:", _jsx("input", { value: userId, onChange: (event) => setUserId(event.target.value), style: { marginLeft: 8, minWidth: 180 } })] }), _jsxs("label", { children: ["consentVersion:", _jsx("input", { value: consentVersion, onChange: (event) => setConsentVersion(event.target.value), style: { marginLeft: 8, width: 80 } })] })] }), _jsxs("div", { style: rowStyle, children: [_jsx("button", { onClick: runConsent, disabled: consentBusy !== "idle", children: consentBusy === "loading" ? "Working..." : "POST /consent" }), _jsx("button", { onClick: runEnroll, disabled: enrollBusy !== "idle", children: enrollBusy === "loading" ? "Working..." : "POST /enroll/keystroke" }), _jsx("button", { onClick: runProfiles, disabled: profilesBusy !== "idle", children: profilesBusy === "loading" ? "Working..." : "GET /user/:userId/profiles" }), _jsx("button", { onClick: runDeleteBiometrics, disabled: deleteBusy !== "idle", children: deleteBusy === "loading" ? "Working..." : "DELETE /user/biometrics" })] }), _jsx("div", { style: rowStyle, children: _jsxs("label", { children: [_jsx("input", { type: "checkbox", checked: deleteConsent, onChange: (event) => setDeleteConsent(event.target.checked) }), "deleteConsent=true query"] }) }), consentError && _jsx("div", { style: { color: "red", marginTop: 8 }, children: consentError }), consentResult && _jsx("pre", { style: preStyle, children: pretty(consentResult) }), enrollError && _jsx("div", { style: { color: "red", marginTop: 8 }, children: enrollError }), enrollResult && _jsx("pre", { style: preStyle, children: pretty(enrollResult) }), profilesError && _jsx("div", { style: { color: "red", marginTop: 8 }, children: profilesError }), profilesResult && _jsx("pre", { style: preStyle, children: pretty(profilesResult) }), deleteError && _jsx("div", { style: { color: "red", marginTop: 8 }, children: deleteError }), deleteResult && _jsx("pre", { style: preStyle, children: pretty(deleteResult) }), lastEnrollmentEvents && (_jsxs(_Fragment, { children: [_jsx("h3", { style: { marginTop: 12 }, children: "Deterministic Keystroke Events" }), _jsx("pre", { style: preStyle, children: pretty(lastEnrollmentEvents) })] }))] })] }));
};
