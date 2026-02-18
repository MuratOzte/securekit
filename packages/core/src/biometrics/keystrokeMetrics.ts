import type { KeystrokeEvent, KeystrokeSample, KeystrokeSampleMetrics } from "../contracts/enrollment";

type NumericSummary = {
  mean: number;
  std: number;
  median: number;
  count: number;
  trimmed: boolean;
};

type TrimConfig = {
  lowerQuantile: number;
  upperQuantile: number;
};

export type ComputeKeystrokeMetricsResult = {
  metrics: KeystrokeSampleMetrics;
  reasons: string[];
  trimmed: boolean;
};

type KeyPair = {
  down: number;
  up: number;
};

const DEFAULT_TRIM_CONFIG: TrimConfig = {
  lowerQuantile: 0.05,
  upperQuantile: 0.95,
};

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock"]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeCount(value: unknown): number {
  if (!isFiniteNumber(value)) return 0;
  if (value <= 0) return 0;
  return Math.round(value);
}

function toRounded(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}

function safeSlice(values: number[], start: number, end: number): number[] {
  if (values.length === 0) return [];
  const normalizedStart = clamp(start, 0, values.length - 1);
  const normalizedEnd = clamp(end, normalizedStart + 1, values.length);
  return values.slice(normalizedStart, normalizedEnd);
}

function trimOutliers(values: number[], config: TrimConfig): { values: number[]; trimmed: boolean } {
  const sorted = values.filter((value) => isFiniteNumber(value) && value >= 0).sort((a, b) => a - b);
  if (sorted.length < 10) {
    return { values: sorted, trimmed: false };
  }

  const start = Math.floor(sorted.length * config.lowerQuantile);
  const end = Math.ceil(sorted.length * config.upperQuantile);
  const sliced = safeSlice(sorted, start, end);

  if (sliced.length < 3) {
    return { values: sorted, trimmed: false };
  }

  return {
    values: sliced,
    trimmed: sliced.length !== sorted.length,
  };
}

function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function calculateStd(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
  return Math.sqrt(variance);
}

function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 0) {
    return (values[middle - 1] + values[middle]) / 2;
  }
  return values[middle];
}

function summarize(values: number[], trimConfig: TrimConfig): NumericSummary {
  const normalized = values.filter((value) => isFiniteNumber(value) && value >= 0).sort((a, b) => a - b);
  if (normalized.length === 0) {
    return {
      mean: 0,
      std: 0,
      median: 0,
      count: 0,
      trimmed: false,
    };
  }

  const trimmed = trimOutliers(normalized, trimConfig);
  const bucket = trimmed.values.length > 0 ? trimmed.values : normalized;
  const mean = calculateMean(bucket);
  const std = calculateStd(bucket, mean);
  const median = calculateMedian(bucket);

  return {
    mean: toRounded(mean),
    std: toRounded(std),
    median: toRounded(median),
    count: normalized.length,
    trimmed: trimmed.trimmed,
  };
}

function isAllowedKey(key: string | undefined): boolean {
  if (!key) return true;
  if (key.length === 1) return true;
  if (key === "Backspace" || key === "Enter") return true;
  return !MODIFIER_KEYS.has(key);
}

function normalizeEvent(event: KeystrokeEvent): KeystrokeEvent | null {
  if (event.type !== "down" && event.type !== "up") return null;
  if (!isFiniteNumber(event.t)) return null;
  if (event.t < 0) return null;
  if (event.isRepeat) return null;
  if (!isAllowedKey(event.key)) return null;

  return {
    key: event.key,
    code: event.code,
    type: event.type,
    t: event.t,
    isRepeat: event.isRepeat,
    location: event.location,
    expectedIndex: event.expectedIndex,
  };
}

function eventToken(event: KeystrokeEvent, index: number): string {
  const codePart = event.code && event.code.length > 0 ? event.code : "code:none";
  const keyPart = event.key && event.key.length > 0 ? event.key : "key:none";
  const indexPart =
    isFiniteNumber(event.expectedIndex) && Number.isInteger(event.expectedIndex)
      ? `idx:${event.expectedIndex}`
      : `idx:auto:${index}`;
  const locationPart = isFiniteNumber(event.location) ? `loc:${event.location}` : "loc:none";
  return `${codePart}|${keyPart}|${indexPart}|${locationPart}`;
}

function buildPairs(events: KeystrokeEvent[]): KeyPair[] {
  const sortedEvents = events
    .map((event) => normalizeEvent(event))
    .filter((event): event is KeystrokeEvent => Boolean(event))
    .sort((left, right) => {
      if (left.t === right.t) {
        if (left.type === right.type) return 0;
        return left.type === "down" ? -1 : 1;
      }
      return left.t - right.t;
    });

  const downByToken = new Map<string, number[]>();
  const pairs: KeyPair[] = [];

  sortedEvents.forEach((event, index) => {
    const token = eventToken(event, index);
    if (event.type === "down") {
      const queue = downByToken.get(token) ?? [];
      queue.push(event.t);
      downByToken.set(token, queue);
      return;
    }

    const queue = downByToken.get(token);
    const downTs = queue?.shift();
    if (!isFiniteNumber(downTs)) return;
    if (event.t < downTs) return;

    pairs.push({
      down: downTs,
      up: event.t,
    });
  });

  return pairs.sort((left, right) => left.down - right.down);
}

