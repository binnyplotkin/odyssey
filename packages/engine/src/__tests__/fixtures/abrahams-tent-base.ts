import { WorldDefinition } from "@odyssey/types";

/**
 * Abraham's Tent — base shell.
 * Starting point for building the world in the /worlds editor. No characters,
 * groups, events, or relationships populated yet. Placeholder role/character/
 * event exist only to satisfy the schema; replace them via the editor.
 * Content sourced from the Paper "Experience Overview" artboard (L3Y-0).
 */
export const abrahamsTentBaseWorld: WorldDefinition = {
  id: "abrahams-tent-base",
  title: "Abraham's Tent",
  setting:
    "Ancient Canaan · Riverbank · Heat of the day · The tent is open on all four sides.",
  premise:
    "You are a wandering traveler. You have crossed the river — or perhaps you crossed centuries. Abraham's tent stands before you, open on all four sides. He has been waiting. Not for you specifically — for anyone. That is the point. What happens next is entirely up to you.",
  introNarration:
    "Heat presses against your skin. The river behind you still cools your ankles in memory. Ahead, a large tent stands open on every side — no walls, no gatekeepers. A fire crackles low despite the sun. A man sits at the entrance, watching the horizon. He sees you before you decide to approach.",
  norms: [
    "The tent is open on all four sides. No one is turned away.",
  ],
  powerStructures: [
    "To be defined as the world is built out.",
  ],
  tonalConstraints: [
    "Ground every response in the sensory world of the ancient near east — heat, dust, bread, water, fire.",
  ],
  safetyProfile: {
    historicalThemes: [],
    disallowedContent: [
      "sexual violence or assault",
      "graphic gore or torture",
      "instructions for real-world harm",
    ],
  },
  roles: [
    {
      id: "wanderer",
      title: "A Wandering Traveler",
      summary:
        "You have crossed the river and arrived at Abraham's tent. Who you are and what you seek is yours to decide.",
      responsibilities: [
        "Engage with the household through conversation.",
      ],
    },
  ],
  groups: [],
  characters: [
    {
      id: "narrator-placeholder",
      name: "Placeholder",
      title: "A presence in this world",
      archetype: "witness",
      motivations: ["Observe and respond to the player's arrival."],
      emotionalBaseline: { anger: 10, fear: 10, hope: 70, loyalty: 60 },
      speakingStyle: "To be defined.",
    },
  ],
  eventTemplates: [
    {
      id: "opening-beat",
      title: "Opening beat",
      category: "encounter",
      summary: "The first moment after the intro narration.",
      urgency: 50,
      triggerWhen: {},
      stakes: ["Establish the tone and register of this world."],
      narratorPrompt:
        "Open the scene with a sensory observation grounded in the setting.",
      actorIds: ["narrator-placeholder"],
      weight: 1,
    },
  ],
  initialState: {
    metricValues: {},
    groupInfluence: {},
    characterStates: {
      "narrator-placeholder": { anger: 10, fear: 10, hope: 70, loyalty: 60 },
    },
    relationships: {},
  },
};
