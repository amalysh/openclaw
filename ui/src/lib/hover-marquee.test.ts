import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHoverMarqueeFromEvent, stopHoverMarqueeFromEvent } from "./hover-marquee.ts";

function enter(row: HTMLElement) {
  row.addEventListener("mouseenter", startHoverMarqueeFromEvent, { once: true });
  row.dispatchEvent(new MouseEvent("mouseenter"));
}

function leave(row: HTMLElement) {
  row.addEventListener("mouseleave", stopHoverMarqueeFromEvent, { once: true });
  row.dispatchEvent(new MouseEvent("mouseleave"));
}

function buildRow(params: { textWidth: number; labelWidth: number }) {
  const row = document.createElement("div");
  const label = document.createElement("span");
  label.className = "hover-marquee";
  label.textContent = "Fix stale iMessage group-allowlist warning copy";
  row.append(label);
  document.body.append(row);
  Object.defineProperty(label, "clientWidth", { value: params.labelWidth });
  Object.defineProperty(label, "scrollWidth", { value: params.textWidth });
  return { row, label };
}

describe("hover marquee", () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("waits before scrolling overflowing labels by the clipped distance", () => {
    const { row, label } = buildRow({ textWidth: 320, labelWidth: 180 });
    enter(row);
    expect(label.style.getPropertyValue("--hover-marquee-shift")).toBe("-140px");
    expect(label.style.getPropertyValue("--hover-marquee-duration")).toBe("1750ms");
    vi.advanceTimersByTime(499);
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(true);
    leave(row);
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(false);
  });

  it("cancels the delayed scroll when hover ends early", () => {
    const { row, label } = buildRow({ textWidth: 320, labelWidth: 180 });
    enter(row);
    vi.advanceTimersByTime(250);
    leave(row);
    vi.advanceTimersByTime(250);
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(false);
  });

  it("keeps short scroll distances readable with a minimum duration", () => {
    const { row, label } = buildRow({ textWidth: 190, labelWidth: 180 });
    enter(row);
    expect(label.style.getPropertyValue("--hover-marquee-shift")).toBe("-10px");
    expect(label.style.getPropertyValue("--hover-marquee-duration")).toBe("300ms");
  });

  it("leaves labels that fit untouched", () => {
    const { row, label } = buildRow({ textWidth: 120, labelWidth: 180 });
    enter(row);
    expect(label.classList.contains("hover-marquee--scrolling")).toBe(false);
    expect(label.style.getPropertyValue("--hover-marquee-shift")).toBe("");
  });

  it("ignores hosts without a marquee label", () => {
    const row = document.createElement("div");
    expect(() => {
      enter(row);
      leave(row);
    }).not.toThrow();
  });
});
