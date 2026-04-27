import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import type {
  HumanBehaviorInput,
  HumanBehaviorOptions,
  HumanDelay,
  HumanMouseOptions,
  HumanScrollOptions,
  HumanTypingOptions,
} from "../types/public/page.js";
import type { MouseButton } from "../types/public/locator.js";

type RandomFn = () => number;

export type ResolvedHumanBehavior = {
  enabled: boolean;
  seed?: number;
  mouse: Required<HumanMouseOptions>;
  typing: Required<HumanTypingOptions>;
  scroll: Required<HumanScrollOptions>;
  actionDelayMs: HumanDelay;
};

export type PointerPosition = { x: number; y: number };

export class HumanPointerState {
  private readonly positions = new Map<string, PointerPosition>();

  public get(session: CDPSessionLike): PointerPosition | undefined {
    return this.positions.get(this.sessionKey(session));
  }

  public set(session: CDPSessionLike, position: PointerPosition): void {
    this.positions.set(this.sessionKey(session), position);
  }

  public clear(session?: CDPSessionLike): void {
    if (!session) {
      this.positions.clear();
      return;
    }
    this.positions.delete(this.sessionKey(session));
  }

  private sessionKey(session: CDPSessionLike): string {
    return session.id ?? "__root__";
  }
}

const disabledBehavior: ResolvedHumanBehavior = {
  enabled: false,
  mouse: {
    enabled: false,
    durationMs: 0,
    steps: 1,
    jitter: 0,
    overshoot: false,
    settleDelayMs: 0,
    pressDelayMs: 0,
    clickDelayMs: 0,
  },
  typing: {
    enabled: false,
    delayMs: 0,
    wordPauseMs: 0,
    mistakeChance: 0,
    mistakeDelayMs: 0,
  },
  scroll: {
    enabled: false,
    chunkSize: 0,
    delayMs: 0,
    jitter: 0,
  },
  actionDelayMs: 0,
};

const presets: Record<
  NonNullable<HumanBehaviorOptions["preset"]>,
  Omit<ResolvedHumanBehavior, "seed">
> = {
  fast: {
    enabled: true,
    mouse: {
      enabled: true,
      durationMs: { min: 80, max: 180 },
      steps: 8,
      jitter: 1.5,
      overshoot: false,
      settleDelayMs: { min: 15, max: 45 },
      pressDelayMs: { min: 20, max: 55 },
      clickDelayMs: { min: 60, max: 120 },
    },
    typing: {
      enabled: true,
      delayMs: { min: 20, max: 70 },
      wordPauseMs: { min: 60, max: 140 },
      mistakeChance: 0,
      mistakeDelayMs: { min: 40, max: 120 },
    },
    scroll: {
      enabled: true,
      chunkSize: { min: 260, max: 520 },
      delayMs: { min: 20, max: 70 },
      jitter: 0.08,
    },
    actionDelayMs: { min: 50, max: 120 },
  },
  balanced: {
    enabled: true,
    mouse: {
      enabled: true,
      durationMs: { min: 180, max: 420 },
      steps: 16,
      jitter: 2.5,
      overshoot: true,
      settleDelayMs: { min: 40, max: 120 },
      pressDelayMs: { min: 45, max: 110 },
      clickDelayMs: { min: 100, max: 220 },
    },
    typing: {
      enabled: true,
      delayMs: { min: 45, max: 140 },
      wordPauseMs: { min: 120, max: 320 },
      mistakeChance: 0.015,
      mistakeDelayMs: { min: 80, max: 220 },
    },
    scroll: {
      enabled: true,
      chunkSize: { min: 180, max: 360 },
      delayMs: { min: 35, max: 120 },
      jitter: 0.12,
    },
    actionDelayMs: { min: 120, max: 300 },
  },
  careful: {
    enabled: true,
    mouse: {
      enabled: true,
      durationMs: { min: 320, max: 750 },
      steps: 28,
      jitter: 3.5,
      overshoot: true,
      settleDelayMs: { min: 100, max: 260 },
      pressDelayMs: { min: 80, max: 180 },
      clickDelayMs: { min: 180, max: 360 },
    },
    typing: {
      enabled: true,
      delayMs: { min: 85, max: 230 },
      wordPauseMs: { min: 220, max: 520 },
      mistakeChance: 0.025,
      mistakeDelayMs: { min: 140, max: 320 },
    },
    scroll: {
      enabled: true,
      chunkSize: { min: 120, max: 260 },
      delayMs: { min: 70, max: 180 },
      jitter: 0.16,
    },
    actionDelayMs: { min: 220, max: 520 },
  },
};

