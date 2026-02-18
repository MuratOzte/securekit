import type { KeystrokeSample, LocationResult, NetworkResult } from "@securekit/core";

export type SessionSignals = {
  network?: NetworkResult;
  location?: LocationResult;
  keystroke?: KeystrokeSample;
};

export type SessionRecord = {
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  signals: SessionSignals;
  lastUpdatedAt?: number;
};

export type SessionLookupResult =
  | { state: "active"; record: SessionRecord }
  | { state: "expired"; record: SessionRecord }
  | { state: "missing" };
