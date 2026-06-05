import { describe, expect, it } from "vitest";
import {
  HumanPointerState,
  dispatchHumanScroll,
  normalizeHumanBehavior,
  randomForBehavior,
  resolveDelay,
} from "../../lib/v3/understudy/humanBehavior.js";
import { InteractionDispatcher } from "../../lib/v3/understudy/interactionDispatcher.js";
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

  it("normalizes hostile numeric options to finite bounded values", () => {
    const behavior = normalizeHumanBehavior({
      seed: Number.POSITIVE_INFINITY,
      mouse: {
        steps: Number.POSITIVE_INFINITY,
        jitter: Number.NaN,
        durationMs: { min: Number.NaN, max: Number.POSITIVE_INFINITY },
      },
      typing: { mistakeChance: 2 },
      scroll: { chunkSize: 0, jitter: 99 },
      actionDelayMs: Number.POSITIVE_INFINITY,
    });

    expect(behavior.seed).toBeUndefined();
    expect(behavior.mouse.steps).toBe(16);
    expect(behavior.mouse.jitter).toBe(2.5);
    expect(behavior.mouse.durationMs).toEqual({ min: 180, max: 420 });
    expect(behavior.typing.mistakeChance).toBe(1);
    expect(behavior.scroll.chunkSize).toBe(1);
    expect(behavior.scroll.jitter).toBe(1);
    expect(behavior.actionDelayMs).toBe(120);
  });

  it("keeps human scroll chunks equal to the requested total delta", async () => {
    const events: Array<{ deltaX?: number; deltaY?: number }> = [];
    const session = {
      id: "scroll-session",
      send: async (_method: string, params?: object) => {
        events.push(params as { deltaX?: number; deltaY?: number });
        return undefined as never;
      },
      on: () => {},
      off: () => {},
      close: async () => {},
    } satisfies CDPSessionLike;

    await dispatchHumanScroll({
      session,
      behavior: normalizeHumanBehavior({
        scroll: { chunkSize: 10, delayMs: 0, jitter: 0.5 },
      }),
      random: () => 0,
      x: 10,
      y: 20,
      deltaX: 30,
      deltaY: 100,
    });

    expect(events.reduce((sum, event) => sum + (event.deltaX ?? 0), 0)).toBe(
      30,
    );
    expect(events.reduce((sum, event) => sum + (event.deltaY ?? 0), 0)).toBe(
      100,
    );
  });

  it("sends non-human click events sequentially", async () => {
    const calls: string[] = [];
    const resolvers: Array<() => void> = [];
    const session = {
      id: "click-session",
      send: async (_method: string, params?: object) => {
        calls.push((params as { type?: string }).type ?? "");
        await new Promise<void>((resolve) => resolvers.push(resolve));
        return undefined as never;
      },
      on: () => {},
      off: () => {},
      close: async () => {},
    } satisfies CDPSessionLike;
    const dispatcher = new InteractionDispatcher({});
    const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
    const click = dispatcher.click({
      session,
      point: { x: 5, y: 6 },
      button: "left",
      clickCount: 1,
    });

    await tick();
    expect(calls).toEqual(["mouseMoved"]);
    resolvers.shift()?.();
    await tick();
    expect(calls).toEqual(["mouseMoved", "mousePressed"]);
    resolvers.shift()?.();
    await tick();
    expect(calls).toEqual(["mouseMoved", "mousePressed", "mouseReleased"]);
    resolvers.shift()?.();
    await click;
  });
});
