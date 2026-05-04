import { JSDOM } from "jsdom";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  buildSelectorPlan,
  resolveSelectorPlan,
  stringifyPlan,
} from "../../lib/v3/selector/selectorPlan.js";

type DomGlobals = {
  window: Window & typeof globalThis;
  document: Document;
  Node: typeof Node;
  Element: typeof Element;
  HTMLElement: typeof HTMLElement;
  HTMLLabelElement: typeof HTMLLabelElement;
  CSS: typeof CSS;
};

const globalRef = globalThis as typeof globalThis & Partial<DomGlobals>;
const originalGlobals: Partial<DomGlobals> = {
  window: globalRef.window,
  document: globalRef.document,
  Node: globalRef.Node,
  Element: globalRef.Element,
  HTMLElement: globalRef.HTMLElement,
  HTMLLabelElement: globalRef.HTMLLabelElement,
  CSS: globalRef.CSS,
};

let dom: JSDOM;

const installDomGlobals = () => {
  const win = dom.window;
  globalRef.window = win as unknown as Window & typeof globalThis;
  globalRef.document = win.document;
  globalRef.Node = win.Node as unknown as typeof Node;
  globalRef.Element = win.Element as unknown as typeof Element;
  globalRef.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
  globalRef.HTMLLabelElement =
    win.HTMLLabelElement as unknown as typeof HTMLLabelElement;
  globalRef.CSS = win.CSS as unknown as typeof CSS;
};

const restoreDomGlobals = () => {
  for (const [key, value] of Object.entries(originalGlobals)) {
    if (value === undefined) {
      delete (globalRef as Record<string, unknown>)[key];
    } else {
      (globalRef as Record<string, unknown>)[key] = value;
    }
  }
};

