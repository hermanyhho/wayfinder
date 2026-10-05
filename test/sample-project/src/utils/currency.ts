const RATES: Record<string, number> = { NOK: 1, SEK: 0.98, EUR: 11.6 };

export function toNok(amount: number, currency: string): number {
  return amount * (RATES[currency] ?? 1);
}
