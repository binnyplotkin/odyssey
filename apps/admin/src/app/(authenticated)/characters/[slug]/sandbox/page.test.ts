import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SandboxPage, { type SandboxCharacter } from "./page";

const dbMocks = vi.hoisted(() => ({
  getById: vi.fn(),
  getBySlug: vi.fn(),
  getVoiceById: vi.fn(),
  listWikisForCharacter: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));

vi.mock("@/components/character-sandbox", () => ({
  CharacterSandbox: vi.fn(() => null),
}));

vi.mock("@/lib/model-registry", () => ({
  DEFAULT_CHAT_MODEL: "test-chat-model",
}));

vi.mock("@odyssey/db", () => ({
  getCharacterStore: () => ({
    getById: dbMocks.getById,
    getBySlug: dbMocks.getBySlug,
  }),
  getVoiceStore: () => ({
    getById: dbMocks.getVoiceById,
  }),
  getWikisStore: () => ({
    listWikisForCharacter: dbMocks.listWikisForCharacter,
  }),
}));

describe("SandboxPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getVoiceById.mockResolvedValue(null);
    dbMocks.listWikisForCharacter.mockResolvedValue([]);
  });

  it("resolves an id route param before trying slug lookup", async () => {
    dbMocks.getById.mockResolvedValue(character({ id: "char_1", slug: "ada" }));
    dbMocks.getBySlug.mockResolvedValue(null);

    const page = await SandboxPage({
      params: Promise.resolve({ slug: "char_1" }),
    });

    expect(dbMocks.getById).toHaveBeenCalledWith("char_1");
    expect(dbMocks.getBySlug).not.toHaveBeenCalled();
    expect(dbMocks.listWikisForCharacter).toHaveBeenCalledWith("char_1");
    expect(sandboxProps(page).character).toMatchObject({
      id: "char_1",
      slug: "ada",
    });
  });

  it("falls back to slug lookup when id lookup misses", async () => {
    dbMocks.getById.mockResolvedValue(null);
    dbMocks.getBySlug.mockResolvedValue(character({ id: "char_2", slug: "ada" }));

    const page = await SandboxPage({
      params: Promise.resolve({ slug: "ada" }),
    });

    expect(dbMocks.getById).toHaveBeenCalledWith("ada");
    expect(dbMocks.getBySlug).toHaveBeenCalledWith("ada");
    expect(dbMocks.listWikisForCharacter).toHaveBeenCalledWith("char_2");
    expect(sandboxProps(page).character).toMatchObject({
      id: "char_2",
      slug: "ada",
    });
  });
});

function sandboxProps(page: unknown) {
  return (page as ReactElement<{ character: SandboxCharacter }>).props;
}

function character(overrides: { id: string; slug: string }) {
  return {
    id: overrides.id,
    slug: overrides.slug,
    title: "Ada",
    summary: null,
    image: null,
    thumbnailColor: null,
    identity: null,
    voiceStyle: null,
    brainModel: null,
    directive: null,
    voiceId: null,
  };
}
