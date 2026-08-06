export interface SavingsProgress {
  progressMinor: bigint;
  targetMinor: bigint;
  pct: number;
  achieved: boolean;
}

export function computeSavingsProgress(input: {
  targetMinor: bigint;
  linkedToAccount: boolean;
  contributedMinor: bigint;
  accountBalanceMinor?: bigint;
  accountOpeningBalanceMinor?: bigint;
}): SavingsProgress {
  let progressMinor: bigint;

  if (input.linkedToAccount) {
    const balance = input.accountBalanceMinor ?? 0n;
    const opening = input.accountOpeningBalanceMinor ?? 0n;
    const delta = balance - opening;
    progressMinor = delta > 0n ? delta : 0n;
  } else {
    progressMinor = input.contributedMinor;
  }

  const pct = input.targetMinor === 0n ? 0 : Number((progressMinor * 10000n) / input.targetMinor) / 100;

  return {
    progressMinor,
    targetMinor: input.targetMinor,
    pct: Math.min(pct, 100),
    achieved: progressMinor >= input.targetMinor,
  };
}
