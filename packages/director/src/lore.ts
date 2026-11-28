import type { Id } from '../../shared/src/index.ts';

/**
 * Story library for the Director and the fallback Run Bible builder.
 * STARTER CONTENT (4 crises, 10 secrets, 20 clues, 4 twists, 6 endings, 4 spawns, 4 kits, 10 tones).
 * It is a real, working set, but small: the plan expects the library to grow (see library_gap).
 */
export interface Crisis {
  id: Id;
  name: string;
  /** one sentence used in opening narration */
  blurb: string;
  /** roles that can be the hidden antagonist of this crisis */
  antagonistRoles: string[];
  tones: string[];
  endings: string[];
  twists: string[];
  clockDays: [number, number];
  /** tag carried by events that suit this crisis (events list it in `tags`) */
  eventTag: string;
  startStats: Partial<Record<'hope' | 'fear' | 'hunger' | 'trust' | 'unity', number>>;
}
export interface Secret {
  id: Id;
  /** crises this secret fits as the villain's main secret; empty means a side secret that fits any crisis */
  crisisIds: Id[];
  /** roles whose holder can carry this secret */
  holderRoles: string[];
  truth: string;
  clueIds: Id[];
}
export interface Clue {
  id: Id;
  /** places this clue can be found (a run picks one per clue) */
  locationIds: Id[];
  text: string;
}
export interface TwistRequirement {
  /** at least one NPC must hold one of these roles in the run, or the twist has no one to land on */
  roles: string[];
  /** that NPC must start at least this friendly (initial_attitude >= n): a twist about a "friend" needs a friend */
  minAttitude?: number;
}
export interface Twist {
  id: Id;
  name: string;
  requires: TwistRequirement;
}
export interface Spawn {
  id: Id;
  name: string;
  locationId: Id;
  narration: string;
}
export interface Kit {
  id: Id;
  name: string;
  items: { item: Id; qty: number }[];
}
export interface Lore {
  crises: Record<Id, Crisis>;
  secrets: Record<Id, Secret>;
  clues: Record<Id, Clue>;
  twists: Record<Id, Twist>;
  endings: Id[];
  tones: Id[];
  spawns: Record<Id, Spawn>;
  kits: Record<Id, Kit>;
  seasons: Id[];
  /** role -> one sentence of hidden motive, used by the fallback builder */
  roleMotives: Record<string, string>;
  /**
   * roles whose name asserts a particular crisis ("cult leader" needs a cult). A bystander may only take such a role
   * in the listed crises; roles not listed here can appear in any run.
   */
  roleCrises: Record<string, Id[]>;
}

const byId = <T extends { id: Id }>(list: T[]): Record<Id, T> => Object.fromEntries(list.map((x) => [x.id, x]));

export const TONES = ['tragedy', 'mystery', 'dark_comedy', 'folk_horror', 'political_intrigue', 'redemption', 'found_family', 'heist', 'haunting', 'fable'];
export const ENDINGS = ['shepherd_saved', 'scarred_survival', 'exile', 'tyrants_peace', 'village_falls', 'quiet_redemption'];

