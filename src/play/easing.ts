export const easeRatio = (ratio: number, ease: string | undefined): number => {
  if (ease !== 'ease_in_out') return ratio;
  return ratio < 0.5
    ? 4 * ratio * ratio * ratio
    : 1 - Math.pow(-2 * ratio + 2, 3) / 2;
};
