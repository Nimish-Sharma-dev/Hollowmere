import type { Phase, Season, Weather, VillageStat, ScheduleSlot } from '../../shared/src/index.ts';

/** All tunable engine constants live here (build plan section 8). */
export const CONFIG = {
  /** world ticks per in-game day. 240 ticks * 2.5s = 10 real minutes */
  ticksPerDay: 240,
  tickSeconds: 2.5,
  /** first tick (of the day) of each phase */
  phaseStarts: { morning: 0, day: 60, evening: 144, night: 192 } as Record<Phase, number>,
  daysPerSeason: 8,
  inventorySlots: 20,

  baseTemp: { spring: 8, summer: 18, autumn: 5, winter: -8 } as Record<Season, number>,
  weatherTemp: { clear: 1, cloudy: 0, rain: -3, fog: -1, snow: -4, blizzard: -10 } as Record<Weather, number>,
  phaseTemp: { morning: -2, day: 2, evening: 0, night: -6 } as Record<Phase, number>,
  /** weights in WEATHERS order: clear, cloudy, rain, fog, snow, blizzard */
  weatherWeights: {
    spring: [30, 25, 25, 15, 5, 0],
    summer: [55, 20, 15, 10, 0, 0],
    autumn: [25, 30, 20, 20, 5, 0],
    winter: [10, 20, 0, 10, 45, 15],
  } as Record<Season, number[]>,

  survival: {
    max: 100,
    hungerDecay: 0.12,
    energyDecay: 0.08,
    restEnergy: 0.6,
    shelterRestBonus: 0.3,
    healthRegen: 0.15,
    starvationDamage: 0.3,
    exhaustionDamage: 0.1,
    coldDamageMild: 0.25,
    coldDamageSevere: 0.5,
    coldThreshold: 20,
    comfortTemp: 5,
    warmthGain: 0.05,
    warmthMaxGain: 0.8,
    warmthMaxLoss: 1.5,
    fireInsulation: 12,
    shelterInsulation: 6,
    startStats: { health: 100, hunger: 80, warmth: 80, energy: 90 },
    activityHungerMult: { rest: 0.6, idle: 0.8, normal: 1, work: 1.4 },
    activityEnergyMult: { idle: 0.7, normal: 1, work: 1.5 },
  },

  village: {
    min: 0,
    max: 10,
    start: { hope: 5, fear: 3, hunger: 3, trust: 4, unity: 5 } as Record<VillageStat, number>,
    /** per-day drift by season */
    seasonDrift: {
      spring: { hope: 0.05 },
      summer: { hope: 0.1, hunger: -0.1 },
      autumn: { hunger: 0.1 },
      winter: { hunger: 0.5, hope: -0.1, fear: 0.1 },
    } as Record<Season, Partial<Record<VillageStat, number>>>,
  },

  npc: {
    trustMin: -10,
    trustMax: 10,
    defaultSchedule: { morning: 'work', day: 'work', evening: 'gather', night: 'home' } as Record<Phase, ScheduleSlot>,
  },

  events: {
    /** days a due-but-blocked event is retried before being dropped */
    maxDeferDays: 3,
    maxChainPerTick: 20,
  },

  combat: {
    stepsPerSecond: 20,
    playerSpeed: 0.11,
    unarmed: { damage: 4, range: 1.2, cooldown: 8, knockback: 0.3 },
    windupSteps: 4,
    staggerSteps: 6,
    /** a hit must deal at least this fraction of the enemy's max hp to interrupt a wind-up */
    staggerMinHpFraction: 0.15,
    staggerImmunity: 24,
    dodgeDistance: 2.0,
    dodgeIframes: 6,
    dodgeCooldown: 30,
    enemyKnockback: 0.5,
    hitSlack: 0.3,
    playerMaxHp: 100,
    arena: { w: 30, h: 20 },
    maxSteps: 4000,
  },
} as const;