export function makeLore(): Lore {
  const crises: Crisis[] = [
    {
      id: 'poisoned_well', name: 'The Poisoned Well', blurb: 'Someone is fouling the village water, and the sickness is spreading.',
      antagonistRoles: ['traitor', 'cult_leader', 'swindler', 'impostor', 'thief'], tones: ['mystery', 'folk_horror', 'political_intrigue', 'tragedy', 'dark_comedy'],
      endings: ['shepherd_saved', 'scarred_survival', 'exile', 'village_falls'], twists: ['victim_is_guilty', 'friend_is_informant'], clockDays: [8, 14],
      eventTag: 'crisis_poisoned_well', startStats: { fear: 5, trust: 3 },
    },
    {
      id: 'chapel_cult', name: 'The Chapel Vigil', blurb: 'Night prayers at the chapel are drawing more people each evening, and not everyone who goes in comes out the same.',
      antagonistRoles: ['cult_leader', 'impostor', 'tyrant', 'keeper'], tones: ['folk_horror', 'haunting', 'mystery', 'tragedy', 'redemption'],
      endings: ['scarred_survival', 'village_falls', 'quiet_redemption', 'exile'], twists: ['leader_was_right', 'outsider_is_kin', 'victim_is_guilty'], clockDays: [10, 16],
      eventTag: 'crisis_chapel_cult', startStats: { hope: 6, unity: 4 },
    },
    {
      id: 'hoarded_stores', name: 'The Hoarded Stores', blurb: 'The winter grain was counted twice and found short, and someone has been counting very quietly.',
      antagonistRoles: ['hoarder', 'swindler', 'traitor', 'smuggler', 'thief', 'liar'], tones: ['political_intrigue', 'dark_comedy', 'heist', 'fable', 'tragedy'],
      endings: ['tyrants_peace', 'shepherd_saved', 'exile', 'quiet_redemption'], twists: ['friend_is_informant', 'leader_was_right'], clockDays: [9, 15],
      eventTag: 'crisis_hoarded_stores', startStats: { hunger: 5, trust: 3 },
    },
    {
      id: 'winter_raiders', name: 'The Winter Raiders', blurb: 'Strangers have been seen at the forest edge, and the gate has been left open more often than it should.',
      antagonistRoles: ['traitor', 'smuggler', 'spy', 'tyrant', 'leaver'], tones: ['political_intrigue', 'found_family', 'heist', 'redemption', 'tragedy'],
      endings: ['shepherd_saved', 'village_falls', 'tyrants_peace', 'scarred_survival'], twists: ['outsider_is_kin', 'friend_is_informant'], clockDays: [8, 13],
      eventTag: 'crisis_winter_raiders', startStats: { fear: 6, unity: 4 },
    },
  ];
  const secrets: Secret[] = [
    { id: 'poisoned_cistern', crisisIds: ['poisoned_well'], holderRoles: ['traitor', 'swindler', 'impostor', 'cult_leader'], truth: 'They tainted the well, believing it would force the village to change.', clueIds: ['oily_flask', 'missing_herbs'] },
    { id: 'grain_cellar', crisisIds: ['hoarded_stores'], holderRoles: ['hoarder', 'swindler', 'smuggler'], truth: 'They have been moving grain into a hidden cellar for weeks.', clueIds: ['grain_sacks', 'ledger_gap'] },
    { id: 'night_rites', crisisIds: ['chapel_cult'], holderRoles: ['cult_leader', 'impostor', 'tyrant'], truth: 'The night vigils are a way to bind the village to one voice.', clueIds: ['candle_wax', 'chalk_marks'] },
    { id: 'gate_bribe', crisisIds: ['winter_raiders', 'hoarded_stores'], holderRoles: ['traitor', 'smuggler', 'spy'], truth: 'They were paid to leave the gate unwatched.', clueIds: ['coin_purse', 'open_latch'] },
    { id: 'false_name', crisisIds: ['chapel_cult', 'poisoned_well', 'hoarded_stores'], holderRoles: ['impostor', 'swindler', 'liar'], truth: 'They arrived under a name that is not theirs.', clueIds: ['wrong_letter', 'old_wanted_bill'] },
    { id: 'old_debt', crisisIds: ['hoarded_stores', 'winter_raiders'], holderRoles: ['tyrant', 'hoarder', 'liar'], truth: 'They are repaying a debt older than the village by any means.', clueIds: ['burned_note', 'widows_word'] },
    { id: 'stolen_cure', crisisIds: ['poisoned_well', 'chapel_cult'], holderRoles: ['thief', 'swindler', 'smuggler'], truth: 'They took the healer\'s last cure and sold it.', clueIds: ['empty_vial', 'small_footprints'] },
    { id: 'midnight_meetings', crisisIds: ['winter_raiders', 'poisoned_well'], holderRoles: ['spy', 'traitor', 'leaver'], truth: 'They meet someone outside the walls every few nights.', clueIds: ['boot_prints', 'signal_lantern'] },
    { id: 'skimmed_stores', crisisIds: ['hoarded_stores'], holderRoles: ['thief', 'hoarder', 'smuggler'], truth: 'They have been skimming a little grain from the common store every night.', clueIds: ['short_measures', 'crumb_trail'] },
    { id: 'guarded_vow', crisisIds: ['chapel_cult'], holderRoles: ['keeper', 'coward', 'leaver'], truth: 'They swore never to say what happened at the chapel years ago, and someone is now using that silence.', clueIds: ['old_vestments', 'scratched_register'] },
    { id: 'sworn_silence', crisisIds: [], holderRoles: ['liar', 'keeper', 'coward'], truth: 'They swore to keep a death quiet and have regretted it since.', clueIds: ['shared_oath', 'torn_page'] },
    { id: 'hidden_grief', crisisIds: [], holderRoles: ['griever', 'victim', 'hope'], truth: 'They are still writing to someone who is gone.', clueIds: ['unsent_letters', 'small_grave'] },
  ];
  const clue = (id: Id, locationIds: Id[], text: string): Clue => ({ id, locationIds, text });
  const clues: Clue[] = [
    clue('oily_flask', ['well', 'mill'], 'A flask with an oily film, left near the water.'),
    clue('missing_herbs', ['chapel', 'forest_edge'], 'Bitter herbs are missing from the healer\'s shelf.'),
    clue('grain_sacks', ['home_alder', 'mill', 'farm'], 'Sacks stamped with this year\'s mark, stacked where they should not be.'),
    clue('ledger_gap', ['meeting_hall', 'village_gate'], 'A ledger page torn out at the exact day the stores were counted.'),
    clue('candle_wax', ['chapel', 'forest_edge'], 'Fresh wax in a place no service is held.'),
    clue('chalk_marks', ['well', 'watchtower'], 'Chalk marks repeated on stones around the village.'),
    clue('coin_purse', ['village_gate', 'forge'], 'A purse of foreign coins, hastily hidden.'),
    clue('open_latch', ['watchtower', 'village_gate'], 'The gate latch has been oiled so it will not creak.'),
    clue('wrong_letter', ['meeting_hall', 'home_tobin'], 'A letter addressed to a name nobody here answers to.'),
    clue('old_wanted_bill', ['village_gate', 'forge'], 'A faded wanted bill with a familiar face half scraped away.'),
    clue('burned_note', ['forge', 'meeting_hall'], 'Ashes of a note that mentions a sum and a date.'),
    clue('widows_word', ['chapel', 'farm'], 'A widow remembers who came asking about an old promise.'),
    clue('empty_vial', ['chapel', 'home_edda'], 'An empty vial with a healer\'s seal, cleaned too well.'),
    clue('small_footprints', ['well', 'village_gate'], 'Small footprints that go in but do not come out the same way.'),
    clue('boot_prints', ['forest_edge', 'watchtower'], 'Boot prints heading out and back at the same hour.'),
    clue('signal_lantern', ['watchtower', 'forest_edge'], 'A lantern with a shutter, hung where only the woods can see it.'),
    clue('short_measures', ['mill', 'farm'], 'Sacks that weigh a little less every morning, though the seals are unbroken.'),
    clue('crumb_trail', ['home_pip', 'meeting_hall'], 'A thin trail of grain leading away from the store.'),
    clue('old_vestments', ['chapel', 'home_edda'], 'Folded vestments that no one admits belong to the old keeper.'),
    clue('scratched_register', ['chapel', 'meeting_hall'], 'A register with one year scratched out.'),
    clue('shared_oath', ['mill', 'chapel'], 'Two names scratched beneath a promise.'),
    clue('torn_page', ['home_tobin', 'mill'], 'A torn page that should have a second half.'),
    clue('unsent_letters', ['chapel', 'home_edda'], 'A bundle of letters never sent, tied with thread.'),
    clue('small_grave', ['forest_edge', 'chapel'], 'A small cairn kept clear of weeds.'),
  ];
  const twists: Twist[] = [
    { id: 'friend_is_informant', name: 'The friend was the informant', requires: { roles: ['spy', 'traitor'], minAttitude: 1 } },
    { id: 'victim_is_guilty', name: 'The victim was guilty', requires: { roles: ['victim'] } },
    { id: 'leader_was_right', name: 'The leader was right all along', requires: { roles: ['weary_leader'] } },
    { id: 'outsider_is_kin', name: 'The outsider is kin', requires: { roles: ['ally_trader', 'swindler', 'impostor'] } },
  ];
  const spawns: Spawn[] = [
    { id: 'forest_stranger', name: 'Arriving from the forest', locationId: 'forest_edge', narration: 'You come out of the trees at dusk, cold and a little lost, and the village lights are the first friendly thing you have seen in days.' },
    { id: 'gate_arrival', name: 'Arriving at the gate', locationId: 'village_gate', narration: 'The gate is half open when you reach it, and no one is watching it.' },
    { id: 'hurt_at_chapel', name: 'Waking at the chapel', locationId: 'chapel', narration: 'You wake on a cot in the chapel with a bandaged arm and no clear memory of the last road.' },
    { id: 'mill_lodger', name: 'Lodging at the mill', locationId: 'mill', narration: 'The miller has put you up in the loft, and the mill wheel turns all night like a slow heartbeat.' },
  ];
  const kits: Kit[] = [
    { id: 'forager', name: 'Forager', items: [{ item: 'berries', qty: 6 }, { item: 'bandage', qty: 1 }, { item: 'wool_coat', qty: 1 }] },
    { id: 'scrapper', name: 'Scrapper', items: [{ item: 'sword', qty: 1 }, { item: 'bread', qty: 3 }] },
    { id: 'trader', name: 'Trader', items: [{ item: 'bread', qty: 6 }, { item: 'axe', qty: 1 }] },
    { id: 'healer', name: 'Healer', items: [{ item: 'bandage', qty: 3 }, { item: 'bread', qty: 2 }, { item: 'wool_coat', qty: 1 }] },
  ];
  const roleMotives: Record<string, string> = {
    friend: 'wants someone in the village to trust them without having to prove it',
    rival: 'wants to be seen as the one who really saved the village',
    smuggler: 'moves goods in the dark because the village would not approve of the cargo',
    protector: 'will cross any line to keep one particular person safe',
    victim: 'was wronged and has decided not to say by whom',
    liar: 'tells small lies so a large one never has to be spoken',
    keeper: 'guards a promise made long ago and is afraid of what keeping it costs',
    saint: 'wants to be good so badly that they hide every doubt',
    cult_leader: 'believes the village must be made to listen, whatever it takes',
    griever: 'cannot let go of someone and bends the present around the loss',
    hero: 'needs to be needed and takes risks to prove it',
    coward: 'would rather the truth stay buried than face what it asks of them',
    tyrant: 'believes only firm hands keep winter at bay',
    truth_seer: 'notices what others miss and is tired of not being believed',
    thief: 'takes what they think the village owes them',
    hope: 'holds the village\'s mood together and will not admit the cost',
    guide: 'knows the safe paths and uses that knowledge as quiet leverage',
    spy: 'has grown fond of the people they were sent to watch and cannot say so',
    leaver: 'has already decided to go and is deciding who to take',
    weary_leader: 'wants to be relieved of a duty they are still doing well',
    hoarder: 'is certain scarcity is coming and trusts no one else to prepare',
    traitor: 'has convinced themselves that betraying the village is the only way to save it',
    ally_trader: 'trades fairly and wants the village to survive to keep buying',
    swindler: 'sells hope in small, expensive doses',
    impostor: 'is terrified of being recognised and will bend the village to keep this new life',
  };
  return {
    crises: byId(crises), secrets: byId(secrets), clues: byId(clues), twists: byId(twists), endings: ENDINGS, tones: TONES,
    spawns: byId(spawns), kits: byId(kits),
    roleCrises: { cult_leader: ['chapel_cult', 'poisoned_well'], hoarder: ['hoarded_stores'] },
    seasons: ['spring_mist', 'summer_haze', 'autumn_rain', 'first_snow', 'deep_winter', 'thaw'],
    roleMotives,
  };
}
