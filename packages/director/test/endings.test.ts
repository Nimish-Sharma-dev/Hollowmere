import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARCHETYPES } from '../src/schemas.ts';
import { ENDINGS } from '../src/lore.ts';
import {
  dominantArchetype,
  generateTitleReveal,
  evaluateEnding,
  BASE_TITLES,
  CONTEXTUAL_EPITHETS,
} from '../src/endings.ts';
import type { EndingFamily, EndingEvaluationInput } from '../src/endings.ts';
import type { Archetype } from '../src/bible.ts';

test('dominantArchetype identifies highest scoring archetype', () => {
  const scores: Record<Archetype, number> = {
    lone_wolf: 0.2,
    peacemaker: 0.4,
    scavenger: 0.1,
    tyrant: 0.9,
    shepherd: 0.5,
    trickster: 0.3,
  };
  assert.equal(dominantArchetype(scores), 'tyrant');
});

test('dominantArchetype breaks ties deterministically in ARCHETYPES order', () => {
  const scores: Record<Archetype, number> = {
    lone_wolf: 0.8,
    peacemaker: 0.8,
    scavenger: 0.2,
    tyrant: 0.1,
    shepherd: 0.2,
    trickster: 0.8,
  };
  // ARCHETYPES starts with 'lone_wolf'
  assert.equal(dominantArchetype(scores), 'lone_wolf');
});

test('generateTitleReveal covers all 36 archetype x ending combinations', () => {
  for (const a of ARCHETYPES) {
    for (const e of ENDINGS) {
      const reveal = generateTitleReveal(a, e);
      assert.equal(reveal.archetype, a);
      assert.ok(reveal.title && reveal.title.length > 0, `missing title for ${a}`);
      assert.ok(reveal.epithet && reveal.epithet.length > 0, `missing epithet for ${a} x ${e}`);
      assert.ok(reveal.reason && reveal.reason.length > 10, `missing reason for ${a} x ${e}`);
      assert.equal(reveal.title, BASE_TITLES[a]);
      assert.equal(reveal.epithet, CONTEXTUAL_EPITHETS[a][e]);
    }
  }
});

test('evaluateEnding evaluates shepherd_saved for thriving compassionate village', () => {
  const input: EndingEvaluationInput = {
    state: {
      village: { hope: 8.5, fear: 1.5, hunger: 2.0, trust: 8.0, unity: 7.5 },
      player: { alive: true },
      npcs: {
        aldous: { alive: true },
        edda: { alive: true },
        mira: { alive: true },
        osric: { alive: true },
      },
      crisisResolved: true,
    },
    archetypeScores: {
      lone_wolf: 0.1,
      peacemaker: 0.4,
      scavenger: 0.1,
      tyrant: 0.0,
      shepherd: 0.95,
      trickster: 0.2,
    },
  };

  const res = evaluateEnding(input);
  assert.equal(res.endingFamily, 'shepherd_saved');
  assert.equal(res.dominantArchetype, 'shepherd');
  assert.equal(res.villageCondition, 'thriving');
  assert.equal(res.titleReveal.title, 'The Shepherd');
  assert.equal(res.titleReveal.epithet, 'The Hearthkeeper');
});

test('evaluateEnding evaluates village_falls for catastrophic starvation and hopelessness', () => {
  const input: EndingEvaluationInput = {
    state: {
      village: { hope: 0.5, fear: 9.0, hunger: 9.5, trust: 1.0, unity: 1.0 },
      player: { alive: false },
      npcs: {
        aldous: { alive: false },
        edda: { alive: false },
        mira: { alive: false },
        osric: { alive: true },
      },
      crisisResolved: false,
    },
    archetypeScores: {
      lone_wolf: 0.2,
      peacemaker: 0.1,
      scavenger: 0.8,
      tyrant: 0.3,
      shepherd: 0.1,
      trickster: 0.4,
    },
  };

  const res = evaluateEnding(input);
  assert.equal(res.endingFamily, 'village_falls');
  assert.equal(res.dominantArchetype, 'scavenger');
  assert.equal(res.villageCondition, 'ruined');
  assert.equal(res.titleReveal.epithet, 'The Carrion Crow');
});

