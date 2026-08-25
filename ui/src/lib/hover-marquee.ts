// Hover marquee for truncated single-line labels: on pointer enter, animate
// text-indent to slide the clipped tail into view; on leave, the base
// transition in styles/components.css (.hover-marquee) snaps it back quickly.
// text-indent (not an inner transform wrapper) because text-overflow renders
// no ellipsis for atomic inline children, which would lose the resting "…".
const MARQUEE_SPEED_PX_PER_SEC = 80;
const MARQUEE_MIN_DURATION_MS = 300;
const MARQUEE_HOVER_DELAY_MS = 500;
type MarqueeState = { frame?: number; timer?: number };

const marqueeStates = new WeakMap<HTMLElement, MarqueeState>();

function findMarqueeLabel(host: HTMLElement): HTMLElement | null {
  return host.classList.contains("hover-marquee")
    ? host
    : host.querySelector<HTMLElement>(".hover-marquee");
}

function getMarqueeViewportWidth(label: HTMLElement, host: HTMLElement): number {
  let width = label.clientWidth;
  for (
    let ancestor = label.parentElement;
    ancestor && ancestor !== host;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor);
    if (style.overflowX !== "hidden" && style.overflowX !== "clip") {
      continue;
    }
    const padding =
      (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
    width = Math.min(width, Math.max(0, ancestor.clientWidth - padding));
  }
  return width;
}

function getMarqueeContentWidth(label: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(label);
  // Range geometry includes a negative text-indent when the label has inline
  // glyphs. Disable its transition and measure at rest so repeated renders
  // cannot compound the shift.
  const inlineIndent = label.style.getPropertyValue("text-indent");
  const inlineIndentPriority = label.style.getPropertyPriority("text-indent");
  const inlineTransition = label.style.getPropertyValue("transition");
  const inlineTransitionPriority = label.style.getPropertyPriority("transition");
  label.style.setProperty("transition", "none", "important");
  label.style.setProperty("text-indent", "0px", "important");
  let rangeWidth = 0;
  try {
    const indent = Number.parseFloat(getComputedStyle(label).textIndent) || 0;
    if (Math.abs(indent) < 0.5) {
      rangeWidth = range.getBoundingClientRect?.().width ?? 0;
    }
  } finally {
    if (inlineIndent) {
      label.style.setProperty("text-indent", inlineIndent, inlineIndentPriority);
    } else {
      label.style.removeProperty("text-indent");
    }
    label.getBoundingClientRect();
    if (inlineTransition) {
      label.style.setProperty("transition", inlineTransition, inlineTransitionPriority);
    } else {
      label.style.removeProperty("transition");
    }
  }
  if (rangeWidth > 0) {
    return rangeWidth;
  }
  // DOM shims do not lay out ranges. Their mocked scrollWidth can still model
  // a mid-transition negative indent, which reduces the reported width.
  const indent = Number.parseFloat(getComputedStyle(label).textIndent) || 0;
  return label.scrollWidth - indent;
}

function clearMarquee(label: HTMLElement): void {
  const state = marqueeStates.get(label);
  if (state === undefined) {
    return;
  }
  if (state.frame !== undefined) {
    window.cancelAnimationFrame(state.frame);
  }
  if (state.timer !== undefined) {
    window.clearTimeout(state.timer);
  }
  marqueeStates.delete(label);
}

export function startHoverMarquee(host: HTMLElement): void {
  const label = findMarqueeLabel(host);
  if (!label) {
    return;
  }
  const state = marqueeStates.get(label) ?? {};
  if (state.frame !== undefined) {
    return;
  }
  marqueeStates.set(label, state);
  // Mouseenter fires before hover-only actions finish affecting layout. Measure
  // on the next frame so the marquee sees the width the user actually sees.
  state.frame = window.requestAnimationFrame(() => {
    if (marqueeStates.get(label) !== state) {
      return;
    }
    state.frame = undefined;
    const shift = getMarqueeContentWidth(label) - getMarqueeViewportWidth(label, host);
    if (shift <= 1) {
      if (state.timer !== undefined) {
        window.clearTimeout(state.timer);
      }
      marqueeStates.delete(label);
      label.classList.remove("hover-marquee--scrolling");
      label.style.removeProperty("--hover-marquee-shift");
      label.style.removeProperty("--hover-marquee-duration");
      return;
    }
    const durationMs = Math.max(
      MARQUEE_MIN_DURATION_MS,
      Math.round((shift / MARQUEE_SPEED_PX_PER_SEC) * 1000),
    );
    label.style.setProperty("--hover-marquee-shift", `${-shift}px`);
    label.style.setProperty("--hover-marquee-duration", `${durationMs}ms`);
    if (state.timer === undefined && !label.classList.contains("hover-marquee--scrolling")) {
      // Keep quick pointer passes quiet; leaving before the timer fires cancels it.
      state.timer = window.setTimeout(() => {
        if (marqueeStates.get(label) !== state) {
          return;
        }
        state.timer = undefined;
        label.classList.add("hover-marquee--scrolling");
      }, MARQUEE_HOVER_DELAY_MS);
    }
  });
}

export function stopHoverMarquee(host: HTMLElement): void {
  const label = findMarqueeLabel(host);
  if (!label) {
    return;
  }
  clearMarquee(label);
  label.classList.remove("hover-marquee--scrolling");
}

export function restartHoverMarqueeIfHovered(element: Element | undefined): void {
  if (!(element instanceof HTMLElement)) {
    return;
  }
  queueMicrotask(() => {
    const host = element.isConnected
      ? element.closest<HTMLElement>(".session-row-host")
      : undefined;
    if (host?.matches(":hover")) {
      startHoverMarquee(host);
    }
  });
}
