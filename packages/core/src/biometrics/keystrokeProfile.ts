import type { KeystrokeEvent, KeystrokeProfile } from "../contracts/enrollment";

type BuildKeystrokeProfileArgs = {
  userId: string;
  nowIso: string;
  events: KeystrokeEvent[];
};

function getMean(values: number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function getStd(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / values.length;
  return Math.sqrt(variance);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function extractHoldDurations(events: KeystrokeEvent[]): number[] {
  const downByKey = new Map<string, number[]>();
  const holdDurations: number[] = [];

  for (const event of events) {
    if (!isFiniteNumber(event.t)) continue;

    if (event.type === "down") {
      const queue = downByKey.get(event.key) ?? [];
      queue.push(event.t);
      downByKey.set(event.key, queue);
      continue;
    }

    const queue = downByKey.get(event.key);
    const downTs = queue?.shift();
    if (!isFiniteNumber(downTs)) continue;

    const delta = event.t - downTs;
    if (delta >= 0) {
      holdDurations.push(delta);
    }
  }

  return holdDurations;
}

function extractFlightDurations(events: KeystrokeEvent[]): number[] {
  const downTimes = events
    .filter((event) => event.type === "down" && isFiniteNumber(event.t))
    .map((event) => event.t);

  const flightDurations: number[] = [];
  for (let index = 0; index < downTimes.length - 1; index += 1) {
    const delta = downTimes[index + 1] - downTimes[index];
    if (delta >= 0) {
      flightDurations.push(delta);
    }
  }

  return flightDurations;
}

export function buildKeystrokeProfile(args: BuildKeystrokeProfileArgs): KeystrokeProfile {
  const holdDurations = extractHoldDurations(args.events);
  const flightDurations = extractFlightDurations(args.events);

  const holdMeanMs = getMean(holdDurations);
  const flightMeanMs = getMean(flightDurations);

  const holdStdMs = holdDurations.length < 5 ? 0 : getStd(holdDurations, holdMeanMs);
  const flightStdMs = flightDurations.length < 5 ? 0 : getStd(flightDurations, flightMeanMs);

  return {
    userId: args.userId,
    createdAt: args.nowIso,
    updatedAt: args.nowIso,
    sampleCount: holdDurations.length,
    holdMeanMs,
    holdStdMs,
    flightMeanMs,
    flightStdMs,
  };
}
