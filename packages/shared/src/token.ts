/**
 * Daily order tokens shown to customers: A1…A99, B1…B99, … Z99, then wraps.
 * Mirrors the Postgres function `format_token(seq)`; keep both in sync.
 */
export const TOKEN_NUMBERS_PER_LETTER = 99;

export function formatToken(seq: number): string {
  if (!Number.isInteger(seq) || seq < 1) throw new RangeError("Token sequence starts at 1");
  const index = seq - 1;
  const letter = String.fromCharCode(65 + (Math.floor(index / TOKEN_NUMBERS_PER_LETTER) % 26));
  const num = (index % TOKEN_NUMBERS_PER_LETTER) + 1;
  return `${letter}${num}`;
}