function deriveDurations(pairs: KeyPair[]): {
  hold: number[];
  dd: number[];
  ud: number[];
  uu: number[];
} {
  const hold = pairs.map((pair) => pair.up - pair.down).filter((value) => value >= 0);
  const dd: number[] = [];
  const ud: number[] = [];

  for (let index = 1; index < pairs.length; index += 1) {
    const current = pairs[index];
    const previous = pairs[index - 1];
    const ddValue = current.down - previous.down;
    if (ddValue >= 0) dd.push(ddValue);

    const udValue = current.down - previous.up;
    if (udValue >= 0) ud.push(udValue);
  }

  const pairsByUp = [...pairs].sort((left, right) => left.up - right.up);
  const uu: number[] = [];
  for (let index = 1; index < pairsByUp.length; index += 1) {
    const value = pairsByUp[index].up - pairsByUp[index - 1].up;
    if (value >= 0) uu.push(value);
  }

  return { hold, dd, ud, uu };
}

function resolveTypedLength(sample: KeystrokeSample, fallback: number): number {
  if (isFiniteNumber(sample.typedLength) && sample.typedLength > 0) {
    return Math.round(sample.typedLength);
  }

  if (typeof sample.expectedText === "string" && sample.expectedText.length > 0) {
    return sample.expectedText.length;
  }

  return fallback;
}

function resolveDurationMs(events: KeystrokeEvent[]): number {
  const normalized = events
    .map((event) => normalizeEvent(event))
    .filter((event): event is KeystrokeEvent => Boolean(event))
    .sort((left, right) => left.t - right.t);

  if (normalized.length < 2) return 0;
  const start = normalized[0].t;
  const end = normalized[normalized.length - 1].t;
  if (end <= start) return 0;
  return toRounded(end - start);
}

export function buildEmptyKeystrokeMetrics(): KeystrokeSampleMetrics {
  return {
    holdMeanMs: 0,
    holdStdMs: 0,
    holdMedianMs: 0,
    flightMeanMs: 0,
    flightStdMs: 0,
    flightMedianMs: 0,
    ddMeanMs: 0,
    ddStdMs: 0,
    ddMedianMs: 0,
    udMeanMs: 0,
    udStdMs: 0,
    udMedianMs: 0,
    uuMeanMs: 0,
    uuStdMs: 0,
    uuMedianMs: 0,
    typingSpeedCharsPerSec: 0,
    errorRate: 0,
    backspaceRate: 0,
    digraphCount: 0,
    keystrokeCount: 0,
    eventCount: 0,
    durationMs: 0,
  };
}

export function computeKeystrokeMetrics(
  sample: KeystrokeSample,
  trimConfig: Partial<TrimConfig> = {}
): ComputeKeystrokeMetricsResult {
  const resolvedTrim: TrimConfig = {
    lowerQuantile:
      isFiniteNumber(trimConfig.lowerQuantile) && trimConfig.lowerQuantile >= 0
        ? trimConfig.lowerQuantile
        : DEFAULT_TRIM_CONFIG.lowerQuantile,
    upperQuantile:
      isFiniteNumber(trimConfig.upperQuantile) && trimConfig.upperQuantile <= 1
        ? trimConfig.upperQuantile
        : DEFAULT_TRIM_CONFIG.upperQuantile,
  };

  const pairs = buildPairs(sample.events ?? []);
  const durations = deriveDurations(pairs);
  const flightValues = durations.ud.length > 0 ? durations.ud : durations.dd;

  const holdSummary = summarize(durations.hold, resolvedTrim);
  const flightSummary = summarize(flightValues, resolvedTrim);
  const ddSummary = summarize(durations.dd, resolvedTrim);
  const udSummary = summarize(durations.ud, resolvedTrim);
  const uuSummary = summarize(durations.uu, resolvedTrim);

  const durationMs = resolveDurationMs(sample.events ?? []);
  const typedLength = resolveTypedLength(sample, pairs.length);
  const errorCount = normalizeCount(sample.errorCount);
  const backspaceCount = normalizeCount(sample.backspaceCount);

  const typingSpeedCharsPerSec =
    durationMs > 0 ? toRounded(typedLength / (durationMs / 1000)) : 0;
  const errorRate = typedLength > 0 ? toRounded(clamp(errorCount / typedLength, 0, 1)) : 0;
  const backspaceRate =
    typedLength > 0 ? toRounded(clamp(backspaceCount / typedLength, 0, 1)) : 0;

  const metrics: KeystrokeSampleMetrics = {
    holdMeanMs: holdSummary.mean,
    holdStdMs: holdSummary.std,
    holdMedianMs: holdSummary.median,
    flightMeanMs: flightSummary.mean,
    flightStdMs: flightSummary.std,
    flightMedianMs: flightSummary.median,
    ddMeanMs: ddSummary.mean,
    ddStdMs: ddSummary.std,
    ddMedianMs: ddSummary.median,
    udMeanMs: udSummary.mean,
    udStdMs: udSummary.std,
    udMedianMs: udSummary.median,
    uuMeanMs: uuSummary.mean,
    uuStdMs: uuSummary.std,
    uuMedianMs: uuSummary.median,
    typingSpeedCharsPerSec,
    errorRate,
    backspaceRate,
    digraphCount: durations.dd.length,
    keystrokeCount: pairs.length,
    eventCount: Array.isArray(sample.events) ? sample.events.length : 0,
    durationMs,
  };

  const reasons: string[] = [];
  const trimmed =
    holdSummary.trimmed ||
    flightSummary.trimmed ||
    ddSummary.trimmed ||
    udSummary.trimmed ||
    uuSummary.trimmed;

  if (trimmed) {
    reasons.push("OUTLIER_TRIMMED");
  }

  if (sample.imeCompositionUsed) {
    reasons.push("IME_COMPOSITION_DETECTED");
  }

  if (pairs.length < 3) {
    reasons.push("INSUFFICIENT_SAMPLES");
  }

  if (durations.dd.length < 2 || durations.ud.length < 2) {
    reasons.push("LOW_DIGRAPH_COVERAGE");
  }

  return {
    metrics,
    reasons,
    trimmed,
  };
}
