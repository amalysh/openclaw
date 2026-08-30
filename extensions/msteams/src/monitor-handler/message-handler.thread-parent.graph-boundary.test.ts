/**
 * Graph-boundary proof for the channel thread-context repair.
 *
 * The sibling `message-handler.thread-parent.test.ts` stubs `../graph-thread.js`, so it
 * pins the selection rule but never reaches the retrieval boundary. Here the seam is moved
 * out to the network edge: `thread-context.ts`, `graph-thread.ts` and `graph.ts` all run
 * unmocked, and the only stub is `globalThis.fetch`.
 *
 * It has to be a `vi.fn()`: `fetchWithSsrFGuard` treats a fetch carrying a `.mock` property
 * as a test-installed mock (`isMockedFetch`) and lets it win, otherwise it routes through
 * undici's dispatcher-aware fetch and a plain function stub is bypassed.
 *
 * The assertions are therefore about the HTTP requests this process actually issues for a
 * channel activity that carries no `replyToId`. Before the repair that set is empty.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../runtime-api.js";
// Preserve module setup before modules that consume it.
// oxfmt-ignore
import { getRuntimeApiMockState } from "./message-handler-mock-support.test-support.js";
import { createMSTeamsMessageHandler } from "./message-handler.js";
import {
  buildChannelActivity,
  channelConversationId,
  createMessageHandlerDeps,
} from "./message-handler.test-support.js";

const runtimeApiMockState = getRuntimeApiMockState();

const TEAM_AAD_GROUP_ID = "11111111-2222-3333-4444-555555555555";
const THREAD_ROOT_ID = "1700000000000";

// Team identity resolution sits upstream of the repair; stubbing it keeps the AAD group id
// deterministic without touching anything the repair reads.
vi.mock("../team-identity.js", () => ({
  resolveTeamGroupId: vi.fn(async () => TEAM_AAD_GROUP_ID),
}));

const graphJson = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

/** Records every outbound request and answers the two Graph reads the thread path performs. */
function installGraphFetchMock() {
  const impl = vi.fn(async (input: unknown) => {
    const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? "");
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

function graphUrls(impl: ReturnType<typeof installGraphFetchMock>): string[] {
  return impl.mock.calls
    .map(([input]) =>
      typeof input === "string" ? input : String((input as { url?: string })?.url ?? ""),
    )
    .filter((url) => url.includes("graph.microsoft.com"));
}

describe("msteams channel thread context at the Graph boundary", () => {
  const cfg: OpenClawConfig = {
    channels: { msteams: { groupPolicy: "open" } },
  } as OpenClawConfig;

  let fetchMock: ReturnType<typeof installGraphFetchMock>;

  beforeEach(() => {
    fetchMock = installGraphFetchMock();
    runtimeApiMockState.dispatchReplyWithBufferedBlockDispatcher.mockClear();
  });

  it("issues the parent and replies Graph reads when the activity omits replyToId", async () => {
    const { deps, enqueueSystemEvent } = createMessageHandlerDeps(cfg);
    const handler = createMSTeamsMessageHandler(deps);

    await handler({
      // The shape Teams delivers for a channel thread reply: no replyToId, thread root
      // recoverable only from the conversation id.
      activity: buildChannelActivity({
        id: "msg-reply-1",
        conversation: {
          id: `${channelConversationId};messageid=${THREAD_ROOT_ID}`,
          conversationType: "channel",
        },
      }),
      sendActivity: vi.fn(async () => undefined),
    } as unknown as Parameters<typeof handler>[0]);

    const urls = graphUrls(fetchMock);
    const encodedChannel = encodeURIComponent(channelConversationId);

    // Before the repair this array is empty: the fetch was gated on `activity.replyToId`.
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
    const parentCall = (enqueueSystemEvent.mock.calls as [string, unknown][]).find(([text]) =>
      text.startsWith("Replying to @"),
    );
    expect(parentCall?.[0]).toBe("Replying to @Alice: Can someone investigate the latency spike?");
  });

  it("issues no thread read when the activity is its own root", async () => {
    const { deps } = createMessageHandlerDeps(cfg);
    const handler = createMSTeamsMessageHandler(deps);

    await handler({
      activity: buildChannelActivity({
        id: THREAD_ROOT_ID,
        conversation: {
          id: `${channelConversationId};messageid=${THREAD_ROOT_ID}`,
          conversationType: "channel",
        },
      }),
      sendActivity: vi.fn(async () => undefined),
    } as unknown as Parameters<typeof handler>[0]);

    expect(
      graphUrls(fetchMock).filter((url) => url.includes(`/messages/${THREAD_ROOT_ID}`)),
    ).toEqual([]);
  });
});
