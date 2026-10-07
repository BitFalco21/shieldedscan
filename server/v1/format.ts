/** Wire formatting shared across `/v1`. */

/** Exact decimal ZEC from integer zatoshi: string arithmetic, never a float division. */
export function zec(zat: number): string {
  const sign = zat < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(zat));
  const whole = Math.floor(abs / 100_000_000);
  const frac = String(abs % 100_000_000).padStart(8, "0");
  return `${sign}${whole}.${frac}`;
}

/** An amount as the analytics series publish it: integer zatoshi beside the exact decimal. */
export function amount(zat: number): { zat: number; zec: string } {
  return { zat, zec: zec(zat) };
}
