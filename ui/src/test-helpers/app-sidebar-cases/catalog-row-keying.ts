import { describe, expect, it } from "vitest";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { buildCatalogSessionKey } from "../../lib/sessions/catalog-key.ts";
import { catalogPage, createGateway, createSessions, mountSidebar } from "../app-sidebar.ts";
import "../../components/app-sidebar.ts";

describe("AppSidebar session catalog row identity", () => {
  it.each([
    {
      direction: "is adopted",
      initialSessionKey: undefined,
      nextSessionKey: "agent:main:released",
      initialMenuSelector: "[data-catalog-session-menu]",
      nextMenuSelector: "[data-session-menu]",
    },
    {
      direction: "is released",
      initialSessionKey: "agent:main:released",
      nextSessionKey: undefined,
      initialMenuSelector: "[data-session-menu]",
      nextMenuSelector: "[data-catalog-session-menu]",
    },
  ])("restores menu focus when a catalog thread $direction", async (testCase) => {
    const adoptedKey = "agent:main:released";
    const gateway = createGateway({} as GatewayBrowserClient);
    const { sidebar } = await mountSidebar(
      gateway,
      createSessions("main", ["agent:main:main", adoptedKey]),
    );
    sidebar.sessionData.sessionCatalogs = catalogPage([
      {
        threadId: "thread-released",
        name: "Catalog session",
        sessionKey: testCase.initialSessionKey,
      },
    ]).catalogs;
    sidebar.sessionData.requestSessionDataUpdate();
    await sidebar.updateComplete;

    const identityKey = buildCatalogSessionKey({
      catalogId: "codex",
      hostId: "gateway:local",
      threadId: "thread-released",
    });
    const rowSelector = `[data-catalog-session-key="${identityKey}"]`;
    const initialMenu = sidebar.querySelector<HTMLButtonElement>(
      `${rowSelector} ${testCase.initialMenuSelector}`,
    );
    initialMenu?.focus();
    expect(document.activeElement).toBe(initialMenu);

    sidebar.sessionData.sessionCatalogs = catalogPage([
      {
        threadId: "thread-released",
        name: "Catalog session",
        sessionKey: testCase.nextSessionKey,
      },
    ]).catalogs;
    sidebar.sessionData.requestSessionDataUpdate();
    await sidebar.updateComplete;

    const nextMenu = sidebar.querySelector<HTMLButtonElement>(
      `${rowSelector} ${testCase.nextMenuSelector}`,
    );
    expect(document.activeElement).toBe(nextMenu);
  });
});
