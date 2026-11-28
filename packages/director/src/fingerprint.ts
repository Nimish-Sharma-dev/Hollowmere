export interface Fingerprint {
  crisis_id: string;
  antagonist_npc_id: string;
  ending_family: string;
  tone: string;
  twist_id: string;
}

export interface RecentRun {
  fingerprint: Fingerprint;
  /** coarse onboarding cluster, e.g. "safety:shepherd" */
  profileKey: string;
}

const FIELDS: (keyof Fingerprint)[] = ['crisis_id', 'antagonist_npc_id', 'ending_family', 'tone', 'twist_id'];

/** number of fields that differ (0..5) */
export function distance(a: Fingerprint, b: Fingerprint): number {
  return FIELDS.reduce((n, f) => n + (a[f] === b[f] ? 0 : 1), 0);
}

export function fingerprintString(f: Fingerprint): string {
  return FIELDS.map((k) => f[k]).join(' | ');
}

export const RECENT_WINDOW = 30;
export const MIN_DISTANCE_SIMILAR = 3;
export const MIN_DISTANCE_OVERALL = 2;

export interface FingerprintCheck {
  ok: boolean;
  /** smallest distance to the last 30 runs overall (5 if none) */
  overallMin: number;
  /** smallest distance to the last 30 runs with the same profile (5 if none) */
  similarMin: number;
  reasons: string[];
}

/** PROMPTS.md section 12: distance >= 3 from similar-profile runs, >= 2 from all of the last 30. */
export function checkFingerprint(fp: Fingerprint, profileKey: string, recents: RecentRun[]): FingerprintCheck {
  const last = recents.slice(-RECENT_WINDOW);
  let overallMin = 5;
  let similarMin = 5;
  for (const r of last) {
    const d = distance(fp, r.fingerprint);
    overallMin = Math.min(overallMin, d);
    if (r.profileKey === profileKey) similarMin = Math.min(similarMin, d);
  }
  const reasons: string[] = [];
  if (overallMin < MIN_DISTANCE_OVERALL) reasons.push(`distance ${overallMin} < ${MIN_DISTANCE_OVERALL} from a recent run`);
  if (similarMin < MIN_DISTANCE_SIMILAR) reasons.push(`distance ${similarMin} < ${MIN_DISTANCE_SIMILAR} from a similar-profile run`);
  return { ok: reasons.length === 0, overallMin, similarMin, reasons };
}
