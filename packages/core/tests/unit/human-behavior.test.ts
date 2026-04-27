import { describe, expect, it } from "vitest";
import {
  HumanPointerState,
  normalizeHumanBehavior,
  randomForBehavior,
  resolveDelay,
} from "../../lib/v3/understudy/humanBehavior.js";
import type { CDPSessionLike } from "../../lib/v3/understudy/cdp.js";

describe("human behavior normalization", () => {
  it("is disabled by default", () => {
    const behavior = normalizeHumanBehavior();

    expect(behavior.enabled).toBe(false);
    expect(behavior.mouse.enabled).toBe(false);
    expect(behavior.typing.enabled).toBe(false);
    expect(behavior.scroll.enabled).toBe(false);
  });

  it("enables the balanced preset for true", () => {
    const behavior = normalizeHumanBehavior(true);

    expect(behavior.enabled).toBe(true);
    expect(behavior.mouse.enabled).toBe(true);
    expect(behavior.typing.enabled).toBe(true);
    expect(behavior.scroll.enabled).toBe(true);
  });

  it("lets per-call options override session defaults", () => {
    const behavior = normalizeHumanBehavior(
      { preset: "fast", mouse: { steps: 4 } },
      { mouse: { steps: 12 }, typing: { mistakeChance: 0.5 } },
    );

    expect(behavior.mouse.steps).toBe(12);
    expect(behavior.typing.mistakeChance).toBe(0.5);
  });

  it("supports deterministic random values with seed", () => {
    const a = randomForBehavior(normalizeHumanBehavior({ seed: 123 }));
    const b = randomForBehavior(normalizeHumanBehavior({ seed: 123 }));

    expect(resolveDelay({ min: 10, max: 20 }, a)).toBe(
      resolveDelay({ min: 10, max: 20 }, b),
    );
  });

  it("tracks pointer positions per CDP session", () => {
    const state = new HumanPointerState();
    const a = { id: "session-a" } as CDPSessionLike;
    const b = { id: "session-b" } as CDPSessionLike;

    state.set(a, { x: 10, y: 20 });
    state.set(b, { x: 30, y: 40 });

    expect(state.get(a)).toEqual({ x: 10, y: 20 });
    expect(state.get(b)).toEqual({ x: 30, y: 40 });
  });
});
