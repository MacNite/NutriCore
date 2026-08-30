export interface RankSignals { barcodeMatch?: boolean; exactNameMatch?: boolean; textMatch: number; brandMatch?: boolean; localeMatch?: boolean; favorite?: boolean; daysSinceUse?: number; usageFrequency?: number; sameMealContext?: boolean; personalRecipe?: boolean; customFood?: boolean; dataCompleteness: number; sourceTrust: number; servingAvailability?: boolean; aiConfidence?: number; isAI?: boolean }
export function rankFood(s: RankSignals) {
  if (s.barcodeMatch) return 1_000_000;
  let score = s.textMatch * 300 + s.dataCompleteness * 60 + s.sourceTrust * 100;
  if (s.exactNameMatch) score += 500;
  if (s.brandMatch) score += 80;
  if (s.localeMatch) score += 25;
  if (s.favorite) score += 180;
  if (s.daysSinceUse !== undefined) score += 100 * Math.exp(-s.daysSinceUse / 14);
  score += Math.log1p(s.usageFrequency ?? 0) * 30;
  if (s.sameMealContext) score += 25;
  if (s.personalRecipe || s.customFood) score += 90;
  if (s.servingAvailability) score += 15;
  if (s.isAI) score -= 250 + (1 - (s.aiConfidence ?? 0)) * 200;
  return score;
}
