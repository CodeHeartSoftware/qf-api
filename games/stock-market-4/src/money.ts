/** Integer-cents accounting discipline shared by every module in this game — never rely on
 * floating-point equality for money (same convention as games/stock-market-2 and
 * games/stock-market-3). */

export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function toDollars(cents: number): number {
  return cents / 100;
}

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}
