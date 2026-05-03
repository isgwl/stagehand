import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";
import {
  ElementNotVisibleError,
  StagehandInvalidArgumentError,
} from "../types/public/sdkErrors.js";
import type { MouseButton } from "../types/public/locator.js";
import type { HumanBehaviorInput } from "../types/public/page.js";
import {
  dispatchHumanClick,
  dispatchHumanMouseMove,
  dispatchHumanScroll,
  HumanPointerState,
  maybeHumanDelay,
  normalizeHumanBehavior,
  randomForBehavior,
  resolveDelay,
  sleep,
  type PointerPosition,
  type RandomFn,
  type ResolvedHumanBehavior,
} from "./humanBehavior.js";

export type InteractionResolution = {
  behavior: ResolvedHumanBehavior;
  random: RandomFn;
};

type CursorUpdater = (x: number, y: number) => Promise<void>;

type ElementViewportState = {
  measurable?: boolean;
  centerInViewport?: boolean;
  deltaX?: number;
  deltaY?: number;
  wheelX?: number;
  wheelY?: number;
};

const DEFAULT_SCROLL_MARGIN = 8;
const MAX_HUMAN_SCROLL_ATTEMPTS = 6;
const MAX_SCROLL_DELTA_PER_ATTEMPT = 1200;

export function centerFromBoxContent(content: number[]): PointerPosition {
  if (!content || content.length < 8) {
    throw new StagehandInvalidArgumentError("Invalid box model content quad");
  }
  const xs = [content[0], content[2], content[4], content[6]];
  const ys = [content[1], content[3], content[5], content[7]];
  return {
    x: (xs[0] + xs[1] + xs[2] + xs[3]) / 4,
    y: (ys[0] + ys[1] + ys[2] + ys[3]) / 4,
  };
}

export class InteractionDispatcher {
  constructor(
    private readonly options: {
      humanBehavior?: HumanBehaviorInput;
      pointerState?: HumanPointerState;
      updateCursor?: CursorUpdater;
    },
  ) {}

  public resolveHumanBehavior(
    override?: HumanBehaviorInput,
  ): InteractionResolution {
    const behavior = normalizeHumanBehavior(
      this.options.humanBehavior,
      override,
    );
    return { behavior, random: randomForBehavior(behavior) };
  }

  public async elementCenter(args: {
    session: CDPSessionLike;
    objectId: Protocol.Runtime.RemoteObjectId;
    selector?: string;
  }): Promise<PointerPosition> {
    const box = await args.session.send<Protocol.DOM.GetBoxModelResponse>(
      "DOM.getBoxModel",
      { objectId: args.objectId },
    );
    if (!box.model) throw new ElementNotVisibleError(args.selector ?? "");
    return centerFromBoxContent(box.model.content);
  }

  public async scrollIntoView(args: {
    session: CDPSessionLike;
    objectId: Protocol.Runtime.RemoteObjectId;
    humanBehavior?: HumanBehaviorInput;
    required?: boolean;
    includeActionDelay?: boolean;
    margin?: number;
  }): Promise<void> {
    const required = args.required ?? true;
    const { behavior, random } = this.resolveHumanBehavior(args.humanBehavior);

    if (behavior.enabled && behavior.scroll.enabled) {
      if (args.includeActionDelay ?? true) {
        await maybeHumanDelay(behavior, random);
      }

      const didScroll = await this.humanScrollIntoView({
        ...args,
        behavior,
        random,
        margin: args.margin ?? DEFAULT_SCROLL_MARGIN,
      });
      if (didScroll) return;
    }

    await this.rawScrollIntoView(args.session, args.objectId, required);
  }

  public async movePointer(args: {
    session: CDPSessionLike;
    point: PointerPosition;
    humanBehavior?: HumanBehaviorInput;
    button?: MouseButton | "none";
    buttons?: number;
    includeActionDelay?: boolean;
  }): Promise<InteractionResolution> {
    const resolved = this.resolveHumanBehavior(args.humanBehavior);
    if (args.includeActionDelay ?? true) {
      await maybeHumanDelay(resolved.behavior, resolved.random);
    }

    await dispatchHumanMouseMove({
      session: args.session,
      behavior: resolved.behavior,
      random: resolved.random,
      from: this.options.pointerState?.get(args.session),
      to: args.point,
      button: args.button,
      buttons: args.buttons,
      updateCursor: this.options.updateCursor,
    });
    this.options.pointerState?.set(args.session, args.point);
    return resolved;
  }

