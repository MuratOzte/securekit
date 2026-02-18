import type { KeystrokeProfile, KeystrokeSampleMetrics } from "../contracts/enrollment";
import type { KeystrokeDecision, KeystrokePolicy } from "../contracts/keystroke";

type FeatureConfig = {
  key: string;
  sample: (metrics: KeystrokeSampleMetrics) => number;
  profileMean: (profile: KeystrokeProfile) => number | undefined;
  profileStd: (profile: KeystrokeProfile) => number | undefined;
  minStd: number;
  weight: number;
};

export type ResolvedKeystrokeThresholds = {
  allowThreshold: number;
  stepUpThreshold: number;
  denyThreshold: number;
};

export type ScoreKeystrokeResult = {
  distance: number;
  similarityScore: number;
  decision: KeystrokeDecision;
  reasons: string[];
  thresholds: ResolvedKeystrokeThresholds;
};

export type EnrollmentReadinessResult = {
  ok: boolean;
  reasons: string[];
};

export const DEFAULT_KEYSTROKE_THRESHOLDS: ResolvedKeystrokeThresholds = {
  allowThreshold: 0.76,
  stepUpThreshold: 0.56,
  denyThreshold: 0.36,
};

const DEFAULT_MIN_ENROLLMENT_ROUNDS = 8;
const DEFAULT_MIN_ENROLLMENT_KEYSTROKES = 120;
const DEFAULT_MIN_DIGRAPH_COUNT = 40;

