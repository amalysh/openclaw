import { describe, expect, it } from "vitest";
import type { GatewayBrowserClient } from "../../api/gateway.ts";
import { buildCatalogSessionKey } from "../../lib/sessions/catalog-key.ts";
import { catalogPage, createGateway, createSessions, mountSidebar } from "../app-sidebar.ts";
import "../../components/app-sidebar.ts";

describe("AppSidebar project session activity", () => {
  it("collapses custom and project groups with colliding source text independently", async () => {
    const gateway = createGateway({} as GatewayBrowserClient);
    const { sidebar } = await mountSidebar(gateway, createSessions("main", ["agent:main:main"]));
    sidebar.sessionData.sessionCatalogs = catalogPage([
      {
        threadId: "custom-thread",
        name: "Custom session",
        customGroup: "repo",
      },
      {
        threadId: "project-thread",
        name: "Project session",
        cwd: "custom:repo",
      },
    ]).catalogs;
    sidebar.sessionData.requestSessionDataUpdate();
    await sidebar.updateComplete;

    const customToggle = sidebar.querySelector<HTMLButtonElement>(
      '[data-session-catalog-project="custom:repo"]',
    );
    const projectToggle = sidebar.querySelector<HTMLButtonElement>(
      '[data-session-catalog-project="project:custom:repo"]',
    );
    const catalogRow = (threadId: string) =>
      sidebar.querySelector(
        `[data-catalog-session-key="${buildCatalogSessionKey({
          catalogId: "codex",
          hostId: "gateway:local",
          threadId,
        })}"]`,
      );
    const customRow = () => catalogRow("custom-thread");
    const projectRow = () => catalogRow("project-thread");
    expect(customRow()).not.toBeNull();
    expect(projectRow()).not.toBeNull();

    customToggle?.click();
    await sidebar.updateComplete;
    expect(customRow()).toBeNull();
    expect(projectRow()).not.toBeNull();

    projectToggle?.click();
    await sidebar.updateComplete;
    expect(customRow()).toBeNull();
    expect(projectRow()).toBeNull();
  });

  it("shows thread-style activity indicators", async () => {
    const gateway = createGateway({} as GatewayBrowserClient);
    const { sidebar } = await mountSidebar(gateway, createSessions("main", ["agent:main:main"]));
    sidebar.sessionData.sessionCatalogs = [
      {
        id: "codex",
        label: "Codex",
        capabilities: { continueSession: true, archive: true },
        hosts: [
          {
            hostId: "gateway:local",
            label: "Local Codex",
            kind: "gateway",
            connected: true,
            sessions: [
              {
                threadId: "active-thread",
                name: "Active session",
                cwd: "/work/openclaw",
                status: "active",
                archived: false,
                canContinue: false,
                canArchive: false,
              },
              {
                threadId: "idle-thread",
                name: "Idle session",
                cwd: "/work/openclaw",
                status: "idle",
                archived: false,
                canContinue: true,
                canArchive: true,
              },
              {
                threadId: "loose-thread",
                name: "Loose session",
                status: "idle",
                archived: false,
                canContinue: true,
                canArchive: true,
              },
            ],
          },
        ],
      },
    ];
    sidebar.sessionData.requestSessionDataUpdate();
    await sidebar.updateComplete;

    const project = sidebar.querySelector(
      '[data-session-catalog-project="project:/work/openclaw"]',
    );
    const active = sidebar.querySelector('[data-session-key*="active-thread"]');
    const idle = sidebar.querySelector('[data-session-key*="idle-thread"]');
    const loose = sidebar.querySelector('[data-session-key*="loose-thread"]');
    const projectItem = project?.closest(".sidebar-session-catalog-project");
    const hostList = projectItem?.parentElement;
    const projectList = active?.closest('[role="list"]');
    expect(project).not.toBeNull();
    expect(hostList?.getAttribute("role")).toBe("list");
    expect(hostList?.getAttribute("aria-label")).toBe("Local Codex");
    expect(
      [...(hostList?.children ?? [])].every((item) => item.getAttribute("role") === "listitem"),
    ).toBe(true);
    expect(projectItem?.getAttribute("role")).toBe("listitem");
    expect(projectList?.getAttribute("aria-label")).toBe("Local Codex: openclaw");
    expect(
      [...(projectList?.children ?? [])].every((item) => item.getAttribute("role") === "listitem"),
    ).toBe(true);
    expect(idle?.closest('[role="list"]')).toBe(projectList);
    expect(loose?.parentElement).toBe(hostList);
    expect(loose?.getAttribute("role")).toBe("listitem");
    const activeState = active?.querySelector(".session-row-state");
    expect(activeState?.getAttribute("role")).toBe("img");
    expect(activeState?.getAttribute("aria-label")).toBe("Active run");
    expect(activeState?.querySelector(".session-run-spinner")).not.toBeNull();
    expect(active?.querySelector(".session-run-spinner")?.getAttribute("aria-label")).toBe(
      "Active run",
    );
    const activeLead = active?.querySelector(".sidebar-session-indicator");
    const idleLead = idle?.querySelector(".sidebar-session-indicator");
    expect(activeLead).not.toBeNull();
    expect(activeLead?.childElementCount).toBe(0);
    expect(idleLead).not.toBeNull();
    expect(idleLead?.childElementCount).toBe(0);
    expect(idle?.querySelector(".session-row-state")).toBeNull();
  });
});
