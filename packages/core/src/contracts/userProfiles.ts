import type { KeystrokeProfile } from "./enrollment";

export type FaceEnrollmentProfile = {
  embedding: number[];
};

export type VoiceEnrollmentProfile = {
  embedding: number[];
};

export type UserProfiles = {
  userId: string;
  keystroke?: KeystrokeProfile | null;
  faceEmbedding?: number[] | null;
  voiceEmbedding?: number[] | null;
  updatedAt: string;
};

export type DeleteBiometricsRequest = {
  userId: string;
};

export type DeleteBiometricsResponse = {
  ok: true;
  userId: string;
};

export type GetProfilesResponse = {
  ok: true;
  profiles: UserProfiles;
};
