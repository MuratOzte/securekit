import type { ChallengeLang, ChallengeLength } from "@securekit/core";

const EN_WORDS = [
  "silver",
  "garden",
  "puzzle",
  "window",
  "planet",
  "signal",
  "forest",
  "camera",
  "bridge",
  "winter",
  "market",
  "rocket",
  "stream",
  "thunder",
  "velvet",
  "ticket",
  "memory",
  "travel",
  "shadow",
  "motion",
  "breeze",
  "stable",
  "anchor",
  "fluent",
  "candle",
  "voyage",
  "harbor",
  "mirror",
  "pocket",
  "rescue",
  "copper",
  "meadow",
];

const TR_WORDS = [
  "bahar",
  "deniz",
  "orman",
  "ruzgar",
  "yolculuk",
  "dag",
  "sehir",
  "yildiz",
  "nehir",
  "kapi",
  "pencere",
  "masa",
  "kalem",
  "bulut",
  "gunes",
  "toprak",
  "kitap",
  "isik",
  "saat",
  "yaka",
  "kozu",
  "durak",
  "golge",
  "ses",
  "adim",
  "yol",
  "kumsal",
  "dagit",
  "isaret",
  "renk",
  "denge",
  "kanat",
];

const LENGTH_RANGE: Record<ChallengeLength, [number, number]> = {
  short: [5, 7],
  medium: [10, 12],
  long: [16, 20],
};

export type Rng = () => number;

function toRandomUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 0.999999999;
  return value;
}

function pickIndex(maxExclusive: number, rng: Rng): number {
  return Math.floor(toRandomUnit(rng()) * maxExclusive);
}

function pickCount(length: ChallengeLength, rng: Rng): number {
  const [min, max] = LENGTH_RANGE[length];
  return min + pickIndex(max - min + 1, rng);
}

export function generateChallengeText(opts: {
  lang: ChallengeLang;
  length: ChallengeLength;
  rng: Rng;
}): string {
  const words = opts.lang === "tr" ? TR_WORDS : EN_WORDS;
  const count = pickCount(opts.length, opts.rng);
  const parts: string[] = [];

  for (let i = 0; i < count; i += 1) {
    parts.push(words[pickIndex(words.length, opts.rng)]);
  }

  return parts.join(" ").trim();
}
