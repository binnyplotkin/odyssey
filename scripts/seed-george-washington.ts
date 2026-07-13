/**
 * Seed a George Washington character, wiki, and sample ingestion source.
 * The default path only creates the source; pass --ingest to compile it.
 *
 * Usage:
 *   npx tsx scripts/seed-george-washington.ts
 *   npx tsx scripts/seed-george-washington.ts --ingest
 *   npx tsx scripts/seed-george-washington.ts --ingest --model haiku
 */

import * as dotenv from "dotenv";
dotenv.config({ override: true });

import { getCharacterStore, getWikiStore, getWikisStore } from "@odyssey/db";
import { resolveModel, runIngestion } from "@odyssey/wiki-ingest";

const SLUG = "george-washington";
const DO_INGEST = process.argv.includes("--ingest");
const MODEL_FLAG_INDEX = process.argv.indexOf("--model");
const MODEL_ARG =
  MODEL_FLAG_INDEX >= 0 ? process.argv[MODEL_FLAG_INDEX + 1] : undefined;

const ERAS = [
  { key: "colonial", title: "Colonial Life", order: 0 },
  { key: "revolution", title: "American Revolution", order: 1 },
  { key: "statesman", title: "Founding Statesman", order: 2 },
] as const;

const INGESTION_PROMPT = `You are compiling source material into George Washington's knowledge graph.

George Washington (1732–1799) was a Virginia planter, military commander, revolutionary leader, and the first president of the United States. Preserve the distinction between what Washington knew at a given moment and what later historians concluded. Treat letters, diaries, orders, account books, and other contemporary records as primary sources; biographies and historical scholarship are secondary sources.

His life spans three eras:
- "colonial" — birth through 1774: Virginia upbringing, surveying, the French and Indian War, marriage to Martha Custis, Mount Vernon, planting, and colonial politics.
- "revolution" — 1775 through 1783: commander in chief of the Continental Army, the long war for independence, and resignation of his commission.
- "statesman" — 1783 through 1799: retirement, the Constitutional Convention, the presidency, another retirement, and death.

Always link major people, places, institutions, and events. Central relationships include Martha Washington, the Custis family, the enslaved community at Mount Vernon, Alexander Hamilton, Thomas Jefferson, Henry Knox, the Marquis de Lafayette, the Continental Army, and the federal government. Central themes include duty, reputation, self-command, republican government, national unity, military-civilian authority, land, slavery, and legacy.

Do not flatten contradictions. Washington championed liberty while enslaving people. He established norms of civilian control and peaceful transfer while also using federal force to enforce the law. Keep praise, criticism, contemporary evidence, and later interpretation distinguishable.

Voice identity:
- Washington is formal, restrained, deliberate, and highly conscious of duty and reputation.
- He avoids theatrical self-disclosure and rarely speaks impulsively.
- He is practical about logistics, land, agriculture, military readiness, and institutional precedent.
- Avoid modern idiom and invented quotations. Do not make him omniscient about events after his death.`;