test('evaluateEnding evaluates tyrants_peace for fear-enforced order', () => {
  const input: EndingEvaluationInput = {
    state: {
      village: { hope: 3.5, fear: 8.5, hunger: 4.0, trust: 2.0, unity: 6.5 },
      player: { alive: true },
      npcs: {
        aldous: { alive: true },
        edda: { alive: true },
      },
      crisisResolved: true,
    },
    archetypeScores: {
      lone_wolf: 0.2,
      peacemaker: 0.0,
      scavenger: 0.3,
      tyrant: 0.9,
      shepherd: 0.1,
      trickster: 0.3,
    },
  };

  const res = evaluateEnding(input);
  assert.equal(res.endingFamily, 'tyrants_peace');
  assert.equal(res.dominantArchetype, 'tyrant');
  assert.equal(res.villageCondition, 'subjugated');
  assert.equal(res.titleReveal.epithet, 'The Iron Sovereign');
});

test('evaluateEnding evaluates exile for expelled / broken-trust player', () => {
  const input: EndingEvaluationInput = {
    state: {
      village: { hope: 4.0, fear: 5.0, hunger: 4.0, trust: 1.0, unity: 3.0 },
      player: { alive: true },
      villagersExpelled: true,
    },
    archetypeScores: {
      lone_wolf: 0.85,
      peacemaker: 0.1,
      scavenger: 0.3,
      tyrant: 0.2,
      shepherd: 0.1,
      trickster: 0.2,
    },
  };

  const res = evaluateEnding(input);
  assert.equal(res.endingFamily, 'exile');
  assert.equal(res.dominantArchetype, 'lone_wolf');
  assert.equal(res.villageCondition, 'abandoned');
  assert.equal(res.titleReveal.epithet, 'The Banished Hunter');
});

test('evaluateEnding evaluates quiet_redemption for peacemaker resolving crisis gently', () => {
  const input: EndingEvaluationInput = {
    state: {
      village: { hope: 6.5, fear: 2.0, hunger: 3.0, trust: 7.5, unity: 7.0 },
      player: { alive: true },
      crisisResolved: true,
    },
    archetypeScores: {
      lone_wolf: 0.1,
      peacemaker: 0.9,
      scavenger: 0.2,
      tyrant: 0.0,
      shepherd: 0.4,
      trickster: 0.3,
    },
  };

  const res = evaluateEnding(input);
  assert.equal(res.endingFamily, 'quiet_redemption');
  assert.equal(res.dominantArchetype, 'peacemaker');
  assert.equal(res.titleReveal.epithet, 'The Quiet Healer');
});

test('evaluateEnding evaluates scarred_survival for bittersweet endurance through losses', () => {
  const input: EndingEvaluationInput = {
    state: {
      village: { hope: 4.5, fear: 5.5, hunger: 5.0, trust: 4.5, unity: 4.0 },
      player: { alive: true },
      npcs: {
        aldous: { alive: true },
        edda: { alive: false },
        mira: { alive: true },
        osric: { alive: false },
      },
      crisisResolved: true,
    },
    archetypeScores: {
      lone_wolf: 0.3,
      peacemaker: 0.2,
      scavenger: 0.8,
      tyrant: 0.2,
      shepherd: 0.3,
      trickster: 0.4,
    },
  };

  const res = evaluateEnding(input);
  assert.equal(res.endingFamily, 'scarred_survival');
  assert.equal(res.dominantArchetype, 'scavenger');
  assert.equal(res.villageCondition, 'scarred');
  assert.equal(res.titleReveal.epithet, 'The Scrap Warden');
});
