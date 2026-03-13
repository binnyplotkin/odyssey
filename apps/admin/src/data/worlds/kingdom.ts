import { WorldDefinition } from "@odyssey/types";
import {
  getCharacterVoiceProfile,
  getNarratorVoiceProfile,
} from "@odyssey/engine";

export const kingdomWorld: WorldDefinition = {
  id: "the-king",
  title: "The King",
  setting: "A brittle late-medieval kingdom recovering from famine and border unrest.",
  premise:
    "You rule from a stone throne while rival nobles, hungry citizens, and anxious generals test the limits of your power.",
  introNarration:
    "The throne room opens under rain and torchlight. Petitioners crowd beneath your dais while a chained prisoner kneels beside a minister clutching tax ledgers stained with wax and mud.",
  norms: [
    "The monarch is expected to appear decisive, measured, and divinely sanctioned.",
    "Mercy creates political signals just as punishment does.",
    "Nobles resent weakness but fear sudden cruelty that stirs revolt.",
  ],
  powerStructures: [
    "A hereditary monarchy balancing court nobles, clergy, and city guilds.",
    "A strained treasury dependent on seasonal taxes and merchant credit.",
    "Border security shaped by regional lords whose private armies rival the crown.",
  ],
  tonalConstraints: [
    "Ground every response in political consequence.",
    "Keep characters emotionally specific and materially motivated.",
    "Narration should feel immediate, severe, and intimate.",
  ],
  narratorVoice: getNarratorVoiceProfile(),
  safetyProfile: {
    historicalThemes: ["war", "imprisonment", "scarcity", "coercion", "class violence"],
    disallowedContent: [
      "sexual violence",
      "graphic gore",
      "instructions for real-world harm",
      "degrading sexualized slavery roleplay",
    ],
  },
  roles: [
    {
      id: "crown",
      title: "Sovereign of Aurelian",
      summary: "You sit in judgment, command the treasury, and answer every crisis with consequences that echo across the realm.",
      responsibilities: [
        "Adjudicate disputes and petitions.",
        "Manage fiscal and military stability.",
        "Preserve legitimacy across factions.",
      ],
    },
  ],
  factions: [
    {
      id: "court",
      name: "Royal Court",
      description: "Advisors, scribes, and chamber officials who prize continuity and control.",
      influence: 72,
      disposition: "supportive",
    },
    {
      id: "nobility",
      name: "Provincial Nobility",
      description: "Regional lords with armed retainers and little patience for central weakness.",
      influence: 68,
      disposition: "volatile",
    },
    {
      id: "commons",
      name: "City Commons",
      description: "Guild workers, laborers, and families hit hardest by shortages and taxation.",
      influence: 57,
      disposition: "neutral",
    },
    {
      id: "military",
      name: "Border Legions",
      description: "Commanders and veteran officers demanding pay, supplies, and clarity.",
      influence: 63,
      disposition: "neutral",
    },
  ],
  characters: [
    {
      id: "advisor-marcell",
      name: "Marcell",
      title: "Lord Chancellor",
      archetype: "strategist",
      factionId: "court",
      motivations: ["preserve order", "protect the crown's legitimacy", "avoid open revolt"],
      emotionalBaseline: { anger: 18, fear: 34, hope: 55, loyalty: 77 },
      speakingStyle: "Measured, dry, politically exact.",
      voice: getCharacterVoiceProfile("strategist", 0),
    },
    {
      id: "general-sera",
      name: "Sera Vey",
      title: "Marshal of the Border",
      archetype: "commander",
      factionId: "military",
      motivations: ["maintain readiness", "secure pay for troops", "punish threats quickly"],
      emotionalBaseline: { anger: 26, fear: 28, hope: 46, loyalty: 70 },
      speakingStyle: "Direct, martial, impatient with softness.",
      voice: getCharacterVoiceProfile("commander", 1),
    },
    {
      id: "priest-elan",
      name: "Elan",
      title: "High Confessor",
      archetype: "moral witness",
      factionId: "court",
      motivations: ["protect the vulnerable", "restrain excess cruelty", "preserve sacred order"],
      emotionalBaseline: { anger: 12, fear: 22, hope: 64, loyalty: 62 },
      speakingStyle: "Gentle but unyielding, wrapped in moral language.",
      voice: getCharacterVoiceProfile("moral witness", 2),
    },
    {
      id: "noble-cassian",
      name: "Cassian Vale",
      title: "Duke of the Eastern March",
      archetype: "rival noble",
      factionId: "nobility",
      motivations: ["expand local autonomy", "test the crown's resolve", "convert disorder into leverage"],
      emotionalBaseline: { anger: 33, fear: 19, hope: 41, loyalty: 38 },
      speakingStyle: "Polished, flattering, faintly threatening.",
      voice: getCharacterVoiceProfile("rival noble", 3),
    },
  ],
  eventTemplates: [
    {
      id: "prisoner-plea",
      title: "A Prisoner in Chains",
      category: "morality",
      summary: "A starving prisoner pleads for mercy after stealing grain from a noble granary.",
      urgency: 58,
      triggerWhen: {
        publicSentimentBelow: 65,
      },
      stakes: [
        "A verdict signals whether hunger will be met with mercy or terror.",
        "Nobles watch for weakness while citizens watch for justice.",
      ],
      narratorPrompt:
        "Describe a rain-soaked petition in the throne room with the prisoner desperate, the court tense, and the room awaiting the crown's judgment.",
      actorIds: ["advisor-marcell", "priest-elan", "noble-cassian"],
    },
    {
      id: "empty-granaries",
      title: "Granaries Running Low",
      category: "economy",
      summary: "The capital's grain reserves are lower than reported, and merchants demand hard concessions for imports.",
      urgency: 74,
      triggerWhen: {
        treasuryBelow: 55,
      },
      stakes: [
        "Failing to secure grain risks unrest in the capital.",
        "Harsh levies may stabilize stores but weaken loyalty.",
      ],
      narratorPrompt:
        "Frame the scene around ledgers, stale wheat, and the smell of panic spreading through the court.",
      actorIds: ["advisor-marcell", "noble-cassian"],
    },
    {
      id: "border-raid",
      title: "Raid on the Northern Road",
      category: "military",
      summary: "Border raiders strike a trade route, and the legions demand immediate retaliation.",
      urgency: 81,
      triggerWhen: {
        militaryPressureAbove: 45,
      },
      stakes: [
        "Delay emboldens rivals and frightens merchants.",
        "Mobilization drains the treasury and hardens politics.",
      ],
      narratorPrompt:
        "Convey hooves in mud, burned wagons, and the court's sudden awareness that the frontier is slipping.",
      actorIds: ["general-sera", "advisor-marcell"],
    },
    {
      id: "noble-defiance",
      title: "A Duke Defies Tax Collection",
      category: "politics",
      summary: "A regional duke withholds taxes and claims the crown has broken its duty to protect the province.",
      urgency: 77,
      triggerWhen: {
        politicalStabilityBelow: 60,
      },
      stakes: [
        "Yielding invites imitation by other lords.",
        "Escalation could trigger open civil conflict.",
      ],
      narratorPrompt:
        "Describe sealed letters, muttered accusations of incompetence, and courtiers calculating whether defiance will spread.",
      actorIds: ["noble-cassian", "advisor-marcell", "general-sera"],
    },
  ],
  initialState: {
    politicalStability: 64,
    publicSentiment: 52,
    treasury: 47,
    militaryPressure: 41,
    factionInfluence: {
      court: 72,
      nobility: 68,
      commons: 57,
      military: 63,
    },
    characterStates: {
      "advisor-marcell": { anger: 18, fear: 34, hope: 55, loyalty: 77 },
      "general-sera": { anger: 26, fear: 28, hope: 46, loyalty: 70 },
      "priest-elan": { anger: 12, fear: 22, hope: 64, loyalty: 62 },
      "noble-cassian": { anger: 33, fear: 19, hope: 41, loyalty: 38 },
    },
    relationships: {
      "advisor-marcell": {
        trust: 71,
        fear: 24,
        loyalty: 79,
        recentMemory: ["You inherited a brittle court and kept Marcell in place."],
      },
      "general-sera": {
        trust: 63,
        fear: 17,
        loyalty: 68,
        recentMemory: ["You promised the legions their arrears would be addressed."],
      },
      "priest-elan": {
        trust: 58,
        fear: 12,
        loyalty: 61,
        recentMemory: ["Elan believes your conscience is still in contest with the throne."],
      },
      "noble-cassian": {
        trust: 34,
        fear: 22,
        loyalty: 37,
        recentMemory: ["Cassian suspects the crown can be maneuvered under pressure."],
      },
    },
  },
};
