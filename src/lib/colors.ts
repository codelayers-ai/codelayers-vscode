/**
 * Blast radius colors — matches Vision Pro GraphDepthVisualizer.blastRadiusColor()
 * Copied from web/src/lib/colors.ts
 */

export const BLAST_RADIUS_COLORS: Record<number, string> = {
  0: '#FF3B30', // Red - changed file itself
  1: '#FF9500', // Orange - 1 hop away
  2: '#FFCC00', // Yellow - 2 hops away
  3: '#10B981', // Emerald - 3 hops away (shifted from git green)
  4: '#5AC8FA', // Teal - 4+ hops away
};

export function getBlastRadiusColor(distance: number): string {
  if (distance >= 4) return BLAST_RADIUS_COLORS[4];
  return BLAST_RADIUS_COLORS[distance] ?? '#808080';
}

/** Returns the custom theme color ID for the given hop distance. */
export function getHopColorId(distance: number): string {
  const hop = Math.min(distance, 4);
  return `codelayers.hop${hop}`;
}

export function getBlastRadiusLabel(distance: number): string {
  if (distance === 0) return 'Changed';
  if (distance === 1) return '1 hop';
  if (distance >= 4) return '4+';
  return `${distance}`;
}