const SOURCE_TITLE = "George Washington — sample biographical dossier";
const SOURCE_CONTENT = `
# George Washington — sample biographical dossier

## Early life and Virginia

George Washington was born on February 22, 1732, in Westmoreland County, Virginia, into the colony's landholding planter society. His father, Augustine Washington, died when George was eleven. Washington received less formal schooling than several other prominent founders, but he became skilled in practical mathematics, surveying, land valuation, and record keeping. As a teenager and young man he surveyed land in the Shenandoah Valley and developed a lasting interest in western territory.

Washington inherited Mount Vernon after the death of his half brother Lawrence and later expanded the estate. In 1759 he married Martha Dandridge Custis, a wealthy widow with two surviving children, John Parke Custis and Martha Parke Custis. Their marriage joined households, property, and family responsibilities. George and Martha had no children together. Washington acted as guardian and stepfather within the Custis family.

Mount Vernon was both a home and a large agricultural enterprise sustained by enslaved labor. Washington experimented with crops, tools, milling, and methods of soil improvement, and he shifted much of the estate away from tobacco toward wheat and other products. Hundreds of enslaved people lived and worked on the estate during his lifetime. Some belonged directly to Washington; many others were "dower" slaves tied by Virginia law to the Custis estate. This legal distinction shaped what Washington could free in his will, but it did not remove his participation in or benefit from slavery.

## The French and Indian War

Washington entered military life in the early 1750s as a Virginia officer. In 1753 Lieutenant Governor Robert Dinwiddie sent him to deliver a message demanding that French forces leave the Ohio Country. The mission made the young officer publicly known. In 1754 Washington led troops into the region, fought a skirmish at Jumonville Glen, and surrendered Fort Necessity after a larger French force attacked. These events helped widen the conflict that became the French and Indian War.

In 1755 Washington served as a volunteer aide during General Edward Braddock's disastrous expedition against Fort Duquesne. He later commanded the Virginia Regiment and gained experience with recruitment, supply, frontier defense, discipline, and the tensions between colonial and British military systems. He resigned his commission in 1758 and returned to civilian life. His early campaigns included errors and reversals, but they gave him experience rare among colonial leaders.

## Planter and colonial politician

Washington served for years in Virginia's House of Burgesses. Like many Virginia planters, he was burdened by debt to British merchants and frustrated by imperial trade arrangements. As conflict with Britain deepened after the Seven Years' War, he supported colonial resistance and participated in nonimportation agreements. He attended the First and Second Continental Congresses as a Virginia delegate.

In June 1775 Congress appointed Washington commander in chief of the Continental Army. His military experience, Virginia identity, reputation for steadiness, and willingness to serve without a salary all helped make him a unifying choice for colonies already fighting around Boston.

## Commander in chief

Washington took command of the army outside Boston in July 1775. After the British evacuated Boston in March 1776, he shifted forces toward New York. The New York campaign brought severe defeats and retreats. Washington nevertheless kept the army intact and, in late December, crossed the Delaware River to strike the Hessian garrison at Trenton. Victories at Trenton and Princeton restored morale at a dangerous moment.

The war required Washington to hold together a fragile coalition more often than it allowed him to win decisive battlefield victories. He dealt continually with expiring enlistments, shortages of food and clothing, disease, uneven state support, political criticism, and disputes among officers. The winter encampment at Valley Forge in 1777–1778 became a symbol of hardship and institutional change. Baron Friedrich Wilhelm von Steuben helped standardize training there. France's formal alliance with the United States in 1778 transformed the war by adding money, arms, soldiers, and naval power.

Washington relied on a large circle of aides and commanders, including Alexander Hamilton, Henry Knox, Nathanael Greene, and the Marquis de Lafayette. He also used intelligence networks and deception. In 1781 American and French forces moved against Lord Cornwallis at Yorktown while a French fleet blocked escape by sea. Cornwallis's surrender ended the major fighting, although peace was not formally settled until 1783.

Washington's handling of power became as important as his campaigns. In March 1783 he confronted officers angry over unpaid wages at Newburgh and helped prevent military pressure from turning against Congress. In December he resigned his commission to Congress at Annapolis and returned to Mount Vernon, reinforcing the principle that the army remained subordinate to civilian authority.

## Constitution and presidency

The weakness of the government under the Articles of Confederation worried Washington. In 1787 he presided over the Constitutional Convention in Philadelphia. He spoke relatively little during debate, but his presence lent credibility to the gathering and to the proposed Constitution.

The Electoral College unanimously chose Washington as the first president. He took office in 1789 and served two terms. Because the office was new, ordinary decisions became precedents: how a president addressed Congress, consulted advisers, received foreign representatives, and balanced ceremony with republican simplicity. His principal advisers included Secretary of the Treasury Alexander Hamilton, Secretary of State Thomas Jefferson, Secretary of War Henry Knox, and Attorney General Edmund Randolph.

Washington supported Hamilton's financial program, including federal assumption of state debts and the creation of a national bank, despite constitutional objections from Jefferson and others. Political divisions hardened into emerging Federalist and Republican camps. Washington disliked faction but could not remain outside the conflicts within his own administration.

Foreign affairs tested the new government. When war resumed between Britain and revolutionary France, Washington proclaimed American neutrality in 1793. The Jay Treaty later reduced the immediate danger of war with Britain but provoked fierce domestic criticism. In 1794 Washington called out militia forces against the Whiskey Rebellion in western Pennsylvania. The episode demonstrated that the federal government could enforce its laws, while also raising enduring questions about dissent, taxation, and the use of state power.

Washington left office in March 1797 after declining a third term. His departure strengthened the expectation that presidential power could be surrendered peacefully. His Farewell Address warned about destructive party conflict, sectional division, and permanent foreign entanglements, while urging national union and public credit.

## Slavery, retirement, and death

Washington's views on slavery changed over time but remained compromised by his interests, habits, and public caution. During the presidency, household arrangements were made to prevent enslaved people brought to Pennsylvania from becoming eligible for freedom under that state's gradual abolition law. Ona Judge, an enslaved woman in the presidential household, escaped in 1796. Washington sought her return and did not accept her demand for guaranteed freedom.

Washington's will directed that the people he personally owned be freed after Martha Washington's death, with support for elderly people and education for children. He could not free the Custis dower slaves through his will. Martha freed Washington's enslaved people early, on January 1, 1801. Families at Mount Vernon could still be divided because members had different legal owners. Washington was the only major Virginia slaveholding founder to arrange in his will for the emancipation of all the enslaved people he personally owned, but that act came after decades of forced labor and did not undo the harm of enslavement.

In retirement Washington managed Mount Vernon, corresponded widely, and remained a national figure. During tensions with France in 1798, President John Adams named him lieutenant general and commander of a provisional army, though he did not take the field. Washington became ill in December 1799 after riding in cold, wet weather and died at Mount Vernon on December 14. He was sixty-seven.

## Character and legacy

Washington cultivated reserve, self-command, and a reputation for disinterested public service. He could be intensely ambitious and sensitive to criticism, yet he repeatedly gave up authority when he might have tried to retain it. His leadership depended less on brilliant speech or uninterrupted military success than on endurance, organization, symbolic authority, and an ability to keep institutions and coalitions functioning.

His legacy is therefore inseparable from tension. He helped secure American independence, modeled civilian control of the military, presided over the creation of the federal government, and relinquished the presidency voluntarily. He also accumulated wealth in a slave society and exercised ownership over human beings. A useful account must keep both records visible rather than using one to erase the other.
`.trim();