const FEATURE_SET: FeatureConfig[] = [
  {
    key: "hold",
    sample: (metrics) => metrics.holdMeanMs,
    profileMean: (profile) => profile.holdMeanMs,
    profileStd: (profile) => profile.holdStdMs,
    minStd: 8,
    weight: 1.2,
  },
  {
    key: "flight",
    sample: (metrics) => metrics.flightMeanMs,
    profileMean: (profile) => profile.flightMeanMs,
    profileStd: (profile) => profile.flightStdMs,
    minStd: 8,
    weight: 1,
  },
  {
    key: "dd",
    sample: (metrics) => metrics.ddMeanMs,
    profileMean: (profile) => profile.ddMeanMs,
    profileStd: (profile) => profile.ddStdMs,
    minStd: 8,
    weight: 0.8,
  },
  {
    key: "ud",
    sample: (metrics) => metrics.udMeanMs,
    profileMean: (profile) => profile.udMeanMs,
    profileStd: (profile) => profile.udStdMs,
    minStd: 8,
    weight: 1,
  },
  {
    key: "uu",
    sample: (metrics) => metrics.uuMeanMs,
    profileMean: (profile) => profile.uuMeanMs,
    profileStd: (profile) => profile.uuStdMs,
    minStd: 8,
    weight: 0.6,
  },
  {
    key: "speed",
    sample: (metrics) => metrics.typingSpeedCharsPerSec,
    profileMean: (profile) => profile.typingSpeedMean,
    profileStd: (profile) => profile.typingSpeedStd,
    minStd: 0.3,
    weight: 0.5,
  },
  {
    key: "error",
    sample: (metrics) => metrics.errorRate,
    profileMean: (profile) => profile.errorRateMean,
    profileStd: () => 0.08,
    minStd: 0.05,
    weight: 0.5,
  },
  {
    key: "backspace",
    sample: (metrics) => metrics.backspaceRate,
    profileMean: (profile) => profile.backspaceRateMean,
    profileStd: () => 0.1,
    minStd: 0.05,
    weight: 0.4,
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toRounded(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

export function resolveKeystrokeThresholds(policy?: KeystrokePolicy): ResolvedKeystrokeThresholds {
  const allowThreshold = clamp(
    isFiniteNumber(policy?.allowThreshold)
      ? policy.allowThreshold
      : DEFAULT_KEYSTROKE_THRESHOLDS.allowThreshold,
    0.1,
    0.99
  );
  const stepUpThreshold = clamp(
    isFiniteNumber(policy?.stepUpThreshold)
      ? policy.stepUpThreshold
      : DEFAULT_KEYSTROKE_THRESHOLDS.stepUpThreshold,
    0.05,
    allowThreshold
  );
  const denyThreshold = clamp(
    isFiniteNumber(policy?.denyThreshold)
      ? policy.denyThreshold
      : DEFAULT_KEYSTROKE_THRESHOLDS.denyThreshold,
    0,
    stepUpThreshold
  );

  return {
    allowThreshold,
    stepUpThreshold,
    denyThreshold,
  };
}

function inferRoundCount(profile: KeystrokeProfile): number {
  if (isFiniteNumber(profile.sampleRoundCount) && profile.sampleRoundCount > 0) {
    return Math.round(profile.sampleRoundCount);
  }
  return profile.sampleCount > 0 ? 1 : 0;
}

function resolveDistance(profile: KeystrokeProfile, sampleMetrics: KeystrokeSampleMetrics): {
  distance: number;
  featuresUsed: number;
} {
  let weightedDistance = 0;
  let totalWeight = 0;
  let featuresUsed = 0;

  for (const feature of FEATURE_SET) {
    const sampleValue = feature.sample(sampleMetrics);
    const profileMean = feature.profileMean(profile);
    const profileStd = feature.profileStd(profile);

    if (!isFiniteNumber(sampleValue) || !isFiniteNumber(profileMean)) {
      continue;
    }

    const std = isFiniteNumber(profileStd) ? Math.max(feature.minStd, Math.abs(profileStd)) : feature.minStd;
    const delta = sampleValue - profileMean;
    const normalized = (delta * delta) / (std * std);

    weightedDistance += normalized * feature.weight;
    totalWeight += feature.weight;
    featuresUsed += 1;
  }

  if (featuresUsed === 0 || totalWeight <= 0) {
    return { distance: 10, featuresUsed: 0 };
  }

  return {
    distance: Math.sqrt(weightedDistance / totalWeight),
    featuresUsed,
  };
}

function distanceToSimilarity(distance: number): number {
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return clamp(Math.exp(-0.9 * distance), 0, 1);
}

function decide(similarityScore: number, thresholds: ResolvedKeystrokeThresholds): KeystrokeDecision {
  if (similarityScore >= thresholds.allowThreshold) return "allow";
  if (similarityScore < thresholds.denyThreshold) return "deny";
  return "step_up";
}

export function evaluateEnrollmentReadiness(
  profile: KeystrokeProfile,
  policy?: KeystrokePolicy
): EnrollmentReadinessResult {
  const rounds = inferRoundCount(profile);
  const minRounds =
    isFiniteNumber(policy?.minEnrollmentRounds) && policy.minEnrollmentRounds > 0
      ? Math.round(policy.minEnrollmentRounds)
      : DEFAULT_MIN_ENROLLMENT_ROUNDS;
  const minKeystrokes =
    isFiniteNumber(policy?.minEnrollmentKeystrokes) && policy.minEnrollmentKeystrokes > 0
      ? Math.round(policy.minEnrollmentKeystrokes)
      : DEFAULT_MIN_ENROLLMENT_KEYSTROKES;
  const minDigraphCount =
    isFiniteNumber(policy?.minDigraphCount) && policy.minDigraphCount > 0
      ? Math.round(policy.minDigraphCount)
      : DEFAULT_MIN_DIGRAPH_COUNT;

  const reasons: string[] = [];
  if (rounds < minRounds && profile.sampleCount < minKeystrokes) {
    reasons.push("INSUFFICIENT_SAMPLES");
  }
  if ((profile.digraphCount ?? 0) < minDigraphCount) {
    reasons.push("LOW_DIGRAPH_COVERAGE");
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}

export function scoreKeystrokeSample(args: {
  profile: KeystrokeProfile;
  sampleMetrics: KeystrokeSampleMetrics;
  policy?: KeystrokePolicy;
}): ScoreKeystrokeResult {
  const thresholds = resolveKeystrokeThresholds(args.policy);
  const distanceDetails = resolveDistance(args.profile, args.sampleMetrics);
  const similarity = distanceToSimilarity(distanceDetails.distance);
  const decision = decide(similarity, thresholds);

  const reasons: string[] = [];
  if (distanceDetails.featuresUsed < 3) {
    reasons.push("INSUFFICIENT_SAMPLES");
  }
  if (distanceDetails.distance > 2.2) {
    reasons.push("HIGH_DISTANCE");
  }
  if (similarity < thresholds.stepUpThreshold) {
    reasons.push("LOW_SIMILARITY");
  }

  return {
    distance: toRounded(distanceDetails.distance),
    similarityScore: toRounded(similarity),
    decision,
    reasons: Array.from(new Set(reasons)),
    thresholds,
  };
}
