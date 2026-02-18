import type {
  EnrollmentProgress,
  KeystrokeEvent,
  KeystrokeProfile,
  KeystrokeSample,
  KeystrokeSampleMetrics,
} from "../contracts/enrollment";
import { buildEmptyKeystrokeMetrics, computeKeystrokeMetrics } from "./keystrokeMetrics";

export const DEFAULT_ENROLLMENT_MIN_ROUNDS = 10;
export const DEFAULT_ENROLLMENT_MIN_KEYSTROKES = 160;

type EnrollmentTargets = {
  minRounds?: number;
  minKeystrokes?: number;
};

type BuildKeystrokeProfileArgs = {
  userId: string;
  nowIso: string;
  events?: KeystrokeEvent[];
  sample?: KeystrokeSample;
  expectedText?: string;
  typedLength?: number;
  errorCount?: number;
  backspaceCount?: number;
  imeCompositionUsed?: boolean;
  existingProfile?: KeystrokeProfile | null;
  enrollmentTargets?: EnrollmentTargets;
};

export type BuildKeystrokeProfileResult = {
  profile: KeystrokeProfile;
  sampleMetrics: KeystrokeSampleMetrics;
  enrollmentProgress: EnrollmentProgress;
  reasons: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (!isFiniteNumber(value) || value <= 0) return fallback;
  return Math.round(value);
}

