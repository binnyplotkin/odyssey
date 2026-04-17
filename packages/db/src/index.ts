export { getDb } from "./client";
export {
  usersTable,
  accountsTable,
  authSessionsTable,
  verificationTokensTable,
  sessionsTable,
  turnsTable,
  versionsTable,
  featuresTable,
  worldsTable,
  ticketsTable,
  platformVersionsTable,
  changelogEntriesTable,
  charactersTable,
  worldCharactersTable,
  wikiPagesTable,
  wikiPageVersionsTable,
  wikiEdgesTable,
  wikiSourcesTable,
  wikiSourceRefsTable,
  wikiIngestionLogTable,
} from "./schema";
export { getPersistenceStore } from "./store";
export type { PersistenceStore } from "./store";
export { getWorldRepository } from "./repository";
export type { WorldRepository, WorldDetail, WorldSource } from "./repository";
export { getTicketStore } from "./ticket-store";
export type { TicketStore, TicketRecord, CreateTicketInput, UpdateTicketInput } from "./ticket-store";
export { getVersionStore } from "./version-store";
export type { VersionStore, VersionRecord, CreateVersionInput, UpdateVersionInput } from "./version-store";
export { getFeatureStore } from "./feature-store";
export type { FeatureStore, FeatureRecord, CreateFeatureInput, UpdateFeatureInput } from "./feature-store";
export { getPlatformVersionStore } from "./platform-version-store";
export type { PlatformVersionStore, PlatformVersionRecord, CreatePlatformVersionInput, UpdatePlatformVersionInput } from "./platform-version-store";
export { getChangelogStore } from "./changelog-store";
export type { ChangelogStore, ChangelogEntryRecord, CreateChangelogEntryInput, UpdateChangelogEntryInput } from "./changelog-store";

export { getCharacterStore } from "./character-store";
export type { CharacterStore } from "./character-store";

export { getWikiStore } from "./wiki-store";
export type { WikiStore } from "./wiki-store";

export {
  parseWikilinks,
  extractReferencedSlugs,
  formatWikilink,
  resolveWikilinks,
  isValidSlug,
  slugifyTitle,
} from "./wiki-links";

export type {
  CharacterRecord,
  CreateCharacterInput,
  UpdateCharacterInput,
  EraConfig,
  WikiPageType,
  TimeIndex,
  Perspective,
  PerspectiveKnowsHow,
  Frontmatter,
  EntityFrontmatter,
  EventFrontmatter,
  ConceptFrontmatter,
  RelationshipFrontmatter,
  TimelineFrontmatter,
  VoiceIdentityFrontmatter,
  Contradiction,
  WikiPageRecord,
  SavePageInput,
  SavePageResult,
  WikiPageVersionRecord,
  EdgeKind,
  WikiEdgeRecord,
  WikiSourceKind,
  WikiSourceRecord,
  CreateSourceInput,
  WikiSourceRefRecord,
  CreateSourceRefInput,
  IngestionStatus,
  WikiIngestionLogRecord,
  StartIngestionInput,
  FinishIngestionInput,
  ParsedWikilink,
} from "./wiki-types";