describe("selector plan builder", () => {
  beforeAll(() => {
    dom = new JSDOM("<!doctype html><html><body></body></html>");
    installDomGlobals();
  });

  afterAll(() => {
    dom.window.close();
    restoreDomGlobals();
  });

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("prefers a unique test attribute over xpath-like structural fallback", () => {
    document.body.innerHTML = `
      <main>
        <button data-testid="save-button" class="btn primary">Save</button>
        <button class="btn primary">Cancel</button>
      </main>
    `;

    const target = document.querySelector(
      "[data-testid='save-button']",
    ) as Element;
    const result = buildSelectorPlan(target);

    expect(result.mode).toBe("single");
    expect(result.best).toMatchObject({
      kind: "direct",
      engine: "css",
      selector: '[data-testid="save-button"]',
    });
    expect(resolveSelectorPlan(result.best!, document)).toEqual([target]);
  });

  it("uses tree-scoped context when the target selector is repeated globally", () => {
    document.body.innerHTML = `
      <form aria-label="Login">
        <input name="email" />
        <button type="submit">Continue</button>
      </form>
      <form aria-label="Newsletter">
        <input name="email" />
        <button type="submit">Continue</button>
      </form>
    `;

    const target = document.querySelector(
      "form[aria-label='Login'] input[name='email']",
    ) as Element;
    const result = buildSelectorPlan(target);

    expect(result.mode).toBe("single");
    expect(result.best?.kind).toBe("within");
    expect(stringifyPlan(result.best!)).toContain('form[aria-label="Login"]');
    expect(stringifyPlan(result.best!)).toContain('input[name="email"]');
    expect(resolveSelectorPlan(result.best!, document)).toEqual([target]);
  });

  it("classifies repeated collection children as a group with a reusable target field", () => {
    document.body.innerHTML = `
      <section>
        <article class="product-card">
          <h2>Shampoo</h2>
          <button>Add to cart</button>
        </article>
        <article class="product-card">
          <h2>Conditioner</h2>
          <button>Add to cart</button>
        </article>
      </section>
    `;

    const target = document.querySelector(
      "article:first-of-type button",
    ) as Element;
    const result = buildSelectorPlan(target);

    expect(result.mode).toBe("group");
    expect(result.selection).toMatchObject({
      mode: "group",
      itemCount: 2,
    });
    expect(result.groups.length).toBeGreaterThan(0);
    expect(result.groups[0]).toMatchObject({
      count: 2,
      targetIsItem: false,
      targetWithinItemCoverage: 2,
    });

    const items = resolveSelectorPlan(result.best!, document);
    expect(
      items.map((item) => item.textContent?.replace(/\s+/g, " ").trim()),
    ).toEqual(["Shampoo Add to cart", "Conditioner Add to cart"]);

    const targetWithinItem =
      result.selection?.mode === "group"
        ? result.selection.targetWithinItem
        : undefined;
    expect(targetWithinItem).toBeDefined();
    expect(
      items.map((item) =>
        resolveSelectorPlan(targetWithinItem!, item)[0]?.textContent?.trim(),
      ),
    ).toEqual(["Add to cart", "Add to cart"]);
  });

  it("supports associated label selectors for form controls", () => {
    document.body.innerHTML = `
      <form>
        <label for="email-field">Email address</label>
        <input id="email-field" />
        <label for="password-field">Password</label>
        <input id="password-field" />
      </form>
    `;

    const target = document.getElementById("email-field") as Element;
    const result = buildSelectorPlan(target);
    const labelCandidate = result.candidates.find(
      (candidate) =>
        candidate.plan.kind === "direct" &&
        candidate.plan.engine === "label" &&
        candidate.plan.label === "Email address",
    );

    expect(labelCandidate).toBeDefined();
    expect(result.mode).toBe("single");
    expect(resolveSelectorPlan(labelCandidate!.plan, document)).toEqual([
      target,
    ]);
    expect(resolveSelectorPlan(result.best!, document)).toEqual([target]);
  });

  it("uses role and accessible name when it uniquely identifies the element", () => {
    document.body.innerHTML = `
      <button aria-label="Open settings">Icon</button>
      <button aria-label="Close settings">Icon</button>
    `;

    const target = document.querySelector(
      "button[aria-label='Open settings']",
    ) as Element;
    const result = buildSelectorPlan(target);
    const roleCandidate = result.candidates.find(
      (candidate) =>
        candidate.plan.kind === "direct" &&
        candidate.plan.engine === "role" &&
        candidate.plan.role === "button" &&
        candidate.plan.name === "Open settings",
    );

    expect(result.mode).toBe("single");
    expect(roleCandidate).toBeDefined();
    expect(resolveSelectorPlan(roleCandidate!.plan, document)).toEqual([
      target,
    ]);
  });

  it("falls back to a structural css path when no semantic selector is available", () => {
    document.body.innerHTML = `
      <div><span></span><span></span></div>
      <div><span></span><span id="targetless"></span></div>
    `;

    const target = document.getElementById("targetless") as Element;
    target.removeAttribute("id");
    const result = buildSelectorPlan(target);

    expect(result.mode).toBe("single");
    expect(result.selection?.confidence).toBe("low");
    expect(result.selection?.risks).toContain("structural-path");
    expect(result.best).toMatchObject({
      kind: "direct",
      engine: "css",
    });
    expect(stringifyPlan(result.best!)).toContain("nth-of-type");
    expect(resolveSelectorPlan(result.best!, document)).toEqual([target]);
  });

  it("uses repeated data attributes for result groups and avoids item-specific title text", () => {
    document.body.innerHTML = `
      <main>
        <div data-component-type="s-search-result">
          <h2>First product</h2>
          <img alt="First image" />
          <button>Add to cart</button>
        </div>
        <div data-component-type="s-search-result">
          <h2>Second product</h2>
          <img alt="Second image" />
          <button>Add to cart</button>
        </div>
        <div data-component-type="s-search-result">
          <h2>Third product</h2>
          <img alt="Third image" />
          <button>Add to cart</button>
        </div>
      </main>
    `;

    const target = document.querySelector("h2") as Element;
    const result = buildSelectorPlan(target);

    expect(result.mode).toBe("group");
    expect(stringifyPlan(result.best!)).toContain(
      'data-component-type="s-search-result"',
    );

    const targetWithinItem =
      result.selection?.mode === "group"
        ? result.selection.targetWithinItem
        : undefined;
    expect(targetWithinItem).toBeDefined();
    expect(stringifyPlan(targetWithinItem!)).not.toContain("First product");

    const items = resolveSelectorPlan(result.best!, document);
    expect(
      items.map((item) =>
        resolveSelectorPlan(targetWithinItem!, item)[0]?.textContent?.trim(),
      ),
    ).toEqual(["First product", "Second product", "Third product"]);
  });

  it("returns the containing item group for repeated leaf fields", () => {
    document.body.innerHTML = `
      <main>
        <article class="product-card">
          <img class="product-image" alt="First image" />
          <span class="product-label">First product</span>
        </article>
        <article class="product-card">
          <img class="product-image" alt="Second image" />
          <span class="product-label">Second product</span>
        </article>
      </main>
    `;

    const target = document.querySelector(".product-label") as Element;
    const result = buildSelectorPlan(target);

    expect(result.mode).toBe("group");
    expect(stringifyPlan(result.best!)).toContain("article.product-card");

    const targetWithinItem =
      result.selection?.mode === "group"
        ? result.selection.targetWithinItem
        : undefined;
    expect(targetWithinItem).toBeDefined();

    const items = resolveSelectorPlan(result.best!, document);
    expect(
      items.map((item) =>
        resolveSelectorPlan(targetWithinItem!, item)[0]?.textContent?.trim(),
      ),
    ).toEqual(["First product", "Second product"]);
  });

  it("keeps uniquely identifiable action targets as single selections", () => {
    document.body.innerHTML = `
      <section>
        <article class="product-card">
          <a href="/account">Your Account</a>
        </article>
        <article class="product-card">
          <a href="/orders">Orders</a>
        </article>
      </section>
    `;

    const target = document.querySelector("a[href='/account']") as Element;
    const result = buildSelectorPlan(target);

    expect(result.mode).toBe("single");
    expect(resolveSelectorPlan(result.best!, document)).toEqual([target]);
  });
});
