import { Page } from "../../understudy/page.js";
import { Page as PlaywrightPage } from "playwright-core";
import { Page as PatchrightPage } from "patchright-core";
import { Page as PuppeteerPage } from "puppeteer-core";

export type { PlaywrightPage, PatchrightPage, PuppeteerPage, Page };
export type AnyPage = PlaywrightPage | PuppeteerPage | PatchrightPage | Page;

export { ConsoleMessage } from "../../understudy/consoleMessage.js";
export type { ConsoleListener } from "../../understudy/consoleMessage.js";

export type LoadState = "load" | "domcontentloaded" | "networkidle";
export { Response } from "../../understudy/response.js";

export type SnapshotResult = {
  formattedTree: string;
  xpathMap: Record<string, string>;
  urlMap: Record<string, string>;
};

export type PageSnapshotOptions = {
  includeIframes?: boolean;
};

export type HumanBehaviorPreset = "fast" | "balanced" | "careful";

export type HumanDelayRange = {
  min: number;
  max: number;
};

export type HumanDelay = number | HumanDelayRange;

export type HumanMouseOptions = {
  enabled?: boolean;
  durationMs?: HumanDelay;
  steps?: number;
  jitter?: number;
  overshoot?: boolean;
  settleDelayMs?: HumanDelay;
  pressDelayMs?: HumanDelay;
  clickDelayMs?: HumanDelay;
};

export type HumanTypingOptions = {
  enabled?: boolean;
  delayMs?: HumanDelay;
  wordPauseMs?: HumanDelay;
  mistakeChance?: number;
  mistakeDelayMs?: HumanDelay;
};

export type HumanScrollOptions = {
  enabled?: boolean;
  chunkSize?: HumanDelay;
  delayMs?: HumanDelay;
  jitter?: number;
};

export type HumanBehaviorOptions = {
  preset?: HumanBehaviorPreset;
  seed?: number;
  mouse?: HumanMouseOptions;
  typing?: HumanTypingOptions;
  scroll?: HumanScrollOptions;
  actionDelayMs?: HumanDelay;
};

export type HumanBehaviorInput = boolean | HumanBehaviorOptions;