  public async hover(args: {
    session: CDPSessionLike;
    point: PointerPosition;
    humanBehavior?: HumanBehaviorInput;
  }): Promise<void> {
    await this.movePointer({
      session: args.session,
      point: args.point,
      humanBehavior: args.humanBehavior,
      button: "none",
    });
  }

  public async click(args: {
    session: CDPSessionLike;
    point: PointerPosition;
    button: MouseButton;
    clickCount: number;
    humanBehavior?: HumanBehaviorInput;
  }): Promise<void> {
    const { behavior, random } = this.resolveHumanBehavior(args.humanBehavior);
    await maybeHumanDelay(behavior, random);

    if (behavior.enabled && behavior.mouse.enabled) {
      await dispatchHumanMouseMove({
        session: args.session,
        behavior,
        random,
        from: this.options.pointerState?.get(args.session),
        to: args.point,
        button: "none",
        updateCursor: this.options.updateCursor,
      });
      this.options.pointerState?.set(args.session, args.point);
      await sleep(resolveDelay(behavior.mouse.settleDelayMs, random));
      await dispatchHumanClick({
        session: args.session,
        behavior,
        random,
        x: args.point.x,
        y: args.point.y,
        button: args.button,
        clickCount: args.clickCount,
      });
      return;
    }

    await this.options.updateCursor?.(args.point.x, args.point.y);
    const dispatches: Array<Promise<unknown>> = [
      args.session.send<never>("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: args.point.x,
        y: args.point.y,
        button: "none",
      } as Protocol.Input.DispatchMouseEventRequest),
    ];

