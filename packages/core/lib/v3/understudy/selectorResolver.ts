import type { Protocol } from "devtools-protocol";
import {
  locatorScriptBootstrap,
  locatorScriptGlobalRefs,
  type LocatorScriptName,
} from "../dom/build/locatorScripts.generated.js";
import { v3Logger } from "../logger.js";
import type { Frame } from "./frame.js";
import { executionContexts } from "./executionContextRegistry.js";

export type SelectorQuery =
  | { kind: "css"; value: string }
  | { kind: "text"; value: string }
  | { kind: "xpath"; value: string };

export interface ResolvedNode {
  objectId: Protocol.Runtime.RemoteObjectId;
  nodeId: Protocol.DOM.NodeId | null;
}

export interface ResolveManyOptions {
  limit?: number;
}

export class FrameSelectorResolver {
  constructor(private readonly frame: Frame) {}

  public async getBestSelector(
    objectId: Protocol.Runtime.RemoteObjectId,
  ): Promise<SelectorQuery | null> {
    const attributes = await this.getAttributes(objectId);
    const selector = await this.findUniqueAttributeSelector(
      objectId,
      attributes,
    );
    return selector ? { kind: "css", value: selector } : null;
  }

  private async getAttributes(
    objectId: Protocol.Runtime.RemoteObjectId,
  ): Promise<Record<string, string>> {
    const response =
      await this.frame.session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: `function () {
            return Object.fromEntries(
              Array.from(this.attributes, attribute => [
                attribute.name,
                attribute.value,
              ]),
            );
          }`,
          returnByValue: true,
        },
      );

    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.text ?? "Unable to read element attributes",
      );
    }

    return (response.result.value ?? {}) as Record<string, string>;
  }

  private async findUniqueAttributeSelector(
    objectId: Protocol.Runtime.RemoteObjectId,
    attributes: Record<string, string>,
  ): Promise<string | null> {
    const response =
      await this.frame.session.send<Protocol.Runtime.CallFunctionOnResponse>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: `function (attributes) {
            const root = this.getRootNode();
            if (!root || typeof root.querySelectorAll !== "function") {
              return null;
            }

            const tagName = String(this.localName || this.tagName || "")
              .toLowerCase();
            const tag = /^[a-z][a-z0-9-]*$/.test(tagName) ? tagName : "";
            const candidates = [];
            const seen = new Set();
            const add = (selector) => {
              if (selector && !seen.has(selector)) {
                seen.add(selector);
                candidates.push(selector);
              }
            };
            const attr = (name, value, prefix = "") =>
              prefix + "[" + name + "=" + CSS.escape(value) + "]";
            const valueFor = (name) =>
              typeof attributes[name] === "string"
                ? attributes[name].trim()
                : "";

            for (const name of ["data-testid", "data-test", "data-cy"]) {
              const value = valueFor(name);
              if (value) add(attr(name, value));
            }

            const id = valueFor("id");
            const generatedId =
              !id ||
              id.length > 64 ||
              /^\\d+$/.test(id) ||
              /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ||
              /^[0-9a-f]{16,}$/i.test(id) ||
              /^:r[\\w-]*:$/i.test(id) ||
              /^(react|ember|vue|radix|headlessui)[-_:]?/i.test(id) ||
              /[-_:]\\d{5,}$/.test(id);
            if (!generatedId) add(attr("id", id));

            const semantic = [];
            for (const name of [
              "name",
              "aria-label",
              "role",
              "type",
              "placeholder",
              "title",
              "alt",
            ]) {
              const value = valueFor(name);
              if (!value) continue;
              semantic.push([name, value]);
              add(attr(name, value, tag));
            }

            for (let left = 0; left < semantic.length; left += 1) {
              for (let right = left + 1; right < semantic.length; right += 1) {
                const [leftName, leftValue] = semantic[left];
                const [rightName, rightValue] = semantic[right];
                add(
                  attr(leftName, leftValue, tag) +
                    attr(rightName, rightValue),
                );
              }
            }

            for (const className of valueFor("class").split(/\\s+/)) {
              if (
                !className ||
                className.length > 64 ||
                !/^[A-Za-z_-][A-Za-z0-9_-]*$/.test(className) ||
                /^(css|sc|jsx|emotion)-[a-z0-9_-]{5,}$/i.test(className) ||
                /^_[a-z0-9]{5,}$/i.test(className) ||
                /^[0-9a-f]{8,}$/i.test(className)
              ) {
                continue;
              }
              add(tag + "[class~=" + CSS.escape(className) + "]");
            }

            for (const candidate of candidates) {
              try {
                const matches = root.querySelectorAll(candidate);
                if (matches.length === 1 && matches[0] === this) {
                  return candidate;
                }
              } catch {
                // Ignore invalid candidates and continue.
              }
            }
            return null;
          }`,
          arguments: [{ value: attributes }],
          returnByValue: true,
        },
      );

    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.text ?? "Unable to validate selectors",
      );
    }

    return typeof response.result.value === "string"
      ? response.result.value
      : null;
  }

  public static parseSelector(raw: string): SelectorQuery {
    const trimmed = raw.trim();

    const isText = /^text=/i.test(trimmed);
    const looksLikeXPath =
      /^xpath=/i.test(trimmed) ||
      trimmed.startsWith("/") ||
      trimmed.startsWith("(");
    const isCssPrefixed = /^css=/i.test(trimmed);

    if (isText) {
      let value = trimmed.replace(/^text=/i, "").trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return { kind: "text", value };
    }

    if (looksLikeXPath) {
      const value = trimmed.replace(/^xpath=/i, "");
      return { kind: "xpath", value };
    }

    let selector = isCssPrefixed ? trimmed.replace(/^css=/i, "") : trimmed;
    if (selector.includes(">>")) {
      selector = selector
        .split(">>")
        .map((piece) => piece.trim())
        .filter(Boolean)
        .join(" ");
    }

    return { kind: "css", value: selector };
  }

  public async resolveFirst(
    query: SelectorQuery,
  ): Promise<ResolvedNode | null> {
    return this.resolveAtIndex(query, 0);
  }

  public async resolveAll(
    query: SelectorQuery,
    { limit = Infinity }: ResolveManyOptions = {},
  ): Promise<ResolvedNode[]> {
    if (limit <= 0) return [];
    switch (query.kind) {
      case "css":
        return this.resolveCss(query.value, limit);
      case "text":
        return this.resolveText(query.value, limit);
      case "xpath":
        return this.resolveXPath(query.value, limit);
      default:
        return [];
    }
  }

  public async count(query: SelectorQuery): Promise<number> {
    switch (query.kind) {
      case "css":
        return this.countCss(query.value);
      case "text":
        return this.countText(query.value);
      case "xpath":
        return this.countXPath(query.value);
      default:
        return 0;
    }
  }

  public async resolveAtIndex(
    query: SelectorQuery,
    index: number,
  ): Promise<ResolvedNode | null> {
    if (index < 0 || !Number.isFinite(index)) return null;
    const results = await this.resolveAll(query, { limit: index + 1 });
    return results[index] ?? null;
  }

  private buildLocatorInvocation(
    name: LocatorScriptName,
    args: string[],
  ): string {
    const call = `${locatorScriptGlobalRefs[name]}(${args.join(", ")})`;
    return `(() => { ${locatorScriptBootstrap}; return ${call}; })()`;
  }

  private async resolveCss(
    selector: string,
    limit: number,
  ): Promise<ResolvedNode[]> {
    if (limit <= 0) return [];

    const session = this.frame.session;
    const { executionContextId } = await session.send<{
      executionContextId: Protocol.Runtime.ExecutionContextId;
    }>("Page.createIsolatedWorld", {
      frameId: this.frame.frameId,
      worldName: "v3-world",
    });

    const ctxId = await executionContexts.waitForMainWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const results: ResolvedNode[] = [];
    let loggedFallback = false;

    for (let index = 0; index < limit; index += 1) {
      const primaryExpr = this.buildLocatorInvocation("resolveCssSelector", [
        JSON.stringify(selector),
        String(index),
      ]);
      const primary = await this.evaluateElement(
        primaryExpr,
        executionContextId,
      );
      if (primary) {
        results.push(primary);
        continue;
      }

      if (!loggedFallback) {
        v3Logger({
          category: "locator",
          message: "css pierce-fallback",
          level: 2,
          auxiliary: {
            frameId: { value: String(this.frame.frameId), type: "string" },
            selector: { value: selector, type: "string" },
          },
        });
        loggedFallback = true;
      }

      const fallbackExpr = this.buildLocatorInvocation(
        "resolveCssSelectorPierce",
        [JSON.stringify(selector), String(index)],
      );
      const fallback = await this.evaluateElement(fallbackExpr, ctxId);
      if (fallback) {
        results.push(fallback);
        continue;
      }

      break;
    }

    return results;
  }

  private async resolveText(
    value: string,
    limit: number,
  ): Promise<ResolvedNode[]> {
    if (limit <= 0) return [];

    const session = this.frame.session;
    const ctxId = await executionContexts.waitForMainWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const results: ResolvedNode[] = [];
    for (let index = 0; index < limit; index += 1) {
      const expr = this.buildLocatorInvocation("resolveTextSelector", [
        JSON.stringify(value),
        String(index),
      ]);
      const resolved = await this.evaluateElement(expr, ctxId);
      if (!resolved) break;
      results.push(resolved);
    }

    return results;
  }

  private async resolveXPath(
    value: string,
    limit: number,
  ): Promise<ResolvedNode[]> {
    if (limit <= 0) return [];

    const session = this.frame.session;
    const ctxId = await executionContexts.waitForMainWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const results: ResolvedNode[] = [];
    for (let index = 0; index < limit; index += 1) {
      const expr = this.buildLocatorInvocation("resolveXPathMainWorld", [
        JSON.stringify(value),
        String(index),
      ]);
      const resolved = await this.evaluateElement(expr, ctxId);
      if (!resolved) break;
      results.push(resolved);
    }

    return results;
  }

  private async countCss(selector: string): Promise<number> {
    const session = this.frame.session;

    const { executionContextId } = await session.send<{
      executionContextId: Protocol.Runtime.ExecutionContextId;
    }>("Page.createIsolatedWorld", {
      frameId: this.frame.frameId,
      worldName: "v3-world",
    });

    const primaryExpr = this.buildLocatorInvocation("countCssMatchesPrimary", [
      JSON.stringify(selector),
    ]);
    const primary = await this.evaluateCount(primaryExpr, executionContextId);

    const ctxId = await executionContexts.waitForMainWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const fallbackExpr = this.buildLocatorInvocation("countCssMatchesPierce", [
      JSON.stringify(selector),
    ]);
    const fallback = await this.evaluateCount(fallbackExpr, ctxId);

    return Math.max(primary, fallback);
  }

  private async countText(value: string): Promise<number> {
    const session = this.frame.session;
    const ctxId = await executionContexts.waitForMainWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const expr = this.buildLocatorInvocation("countTextMatches", [
      JSON.stringify(value),
    ]);

    try {
      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        {
          expression: expr,
          contextId: ctxId,
          returnByValue: true,
          awaitPromise: true,
        },
      );

      if (evalRes.exceptionDetails) {
        const details = evalRes.exceptionDetails;
        v3Logger({
          category: "locator",
          message: "count text evaluate exception",
          level: 0,
          auxiliary: {
            frameId: { value: String(this.frame.frameId), type: "string" },
            selector: { value: value, type: "string" },
            exception: {
              value:
                details.text ??
                String(
                  details.exception?.description ??
                    details.exception?.value ??
                    "",
                ),
              type: "string",
            },
          },
        });
        return 0;
      }

      const data = (evalRes.result.value ?? {}) as {
        count?: unknown;
      };

      const num =
        typeof data.count === "number" ? data.count : Number(data.count);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    } catch {
      return 0;
    }
  }

  private async countXPath(value: string): Promise<number> {
    const session = this.frame.session;

    const ctxId = await executionContexts.waitForMainWorld(
      session,
      this.frame.frameId,
      1000,
    );

    const expr = this.buildLocatorInvocation("countXPathMatchesMainWorld", [
      JSON.stringify(value),
    ]);

    try {
      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        {
          expression: expr,
          contextId: ctxId,
          returnByValue: true,
          awaitPromise: true,
        },
      );

      if (evalRes.exceptionDetails) {
        return 0;
      }

      const num =
        typeof evalRes.result.value === "number"
          ? evalRes.result.value
          : Number(evalRes.result.value);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    } catch {
      return 0;
    }
  }

  private async resolveFromObjectId(
    objectId: Protocol.Runtime.RemoteObjectId,
  ): Promise<ResolvedNode | null> {
    const session = this.frame.session;
    let nodeId: Protocol.DOM.NodeId | null;
    try {
      const rn = await session.send<{ nodeId: Protocol.DOM.NodeId }>(
        "DOM.requestNode",
        { objectId },
      );
      nodeId = rn.nodeId ?? null;
    } catch {
      nodeId = null;
    }

    return { objectId, nodeId };
  }

  private async evaluateCount(
    expression: string,
    contextId: Protocol.Runtime.ExecutionContextId,
  ): Promise<number> {
    const session = this.frame.session;

    try {
      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        {
          expression,
          contextId,
          returnByValue: true,
          awaitPromise: true,
        },
      );

      if (evalRes.exceptionDetails) {
        return 0;
      }

      const value = evalRes.result.value;
      const num = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(num)) return 0;
      return Math.max(0, Math.floor(num));
    } catch {
      return 0;
    }
  }

  private async evaluateElement(
    expression: string,
    contextId: Protocol.Runtime.ExecutionContextId,
  ): Promise<ResolvedNode | null> {
    const session = this.frame.session;

    try {
      const evalRes = await session.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        {
          expression,
          contextId,
          returnByValue: false,
          awaitPromise: true,
        },
      );

      if (evalRes.exceptionDetails || !evalRes.result.objectId) {
        return null;
      }

      return this.resolveFromObjectId(evalRes.result.objectId);
    } catch {
      return null;
    }
  }
}
