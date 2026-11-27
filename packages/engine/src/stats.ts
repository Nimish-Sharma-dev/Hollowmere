import type { ContentBundle } from '../../shared/src/index.ts';
import { CONFIG } from './config.ts';
import { currentPhase, currentSeason } from './state.ts';
import type { GameState } from './state.ts';

export type Activity = 'rest' | 'idle' | 'normal' | 'work';

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** outdoor temperature in abstract degrees */
export function ambientTemp(state: GameState): number {
  return (
    CONFIG.baseTemp[currentSeason(state)] +
    CONFIG.weatherTemp[state.weather] +
    CONFIG.phaseTemp[currentPhase(state)] +
    state.modifiers.tempOffset
  );
}

export function insulation(state: GameState, content: ContentBundle): number {
  const S = CONFIG.survival;
  let v = 0;
  const cloth = state.player.equipped.clothing;
  if (cloth) v += content.items[cloth]?.warmth ?? 0;
  if (state.player.nearby.includes('fire')) v += S.fireInsulation;
  if (state.player.nearby.includes('shelter')) v += S.shelterInsulation;
  return v;
}

/** One world tick of survival rules. Fixed and fair: the Director never touches this. */
export function tickSurvival(state: GameState, content: ContentBundle, activity: Activity): void {
  const p = state.player;
  if (!p.alive) return;
  const S = CONFIG.survival;
  const st = p.stats;

  // hunger
  st.hunger = clamp(st.hunger - S.hungerDecay * S.activityHungerMult[activity] * state.modifiers.hungerMult, 0, S.max);

  // warmth
  const eff = ambientTemp(state) + insulation(state, content);
  const dW = clamp((eff - S.comfortTemp) * S.warmthGain, -S.warmthMaxLoss, S.warmthMaxGain);
  st.warmth = clamp(st.warmth + dW, 0, S.max);

  // energy
  if (activity === 'rest') {
    const bonus = p.nearby.includes('shelter') ? S.shelterRestBonus : 0;
    st.energy = clamp(st.energy + S.restEnergy + bonus, 0, S.max);
  } else {
    st.energy = clamp(st.energy - S.energyDecay * S.activityEnergyMult[activity], 0, S.max);
  }

  // health
  let starve = 0;
  let cold = 0;
  let tired = 0;
  if (st.hunger <= 0) starve = S.starvationDamage;
  if (st.warmth <= 0) cold = S.coldDamageSevere;
  else if (st.warmth < S.coldThreshold) cold = S.coldDamageMild;
  if (st.energy <= 0) tired = S.exhaustionDamage;
  const damage = starve + cold + tired;
  if (damage > 0) {
    st.health = clamp(st.health - damage, 0, S.max);
  } else if (st.hunger > 50 && st.warmth > 40 && st.energy > 20) {
    st.health = clamp(st.health + S.healthRegen, 0, S.max);
  }
  if (st.health <= 0) {
    p.alive = false;
    p.deathCause = starve >= cold && starve >= tired ? 'starvation' : cold >= tired ? 'exposure' : 'exhaustion';
  }
}
