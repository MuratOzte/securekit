import type { ConsentLog, KeystrokeProfile, UserProfiles } from "@securekit/core";

export type { ConsentLog, KeystrokeProfile, UserProfiles };

export type StoredUserData = {
  profiles: UserProfiles | null;
  consentLogs: ConsentLog[];
};
