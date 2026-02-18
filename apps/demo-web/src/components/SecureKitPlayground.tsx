import React, { useEffect, useMemo, useState } from "react";
import type { KeystrokeEvent } from "@securekit/core";
import type {
  ConsentResponse,
  DeleteBiometricsResponse,
  EnrollKeystrokeResponse,
  GetProfilesResponse,
  LocationResult,
  NetworkResult,
  VerifySessionResponse,
} from "@securekit/web-sdk";
import {
  createSecureKitClient,
  deleteSecureKitJson,
  formatSecureKitError,
  postSecureKitJson,
  resolveSecureKitBaseUrl,
} from "../lib/secureKitClient.js";

type MockScenario = "clean" | "risky";
type SectionBusy = "idle" | "loading";

function parseAllowedCountries(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(",")
        .map((part) => part.trim().toUpperCase())
        .filter((part) => part.length > 0)
    )
  );
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function createDeterministicEvents(
  text = "securekitdemo",
  seed = 1337
): KeystrokeEvent[] {
  const rng = createSeededRng(seed);
  const events: KeystrokeEvent[] = [];
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

function usePersistentState<T>(
  key: string,
  initialValue: T
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return initialValue;
      return JSON.parse(raw) as T;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // ignore storage errors in playground
    }
  }, [key, value]);

  return [value, setValue];
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

const panelStyle: React.CSSProperties = {
  border: "1px solid #d1d5db",
  borderRadius: 8,
  padding: 16,
  marginTop: 16,
  textAlign: "left",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  alignItems: "center",
  marginTop: 8,
};

const preStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  background: "#f8fafc",
  borderRadius: 8,
  maxHeight: 260,
  overflow: "auto",
  fontSize: 12,
};

