import type { SubscriptionFrequency } from "./contracts";

const frequencyRanges: Record<SubscriptionFrequency, { min: number; max: number; target: number }> = {
  weekly: { min: 5, max: 9, target: 7 },
  biweekly: { min: 12, max: 16, target: 14 },
  monthly: { min: 26, max: 34, target: 30 },
  quarterly: { min: 80, max: 100, target: 90 },
  yearly: { min: 350, max: 380, target: 365 },
};

export function levenshteinDistance(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const previous = Array.from({ length: a.length + 1 }, (_, index) => index);

  for (let row = 1; row <= b.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= a.length; column += 1) {
      const above = previous[column];
      previous[column] = a[column - 1] === b[row - 1]
        ? diagonal
        : Math.min(diagonal, previous[column - 1], above) + 1;
      diagonal = above;
    }
  }

  return previous[a.length];
}

export function calculateStringSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  const a = left.toLowerCase().trim();
  const b = right.toLowerCase().trim();
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 80;
  const maxLength = Math.max(a.length, b.length);
  return Math.max(0, ((maxLength - levenshteinDistance(a, b)) / maxLength) * 100);
}

function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function filterGapOutliers(values: number[], multiplier = 2): number[] {
  if (values.length < 3) return values;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = standardDeviation(values);
  if (deviation === 0) return values;
  return values.filter((value) => Math.abs(value - mean) <= multiplier * deviation);
}

export function detectFrequencyFromGaps(
  gaps: number[]
): { frequency: SubscriptionFrequency | null; confidence: number } {
  const filtered = filterGapOutliers(gaps.filter((gap) => Number.isFinite(gap) && gap > 0));
  if (filtered.length === 0) return { frequency: null, confidence: 0 };

  const average = filtered.reduce((sum, gap) => sum + gap, 0) / filtered.length;
  let best: { frequency: SubscriptionFrequency | null; score: number } = { frequency: null, score: 0 };
  for (const [frequency, range] of Object.entries(frequencyRanges) as Array<[
    SubscriptionFrequency,
    { min: number; max: number; target: number },
  ]>) {
    if (average < range.min || average > range.max) continue;
    const score = 1 - Math.abs(average - range.target) / ((range.max - range.min) / 2);
    if (score > best.score) best = { frequency, score };
  }

  if (!best.frequency) return { frequency: null, confidence: 0 };
  const consistency = Math.max(0, 1 - standardDeviation(filtered) / average);
  return { frequency: best.frequency, confidence: Math.round((best.score + consistency) * 50) };
}

export interface MatchCandidate {
  merchant: string | null;
  description: string | null;
  amount: string | number;
  categoryId?: string | null;
  categorySystemId?: string | null;
}

export interface MatchTarget {
  name: string;
  merchant: string | null;
  amount: string | number;
  categoryId?: string | null;
}

export function scoreSubscriptionMatch(target: MatchTarget, candidate: MatchCandidate) {
  let score = 0;
  const reasons: string[] = [];
  if (target.merchant && candidate.merchant) {
    const similarity = calculateStringSimilarity(target.merchant, candidate.merchant);
    if (similarity === 100) { score += 50; reasons.push("Exact merchant match"); }
    else if (similarity >= 80) { score += 30; reasons.push("Similar merchant"); }
  }

  const targetAmount = Math.abs(Number(target.amount));
  const candidateAmount = Math.abs(Number(candidate.amount));
  const difference = Math.abs(targetAmount - candidateAmount);
  if (difference === 0) { score += 30; reasons.push("Exact amount match"); }
  else if (difference <= targetAmount * 0.05) { score += 20; reasons.push("Amount within 5%"); }

  if (target.categoryId && (candidate.categoryId === target.categoryId || candidate.categorySystemId === target.categoryId)) {
    score += 10;
    reasons.push("Same category");
  }
  if (!target.merchant && !candidate.merchant && calculateStringSimilarity(target.name, candidate.description ?? "") >= 70) {
    score += 20;
    reasons.push("Description match");
  }
  return { score, reason: reasons.join(", ") };
}
