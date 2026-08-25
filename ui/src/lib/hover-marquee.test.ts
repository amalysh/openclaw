import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHoverMarquee, stopHoverMarquee } from "./hover-marquee.ts";

let pendingFrame: FrameRequestCallback | undefined;

function runPendingFrame(): void {
  const callback = pendingFrame;
  pendingFrame = undefined;
  callback?.(0);
}

function buildRow(params: { textWidth: number; labelWidth: number }) {
  const row = document.createElement("div");
  const viewport = document.createElement("span");
  const label = document.createElement("span");
  label.className = "hover-marquee";
  label.textContent = "Fix stale iMessage group-allowlist warning copy";
  viewport.append(label);
  row.append(viewport);
  document.body.append(row);
  Object.defineProperty(label, "clientWidth", { configurable: true, value: params.labelWidth });
  Object.defineProperty(label, "scrollWidth", { configurable: true, value: params.textWidth });
  return { row, viewport, label };
}

describe("hover marquee", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pendingFrame = undefined;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pendingFrame = callback;
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("waits before scrolling overflowing labels by the clipped distance", () => {
    const { row, label } = buildRow({ textWidth: 320, labelWidth: 180 });
    startHoverMarquee(row);
    expect(label.style.getPropertyValue("--hover-marquee-shift")).toBe("");
    runPendingFrame();
    expect(label.style.getPropertyValue("--hover-marquee-shift")).toBe("-140px");
    expect(label.style.getPropertyValue("--hover-marquee-duration")).toBe("1750ms");
    vi.advanceTimersByTime(499);
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(true);
    stopHoverMarquee(row);
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(false);
  });

  it("cancels the delayed scroll when hover ends early", () => {
    const { row, label } = buildRow({ textWidth: 320, labelWidth: 180 });
    startHoverMarquee(row);
    runPendingFrame();
    vi.advanceTimersByTime(250);
    stopHoverMarquee(row);
    vi.advanceTimersByTime(250);
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(false);
  });

  it("keeps the original delay when start repeats during hover", () => {
    const { row, label } = buildRow({ textWidth: 320, labelWidth: 180 });
    startHoverMarquee(row);
    runPendingFrame();
    vi.advanceTimersByTime(250);
    startHoverMarquee(row);
    runPendingFrame();
    vi.advanceTimersByTime(250);
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(true);
  });

  it("remeasures changed geometry while the same label stays hovered", () => {
    const { row, label } = buildRow({ textWidth: 320, labelWidth: 180 });
    startHoverMarquee(row);
    runPendingFrame();
    vi.advanceTimersByTime(250);

    Object.defineProperty(label, "scrollWidth", { configurable: true, value: 360 });
    startHoverMarquee(row);
    runPendingFrame();
    expect(label.style.getPropertyValue("--hover-marquee-shift")).toBe("-180px");
    vi.advanceTimersByTime(250);
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(true);

    Object.defineProperty(label, "scrollWidth", { configurable: true, value: 120 });
    startHoverMarquee(row);
    runPendingFrame();
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(false);
  });

  it("measures natural content width after an indented label starts scrolling", () => {
    const { row, label } = buildRow({ textWidth: 320, labelWidth: 180 });
    const range = document.createRange();
    let animatedIndent = 0;
    Object.defineProperty(range, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(
        () =>
          ({
            width:
              320 - (label.style.getPropertyValue("transition") === "none" ? 0 : animatedIndent),
          }) as DOMRect,
      ),
    });
    vi.spyOn(document, "createRange").mockReturnValue(range);
    startHoverMarquee(row);
    runPendingFrame();
    expect(label.style.getPropertyValue("--hover-marquee-shift")).toBe("-140px");

    label.style.textIndent = "-140px";
    animatedIndent = -140;
    startHoverMarquee(row);
    runPendingFrame();
    expect(label.style.getPropertyValue("--hover-marquee-shift")).toBe("-140px");
  });

  it("cancels measurement when hover ends before the next frame", () => {
    const { row, label } = buildRow({ textWidth: 320, labelWidth: 180 });
    startHoverMarquee(row);
    stopHoverMarquee(row);
    runPendingFrame();
    vi.advanceTimersByTime(500);
    expect(label.style.getPropertyValue("--hover-marquee-shift")).toBe("");
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(false);
  });

  it("keeps short scroll distances readable with a minimum duration", () => {
    const { row, label } = buildRow({ textWidth: 190, labelWidth: 180 });
    startHoverMarquee(row);
    runPendingFrame();
    expect(label.style.getPropertyValue("--hover-marquee-shift")).toBe("-10px");
    expect(label.style.getPropertyValue("--hover-marquee-duration")).toBe("300ms");
  });

  it("uses a clipping ancestor's content width", () => {
    const { row, viewport, label } = buildRow({ textWidth: 190, labelWidth: 220 });
    viewport.style.overflowX = "hidden";
    viewport.style.paddingRight = "44px";
    Object.defineProperty(viewport, "clientWidth", { value: 220 });
    startHoverMarquee(row);
    runPendingFrame();
    expect(label.style.getPropertyValue("--hover-marquee-shift")).toBe("-14px");
  });

  it("leaves labels that fit untouched", () => {
    const { row, label } = buildRow({ textWidth: 120, labelWidth: 180 });
    startHoverMarquee(row);
    runPendingFrame();
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(false);
    expect(label.style.getPropertyValue("--hover-marquee-shift")).toBe("");
  });

  it("ignores hosts without a marquee label", () => {
    const row = document.createElement("div");
    expect(() => {
      startHoverMarquee(row);
      stopHoverMarquee(row);
    }).not.toThrow();
  });
});