export const SecureKitPlayground: React.FC = () => {
  const baseUrl = resolveSecureKitBaseUrl();
  const client = useMemo(() => createSecureKitClient(baseUrl), [baseUrl]);

  const [mockScenario, setMockScenario] = usePersistentState<MockScenario>(
    "securekit.playground.mockScenario",
    "clean"
  );

  const [clientOffsetInput, setClientOffsetInput] = usePersistentState(
    "securekit.playground.clientOffset",
    String(-new Date().getTimezoneOffset())
  );
  const [allowedCountriesInput, setAllowedCountriesInput] = usePersistentState(
    "securekit.playground.allowedCountries",
    "TR,US"
  );
  const [sessionPolicyCountriesInput, setSessionPolicyCountriesInput] = usePersistentState(
    "securekit.playground.sessionPolicyCountries",
    "TR,US"
  );
  const [sessionId, setSessionId] = usePersistentState("securekit.playground.sessionId", "");
  const [sessionExpiresAt, setSessionExpiresAt] = usePersistentState(
    "securekit.playground.sessionExpiresAt",
    ""
  );
  const [userId, setUserId] = usePersistentState("securekit.playground.userId", "demo-user-1");
  const [consentVersion, setConsentVersion] = usePersistentState(
    "securekit.playground.consentVersion",
    "v1"
  );

  const [includeNetworkSignal, setIncludeNetworkSignal] = usePersistentState(
    "securekit.playground.includeNetworkSignal",
    true
  );
  const [includeLocationSignal, setIncludeLocationSignal] = usePersistentState(
    "securekit.playground.includeLocationSignal",
    true
  );
  const [autoRunNetwork, setAutoRunNetwork] = usePersistentState(
    "securekit.playground.autoRunNetwork",
    true
  );
  const [autoRunLocation, setAutoRunLocation] = usePersistentState(
    "securekit.playground.autoRunLocation",
    true
  );
  const [deleteConsent, setDeleteConsent] = usePersistentState(
    "securekit.playground.deleteConsent",
    false
  );

  const [healthBusy, setHealthBusy] = useState<SectionBusy>("idle");
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthResult, setHealthResult] = useState<{ ok: boolean } | null>(null);

  const [networkBusy, setNetworkBusy] = useState<SectionBusy>("idle");
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [networkResult, setNetworkResult] = useState<NetworkResult | null>(null);

  const [locationBusy, setLocationBusy] = useState<SectionBusy>("idle");
  const [locationError, setLocationError] = useState<string | null>(null);
  const [locationResult, setLocationResult] = useState<LocationResult | null>(null);

  const [sessionBusy, setSessionBusy] = useState<SectionBusy>("idle");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionResult, setSessionResult] = useState<VerifySessionResponse | null>(null);

  const [consentBusy, setConsentBusy] = useState<SectionBusy>("idle");
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentResult, setConsentResult] = useState<ConsentResponse | null>(null);

  const [enrollBusy, setEnrollBusy] = useState<SectionBusy>("idle");
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollResult, setEnrollResult] = useState<EnrollKeystrokeResponse | null>(null);

  const [profilesBusy, setProfilesBusy] = useState<SectionBusy>("idle");
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [profilesResult, setProfilesResult] = useState<GetProfilesResponse | null>(null);

  const [deleteBusy, setDeleteBusy] = useState<SectionBusy>("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteResult, setDeleteResult] = useState<DeleteBiometricsResponse | null>(null);
  const [lastEnrollmentEvents, setLastEnrollmentEvents] = useState<KeystrokeEvent[] | null>(null);

  const allowedCountries = useMemo(
    () => parseAllowedCountries(allowedCountriesInput),
    [allowedCountriesInput]
  );
  const sessionPolicyCountries = useMemo(
    () => parseAllowedCountries(sessionPolicyCountriesInput),
    [sessionPolicyCountriesInput]
  );

  const resolveClientOffsetMin = (): number | null => {
    const parsed = Number(clientOffsetInput);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const requestNetwork = async (): Promise<NetworkResult> => {
    return postSecureKitJson<NetworkResult>(
      "/verify/network",
      {
        clientOffsetMin: resolveClientOffsetMin(),
        scenario: mockScenario,
      },
      baseUrl
    );
  };

  const requestLocation = async (): Promise<LocationResult> => {
    return postSecureKitJson<LocationResult>(
      "/verify/location",
      {
        allowedCountries: allowedCountries.length > 0 ? allowedCountries : undefined,
        scenario: mockScenario,
      },
      baseUrl
    );
  };

  const runHealth = async () => {
    setHealthBusy("loading");
    setHealthError(null);
    setHealthResult(null);

    try {
      const result = await client.health();
      setHealthResult(result);
    } catch (error) {
      setHealthError(formatSecureKitError(error, baseUrl));
    } finally {
      setHealthBusy("idle");
    }
  };

  const runNetwork = async () => {
    setNetworkBusy("loading");
    setNetworkError(null);

    try {
      const result = await requestNetwork();
      setNetworkResult(result);
    } catch (error) {
      setNetworkError(formatSecureKitError(error, baseUrl));
    } finally {
      setNetworkBusy("idle");
    }
  };

  const runLocation = async () => {
    setLocationBusy("loading");
    setLocationError(null);

    try {
      const result = await requestLocation();
      setLocationResult(result);
    } catch (error) {
      setLocationError(formatSecureKitError(error, baseUrl));
    } finally {
      setLocationBusy("idle");
    }
  };

  const startSession = async (): Promise<string | null> => {
    setSessionBusy("loading");
    setSessionError(null);

    try {
      const started = await client.startSession();
      setSessionId(started.sessionId);
      setSessionExpiresAt(started.expiresAt);
      return started.sessionId;
    } catch (error) {
      setSessionError(formatSecureKitError(error, baseUrl));
      return null;
    } finally {
      setSessionBusy("idle");
    }
  };

  const runOptionalSignals = async (): Promise<{
    network?: NetworkResult;
    location?: LocationResult;
  }> => {
    const out: { network?: NetworkResult; location?: LocationResult } = {};

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

  const verifySession = async (sessionIdToUse: string, freshSignals?: {
    network?: NetworkResult;
    location?: LocationResult;
  }) => {
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

      const signals: { network?: NetworkResult; location?: LocationResult } = {};
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
          allowedCountries:
            sessionPolicyCountries.length > 0 ? sessionPolicyCountries : undefined,
        },
        signals: Object.keys(signals).length > 0 ? signals : undefined,
      });

      setSessionResult(result);
    } catch (error) {
      setSessionError(formatSecureKitError(error, baseUrl));
    } finally {
      setSessionBusy("idle");
    }
  };

  const runFullSessionFlow = async () => {
    setSessionError(null);
    const startedId = await startSession();
    if (!startedId) return;

    setSessionBusy("loading");
    try {
      const freshSignals = await runOptionalSignals();
      await verifySession(startedId, freshSignals);
    } catch (error) {
      setSessionError(formatSecureKitError(error, baseUrl));
    } finally {
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
    } catch (error) {
      setConsentError(formatSecureKitError(error, baseUrl));
    } finally {
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
    } catch (error) {
      setEnrollError(formatSecureKitError(error, baseUrl));
    } finally {
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
    } catch (error) {
      setProfilesError(formatSecureKitError(error, baseUrl));
    } finally {
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
      const result = await deleteSecureKitJson<DeleteBiometricsResponse>(
        path,
        { userId: normalizedUserId },
        baseUrl
      );
      setDeleteResult(result);
    } catch (error) {
      setDeleteError(formatSecureKitError(error, baseUrl));
    } finally {
      setDeleteBusy("idle");
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1>SecureKit Playground</h1>
      <p style={{ marginTop: 4 }}>
        Base URL: <code>{baseUrl}</code>
      </p>

      <div style={panelStyle}>
        <h2 style={{ marginTop: 0 }}>General</h2>
        <div style={rowStyle}>
          <label>
            Mock scenario:
            <select
              value={mockScenario}
              onChange={(event) => setMockScenario(event.target.value as MockScenario)}
              style={{ marginLeft: 8 }}
            >
              <option value="clean">clean</option>
              <option value="risky">risky</option>
            </select>
          </label>
          <button onClick={runHealth} disabled={healthBusy !== "idle"}>
            {healthBusy === "loading" ? "Checking..." : "GET /health"}
          </button>
        </div>
        {healthError && <div style={{ color: "red", marginTop: 8 }}>{healthError}</div>}
        {healthResult && <pre style={preStyle}>{pretty(healthResult)}</pre>}
      </div>

      <div style={panelStyle}>
        <h2 style={{ marginTop: 0 }}>1) Network Check</h2>
        <div style={rowStyle}>
          <label>
            clientOffsetMin:
            <input
              value={clientOffsetInput}
              onChange={(event) => setClientOffsetInput(event.target.value)}
              style={{ marginLeft: 8, width: 100 }}
            />
          </label>
          <button onClick={runNetwork} disabled={networkBusy !== "idle"}>
            {networkBusy === "loading" ? "Running..." : "POST /verify/network"}
          </button>
        </div>
        {networkError && <div style={{ color: "red", marginTop: 8 }}>{networkError}</div>}
        {networkResult && <pre style={preStyle}>{pretty(networkResult)}</pre>}
      </div>

      <div style={panelStyle}>
        <h2 style={{ marginTop: 0 }}>2) Location Check</h2>
        <div style={rowStyle}>
          <label>
            allowedCountries:
            <input
              value={allowedCountriesInput}
              onChange={(event) => setAllowedCountriesInput(event.target.value)}
              style={{ marginLeft: 8, minWidth: 240 }}
              placeholder="TR,US"
            />
          </label>
          <button onClick={runLocation} disabled={locationBusy !== "idle"}>
            {locationBusy === "loading" ? "Running..." : "POST /verify/location"}
          </button>
        </div>
        {locationError && <div style={{ color: "red", marginTop: 8 }}>{locationError}</div>}
        {locationResult && <pre style={preStyle}>{pretty(locationResult)}</pre>}
      </div>

      <div style={panelStyle}>
        <h2 style={{ marginTop: 0 }}>3) Session Flow</h2>
        <div style={rowStyle}>
          <button onClick={() => void startSession()} disabled={sessionBusy !== "idle"}>
            {sessionBusy === "loading" ? "Working..." : "POST /session/start"}
          </button>
          <button onClick={() => void runFullSessionFlow()} disabled={sessionBusy !== "idle"}>
            {sessionBusy === "loading" ? "Working..." : "Start + Optional Checks + Verify"}
          </button>
          <button
            onClick={() => void verifySession(sessionId)}
            disabled={sessionBusy !== "idle" || sessionId.trim().length === 0}
          >
            {sessionBusy === "loading" ? "Working..." : "POST /verify/session"}
          </button>
        </div>

        <div style={rowStyle}>
          <label>
            sessionId:
            <input
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              style={{ marginLeft: 8, minWidth: 260 }}
            />
          </label>
          <label>
            expiresAt: <code>{sessionExpiresAt || "-"}</code>
          </label>
        </div>

        <div style={rowStyle}>
          <label>
            session policy allowedCountries:
            <input
              value={sessionPolicyCountriesInput}
              onChange={(event) => setSessionPolicyCountriesInput(event.target.value)}
              style={{ marginLeft: 8, minWidth: 220 }}
            />
          </label>
        </div>

        <div style={rowStyle}>
          <label>
            <input
              type="checkbox"
              checked={autoRunNetwork}
              onChange={(event) => setAutoRunNetwork(event.target.checked)}
            />
            auto-run network before verify
          </label>
          <label>
            <input
              type="checkbox"
              checked={autoRunLocation}
              onChange={(event) => setAutoRunLocation(event.target.checked)}
            />
            auto-run location before verify
          </label>
        </div>

        <div style={rowStyle}>
          <label>
            <input
              type="checkbox"
              checked={includeNetworkSignal}
              onChange={(event) => setIncludeNetworkSignal(event.target.checked)}
            />
            include network signal in /verify/session
          </label>
          <label>
            <input
              type="checkbox"
              checked={includeLocationSignal}
              onChange={(event) => setIncludeLocationSignal(event.target.checked)}
            />
            include location signal in /verify/session
          </label>
        </div>

        {sessionError && <div style={{ color: "red", marginTop: 8 }}>{sessionError}</div>}
        {sessionResult && <pre style={preStyle}>{pretty(sessionResult)}</pre>}
      </div>

      <div style={panelStyle}>
        <h2 style={{ marginTop: 0 }}>4) Consent + Keystroke Enrollment</h2>
        <div style={rowStyle}>
          <label>
            userId:
            <input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              style={{ marginLeft: 8, minWidth: 180 }}
            />
          </label>
          <label>
            consentVersion:
            <input
              value={consentVersion}
              onChange={(event) => setConsentVersion(event.target.value)}
              style={{ marginLeft: 8, width: 80 }}
            />
          </label>
        </div>

        <div style={rowStyle}>
          <button onClick={runConsent} disabled={consentBusy !== "idle"}>
            {consentBusy === "loading" ? "Working..." : "POST /consent"}
          </button>
          <button onClick={runEnroll} disabled={enrollBusy !== "idle"}>
            {enrollBusy === "loading" ? "Working..." : "POST /enroll/keystroke"}
          </button>
          <button onClick={runProfiles} disabled={profilesBusy !== "idle"}>
            {profilesBusy === "loading" ? "Working..." : "GET /user/:userId/profiles"}
          </button>
          <button onClick={runDeleteBiometrics} disabled={deleteBusy !== "idle"}>
            {deleteBusy === "loading" ? "Working..." : "DELETE /user/biometrics"}
          </button>
        </div>

        <div style={rowStyle}>
          <label>
            <input
              type="checkbox"
              checked={deleteConsent}
              onChange={(event) => setDeleteConsent(event.target.checked)}
            />
            deleteConsent=true query
          </label>
        </div>

        {consentError && <div style={{ color: "red", marginTop: 8 }}>{consentError}</div>}
        {consentResult && <pre style={preStyle}>{pretty(consentResult)}</pre>}

        {enrollError && <div style={{ color: "red", marginTop: 8 }}>{enrollError}</div>}
        {enrollResult && <pre style={preStyle}>{pretty(enrollResult)}</pre>}

        {profilesError && <div style={{ color: "red", marginTop: 8 }}>{profilesError}</div>}
        {profilesResult && <pre style={preStyle}>{pretty(profilesResult)}</pre>}

        {deleteError && <div style={{ color: "red", marginTop: 8 }}>{deleteError}</div>}
        {deleteResult && <pre style={preStyle}>{pretty(deleteResult)}</pre>}

        {lastEnrollmentEvents && (
          <>
            <h3 style={{ marginTop: 12 }}>Deterministic Keystroke Events</h3>
            <pre style={preStyle}>{pretty(lastEnrollmentEvents)}</pre>
          </>
        )}
      </div>
    </div>
  );
};