    for (let i = 1; i <= args.clickCount; i++) {
      dispatches.push(
        args.session.send<never>("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: args.point.x,
          y: args.point.y,
          button: args.button,
          clickCount: i,
        } as Protocol.Input.DispatchMouseEventRequest),
      );
      dispatches.push(
        args.session.send<never>("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: args.point.x,
          y: args.point.y,
          button: args.button,
          clickCount: i,
        } as Protocol.Input.DispatchMouseEventRequest),
      );
    }

    await Promise.all(dispatches);
    this.options.pointerState?.set(args.session, args.point);
  }

  public async scroll(args: {
    session: CDPSessionLike;
    point: PointerPosition;
    deltaX: number;
    deltaY: number;
    humanBehavior?: HumanBehaviorInput;
  }): Promise<void> {
    const { behavior, random } = await this.movePointer({
      session: args.session,
      point: args.point,
      humanBehavior: args.humanBehavior,
      button: "none",
    });

    await dispatchHumanScroll({
      session: args.session,
      behavior,
      random,
      x: args.point.x,
      y: args.point.y,
      deltaX: args.deltaX,
      deltaY: args.deltaY,
    });
  }

  public async type(args: {
    session: CDPSessionLike;
    text: string;
    delay?: number;
    withMistakes?: boolean;
    preferInsertText?: boolean;
    humanBehavior?: HumanBehaviorInput;
  }): Promise<void> {
    const { behavior, random } = this.resolveHumanBehavior(args.humanBehavior);
    await maybeHumanDelay(behavior, random);

    const explicitDelay =
      typeof args.delay === "number" && Number.isFinite(args.delay)
        ? Math.max(0, args.delay)
        : undefined;
    const useHumanTyping =
      behavior.enabled &&
      behavior.typing.enabled &&
      explicitDelay === undefined;

    if (
      args.preferInsertText &&
      explicitDelay === undefined &&
      !useHumanTyping &&
      args.withMistakes !== true
    ) {
      await args.session.send<never>("Input.insertText", { text: args.text });
      return;
    }

    const mistakeChance =
      args.withMistakes === true
        ? 0.12
        : useHumanTyping
          ? behavior.typing.mistakeChance
          : 0;

    for (const ch of args.text) {
      if (ch === "\n" || ch === "\r") {
        await this.keyStroke(args.session, ch, {
          key: "Enter",
          code: "Enter",
          windowsVirtualKeyCode: 13,
        });
      } else if (ch === "\t") {
        await this.keyStroke(args.session, ch, {
          key: "Tab",
          code: "Tab",
          windowsVirtualKeyCode: 9,
        });
      } else {
        if (mistakeChance > 0 && random() < mistakeChance) {
          const wrong = this.randomPrintable(random, ch);
          await this.keyStroke(args.session, wrong);
          await this.sleepBetweenKeystrokes({
            behavior,
            random,
            useHumanTyping,
            explicitDelay,
            mistake: true,
          });
          await this.pressBackspace(args.session);
          await this.sleepBetweenKeystrokes({
            behavior,
            random,
            useHumanTyping,
            explicitDelay,
            mistake: true,
          });
        }
        await this.keyStroke(args.session, ch);
      }

      await this.sleepBetweenKeystrokes({
        behavior,
        random,
        useHumanTyping,
        explicitDelay,
        wordBoundary: ch === " ",
      });
    }
  }

  private async humanScrollIntoView(args: {
    session: CDPSessionLike;
    objectId: Protocol.Runtime.RemoteObjectId;
    behavior: ResolvedHumanBehavior;
    random: RandomFn;
    margin: number;
  }): Promise<boolean> {
    let lastDistance = Number.POSITIVE_INFINITY;
    let stalledAttempts = 0;

    for (let attempt = 0; attempt < MAX_HUMAN_SCROLL_ATTEMPTS; attempt++) {
      const state = await this.measureElementViewport(args);
      if (!state?.measurable) return false;
      if (state.centerInViewport) return true;

      const deltaX = sanitizeScrollDelta(state.deltaX);
      const deltaY = sanitizeScrollDelta(state.deltaY);
      const distance = Math.hypot(deltaX, deltaY);
      if (distance < 1) return true;

      if (distance >= lastDistance - 1) {
        stalledAttempts += 1;
      } else {
        stalledAttempts = 0;
      }
      if (stalledAttempts >= 2) return false;
      lastDistance = distance;

      const wheelPoint = {
        x: finiteOrDefault(state.wheelX, args.margin),
        y: finiteOrDefault(state.wheelY, args.margin),
      };

      await dispatchHumanMouseMove({
        session: args.session,
        behavior: args.behavior,
        random: args.random,
        from: this.options.pointerState?.get(args.session),
        to: wheelPoint,
        button: "none",
        updateCursor: this.options.updateCursor,
      });
      this.options.pointerState?.set(args.session, wheelPoint);

      await dispatchHumanScroll({
        session: args.session,
        behavior: args.behavior,
        random: args.random,
        x: wheelPoint.x,
        y: wheelPoint.y,
        deltaX,
        deltaY,
      });
      await sleep(50);
    }

    const finalState = await this.measureElementViewport(args);
    return Boolean(finalState?.measurable && finalState.centerInViewport);
  }

  private async rawScrollIntoView(
    session: CDPSessionLike,
    objectId: Protocol.Runtime.RemoteObjectId,
    required: boolean,
  ): Promise<boolean> {
    try {
      await session.send("DOM.scrollIntoViewIfNeeded", { objectId });
      return true;
    } catch (error) {
      if (required) throw error;
      return false;
    }
  }

  private async measureElementViewport(args: {
    session: CDPSessionLike;
    objectId: Protocol.Runtime.RemoteObjectId;
    margin: number;
  }): Promise<ElementViewportState | null> {
    const res =
      await args.session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId: args.objectId,
          functionDeclaration: `
          function(margin) {
            const rect = this.getBoundingClientRect();
            const viewport = window.visualViewport;
            const width = viewport?.width ?? window.innerWidth ?? document.documentElement?.clientWidth ?? 0;
            const height = viewport?.height ?? window.innerHeight ?? document.documentElement?.clientHeight ?? 0;
            const finite = (...values) => values.every((value) => Number.isFinite(value));
            if (!finite(rect.left, rect.top, rect.right, rect.bottom, rect.width, rect.height, width, height) || width <= 0 || height <= 0) {
              return { measurable: false };
            }

            const safeMargin = Math.max(0, Math.min(Number(margin) || 0, Math.floor(Math.min(width, height) / 3)));
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const minX = safeMargin;
            const minY = safeMargin;
            const maxX = Math.max(minX, width - safeMargin);
            const maxY = Math.max(minY, height - safeMargin);
            const centerInViewport = centerX >= minX && centerX <= maxX && centerY >= minY && centerY <= maxY;
            const intersects = rect.right > 0 && rect.left < width && rect.bottom > 0 && rect.top < height;
            const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

            return {
              measurable: true,
              centerInViewport,
              deltaX: centerX - width / 2,
              deltaY: centerY - height / 2,
              wheelX: intersects ? clamp(centerX, minX, maxX) : width / 2,
              wheelY: intersects ? clamp(centerY, minY, maxY) : height / 2,
            };
          }
        `,
          arguments: [{ value: args.margin }],
          returnByValue: true,
        },
      );

    if (res.exceptionDetails) return null;
    const value = res.result.value as ElementViewportState | null | undefined;
    if (!value || typeof value !== "object") return null;
    return value;
  }

  private async keyStroke(
    session: CDPSessionLike,
    ch: string,
    override?: {
      key?: string;
      code?: string;
      windowsVirtualKeyCode?: number;
    },
  ): Promise<void> {
    if (override) {
      const base: Protocol.Input.DispatchKeyEventRequest = {
        type: "keyDown",
        key: override.key,
        code: override.code,
        windowsVirtualKeyCode: override.windowsVirtualKeyCode,
      } as Protocol.Input.DispatchKeyEventRequest;
      await session.send("Input.dispatchKeyEvent", base);
      await session.send("Input.dispatchKeyEvent", {
        ...base,
        type: "keyUp",
      } as Protocol.Input.DispatchKeyEventRequest);
      return;
    }

    const isLetter = /^[a-zA-Z]$/.test(ch);
    const isDigit = /^[0-9]$/.test(ch);
    let key = ch;
    let code = "";
    let windowsVirtualKeyCode: number | undefined;

    if (isLetter) {
      code = `Key${ch.toUpperCase()}`;
      windowsVirtualKeyCode = ch.toUpperCase().charCodeAt(0);
    } else if (isDigit) {
      code = `Digit${ch}`;
      windowsVirtualKeyCode = ch.charCodeAt(0);
    } else if (ch === " ") {
      key = " ";
      code = "Space";
      windowsVirtualKeyCode = 32;
    }

    await session.send<never>("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      code: code || undefined,
      text: ch,
      unmodifiedText: ch,
      windowsVirtualKeyCode,
    } as Protocol.Input.DispatchKeyEventRequest);
    await session.send<never>("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code: code || undefined,
      windowsVirtualKeyCode,
    } as Protocol.Input.DispatchKeyEventRequest);
  }

  private async pressBackspace(session: CDPSessionLike): Promise<void> {
    await this.keyStroke(session, "\b", {
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });
  }

  private async sleepBetweenKeystrokes(args: {
    behavior: ResolvedHumanBehavior;
    random: RandomFn;
    useHumanTyping: boolean;
    explicitDelay?: number;
    mistake?: boolean;
    wordBoundary?: boolean;
  }): Promise<void> {
    if (args.useHumanTyping) {
      await sleep(
        resolveDelay(
          args.mistake
            ? args.behavior.typing.mistakeDelayMs
            : args.behavior.typing.delayMs,
          args.random,
        ),
      );
      if (args.wordBoundary) {
        await sleep(
          resolveDelay(args.behavior.typing.wordPauseMs, args.random),
        );
      }
      return;
    }

    if (args.explicitDelay && args.explicitDelay > 0) {
      await sleep(args.explicitDelay);
    }
  }

  private randomPrintable(random: RandomFn, avoid: string): string {
    const pool =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:'\"!?@#$%^&*()-_=+[]{}<>/\\|`~";
    let value = avoid;
    while (value === avoid) {
      value = pool[Math.floor(random() * pool.length)];
    }
    return value;
  }
}

function sanitizeScrollDelta(value: unknown): number {
  const finite = finiteOrDefault(value, 0);
  return Math.max(
    -MAX_SCROLL_DELTA_PER_ATTEMPT,
    Math.min(MAX_SCROLL_DELTA_PER_ATTEMPT, finite),
  );
}

function finiteOrDefault(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
