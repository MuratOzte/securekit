export type KeystrokeEvent = {
  key: string;
  type: "down" | "up";
  t: number;
};

export type KeystrokeProfile = {
  userId: string;
  createdAt: string;
  updatedAt: string;
  sampleCount: number;
  holdMeanMs: number;
  holdStdMs: number;
  flightMeanMs: number;
  flightStdMs: number;
};

export type EnrollKeystrokeRequest = {
  userId: string;
  challengeId?: string;
  events: KeystrokeEvent[];
};

export type EnrollKeystrokeResponse = {
  ok: true;
  profile: KeystrokeProfile;
};
