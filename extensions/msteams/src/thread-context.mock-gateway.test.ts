/**
 * Mock-gateway proof for the channel thread-context repair.
 *
 * Shaped after `approval-control.mock-gateway.test.ts`: the activity enters through
 * `registerMSTeamsHandlers`, so the registered Bot Framework `onMessage` callback drives the
 * real inbound path rather than a handler factory being called directly. Everything the
 * repair touches — the message handler, `thread-context.ts`, `graph-thread.ts` and `graph.ts`
 * — runs unmocked, and the Microsoft Graph transport is observed at the fetch boundary.
 *
 * The fetch stub must be a `vi.fn()`. `fetchWithSsrFGuard` treats a fetch carrying a `.mock`
 * property as a test-installed mock (`isMockedFetch`) and lets it win; a plain function is
 * bypassed in favour of undici's dispatcher-aware fetch and observes nothing.
 *
 * Assertions are on the Graph requests this process issues for a channel activity delivered
 * without `replyToId`. Before the repair that set is empty.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../runtime-api.js";
import { type MSTeamsActivityHandler, registerMSTeamsHandlers } from "./monitor-handler.js";
import {
  createMSTeamsMessageHandlerDeps,
  installMSTeamsTestRuntime,
} from "./monitor-handler.test-helpers.js";
import type { MSTeamsTurnContext } from "./sdk-types.js";

const CHANNEL_CONVERSATION_ID = "19:general@thread.tacv2";
const TEAM_AAD_GROUP_ID = "00000000-0000-4000-8000-000000000001";
const THREAD_ROOT_ID = "1700000000000";

const graphJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const realFetch = globalThis.fetch;

// Restore the ambient fetch after every case. Without this the stub leaks into sibling
// suites in the same worker — the QA Bot Framework server tests start seeing 200 for
// requests they expect to fail.
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answers the two Graph thread reads and records every request the process issues. */
function installGraphFetchMock() {
  const impl = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : ((input as { url?: string })?.url ?? "");
    if (url.includes(`/messages/${THREAD_ROOT_ID}/replies`)) {
      return graphJson({
        value: [
          {
            id: "sibling-1",
            from: { user: { displayName: "Bob", id: "bob-id" } },
            body: { content: "I saw it too, right after the deploy.", contentType: "text" },
          },
        ],
      });
    }
    if (url.includes(`/messages/${THREAD_ROOT_ID}`)) {
      return graphJson({
        id: THREAD_ROOT_ID,
        from: { user: { displayName: "Alice", id: "alice-id" } },
        body: { content: "Can someone investigate the latency spike?", contentType: "text" },
      });
    }
    return graphJson({});
  });
  globalThis.fetch = impl as unknown as typeof globalThis.fetch;
  return impl;
}

function graphUrls(impl: ReturnType<typeof installGraphFetchMock>) {
  return impl.mock.calls
    .map(([input]) =>
      typeof input === "string" ? input : ((input as { url?: string })?.url ?? ""),
    )
    .filter((url) => url.includes("graph.microsoft.com"));
}

/** Registers the real handlers and returns the Bot Framework message callback. */
function registerAndCaptureMessageHandler(
  deps: ReturnType<typeof createMSTeamsMessageHandlerDeps>,
) {
  let messageHandler: Parameters<MSTeamsActivityHandler["onMessage"]>[0] | undefined;
  const handler: MSTeamsActivityHandler = {
    onMessage: (callback) => {
      messageHandler = callback;
      return handler;
    },
    onMembersAdded: () => handler,
    onReactionsAdded: () => handler,
    onReactionsRemoved: () => handler,
  };
  registerMSTeamsHandlers(handler, deps);
  if (!messageHandler) {
    throw new Error("registerMSTeamsHandlers did not register a message handler");
  }
  return messageHandler;
}

function channelTurnContext(overrides: Record<string, unknown>): MSTeamsTurnContext {
  return {
    activity: {
      type: "message",
      text: "hello",
      from: { id: "user-id", aadObjectId: "user-aad", name: "Test User" },
      recipient: { id: "bot-id", name: "OpenClaw" },
      channelData: { team: { id: "qa-msteams-team", aadGroupId: TEAM_AAD_GROUP_ID } },
      attachments: [],
      entities: [{ type: "mention", mentioned: { id: "bot-id" } }],
      ...overrides,
    },
    sendActivity: vi.fn(async () => undefined),
  } as unknown as MSTeamsTurnContext;
}

describe("msteams channel thread context mock-gateway proof", () => {
  const cfg = {
    channels: { msteams: { groupPolicy: "open" } },
  } as OpenClawConfig;

  it("retrieves thread parent and sibling replies for a channel activity without replyToId", async () => {
    const enqueueSystemEvent = vi.fn();
    installMSTeamsTestRuntime({ enqueueSystemEvent });
    const fetchMock = installGraphFetchMock();
    const deps = createMSTeamsMessageHandlerDeps({ cfg });
    const onMessage = registerAndCaptureMessageHandler(deps);

    // The shape Teams delivers for a channel thread reply: no replyToId, the thread root
    // recoverable only from the conversation id.
    await onMessage(
      channelTurnContext({
        id: "msg-reply-1",
        conversation: {
          id: `${CHANNEL_CONVERSATION_ID};messageid=${THREAD_ROOT_ID}`,
          conversationType: "channel",
        },
      }),
      async () => undefined,
    );

    const urls = graphUrls(fetchMock);
    const encodedChannel = encodeURIComponent(CHANNEL_CONVERSATION_ID);

    // Before the repair this is empty: the retrieval was gated on `activity.replyToId`.
    expect(urls.length).toBeGreaterThan(0);
    expect(
      urls.some(
        (url) =>
          url.includes(`/teams/${TEAM_AAD_GROUP_ID}/channels/${encodedChannel}/messages/`) &&
          url.endsWith(`/messages/${THREAD_ROOT_ID}`),
      ),
    ).toBe(true);
    expect(urls.some((url) => url.includes(`/messages/${THREAD_ROOT_ID}/replies`))).toBe(true);

    // The retrieved parent reaches the agent, which is the user-visible point of the repair.
    const parentEvent = (enqueueSystemEvent.mock.calls as [string, unknown][]).find(([text]) =>
      text.startsWith("Replying to @"),
    );
    expect(parentEvent?.[0]).toBe("Replying to @Alice: Can someone investigate the latency spike?");
  });

  it("issues no thread retrieval when the channel activity is its own thread root", async () => {
    const enqueueSystemEvent = vi.fn();
    installMSTeamsTestRuntime({ enqueueSystemEvent });
    const fetchMock = installGraphFetchMock();
    const deps = createMSTeamsMessageHandlerDeps({ cfg });
    const onMessage = registerAndCaptureMessageHandler(deps);

    await onMessage(
      channelTurnContext({
        id: THREAD_ROOT_ID,
        conversation: {
          id: `${CHANNEL_CONVERSATION_ID};messageid=${THREAD_ROOT_ID}`,
          conversationType: "channel",
        },
      }),
      async () => undefined,
    );

    expect(
      graphUrls(fetchMock).filter((url) => url.includes(`/messages/${THREAD_ROOT_ID}`)),
    ).toEqual([]);
  });
});
