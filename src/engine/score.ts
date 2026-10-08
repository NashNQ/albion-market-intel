// Score — fonction pure.

/** Score = profit unitaire × Q × C. */
export function score(unitProfit: number, q: number, c: number): number {
  return unitProfit * q * c;
}
