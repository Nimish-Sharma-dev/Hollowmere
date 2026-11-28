/**
 * Content + vocabulary contracts used by the engine.
 * NOTE: the build plan calls for Zod schemas here (T003). These are plain
 * TypeScript types so the engine has zero runtime dependencies; swap in Zod
 * schemas with z.infer<> later without changing the engine.
 */
export type Id = string;

export const PHASES = ['morning', 'day', 'evening', 'night'] as const;
export type Phase = (typeof PHASES)[number];

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

export const WEATHERS = ['clear', 'cloudy', 'rain', 'fog', 'snow', 'blizzard'] as const;
export type Weather = (typeof WEATHERS)[number];

export const NEEDS = ['health', 'hunger', 'warmth', 'energy'] as const;
export type Need = (typeof NEEDS)[number];

export const VILLAGE_STATS = ['hope', 'fear', 'hunger', 'trust', 'unity'] as const;
export type VillageStat = (typeof VILLAGE_STATS)[number];

export type ItemKind = 'resource' | 'tool' | 'weapon' | 'food' | 'clothing' | 'remedy';

export interface ItemDef {
  id: Id;
  name: string;
  kind: ItemKind;
  /** max quantity per inventory slot */
  stack: number;
  food?: { hunger: number; health?: number };
  remedy?: { heal: number };
  /** clothing insulation, added to effective temperature */
  warmth?: number;
  tool?: { type: string; power: number };
  weapon?: {
    damage: number;
    /** tiles */
    range: number;
    /** combat steps between attacks */
    cooldown: number;
    /** tiles */
    knockback: number;
    ranged?: { ammo: Id };
  };
}

export interface Ingredient {
  item: Id;
  qty: number;
}

export interface RecipeDef {
  id: Id;
  output: Ingredient;
  inputs: Ingredient[];
  /** station tag that must be in player.nearby, e.g. "fire" or "workshop". Omit for none. */
  station?: string;
  /** world ticks the craft takes */
  ticks: number;
}

export interface NodeYield {
  item: Id;
  min: number;
  max: number;
  /** probability 0..1, default 1 */
  chance?: number;
}

export interface ResourceNodeDef {
  id: Id;
  name: string;
  yields: NodeYield[];
  /** tool type required (see ItemDef.tool.type) */
  tool?: string;
  /** gathers before depletion */
  uses: number;
  /** days until a depleted node refills */
  respawnDays: number;
  energyCost?: number;
  ticks?: number;
}

export interface DropDef {
  item: Id;
  chance: number;
  min: number;
  max: number;
}

export interface EnemyDef {
  id: Id;
  name: string;
  hp: number;
  damage: number;
  /** tiles per combat step */
  speed: number;
  sight: number;
  attackRange: number;
  /** combat steps spent recovering after an attack */
  attackCooldown: number;
  /** flee when hp fraction <= this */
  fleeBelow?: number;
  drops: DropDef[];
}

export interface StructureDef {
  id: Id;
  name: string;
  cost: Ingredient[];
  /** station tag this structure provides: "fire", "shelter", "workshop", ... */
  provides: string;
}

export type ScheduleSlot = 'home' | 'work' | 'gather';

export interface NpcCard {
  id: Id;
  name: string;
  /** short role in the village, e.g. "The blacksmith" */
  title?: string;
  personality?: string;
  /** how they talk; used by the dialogue prompt and by fallback lines */
  speechStyle?: string;
  /** small repeated behaviours that make a character recognisable (3 or more) */
  tics?: string[];
  /** one sentence shown when this NPC is the first person the player meets (a real sentence, not a tic) */
  arrival?: string;
  allowedRoles: string[];
  home: Id;
  work: Id;
  gather: Id;
  /** where the NPC is each phase; defaults in engine config */
  schedule?: Partial<Record<Phase, ScheduleSlot>>;
}

export interface SlotDef {
  /** run roles (see GameState.npcs[id].role) that may fill this slot */
  roles: string[];
}

export interface EventRequirements {
  phase?: Phase[];
  season?: Season[];
  minDay?: number;
  maxDay?: number;
  flagsAll?: string[];
  flagsNone?: string[];
  village?: { stat: VillageStat; min?: number; max?: number }[];
}

export interface EventDef {
  id: Id;
  tags: string[];
  requirements?: EventRequirements;
  /** role slots; keys are snake_case slot names */
  slots: Record<string, SlotDef>;
  /** text beats; `{slot_name}` is replaced by the assigned NPC's name */
  beats: string[];
  /** effect strings from the fixed vocabulary (see engine/effects) */
  effects: string[];
  cooldownDays?: number;
  maxRuns?: number;
  weight?: number;
}

export interface ThresholdCondition {
  stat: VillageStat;
  op: '>=' | '<=';
  value: number;
}

export interface ThresholdDef {
  id: Id;
  /** all conditions must hold; the event is scheduled when they become true */
  conditions: ThresholdCondition[];
  event: Id;
  cooldownDays: number;
  once?: boolean;
}

export interface ContentBundle {
  items: Record<Id, ItemDef>;
  recipes: Record<Id, RecipeDef>;
  nodes: Record<Id, ResourceNodeDef>;
  enemies: Record<Id, EnemyDef>;
  structures: Record<Id, StructureDef>;
  npcs: Record<Id, NpcCard>;
  events: Record<Id, EventDef>;
  thresholds: ThresholdDef[];
  locations: Id[];
}
