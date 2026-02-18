import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChallengeLang,
  ChallengeTextResponse,
  KeystrokeEvent,
  KeystrokeSampleMetrics,
} from "@securekit/core";
import {
  buildKeystrokeSample,
  createKeystrokeCollector,
  HttpError,
  type ConsentResponse,
  type DeleteBiometricsResponse,
  type EnrollKeystrokeResponse,
  type GetProfilesResponse,
  type VerifyKeystrokeResponse,
  type VerifySessionRequest,
  type VerifySessionResponse,
} from "@securekit/web-sdk";
import {
  createSecureKitClient,
  deleteSecureKitJson,
  formatSecureKitError,
  resolveSecureKitBaseUrl,
} from "../lib/secureKitClient.js";

type SectionBusy = "idle" | "loading";
type CollectorApi = ReturnType<typeof createKeystrokeCollector>;

type KeystrokeDecision = "allow" | "step_up" | "deny";

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
      // ignore
    }
  }, [key, value]);

  return [value, setValue];
}

function parseNumber(value: string, fallback: number, min = 0, max = Number.POSITIVE_INFINITY): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function splitWords(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
}

function resolveCompletedWordCount(expectedWords: string[], typedValue: string): number {
  if (expectedWords.length === 0) return 0;

  let cursor = 0;
  let completed = 0;

  for (let index = 0; index < expectedWords.length; index += 1) {
    const word = expectedWords[index];
    const typedWord = typedValue.slice(cursor, cursor + word.length);

    if (typedWord !== word) {
      return completed;
    }

    cursor += word.length;
    completed = index + 1;

    if (index < expectedWords.length - 1) {
      if (typedValue[cursor] === " ") {
        cursor += 1;
        continue;
      }
      if (cursor === typedValue.length) {
        return completed;
      }
      if (typedValue[cursor] !== " ") {
        return completed - 1;
      }
    }
  }

  return completed;
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

  const [userId, setUserId] = usePersistentState("securekit.playground.userId", "demo-user-1");
  const [consentVersion, setConsentVersion] = usePersistentState("securekit.playground.consentVersion", "v1");
  const [challengeLang, setChallengeLang] = usePersistentState<ChallengeLang>("securekit.playground.challengeLang", "en");
  const [challengeWordCountInput, setChallengeWordCountInput] = usePersistentState("securekit.playground.challengeWordCount", "6");
  const [targetRoundsInput, setTargetRoundsInput] = usePersistentState("securekit.playground.targetRounds", "10");
  const [showRawEvents, setShowRawEvents] = usePersistentState("securekit.playground.showRawEvents", false);
  const [deleteConsent, setDeleteConsent] = usePersistentState("securekit.playground.deleteConsent", false);

  const [allowThresholdInput, setAllowThresholdInput] = usePersistentState("securekit.playground.allowThreshold", "0.76");
  const [stepUpThresholdInput, setStepUpThresholdInput] = usePersistentState("securekit.playground.stepUpThreshold", "0.56");
  const [denyThresholdInput, setDenyThresholdInput] = usePersistentState("securekit.playground.denyThreshold", "0.36");

  const [sessionId, setSessionId] = usePersistentState("securekit.playground.sessionId", "");
  const [sessionResult, setSessionResult] = useState<VerifySessionResponse | null>(null);
  const [sessionBusy, setSessionBusy] = useState<SectionBusy>("idle");
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [consentBusy, setConsentBusy] = useState<SectionBusy>("idle");
  const [consentError, setConsentError] = useState<string | null>(null);
  const [consentResult, setConsentResult] = useState<ConsentResponse | null>(null);

  const [enrollBusy, setEnrollBusy] = useState<SectionBusy>("idle");
  const [enrollError, setEnrollError] = useState<string | null>(null);
  const [enrollResult, setEnrollResult] = useState<EnrollKeystrokeResponse | null>(null);
  const [enrollChallenge, setEnrollChallenge] = useState<ChallengeTextResponse | null>(null);
  const [enrollTyped, setEnrollTyped] = useState("");
  const [enrollWordInput, setEnrollWordInput] = useState("");
  const [enrollWordIndex, setEnrollWordIndex] = useState(0);
  const [enrollRoundsCompleted, setEnrollRoundsCompleted] = useState(0);

  const [verifyBusy, setVerifyBusy] = useState<SectionBusy>("idle");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyKeystrokeResponse | null>(null);
  const [verifyChallenge, setVerifyChallenge] = useState<ChallengeTextResponse | null>(null);
  const [verifyTyped, setVerifyTyped] = useState("");
  const [verifyWordInput, setVerifyWordInput] = useState("");
  const [verifyWordIndex, setVerifyWordIndex] = useState(0);

  const [profilesBusy, setProfilesBusy] = useState<SectionBusy>("idle");
  const [profilesError, setProfilesError] = useState<string | null>(null);
  const [profilesResult, setProfilesResult] = useState<GetProfilesResponse | null>(null);

  const [deleteBusy, setDeleteBusy] = useState<SectionBusy>("idle");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteResult, setDeleteResult] = useState<DeleteBiometricsResponse | null>(null);

  const [lastMetrics, setLastMetrics] = useState<KeystrokeSampleMetrics | null>(null);
  const [lastRawEvents, setLastRawEvents] = useState<KeystrokeEvent[] | null>(null);

  const enrollInputRef = useRef<HTMLInputElement | null>(null);
  const verifyInputRef = useRef<HTMLInputElement | null>(null);
  const enrollCollectorRef = useRef<CollectorApi | null>(null);
  const verifyCollectorRef = useRef<CollectorApi | null>(null);

  const targetRounds = Math.max(1, Math.round(parseNumber(targetRoundsInput, 10, 1, 50)));
  const challengeWordCount = Math.max(1, Math.round(parseNumber(challengeWordCountInput, 6, 1, 40)));
  const allowThreshold = parseNumber(allowThresholdInput, 0.76, 0, 1);
  const stepUpThreshold = parseNumber(stepUpThresholdInput, 0.56, 0, 1);
  const denyThreshold = parseNumber(denyThresholdInput, 0.36, 0, 1);

  const enrollChallengeWords = useMemo(
    () => splitWords(enrollChallenge?.text ?? ""),
    [enrollChallenge?.challengeId, enrollChallenge?.text]
  );

  const enrollCurrentWordIndex =
    enrollChallengeWords.length > 0
      ? Math.min(enrollWordIndex, enrollChallengeWords.length - 1)
      : 0;
  const enrollCurrentWord = enrollChallengeWords[enrollCurrentWordIndex] ?? "";

  const verifyChallengeWords = useMemo(
    () => splitWords(verifyChallenge?.text ?? ""),
    [verifyChallenge?.challengeId, verifyChallenge?.text]
  );

  const verifyCurrentWordIndex =
    verifyChallengeWords.length > 0
      ? Math.min(verifyWordIndex, verifyChallengeWords.length - 1)
      : 0;
  const verifyCurrentWord = verifyChallengeWords[verifyCurrentWordIndex] ?? "";

  useEffect(() => {
    const input = enrollInputRef.current;
    if (!input || !enrollChallenge) return undefined;

    const collector = createKeystrokeCollector(input, {
      includeBackspace: true,
      includeEnter: false,
      includeRawKey: showRawEvents,
    });
    enrollCollectorRef.current = collector;

    return () => {
      collector.stop();
      if (enrollCollectorRef.current === collector) {
        enrollCollectorRef.current = null;
      }
    };
  }, [enrollChallenge?.challengeId, showRawEvents]);

  useEffect(() => {
    if (!enrollChallenge) return;
    const input = enrollInputRef.current;
    if (!input) return;
    input.focus();
    enrollCollectorRef.current?.start();
  }, [enrollChallenge?.challengeId]);

  useEffect(() => {
    const input = verifyInputRef.current;
    if (!input || !verifyChallenge) return undefined;

    const collector = createKeystrokeCollector(input, {
      includeBackspace: true,
      includeEnter: false,
      includeRawKey: showRawEvents,
    });
    verifyCollectorRef.current = collector;

    return () => {
      collector.stop();
      if (verifyCollectorRef.current === collector) {
        verifyCollectorRef.current = null;
      }
    };
  }, [verifyChallenge?.challengeId, showRawEvents]);

  useEffect(() => {
    if (!verifyChallenge) return;
    const input = verifyInputRef.current;
    if (!input) return;
    input.focus();
    verifyCollectorRef.current?.start();
  }, [verifyChallenge?.challengeId]);

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
      setConsentResult(
        await client.grantConsent({
          userId: normalizedUserId,
          consentVersion: normalizedConsentVersion,
        })
      );
    } catch (error) {
      setConsentError(formatSecureKitError(error, baseUrl));
    } finally {
      setConsentBusy("idle");
    }
  };

  const getChallenge = async () =>
    client.getTextChallenge({
      lang: challengeLang,
      wordCount: challengeWordCount,
    });

  const startEnrollment = async () => {
    setEnrollBusy("loading");
    setEnrollError(null);
    setEnrollRoundsCompleted(0);
    setEnrollResult(null);
    try {
      const challenge = await getChallenge();
      setEnrollChallenge(challenge);
      setEnrollTyped("");
      setEnrollWordInput("");
      setEnrollWordIndex(0);
      enrollCollectorRef.current?.reset();
    } catch (error) {
      setEnrollError(formatSecureKitError(error, baseUrl));
    } finally {
      setEnrollBusy("idle");
    }
  };

  const submitEnrollment = async (typedTextOverride?: string) => {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId || !enrollChallenge || !enrollCollectorRef.current) return;

    setEnrollBusy("loading");
    setEnrollError(null);

    try {
      const collector = enrollCollectorRef.current;
      collector.stop();
      const snapshot = collector.getSnapshot();
      if (snapshot.events.length === 0) {
        setEnrollError("No keystroke events captured. Keep input focused while typing.");
        return;
      }

      const typedLength =
        typeof typedTextOverride === "string"
          ? typedTextOverride.length
          : snapshot.typedLength;

      const sample = buildKeystrokeSample(snapshot.events, enrollChallenge.text, {
        challengeId: enrollChallenge.challengeId,
        typedLength,
        errorCount: snapshot.errorCount,
        backspaceCount: snapshot.backspaceCount,
        ignoredEventCount: snapshot.ignoredEventCount,
        imeCompositionUsed: snapshot.imeCompositionUsed,
      });

      const result = await client.enrollKeystroke({
        userId: normalizedUserId,
        challengeId: enrollChallenge.challengeId,
        sample,
        expectedText: enrollChallenge.text,
        typedLength,
        errorCount: snapshot.errorCount,
        backspaceCount: snapshot.backspaceCount,
        imeCompositionUsed: snapshot.imeCompositionUsed,
      });

      setEnrollResult(result);
      setLastMetrics(result.sampleMetrics ?? null);
      setLastRawEvents(showRawEvents ? snapshot.events : null);

      const completed = enrollRoundsCompleted + 1;
      setEnrollRoundsCompleted(completed);

      const ready = completed >= targetRounds;
      if (ready) {
        setEnrollChallenge(null);
        setEnrollTyped("");
        setEnrollWordInput("");
        setEnrollWordIndex(0);
      } else {
        const nextChallenge = await getChallenge();
        setEnrollChallenge(nextChallenge);
        setEnrollTyped("");
        setEnrollWordInput("");
        setEnrollWordIndex(0);
        collector.reset();
      }
    } catch (error) {
      setEnrollError(formatSecureKitError(error, baseUrl));
    } finally {
      setEnrollBusy("idle");
    }
  };

  const startVerification = async () => {
    setVerifyBusy("loading");
    setVerifyError(null);
    setVerifyResult(null);

    try {
      const challenge = await getChallenge();
      setVerifyChallenge(challenge);
      setVerifyTyped("");
      setVerifyWordInput("");
      setVerifyWordIndex(0);
      verifyCollectorRef.current?.reset();
    } catch (error) {
      setVerifyError(formatSecureKitError(error, baseUrl));
    } finally {
      setVerifyBusy("idle");
    }
  };

  const submitVerification = async (typedTextOverride?: string) => {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId || !verifyChallenge || !verifyCollectorRef.current) return;

    setVerifyBusy("loading");
    setVerifyError(null);

    try {
      const collector = verifyCollectorRef.current;
      collector.stop();
      const snapshot = collector.getSnapshot();
      if (snapshot.events.length === 0) {
        setVerifyError("No keystroke events captured.");
        return;
      }

      const typedLength =
        typeof typedTextOverride === "string"
          ? typedTextOverride.length
          : snapshot.typedLength;

      const sample = buildKeystrokeSample(snapshot.events, verifyChallenge.text, {
        challengeId: verifyChallenge.challengeId,
        typedLength,
        errorCount: snapshot.errorCount,
        backspaceCount: snapshot.backspaceCount,
        ignoredEventCount: snapshot.ignoredEventCount,
        imeCompositionUsed: snapshot.imeCompositionUsed,
      });

      const result = await client.verifyKeystroke({
        userId: normalizedUserId,
        challengeId: verifyChallenge.challengeId,
        sample,
        policy: {
          enabled: true,
          allowThreshold,
          stepUpThreshold,
          denyThreshold,
          updateProfileOnAllow: true,
        },
      });

      setVerifyResult(result);
      setLastMetrics(result.sampleMetrics);
      setLastRawEvents(showRawEvents ? snapshot.events : null);

      if (sessionId.trim()) {
        setSessionBusy("loading");
        setSessionError(null);
        try {
          const decision = (result.decision as KeystrokeDecision) === "step_up" ? "keystroke" : "keystroke";
          const payload: Omit<VerifySessionRequest, "sessionId"> = {
            userId: normalizedUserId,
            policy: {
              stepUpSteps: [decision],
              keystroke: {
                enabled: true,
                allowThreshold,
                stepUpThreshold,
                denyThreshold,
                updateProfileOnAllow: true,
              },
            },
            signals: {
              keystroke: sample,
            },
          };

          const verifyWithSession = (activeSessionId: string) =>
            client.verifySession({
              sessionId: activeSessionId,
              ...payload,
            });

          const currentSessionId = sessionId.trim();
          let sessionResponse: VerifySessionResponse;
          try {
            sessionResponse = await verifyWithSession(currentSessionId);
          } catch (error) {
            if (error instanceof HttpError && (error.status === 404 || error.status === 410)) {
              const started = await client.startSession();
              setSessionId(started.sessionId);
              sessionResponse = await verifyWithSession(started.sessionId);
            } else {
              throw error;
            }
          }

          setSessionResult(sessionResponse);
        } catch (error) {
          setSessionError(formatSecureKitError(error, baseUrl));
        } finally {
          setSessionBusy("idle");
        }
      }

      setVerifyChallenge(null);
      setVerifyTyped("");
      setVerifyWordInput("");
      setVerifyWordIndex(0);
    } catch (error) {
      setVerifyError(formatSecureKitError(error, baseUrl));
    } finally {
      setVerifyBusy("idle");
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
      setProfilesResult(await client.getProfiles(normalizedUserId));
    } catch (error) {
      setProfilesError(formatSecureKitError(error, baseUrl));
    } finally {
      setProfilesBusy("idle");
    }
  };

  const runDelete = async () => {
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
      setDeleteResult(
        await deleteSecureKitJson<DeleteBiometricsResponse>(
          path,
          { userId: normalizedUserId },
          baseUrl
        )
      );
      setEnrollRoundsCompleted(0);
      setEnrollResult(null);
      setVerifyResult(null);
    } catch (error) {
      setDeleteError(formatSecureKitError(error, baseUrl));
    } finally {
      setDeleteBusy("idle");
    }
  };

  const onEnrollChange = (value: string) => {
    setEnrollWordInput(value);
  };

  const onEnrollKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== " ") return;
    event.preventDefault();
    if (enrollBusy !== "idle" || !enrollChallenge) return;

    const expectedWord = enrollChallengeWords[enrollWordIndex];
    if (!expectedWord) return;

    const typedWord = enrollWordInput.trim();
    if (!typedWord) return;
    if (typedWord !== expectedWord) {
      setEnrollError(`Expected word: "${expectedWord}"`);
      return;
    }

    setEnrollError(null);
    const nextTyped = enrollTyped.length > 0 ? `${enrollTyped} ${typedWord}` : typedWord;
    const nextWordIndex = enrollWordIndex + 1;
    setEnrollTyped(nextTyped);
    setEnrollWordInput("");
    setEnrollWordIndex(nextWordIndex);

    if (nextWordIndex >= enrollChallengeWords.length) {
      window.setTimeout(() => {
        void submitEnrollment(nextTyped);
      }, 0);
    }
  };

  const onVerifyChange = (value: string) => {
    setVerifyWordInput(value);
  };

  const onVerifyKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== " ") return;
    event.preventDefault();
    if (verifyBusy !== "idle" || !verifyChallenge) return;

    const expectedWord = verifyChallengeWords[verifyWordIndex];
    if (!expectedWord) return;

    const typedWord = verifyWordInput.trim();
    if (!typedWord) return;
    if (typedWord !== expectedWord) {
      setVerifyError(`Expected word: "${expectedWord}"`);
      return;
    }

    setVerifyError(null);
    const nextTyped = verifyTyped.length > 0 ? `${verifyTyped} ${typedWord}` : typedWord;
    const nextWordIndex = verifyWordIndex + 1;
    setVerifyTyped(nextTyped);
    setVerifyWordInput("");
    setVerifyWordIndex(nextWordIndex);

    if (nextWordIndex >= verifyChallengeWords.length) {
      window.setTimeout(() => {
        void submitVerification(nextTyped);
      }, 0);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h1>SecureKit Playground</h1>
      <p style={{ marginTop: 4 }}>
        Base URL: <code>{baseUrl}</code>
      </p>

      <div style={panelStyle}>
        <h2 style={{ marginTop: 0 }}>Keystroke Dynamics Flow</h2>

        <div style={rowStyle}>
          <label>
            userId:
            <input value={userId} onChange={(event) => setUserId(event.target.value)} style={{ marginLeft: 8 }} />
          </label>
          <label>
            consentVersion:
            <input value={consentVersion} onChange={(event) => setConsentVersion(event.target.value)} style={{ marginLeft: 8, width: 90 }} />
          </label>
          <button onClick={runConsent} disabled={consentBusy !== "idle"}>
            {consentBusy === "loading" ? "Working..." : "Step 1: POST /consent"}
          </button>
        </div>

        <div style={rowStyle}>
          <label>
            lang:
            <select value={challengeLang} onChange={(event) => setChallengeLang(event.target.value as ChallengeLang)} style={{ marginLeft: 8 }}>
              <option value="en">en</option>
              <option value="tr">tr</option>
            </select>
          </label>
          <label>
            length (words):
            <input
              type="number"
              min={1}
              max={40}
              step={1}
              value={challengeWordCountInput}
              onChange={(event) => setChallengeWordCountInput(event.target.value)}
              style={{ marginLeft: 8, width: 70 }}
            />
          </label>
          <label>
            target rounds:
            <input value={targetRoundsInput} onChange={(event) => setTargetRoundsInput(event.target.value)} style={{ marginLeft: 8, width: 70 }} />
          </label>
        </div>

        <div style={rowStyle}>
          <label>
            <input type="checkbox" checked={showRawEvents} onChange={(event) => setShowRawEvents(event.target.checked)} />
            show raw events (dev)
          </label>
          <label>
            sessionId:
            <input value={sessionId} onChange={(event) => setSessionId(event.target.value)} style={{ marginLeft: 8, width: 220 }} placeholder="optional /verify/session" />
          </label>
        </div>

        <h3 style={{ marginTop: 16 }}>Step 2: Enrollment</h3>
        <div style={rowStyle}>
          <button onClick={() => void startEnrollment()} disabled={enrollBusy !== "idle"}>
            {enrollBusy === "loading" ? "Working..." : "Start Enrollment Challenge"}
          </button>
          <div>progress: {Math.min(enrollRoundsCompleted, targetRounds)}/{targetRounds}</div>
        </div>
        {enrollChallenge && (
          <>
            <div style={{ marginTop: 8 }}>
              word {Math.min(enrollWordIndex + 1, enrollChallengeWords.length)}/{enrollChallengeWords.length}:{" "}
              <code>{enrollCurrentWord || "-"}</code>
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}>
              Press space to move to the next word.
            </div>
            <input
              ref={enrollInputRef}
              value={enrollWordInput}
              onChange={(event) => onEnrollChange(event.target.value)}
              onKeyDown={onEnrollKeyDown}
              onFocus={() => enrollCollectorRef.current?.start()}
              onBlur={() => enrollCollectorRef.current?.stop()}
              style={{ marginTop: 8, width: "100%", maxWidth: 760 }}
              placeholder="Type current word, press space"
            />
          </>
        )}

        <h3 style={{ marginTop: 16 }}>Step 3: Verification</h3>
        <div style={rowStyle}>
          <label>
            allow:
            <input value={allowThresholdInput} onChange={(event) => setAllowThresholdInput(event.target.value)} style={{ marginLeft: 8, width: 65 }} />
          </label>
          <label>
            step_up:
            <input value={stepUpThresholdInput} onChange={(event) => setStepUpThresholdInput(event.target.value)} style={{ marginLeft: 8, width: 65 }} />
          </label>
          <label>
            deny:
            <input value={denyThresholdInput} onChange={(event) => setDenyThresholdInput(event.target.value)} style={{ marginLeft: 8, width: 65 }} />
          </label>
          <button onClick={() => void startVerification()} disabled={verifyBusy !== "idle"}>
            {verifyBusy === "loading" ? "Working..." : "Start Verification Challenge"}
          </button>
        </div>
        {verifyChallenge && (
          <>
            <div style={{ marginTop: 8 }}>
              word {Math.min(verifyWordIndex + 1, verifyChallengeWords.length)}/{verifyChallengeWords.length}:{" "}
              <code>{verifyCurrentWord || "-"}</code>
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: "#475569" }}>
              Press space to move to the next word.
            </div>
            <input
              ref={verifyInputRef}
              value={verifyWordInput}
              onChange={(event) => onVerifyChange(event.target.value)}
              onKeyDown={onVerifyKeyDown}
              onFocus={() => verifyCollectorRef.current?.start()}
              onBlur={() => verifyCollectorRef.current?.stop()}
              style={{ marginTop: 8, width: "100%", maxWidth: 760 }}
              placeholder="Type current word, press space"
            />
          </>
        )}

        {consentError && <div style={{ color: "red", marginTop: 8 }}>{consentError}</div>}
        {enrollError && <div style={{ color: "red", marginTop: 8 }}>{enrollError}</div>}
        {verifyError && <div style={{ color: "red", marginTop: 8 }}>{verifyError}</div>}
        {profilesError && <div style={{ color: "red", marginTop: 8 }}>{profilesError}</div>}
        {deleteError && <div style={{ color: "red", marginTop: 8 }}>{deleteError}</div>}
        {sessionError && <div style={{ color: "red", marginTop: 8 }}>{sessionError}</div>}

        {consentResult && <pre style={preStyle}>{pretty(consentResult)}</pre>}
        {enrollResult && <pre style={preStyle}>{pretty(enrollResult)}</pre>}
        {verifyResult && (
          <div style={{ marginTop: 12 }}>
            <div>similarityScore: <strong>{verifyResult.similarityScore}</strong></div>
            <div>decision: <strong>{verifyResult.decision}</strong></div>
            <div>reasons: {verifyResult.reasons.join(", ") || "-"}</div>
            <pre style={preStyle}>{pretty(verifyResult)}</pre>
          </div>
        )}

        <div style={rowStyle}>
          <button onClick={runProfiles} disabled={profilesBusy !== "idle"}>
            {profilesBusy === "loading" ? "Working..." : "GET /user/:userId/profiles"}
          </button>
          <button onClick={runDelete} disabled={deleteBusy !== "idle"}>
            {deleteBusy === "loading" ? "Working..." : "DELETE /user/biometrics"}
          </button>
          <label>
            <input type="checkbox" checked={deleteConsent} onChange={(event) => setDeleteConsent(event.target.checked)} />
            deleteConsent=true
          </label>
        </div>

        {profilesResult && <pre style={preStyle}>{pretty(profilesResult)}</pre>}
        {deleteResult && <pre style={preStyle}>{pretty(deleteResult)}</pre>}
        {sessionResult && <pre style={preStyle}>{pretty(sessionResult)}</pre>}

        <h3 style={{ marginTop: 16 }}>Last Sample Metrics</h3>
        {lastMetrics ? <pre style={preStyle}>{pretty(lastMetrics)}</pre> : <div>Not available yet.</div>}

        {showRawEvents && lastRawEvents && (
          <>
            <h3 style={{ marginTop: 16 }}>Raw Events (dev)</h3>
            <pre style={preStyle}>{pretty(lastRawEvents)}</pre>
          </>
        )}
      </div>
    </div>
  );
};
