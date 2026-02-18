import request from "supertest";
import { describe, expect, it } from "vitest";
import type { KeystrokeEvent, KeystrokeSample } from "@securekit/core";
import { createApp } from "../server";
import { InMemoryAdapter } from "../storage/inMemoryAdapter";

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function createSample(args: {
  seed: number;
  chars: number;
  speedMultiplier?: number;
  errorCount?: number;
  backspaceCount?: number;
}): KeystrokeSample {
  const rng = createSeededRng(args.seed);
  const events: KeystrokeEvent[] = [];
  let t = 0;

  const speedMultiplier = args.speedMultiplier ?? 1;
  for (let index = 0; index < args.chars; index += 1) {
    const flight = (40 + Math.floor(rng() * 30)) * speedMultiplier;
    const hold = (85 + Math.floor(rng() * 35)) * speedMultiplier;
    const key = String.fromCharCode(97 + (index % 26));
    const code = `Key${key.toUpperCase()}`;

    t += flight;
    events.push({
      key,
      code,
      type: "down",
      t,
      expectedIndex: index,
    });

    t += hold;
    events.push({
      key,
      code,
      type: "up",
      t,
      expectedIndex: index,
    });
  }

  return {
    events,
    expectedText: "deterministic challenge",
    typedLength: args.chars,
    errorCount: args.errorCount ?? 0,
    backspaceCount: args.backspaceCount ?? 0,
    source: "collector_v1",
  };
}

describe("verify keystroke endpoint", () => {
  it("supports enroll -> verify allow/deny with threshold policy", async () => {
    const app = createApp({
      storage: new InMemoryAdapter(),
      nowFnIso: () => "2026-02-18T12:00:00.000Z",
    });

    await request(app).post("/consent").send({
      userId: "u1",
      consentVersion: "v1",
    });

    const enrollmentSample = createSample({
      seed: 11,
      chars: 32,
    });

    const enroll = await request(app).post("/enroll/keystroke").send({
      userId: "u1",
      sample: enrollmentSample,
      expectedText: enrollmentSample.expectedText,
      typedLength: enrollmentSample.typedLength,
      errorCount: enrollmentSample.errorCount,
      backspaceCount: enrollmentSample.backspaceCount,
    });

    expect(enroll.status).toBe(200);
    expect(enroll.body.ok).toBe(true);
    expect(enroll.body.profile.sampleCount).toBeGreaterThan(0);

    const similarVerify = await request(app).post("/verify/keystroke").send({
      userId: "u1",
      sample: createSample({
        seed: 11,
        chars: 32,
      }),
      policy: {
        enabled: true,
        allowThreshold: 0.7,
        stepUpThreshold: 0.5,
        denyThreshold: 0.25,
        minEnrollmentRounds: 1,
        minEnrollmentKeystrokes: 20,
        minDigraphCount: 15,
      },
    });

    expect(similarVerify.status).toBe(200);
    expect(similarVerify.body.similarityScore).toBeGreaterThanOrEqual(0.7);
    expect(similarVerify.body.decision).toBe("allow");
    expect(similarVerify.body.reasons).not.toContain("PROFILE_MISSING");

    const shiftedVerify = await request(app).post("/verify/keystroke").send({
      userId: "u1",
      sample: createSample({
        seed: 123,
        chars: 32,
        speedMultiplier: 2.5,
        errorCount: 7,
        backspaceCount: 6,
      }),
      policy: {
        enabled: true,
        allowThreshold: 0.88,
        stepUpThreshold: 0.7,
        denyThreshold: 0.6,
        minEnrollmentRounds: 1,
        minEnrollmentKeystrokes: 20,
        minDigraphCount: 15,
      },
    });

    expect(shiftedVerify.status).toBe(200);
    expect(shiftedVerify.body.similarityScore).toBeGreaterThanOrEqual(0);
    expect(shiftedVerify.body.similarityScore).toBeLessThanOrEqual(1);
    expect(shiftedVerify.body.decision).toBe("deny");
    expect(shiftedVerify.body.reasons).toContain("LOW_SIMILARITY");
  });
});