export function normalizeHumanBehavior(
  base?: HumanBehaviorInput,
  override?: HumanBehaviorInput,
): ResolvedHumanBehavior {
  const normalizedBase = normalizeSingleHumanBehavior(base);
  const normalizedOverride =
    override === undefined ? undefined : normalizeSingleHumanBehavior(override);

  if (!normalizedOverride) return normalizedBase;
  if (!normalizedOverride.enabled) return normalizedOverride;
  if (!normalizedBase.enabled) return normalizedOverride;

  return {
    enabled: normalizedOverride.enabled,
    seed: normalizedOverride.seed ?? normalizedBase.seed,
    mouse: { ...normalizedBase.mouse, ...normalizedOverride.mouse },
    typing: { ...normalizedBase.typing, ...normalizedOverride.typing },
    scroll: { ...normalizedBase.scroll, ...normalizedOverride.scroll },
    actionDelayMs:
      normalizedOverride.actionDelayMs ?? normalizedBase.actionDelayMs,
  };
}

function normalizeSingleHumanBehavior(
  input?: HumanBehaviorInput,
): ResolvedHumanBehavior {
  if (!input) return disabledBehavior;
  if (input === true) return { ...presets.balanced };

  const preset = presets[input.preset ?? "balanced"];
  return {
    enabled: true,
    seed: input.seed,
    mouse: { ...preset.mouse, ...input.mouse },
    typing: { ...preset.typing, ...input.typing },
    scroll: { ...preset.scroll, ...input.scroll },
    actionDelayMs: input.actionDelayMs ?? preset.actionDelayMs,
  };
}

export function randomForBehavior(behavior: ResolvedHumanBehavior): RandomFn {
  if (typeof behavior.seed !== "number") return Math.random;
  let state = behavior.seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function resolveDelay(delay: HumanDelay, random: RandomFn): number {
  if (typeof delay === "number") return Math.max(0, delay);
  const min = Math.max(0, Math.min(delay.min, delay.max));
  const max = Math.max(0, Math.max(delay.min, delay.max));
  return Math.round(min + (max - min) * random());
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    ms > 0 ? setTimeout(resolve, ms) : resolve(),
  );
}

export async function maybeHumanDelay(
  behavior: ResolvedHumanBehavior,
  random: RandomFn,
): Promise<void> {
  if (!behavior.enabled) return;
  await sleep(resolveDelay(behavior.actionDelayMs, random));
}

export async function dispatchHumanMouseMove(args: {
  session: CDPSessionLike;
  behavior: ResolvedHumanBehavior;
  random: RandomFn;
  from?: PointerPosition;
  to: PointerPosition;
  button?: MouseButton | "none";
  buttons?: number;
  updateCursor?: (x: number, y: number) => Promise<void>;
}): Promise<void> {
  const { session, behavior, random, from, to, updateCursor } = args;
  const button = args.button ?? "none";
  const buttons = args.buttons ?? 0;

  if (!behavior.enabled || !behavior.mouse.enabled) {
    await updateCursor?.(to.x, to.y);
    await session.send<never>("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: to.x,
      y: to.y,
      button,
      buttons,
    } as Protocol.Input.DispatchMouseEventRequest);
    return;
  }

  const start = from ?? to;
  const distance = Math.hypot(to.x - start.x, to.y - start.y);
  const configuredSteps = Math.max(1, Math.floor(behavior.mouse.steps));
  const steps = Math.max(
    configuredSteps,
    Math.min(48, Math.ceil(distance / 40)),
  );
  const duration = resolveDelay(behavior.mouse.durationMs, random);
  const perStepDelay = steps > 0 ? Math.floor(duration / steps) : 0;
  const points = buildMousePath(start, to, steps, behavior, random);

  for (const point of points) {
    await updateCursor?.(point.x, point.y);
    await session.send<never>("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button,
      buttons,
    } as Protocol.Input.DispatchMouseEventRequest);
    await sleep(perStepDelay);
  }
}