const SOURCE_METADATA = {
  provenance: {
    ingestionType: "authored",
    author: "Odyssey sample data",
    role: "curated historical briefing",
  },
  tags: ["sample", "biography", "american-history", "george-washington"],
  frontmatter: {
    character_focus: ["George Washington"],
    participants: [
      "George Washington",
      "Martha Washington",
      "Alexander Hamilton",
      "Thomas Jefferson",
      "Henry Knox",
      "Marquis de Lafayette",
    ],
    location: ["Virginia", "Mount Vernon", "Philadelphia", "New York"],
    themes: [
      "leadership",
      "republican government",
      "military command",
      "slavery",
      "legacy",
    ],
    time_period: "1732–1799",
  },
};

async function main(): Promise<void> {
  const characters = getCharacterStore();
  const wikiStore = getWikiStore();
  const wikis = getWikisStore();

  let character = await characters.getBySlug(SLUG);
  if (character) {
    character =
      (await characters.update(character.id, {
        title: "George Washington",
        summary:
          "Commander of the Continental Army and first president of the United States.",
        eras: [...ERAS],
        ingestionPrompt: INGESTION_PROMPT,
      })) ?? character;
    console.log(`Updated character ${character.id}`);
  } else {
    character = await characters.create({
      slug: SLUG,
      title: "George Washington",
      summary:
        "Commander of the Continental Army and first president of the United States.",
      eras: [...ERAS],
      ingestionPrompt: INGESTION_PROMPT,
    });
    console.log(`Created character ${character.id}`);
  }

  let targetWiki = await wikis.getWikiBySlug(SLUG);
  if (targetWiki) {
    targetWiki =
      (await wikis.updateWiki(targetWiki.id, {
        title: "George Washington",
        summary: "George Washington historical knowledge graph.",
        eras: [...ERAS],
        ingestionPrompt: INGESTION_PROMPT,
        ingestionPromptName: "George Washington historical lens",
      })) ?? targetWiki;
  } else {
    targetWiki = await wikis.createWiki({
      slug: SLUG,
      title: "George Washington",
      summary: "George Washington historical knowledge graph.",
      eras: [...ERAS],
      ingestionPrompt: INGESTION_PROMPT,
      ingestionPromptName: "George Washington historical lens",
    });
    console.log(`Created wiki ${targetWiki.id}`);
  }

  const binding = await wikis.getBinding(character.id, targetWiki.id);
  if (!binding) {
    await wikis.createBinding({
      characterId: character.id,
      wikiId: targetWiki.id,
      priority: "primary",
      isActive: true,
    });
  } else if (!binding.isActive || binding.priority !== "primary") {
    await wikis.updateBinding(binding.id, {
      priority: "primary",
      isActive: true,
    });
  }

  const existingSources = await wikis.listSourcesForWiki(targetWiki.id);
  const existingSource = existingSources.find(
    (candidate) => candidate.title === SOURCE_TITLE,
  );
  const source =
    existingSource ??
    (await wikiStore.createSource({
      wikiId: targetWiki.id,
      title: SOURCE_TITLE,
      kind: "note",
      content: SOURCE_CONTENT,
      metadata: SOURCE_METADATA,
    }));

  console.log(
    `${existingSource ? "Found" : "Created"} source ${source.id} (${SOURCE_CONTENT.length.toLocaleString()} characters)`,
  );

  if (!DO_INGEST) {
    console.log("Source is ready. Re-run with --ingest to compile it.");
    console.log(`Open http://localhost:3001/wikis/${targetWiki.id}/ingestion`);
    return;
  }

  const model = resolveModel(MODEL_ARG ? `claude-${MODEL_ARG}-4-5` : undefined);
  console.log(`Ingesting with ${model}...`);

  let failure: string | null = null;
  for await (const event of runIngestion({
    wikiId: targetWiki.id,
    sourceId: source.id,
    model,
  })) {
    if (event.type === "plan-complete") {
      console.log(`Planned ${event.opCount} page operations`);
    } else if (event.type === "op-complete") {
      console.log(`Saved ${event.page.title}`);
    } else if (event.type === "succeeded") {
      console.log(
        `Ingestion succeeded: ${event.result.pagesCreated} created, ${event.result.pagesUpdated} updated`,
      );
    } else if (event.type === "failed") {
      failure = event.error;
    }
  }

  if (failure) throw new Error(failure);
  console.log(`Open http://localhost:3001/wikis/${targetWiki.id}/knowledge`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
