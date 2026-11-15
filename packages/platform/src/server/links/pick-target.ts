export interface TargetCandidate {
  readonly id: string;
  readonly spaceId: string;
}

// A title that matches several pages is never guessed: the author picks one explicitly from the picker.
export function pickTarget(candidates: readonly TargetCandidate[], sourceSpaceId: string): string | null {
  const here = candidates.filter((candidate) => candidate.spaceId === sourceSpaceId);
  const pool = here.length > 0 ? here : candidates;
  return pool.length === 1 ? (pool[0]?.id ?? null) : null;
}