export async function dispatchHumanClick(args: {
  session: CDPSessionLike;
  behavior: ResolvedHumanBehavior;
  random: RandomFn;
  x: number;
  y: number;
  button: MouseButton;
  clickCount: number;
}): Promise<void> {
  const { session, behavior, random, x, y, button, clickCount } = args;
  for (let i = 1; i <= clickCount; i++) {
    await session.send<never>("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      clickCount: i,
    } as Protocol.Input.DispatchMouseEventRequest);
    if (behavior.enabled && behavior.mouse.enabled) {
      await sleep(resolveDelay(behavior.mouse.pressDelayMs, random));
    }
    await session.send<never>("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button,
      clickCount: i,
    } as Protocol.Input.DispatchMouseEventRequest);
    if (i < clickCount && behavior.enabled && behavior.mouse.enabled) {
      await sleep(resolveDelay(behavior.mouse.clickDelayMs, random));
    }
  }
}

export async function dispatchHumanScroll(args: {
  session: CDPSessionLike;
  behavior: ResolvedHumanBehavior;
  random: RandomFn;
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
}): Promise<void> {
  const { session, behavior, random, x, y, deltaX, deltaY } = args;
  if (!behavior.enabled || !behavior.scroll.enabled) {
    await session.send<never>("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      button: "none",
      deltaX,
      deltaY,
    } as Protocol.Input.DispatchMouseEventRequest);
    return;
  }

  const maxMagnitude = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  const baseChunkSize = Math.max(
    1,
    resolveDelay(behavior.scroll.chunkSize, random),
  );
  const chunks = Math.max(1, Math.ceil(maxMagnitude / baseChunkSize));

  for (let i = 1; i <= chunks; i++) {
    const remainingX = deltaX - (deltaX / chunks) * (i - 1);
    const remainingY = deltaY - (deltaY / chunks) * (i - 1);
    const jitter = 1 + (random() * 2 - 1) * behavior.scroll.jitter;
    const chunkX =
      i === chunks ? remainingX : (deltaX / chunks) * Math.max(0.1, jitter);
    const chunkY =
      i === chunks ? remainingY : (deltaY / chunks) * Math.max(0.1, jitter);

    await session.send<never>("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      button: "none",
      deltaX: chunkX,
      deltaY: chunkY,
    } as Protocol.Input.DispatchMouseEventRequest);

    if (i < chunks) {
      await sleep(resolveDelay(behavior.scroll.delayMs, random));
    }
  }
}

function buildMousePath(
  from: PointerPosition,
  to: PointerPosition,
  steps: number,
  behavior: ResolvedHumanBehavior,
  random: RandomFn,
): PointerPosition[] {
  const points: PointerPosition[] = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const normalX = distance > 0 ? -dy / distance : 0;
  const normalY = distance > 0 ? dx / distance : 0;
  const curve = (random() * 2 - 1) * Math.min(80, distance * 0.25);
  const jitter = Math.max(0, behavior.mouse.jitter);
  const cp1 = {
    x: from.x + dx * 0.33 + normalX * curve,
    y: from.y + dy * 0.33 + normalY * curve,
  };
  const cp2 = {
    x: from.x + dx * 0.66 - normalX * curve,
    y: from.y + dy * 0.66 - normalY * curve,
  };

  const finalTo =
    behavior.mouse.overshoot && distance > 120
      ? {
          x: to.x + (dx / distance) * Math.min(12, distance * 0.04),
          y: to.y + (dy / distance) * Math.min(12, distance * 0.04),
        }
      : to;

  for (let i = 1; i <= steps; i++) {
    const t = easeInOutCubic(i / steps);
    const base = cubicBezier(from, cp1, cp2, finalTo, t);
    const shouldJitter = i < steps || finalTo !== to;
    points.push({
      x: base.x + (shouldJitter ? (random() * 2 - 1) * jitter : 0),
      y: base.y + (shouldJitter ? (random() * 2 - 1) * jitter : 0),
    });
  }

  if (finalTo !== to) {
    points.push(to);
  }

  return points;
}

function cubicBezier(
  p0: PointerPosition,
  p1: PointerPosition,
  p2: PointerPosition,
  p3: PointerPosition,
  t: number,
): PointerPosition {
  const mt = 1 - t;
  return {
    x:
      mt * mt * mt * p0.x +
      3 * mt * mt * t * p1.x +
      3 * mt * t * t * p2.x +
      t * t * t * p3.x,
    y:
      mt * mt * mt * p0.y +
      3 * mt * mt * t * p1.y +
      3 * mt * t * t * p2.y +
      t * t * t * p3.y,
  };
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