function toRounded(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

function inferRounds(profile: KeystrokeProfile | null | undefined): number {
  if (!profile) return 0;
  if (isFiniteNumber(profile.sampleRoundCount) && profile.sampleRoundCount > 0) {
    return Math.round(profile.sampleRoundCount);
  }
  return profile.sampleCount > 0 ? 1 : 0;
}

function mergeMeanStd(args: {
  existingMean: number;
  existingStd: number;
  sampleMean: number;
  sampleStd: number;
  existingWeight: number;
  sampleWeight: number;
}): { mean: number; std: number } {
  const totalWeight = args.existingWeight + args.sampleWeight;
  if (totalWeight <= 0) {
    return {
      mean: toRounded(args.sampleMean),
      std: toRounded(args.sampleStd),
    };
  }

  const mean =
    (args.existingMean * args.existingWeight + args.sampleMean * args.sampleWeight) / totalWeight;

  const existingVariance = Math.max(0, args.existingStd) ** 2;
  const sampleVariance = Math.max(0, args.sampleStd) ** 2;

  const variance =
    ((existingVariance + (args.existingMean - mean) ** 2) * args.existingWeight +
      (sampleVariance + (args.sampleMean - mean) ** 2) * args.sampleWeight) /
    totalWeight;

  return {
    mean: toRounded(mean),
    std: toRounded(Math.sqrt(Math.max(0, variance))),
  };
}

function mergeNumeric(
  existingValue: number | undefined,
  sampleValue: number,
  existingWeight: number,
  sampleWeight: number
): number {
  if (!isFiniteNumber(existingValue) || existingWeight <= 0) {
    return toRounded(sampleValue);
  }

  const totalWeight = existingWeight + sampleWeight;
  if (totalWeight <= 0) return toRounded(sampleValue);

  return toRounded((existingValue * existingWeight + sampleValue * sampleWeight) / totalWeight);
}

function resolveSample(args: BuildKeystrokeProfileArgs): KeystrokeSample {
  if (args.sample) {
    return {
      ...args.sample,
      events: Array.isArray(args.sample.events) ? args.sample.events : [],
      ...(args.expectedText !== undefined ? { expectedText: args.expectedText } : {}),
      ...(args.typedLength !== undefined ? { typedLength: args.typedLength } : {}),
      ...(args.errorCount !== undefined ? { errorCount: args.errorCount } : {}),
      ...(args.backspaceCount !== undefined ? { backspaceCount: args.backspaceCount } : {}),
      ...(args.imeCompositionUsed !== undefined
        ? { imeCompositionUsed: args.imeCompositionUsed }
        : {}),
    };
  }

  return {
    source: "legacy",
    events: Array.isArray(args.events) ? args.events : [],
    ...(args.expectedText !== undefined ? { expectedText: args.expectedText } : {}),
    ...(args.typedLength !== undefined ? { typedLength: args.typedLength } : {}),
    ...(args.errorCount !== undefined ? { errorCount: args.errorCount } : {}),
    ...(args.backspaceCount !== undefined ? { backspaceCount: args.backspaceCount } : {}),
    ...(args.imeCompositionUsed !== undefined
      ? { imeCompositionUsed: args.imeCompositionUsed }
      : {}),
  };
}

function resolveTargets(input?: EnrollmentTargets): { minRounds: number; minKeystrokes: number } {
  return {
    minRounds: normalizePositiveInt(input?.minRounds, DEFAULT_ENROLLMENT_MIN_ROUNDS),
    minKeystrokes: normalizePositiveInt(input?.minKeystrokes, DEFAULT_ENROLLMENT_MIN_KEYSTROKES),
  };
}

function createInitialProfile(args: {
  userId: string;
  nowIso: string;
  sampleMetrics: KeystrokeSampleMetrics;
  sampleWeight: number;
}): KeystrokeProfile {
  return {
    userId: args.userId,
    createdAt: args.nowIso,
    updatedAt: args.nowIso,
    sampleCount: args.sampleWeight,
    sampleRoundCount: 1,
    holdMeanMs: args.sampleMetrics.holdMeanMs,
    holdStdMs: args.sampleMetrics.holdStdMs,
    holdMedianMs: args.sampleMetrics.holdMedianMs,
    flightMeanMs: args.sampleMetrics.flightMeanMs,
    flightStdMs: args.sampleMetrics.flightStdMs,
    flightMedianMs: args.sampleMetrics.flightMedianMs,
    digraphCount: args.sampleMetrics.digraphCount,
    ddMeanMs: args.sampleMetrics.ddMeanMs,
    ddStdMs: args.sampleMetrics.ddStdMs,
    ddMedianMs: args.sampleMetrics.ddMedianMs,
    udMeanMs: args.sampleMetrics.udMeanMs,
    udStdMs: args.sampleMetrics.udStdMs,
    udMedianMs: args.sampleMetrics.udMedianMs,
    uuMeanMs: args.sampleMetrics.uuMeanMs,
    uuStdMs: args.sampleMetrics.uuStdMs,
    uuMedianMs: args.sampleMetrics.uuMedianMs,
    typingSpeedMean: args.sampleMetrics.typingSpeedCharsPerSec,
    typingSpeedStd: 0,
    errorRateMean: args.sampleMetrics.errorRate,
    backspaceRateMean: args.sampleMetrics.backspaceRate,
  };
}

function mergeProfile(args: {
  existingProfile: KeystrokeProfile;
  nowIso: string;
  sampleMetrics: KeystrokeSampleMetrics;
  sampleWeight: number;
}): KeystrokeProfile {
  const existingWeight = Math.max(0, args.existingProfile.sampleCount);
  if (existingWeight <= 0) {
    return createInitialProfile({
      userId: args.existingProfile.userId,
      nowIso: args.nowIso,
      sampleMetrics: args.sampleMetrics,
      sampleWeight: args.sampleWeight,
    });
  }

  const hold = mergeMeanStd({
    existingMean: args.existingProfile.holdMeanMs,
    existingStd: args.existingProfile.holdStdMs,
    sampleMean: args.sampleMetrics.holdMeanMs,
    sampleStd: args.sampleMetrics.holdStdMs,
    existingWeight,
    sampleWeight: args.sampleWeight,
  });
  const flight = mergeMeanStd({
    existingMean: args.existingProfile.flightMeanMs,
    existingStd: args.existingProfile.flightStdMs,
    sampleMean: args.sampleMetrics.flightMeanMs,
    sampleStd: args.sampleMetrics.flightStdMs,
    existingWeight,
    sampleWeight: args.sampleWeight,
  });
  const dd = mergeMeanStd({
    existingMean: args.existingProfile.ddMeanMs ?? args.existingProfile.flightMeanMs,
    existingStd: args.existingProfile.ddStdMs ?? args.existingProfile.flightStdMs,
    sampleMean: args.sampleMetrics.ddMeanMs,
    sampleStd: args.sampleMetrics.ddStdMs,
    existingWeight,
    sampleWeight: args.sampleWeight,
  });
  const ud = mergeMeanStd({
    existingMean: args.existingProfile.udMeanMs ?? args.existingProfile.flightMeanMs,
    existingStd: args.existingProfile.udStdMs ?? args.existingProfile.flightStdMs,
    sampleMean: args.sampleMetrics.udMeanMs,
    sampleStd: args.sampleMetrics.udStdMs,
    existingWeight,
    sampleWeight: args.sampleWeight,
  });
  const uu = mergeMeanStd({
    existingMean: args.existingProfile.uuMeanMs ?? args.existingProfile.flightMeanMs,
    existingStd: args.existingProfile.uuStdMs ?? args.existingProfile.flightStdMs,
    sampleMean: args.sampleMetrics.uuMeanMs,
    sampleStd: args.sampleMetrics.uuStdMs,
    existingWeight,
    sampleWeight: args.sampleWeight,
  });

  const sampleRoundCount = inferRounds(args.existingProfile) + 1;
  const sampleCount = existingWeight + args.sampleWeight;

  return {
    ...args.existingProfile,
    updatedAt: args.nowIso,
    sampleCount,
    sampleRoundCount,
    holdMeanMs: hold.mean,
    holdStdMs: hold.std,
    holdMedianMs: mergeNumeric(
      args.existingProfile.holdMedianMs,
      args.sampleMetrics.holdMedianMs,
      existingWeight,
      args.sampleWeight
    ),
    flightMeanMs: flight.mean,
    flightStdMs: flight.std,
    flightMedianMs: mergeNumeric(
      args.existingProfile.flightMedianMs,
      args.sampleMetrics.flightMedianMs,
      existingWeight,
      args.sampleWeight
    ),
    digraphCount: Math.max(0, (args.existingProfile.digraphCount ?? 0) + args.sampleMetrics.digraphCount),
    ddMeanMs: dd.mean,
    ddStdMs: dd.std,
    ddMedianMs: mergeNumeric(
      args.existingProfile.ddMedianMs,
      args.sampleMetrics.ddMedianMs,
      existingWeight,
      args.sampleWeight
    ),
    udMeanMs: ud.mean,
    udStdMs: ud.std,
    udMedianMs: mergeNumeric(
      args.existingProfile.udMedianMs,
      args.sampleMetrics.udMedianMs,
      existingWeight,
      args.sampleWeight
    ),
    uuMeanMs: uu.mean,
    uuStdMs: uu.std,
    uuMedianMs: mergeNumeric(
      args.existingProfile.uuMedianMs,
      args.sampleMetrics.uuMedianMs,
      existingWeight,
      args.sampleWeight
    ),
    typingSpeedMean: mergeNumeric(
      args.existingProfile.typingSpeedMean,
      args.sampleMetrics.typingSpeedCharsPerSec,
      existingWeight,
      args.sampleWeight
    ),
    typingSpeedStd: mergeNumeric(
      args.existingProfile.typingSpeedStd,
      0,
      existingWeight,
      args.sampleWeight
    ),
    errorRateMean: mergeNumeric(
      args.existingProfile.errorRateMean,
      args.sampleMetrics.errorRate,
      existingWeight,
      args.sampleWeight
    ),
    backspaceRateMean: mergeNumeric(
      args.existingProfile.backspaceRateMean,
      args.sampleMetrics.backspaceRate,
      existingWeight,
      args.sampleWeight
    ),
  };
}

function toEnrollmentProgress(args: {
  profile: KeystrokeProfile;
  minRounds: number;
  minKeystrokes: number;
}): EnrollmentProgress {
  const roundsCompleted = inferRounds(args.profile);
  const keystrokesCollected = Math.max(0, Math.round(args.profile.sampleCount));

  const roundsRemaining = Math.max(0, args.minRounds - roundsCompleted);
  const keystrokesRemaining = Math.max(0, args.minKeystrokes - keystrokesCollected);

  return {
    roundsCompleted,
    roundsTarget: args.minRounds,
    roundsRemaining,
    keystrokesCollected,
    keystrokesTarget: args.minKeystrokes,
    keystrokesRemaining,
    ready: roundsRemaining === 0 || keystrokesRemaining === 0,
  };
}

function ema(current: number, sample: number, alpha: number): number {
  return current + alpha * (sample - current);
}

function emaStd(currentStd: number, currentMean: number, sample: number, alpha: number): number {
  const variance = Math.max(0, currentStd) ** 2;
  const nextVariance = (1 - alpha) * variance + alpha * (sample - currentMean) ** 2;
  return Math.sqrt(Math.max(0, nextVariance));
}

export function applyKeystrokeProfileEmaUpdate(args: {
  profile: KeystrokeProfile;
  sampleMetrics: KeystrokeSampleMetrics;
  nowIso: string;
  alpha?: number;
}): KeystrokeProfile {
  const alpha = clamp(isFiniteNumber(args.alpha) ? args.alpha : 0.08, 0.01, 0.5);

  const holdMean = ema(args.profile.holdMeanMs, args.sampleMetrics.holdMeanMs, alpha);
  const holdStd = emaStd(args.profile.holdStdMs, args.profile.holdMeanMs, args.sampleMetrics.holdMeanMs, alpha);
  const flightMean = ema(args.profile.flightMeanMs, args.sampleMetrics.flightMeanMs, alpha);
  const flightStd = emaStd(
    args.profile.flightStdMs,
    args.profile.flightMeanMs,
    args.sampleMetrics.flightMeanMs,
    alpha
  );

  return {
    ...args.profile,
    updatedAt: args.nowIso,
    sampleCount: Math.max(1, args.profile.sampleCount) + Math.max(1, args.sampleMetrics.keystrokeCount),
    sampleRoundCount: inferRounds(args.profile) + 1,
    holdMeanMs: toRounded(holdMean),
    holdStdMs: toRounded(holdStd),
    holdMedianMs: mergeNumeric(
      args.profile.holdMedianMs,
      args.sampleMetrics.holdMedianMs,
      Math.max(1, args.profile.sampleCount),
      Math.max(1, args.sampleMetrics.keystrokeCount)
    ),
    flightMeanMs: toRounded(flightMean),
    flightStdMs: toRounded(flightStd),
    flightMedianMs: mergeNumeric(
      args.profile.flightMedianMs,
      args.sampleMetrics.flightMedianMs,
      Math.max(1, args.profile.sampleCount),
      Math.max(1, args.sampleMetrics.keystrokeCount)
    ),
    digraphCount: Math.max(0, (args.profile.digraphCount ?? 0) + args.sampleMetrics.digraphCount),
    ddMeanMs: toRounded(
      ema(args.profile.ddMeanMs ?? args.profile.flightMeanMs, args.sampleMetrics.ddMeanMs, alpha)
    ),
    ddStdMs: toRounded(
      emaStd(
        args.profile.ddStdMs ?? args.profile.flightStdMs,
        args.profile.ddMeanMs ?? args.profile.flightMeanMs,
        args.sampleMetrics.ddMeanMs,
        alpha
      )
    ),
    ddMedianMs: mergeNumeric(
      args.profile.ddMedianMs,
      args.sampleMetrics.ddMedianMs,
      Math.max(1, args.profile.sampleCount),
      Math.max(1, args.sampleMetrics.keystrokeCount)
    ),
    udMeanMs: toRounded(
      ema(args.profile.udMeanMs ?? args.profile.flightMeanMs, args.sampleMetrics.udMeanMs, alpha)
    ),
    udStdMs: toRounded(
      emaStd(
        args.profile.udStdMs ?? args.profile.flightStdMs,
        args.profile.udMeanMs ?? args.profile.flightMeanMs,
        args.sampleMetrics.udMeanMs,
        alpha
      )
    ),
    udMedianMs: mergeNumeric(
      args.profile.udMedianMs,
      args.sampleMetrics.udMedianMs,
      Math.max(1, args.profile.sampleCount),
      Math.max(1, args.sampleMetrics.keystrokeCount)
    ),
    uuMeanMs: toRounded(
      ema(args.profile.uuMeanMs ?? args.profile.flightMeanMs, args.sampleMetrics.uuMeanMs, alpha)
    ),
    uuStdMs: toRounded(
      emaStd(
        args.profile.uuStdMs ?? args.profile.flightStdMs,
        args.profile.uuMeanMs ?? args.profile.flightMeanMs,
        args.sampleMetrics.uuMeanMs,
        alpha
      )
    ),
    uuMedianMs: mergeNumeric(
      args.profile.uuMedianMs,
      args.sampleMetrics.uuMedianMs,
      Math.max(1, args.profile.sampleCount),
      Math.max(1, args.sampleMetrics.keystrokeCount)
    ),
    typingSpeedMean: toRounded(
      ema(args.profile.typingSpeedMean ?? 0, args.sampleMetrics.typingSpeedCharsPerSec, alpha)
    ),
    typingSpeedStd: toRounded(
      emaStd(
        args.profile.typingSpeedStd ?? 0,
        args.profile.typingSpeedMean ?? 0,
        args.sampleMetrics.typingSpeedCharsPerSec,
        alpha
      )
    ),
    errorRateMean: toRounded(ema(args.profile.errorRateMean ?? 0, args.sampleMetrics.errorRate, alpha)),
    backspaceRateMean: toRounded(
      ema(args.profile.backspaceRateMean ?? 0, args.sampleMetrics.backspaceRate, alpha)
    ),
  };
}

export function buildKeystrokeProfile(args: BuildKeystrokeProfileArgs): BuildKeystrokeProfileResult {
  const sample = resolveSample(args);
  const metricsResult = sample.events.length
    ? computeKeystrokeMetrics(sample)
    : { metrics: buildEmptyKeystrokeMetrics(), reasons: ["INSUFFICIENT_SAMPLES"], trimmed: false };

  const sampleWeight = Math.max(1, metricsResult.metrics.keystrokeCount);
  const profile = args.existingProfile
    ? mergeProfile({
        existingProfile: args.existingProfile,
        nowIso: args.nowIso,
        sampleMetrics: metricsResult.metrics,
        sampleWeight,
      })
    : createInitialProfile({
        userId: args.userId,
        nowIso: args.nowIso,
        sampleMetrics: metricsResult.metrics,
        sampleWeight,
      });

  const targets = resolveTargets(args.enrollmentTargets);
  const enrollmentProgress = toEnrollmentProgress({
    profile,
    minRounds: targets.minRounds,
    minKeystrokes: targets.minKeystrokes,
  });

  const reasons = [...metricsResult.reasons];
  if (!enrollmentProgress.ready) {
    reasons.push("INSUFFICIENT_SAMPLES");
  }

  return {
    profile,
    sampleMetrics: metricsResult.metrics,
    enrollmentProgress,
    reasons: Array.from(new Set(reasons)),
  };
}
