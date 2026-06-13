import { describe, expect, it } from "vitest";
import type { Frame } from "../../lib/v3/understudy/frame.js";
import { FrameSelectorResolver } from "../../lib/v3/understudy/selectorResolver.js";
import { MockCDPSession } from "./helpers/mockCDPSession.js";

const css = {
  escape(value: unknown): string {
    return String(value).replace(
      /[^A-Za-z0-9_-]/g,
      (character) => `\\${character}`,
    );
  },
};

function makeResolver(
  attributes: Record<string, string>,
  matches: (selector: string) => boolean,
): { resolver: FrameSelectorResolver; queried: string[] } {
  const queried: string[] = [];
  // Assigned after the session closure is created so the fake root can return itself.
  // eslint-disable-next-line prefer-const
  let target: {
    localName: string;
    getRootNode: () => {
      querySelectorAll: (selector: string) => unknown[];
    };
  };

  const session = new MockCDPSession({
    "Runtime.callFunctionOn": (params) => {
      const declaration = String(params?.functionDeclaration ?? "");
      if (declaration.includes("Object.fromEntries")) {
        return { result: { value: attributes } };
      }

      // The production code sends this function source to Chromium for execution.
      // eslint-disable-next-line no-restricted-syntax, no-new-func
      const runtimeFunction = new Function("CSS", `return (${declaration});`)(
        css,
      ) as (this: typeof target, attrs: Record<string, string>) => string;

      const args = params?.arguments as Array<{ value?: unknown }> | undefined;
      const value = runtimeFunction.call(
        target,
        (args?.[0]?.value ?? {}) as Record<string, string>,
      );
      return { result: { value } };
    },
  });

  target = {
    localName: "input",
    getRootNode: () => ({
      querySelectorAll: (selector: string) => {
        queried.push(selector);
        return matches(selector) ? [target] : [];
      },
    }),
  };

  const frame = { session } as unknown as Frame;
  return { resolver: new FrameSelectorResolver(frame), queried };
}

describe("FrameSelectorResolver.getBestSelector", () => {
  it("prefers a unique test attribute", async () => {
    const { resolver } = makeResolver(
      {
        "data-testid": "checkout",
        id: "checkout-input",
        name: "email",
      },
      () => true,
    );

    await expect(resolver.getBestSelector("object-1")).resolves.toEqual({
      kind: "css",
      value: "[data-testid=checkout]",
    });
  });

  it("rejects generated ids and combines semantic attributes", async () => {
    const expected = "input[name=email][type=email]";
    const { resolver, queried } = makeResolver(
      {
        id: "react-123456",
        name: "email",
        type: "email",
      },
      (selector) => selector === expected,
    );

    await expect(resolver.getBestSelector("object-2")).resolves.toEqual({
      kind: "css",
      value: expected,
    });
    expect(queried).not.toContain("[id=react-123456]");
  });

  it("returns null when no attribute selector is unique", async () => {
    const { resolver } = makeResolver(
      { "aria-label": "Close", class: "button primary" },
      () => false,
    );

    await expect(resolver.getBestSelector("object-3")).resolves.toBeNull();
  });
});
