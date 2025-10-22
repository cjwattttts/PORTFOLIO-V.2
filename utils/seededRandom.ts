// utils/seededRandom.ts
// Small, fast, deterministic PRNG (Mulberry32).
// Use createSeededRandom(seed) to get a stable [0,1) generator.

export function createSeededRandom(seed: number) {
  // Normalize the seed to 32-bit unsigned integer.
  let s = seed >>> 0 || 0x9e3779b9;

  return function rand() {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // [0,1)
  };
}
