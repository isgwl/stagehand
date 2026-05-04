export type SelectorPlanEngine = "css" | "text" | "role" | "label";

export type SelectorRoot = Document | DocumentFragment | Element;

export type SelectorPlanMode = "none" | "single" | "group";

export type SelectorPlanConfidence = "high" | "medium" | "low";

export type SelectorPlanRisk =
  | "content-specific"
  | "generated-class"
  | "generic-tag"
  | "long-selector"
  | "nth-of-type"
  | "structural-path"
  | "weak-class";

export type DirectSelectorPlan =
  | {
      kind: "direct";
      engine: "css";
      selector: string;
      score: number;
      reason: string;
    }
  | {
      kind: "direct";
      engine: "text";
      selector: string;
      text: string;
      score: number;
      reason: string;
    }
  | {
      kind: "direct";
      engine: "role";
      selector: string;
      role: string;
      name?: string;
      score: number;
      reason: string;
    }
  | {
      kind: "direct";
      engine: "label";
      selector: string;
      label: string;
      score: number;
      reason: string;
    };

export type SelectorPlan =
  | DirectSelectorPlan
  | {
      kind: "within";
      scope: SelectorPlan;
      target: SelectorPlan;
      score: number;
      reason: string;
    }
  | {
      kind: "has";
      base: SelectorPlan;
      has: SelectorPlan;
      score: number;
      reason: string;
    };

export interface SelectorPlanCandidate {
  plan: SelectorPlan;
  score: number;
  matchCount: number;
  confidence: SelectorPlanConfidence;
  risks: SelectorPlanRisk[];
  reason: string;
}

export interface SelectorGroupCandidate {
  item: SelectorPlan;
  count: number;
  targetIsItem: boolean;
  targetWithinItem?: SelectorPlan;
  targetWithinItemCoverage?: number;
  anchor?: SelectorPlan;
  score: number;
  confidence: SelectorPlanConfidence;
  risks: SelectorPlanRisk[];
  reason: string;
}

export type SelectorPlanSelection =
  | {
      mode: "single";
      plan: SelectorPlan;
      score: number;
      matchCount: 1;
      confidence: SelectorPlanConfidence;
      risks: SelectorPlanRisk[];
      reason: string;
    }
  | {
      mode: "group";
      plan: SelectorPlan;
      groupPlan: SelectorPlan;
      itemCount: number;
      targetWithinItem?: SelectorPlan;
      targetWithinItemCoverage?: number;
      score: number;
      confidence: SelectorPlanConfidence;
      risks: SelectorPlanRisk[];
      reason: string;
    };

export interface SelectorPlanResult {
  mode: SelectorPlanMode;
  best: SelectorPlan | null;
  selection: SelectorPlanSelection | null;
  single: SelectorPlanCandidate | null;
  candidates: SelectorPlanCandidate[];
  groups: SelectorGroupCandidate[];
}

export interface BuildSelectorPlanOptions {
  root?: SelectorRoot;
  maxAncestorDepth?: number;
  maxTextLength?: number;
  maxCandidates?: number;
  maxGroupCount?: number;
  minGroupScore?: number;
}

const TEST_ATTRIBUTES = [
  "data-testid",
  "data-test",
  "data-cy",
  "data-qa",
  "data-test-id",
  "data-automation-id",
  "data-component",
  "data-slot",
];

const SEMANTIC_ATTRIBUTES = [
  "aria-label",
  "name",
  "placeholder",
  "alt",
  "title",
  "href",
  "for",
  "type",
];

const GROUP_ATTRIBUTES = [
  ...TEST_ATTRIBUTES,
  "data-component-type",
  "data-item-type",
  "data-list-item-type",
  "data-result-type",
  "data-widget-type",
  "itemtype",
];

const FORM_CONTROL_TAGS = new Set([
  "button",
  "input",
  "select",
  "textarea",
  "option",
]);

const TEXT_TAGS = new Set([
  "a",
  "button",
  "label",
  "legend",
  "summary",
  "option",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "th",
  "td",
]);

const FIELD_ONLY_GROUP_TAGS = new Set([
  "a",
  "b",
  "button",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "input",
  "label",
  "option",
  "p",
  "picture",
  "select",
  "small",
  "span",
  "strong",
  "textarea",
]);

export function buildSelectorPlan(
  target: Element,
  options: BuildSelectorPlanOptions = {},
): SelectorPlanResult {
  const root = options.root ?? getDefaultRoot(target);
  const maxAncestorDepth = options.maxAncestorDepth ?? 8;
  const maxCandidates = options.maxCandidates ?? 50;
  const maxGroupCount = options.maxGroupCount ?? 200;
  const minGroupScore = options.minGroupScore ?? 50;
  const maxTextLength = options.maxTextLength ?? 80;

  if (!containsElement(root, target)) {
    return {
      mode: "none",
      best: null,
      selection: null,
      single: null,
      candidates: [],
      groups: [],
    };
  }

  const candidates: SelectorPlanCandidate[] = [];
  const groups: SelectorGroupCandidate[] = [];
  const seenPlans = new Set<string>();
  const seenGroups = new Set<string>();

  const addCandidate = (plan: SelectorPlan, reason: string) => {
    const signature = stringifyPlan(plan);
    if (seenPlans.has(signature)) return;
    seenPlans.add(signature);
    const matches = resolveSelectorPlan(plan, root);
    const sameTarget =
      matches.length === 1 && Boolean(matches[0]?.isSameNode(target));
    if (!sameTarget) return;
    const score = scorePlanForSelection(plan);
    const risks = getPlanRisks(plan);
    candidates.push({
      plan,
      score,
      matchCount: matches.length,
      confidence: getConfidence(score, risks),
      risks,
      reason,
    });
  };

  const addGroups = (newGroups: SelectorGroupCandidate[]) => {
    for (const group of newGroups) {
      const signature = [
        stringifyPlan(group.item),
        group.targetWithinItem ? stringifyPlan(group.targetWithinItem) : "",
      ].join("::");
      if (seenGroups.has(signature)) continue;
      seenGroups.add(signature);
      groups.push(group);
    }
  };

  for (const plan of uniqueDirectPlans(target, root, maxTextLength, true)) {
    addCandidate(plan, plan.reason);
  }

  const ancestors = getAncestors(target, root, maxAncestorDepth);
  const potentialGroupItems = [target, ...ancestors];

  potentialGroupItems.forEach((item, depth) => {
    addGroups(
      buildGroupCandidatesForItem(
        item,
        target,
        root,
        maxTextLength,
        maxGroupCount,
        depth,
      ),
    );
  });

  ancestors.forEach((ancestor, depth) => {
    const scopePlans = uniqueDirectPlans(ancestor, root, maxTextLength, true);
    if (scopePlans.length === 0) return;

    const targetPlans = uniqueDirectPlans(
      target,
      ancestor,
      maxTextLength,
      true,
    );

    for (const scope of scopePlans.slice(0, 8)) {
      for (const localTarget of targetPlans.slice(0, 8)) {
        const score = scoreCompositePlan(scope, localTarget, 8 + depth);
        addCandidate(
          {
            kind: "within",
            scope,
            target: localTarget,
            score,
            reason: `unique ${localTarget.reason} within ${scope.reason}`,
          },
          `unique ${localTarget.reason} within ${scope.reason}`,
        );
      }
    }
  });

  candidates.sort(compareCandidates);
  groups.sort((left, right) => right.score - left.score);

  const single = candidates[0] ?? null;
  const group = groups.find(
    (candidate) =>
      candidate.score >= minGroupScore && candidate.confidence !== "low",
  );
  const selection = selectBestPlan(single, group, target);

  return {
    mode: selection?.mode ?? "none",
    best: selection?.plan ?? null,
    selection,
    single,
    candidates: candidates.slice(0, maxCandidates),
    groups,
  };
}

export function resolveSelectorPlan(
  plan: SelectorPlan,
  root: SelectorRoot,
): Element[] {
  switch (plan.kind) {
    case "direct":
      return resolveDirectPlan(plan, root);
    case "within": {
      const scopes = resolveSelectorPlan(plan.scope, root);
      const results: Element[] = [];
      for (const scope of scopes) {
        results.push(...resolveSelectorPlan(plan.target, scope));
      }
      return uniqueElements(results);
    }
    case "has": {
      const bases = resolveSelectorPlan(plan.base, root);
      return bases.filter(
        (base) => resolveSelectorPlan(plan.has, base).length > 0,
      );
    }
  }
}

export function stringifyPlan(plan: SelectorPlan): string {
  switch (plan.kind) {
    case "direct":
      return `${plan.kind}:${plan.engine}:${plan.selector}`;
    case "within":
      return `within(${stringifyPlan(plan.scope)} => ${stringifyPlan(plan.target)})`;
    case "has":
      return `has(${stringifyPlan(plan.base)} ? ${stringifyPlan(plan.has)})`;
  }
}

function uniqueDirectPlans(
  target: Element,
  root: SelectorRoot,
  maxTextLength: number,
  includeStructural: boolean,
): DirectSelectorPlan[] {
  return generateDirectPlans(target, root, maxTextLength, includeStructural)
    .filter((plan) => {
      const matches = resolveDirectPlan(plan, root);
      return matches.length === 1 && Boolean(matches[0]?.isSameNode(target));
    })
    .sort((left, right) => right.score - left.score);
}

function generateDirectPlans(
  target: Element,
  root: SelectorRoot,
  maxTextLength: number,
  includeStructural: boolean,
): DirectSelectorPlan[] {
  const tagName = target.localName.toLowerCase();
  const plans: DirectSelectorPlan[] = [];
  const seen = new Set<string>();
  const add = (plan: DirectSelectorPlan) => {
    const signature = stringifyPlan(plan);
    if (seen.has(signature)) return;
    seen.add(signature);
    plans.push(plan);
  };

  const id = target.getAttribute("id");
  if (id) {
    const stable = isLikelyStableToken(id);
    add({
      kind: "direct",
      engine: "css",
      selector: `#${cssIdent(id)}`,
      score: stable ? 88 : 50,
      reason: stable ? "stable id" : "id",
    });
    add({
      kind: "direct",
      engine: "css",
      selector: `[id="${cssString(id)}"]`,
      score: stable ? 84 : 48,
      reason: stable ? "stable id attribute" : "id attribute",
    });
  }

  for (const attr of TEST_ATTRIBUTES) {
    const value = attrValue(target, attr);
    if (!value) continue;
    add({
      kind: "direct",
      engine: "css",
      selector: `[${attr}="${cssString(value)}"]`,
      score: 96,
      reason: `${attr} attribute`,
    });
    add({
      kind: "direct",
      engine: "css",
      selector: `${tagName}[${attr}="${cssString(value)}"]`,
      score: 94,
      reason: `${tagName} ${attr} attribute`,
    });
  }

  for (const attr of SEMANTIC_ATTRIBUTES) {
    const value = attrValue(target, attr);
    if (!value) continue;
    const baseScore = scoreAttribute(attr, value);
    add({
      kind: "direct",
      engine: "css",
      selector: `${tagName}[${attr}="${cssString(value)}"]`,
      score: baseScore,
      reason: `${tagName} ${attr} attribute`,
    });
    if (attr !== "type") {
      add({
        kind: "direct",
        engine: "css",
        selector: `[${attr}="${cssString(value)}"]`,
        score: baseScore - 2,
        reason: `${attr} attribute`,
      });
    }
  }

  for (const label of getLabels(target, maxTextLength)) {
    add({
      kind: "direct",
      engine: "label",
      selector: `label="${escapeSelectorDisplay(label)}"`,
      label,
      score: 86,
      reason: "associated label",
    });
  }

  const role = getElementRole(target);
  if (role) {
    const name = getAccessibleName(target, maxTextLength);
    if (name) {
      add({
        kind: "direct",
        engine: "role",
        selector: `role=${role}[name="${escapeSelectorDisplay(name)}"]`,
        role,
        name,
        score: 84,
        reason: "role and accessible name",
      });
    }
    add({
      kind: "direct",
      engine: "role",
      selector: `role=${role}`,
      role,
      score: 45,
      reason: "role",
    });
  }

  const text = getTextSelectorValue(target, maxTextLength);
  if (text && (TEXT_TAGS.has(tagName) || FORM_CONTROL_TAGS.has(tagName))) {
    add({
      kind: "direct",
      engine: "text",
      selector: `text="${escapeSelectorDisplay(text)}"`,
      text,
      score: 74,
      reason: "exact visible text",
    });
  }

  const classNames = getStableClassNames(target);
  for (const className of classNames.slice(0, 6)) {
    add({
      kind: "direct",
      engine: "css",
      selector: `.${cssIdent(className)}`,
      score: 54,
      reason: "stable class",
    });
    add({
      kind: "direct",
      engine: "css",
      selector: `${tagName}.${cssIdent(className)}`,
      score: 58,
      reason: `${tagName} stable class`,
    });
  }

  for (const combo of combinations(classNames.slice(0, 5), 2)) {
    add({
      kind: "direct",
      engine: "css",
      selector: combo.map((className) => `.${cssIdent(className)}`).join(""),
      score: 62,
      reason: "stable class combination",
    });
    add({
      kind: "direct",
      engine: "css",
      selector: `${tagName}${combo
        .map((className) => `.${cssIdent(className)}`)
        .join("")}`,
      score: 64,
      reason: `${tagName} stable class combination`,
    });
  }

  add({
    kind: "direct",
    engine: "css",
    selector: tagName,
    score: FORM_CONTROL_TAGS.has(tagName) ? 26 : 14,
    reason: `${tagName} tag`,
  });

  if (includeStructural) {
    const structural = buildStructuralCssSelector(target, root);
    if (structural) {
      add({
        kind: "direct",
        engine: "css",
        selector: structural,
        score: 8,
        reason: "structural css path",
      });
    }
  }

  return plans
    .map((plan) => ({
      ...plan,
      score: applyLengthPenalty(plan.score, plan.selector),
    }))
    .sort((left, right) => right.score - left.score);
}

function buildGroupCandidatesForItem(
  itemElement: Element,
  target: Element,
  root: SelectorRoot,
  maxTextLength: number,
  maxGroupCount: number,
  depth: number,
): SelectorGroupCandidate[] {
  if (!containsElement(itemElement, target)) return [];
  if (!isLikelyGroupItemElement(itemElement)) return [];

  const groupPlans = generateGroupPlans(itemElement, root)
    .filter((plan) => {
      const matches = resolveSelectorPlan(plan, root);
      return (
        matches.length > 1 &&
        matches.length <= maxGroupCount &&
        matches.some((match) => match.isSameNode(itemElement))
      );
    })
    .sort((left, right) => right.score - left.score);

  if (groupPlans.length === 0) return [];

  const targetIsItem = itemElement.isSameNode(target);
  const anchors = targetIsItem
    ? []
    : findAnchorPlans(itemElement, target, root, maxTextLength);

  return groupPlans.slice(0, 8).map((item) => {
    const itemMatches = resolveSelectorPlan(item, root);
    const targetWithinItem = targetIsItem
      ? undefined
      : getReusableTargetWithinItemPlan(
          target,
          itemElement,
          itemMatches,
          maxTextLength,
        );
    const targetWithinItemCoverage = targetWithinItem
      ? countItemsWithLocalMatch(itemMatches, targetWithinItem)
      : undefined;
    const groupScore = scoreGroupCandidate(
      item,
      itemElement,
      itemMatches,
      targetWithinItem,
      targetWithinItemCoverage,
      depth,
    );
    const anchor = anchors.find((candidate) => {
      const filtered = resolveSelectorPlan(
        {
          kind: "has",
          base: item,
          has: candidate,
          score: scoreCompositePlan(item, candidate, 10),
          reason: `${item.reason} containing ${candidate.reason}`,
        },
        root,
      );
      return filtered.length === 1 && filtered[0]?.isSameNode(itemElement);
    });
    const risks = getGroupRisks(item, itemElement);

    return {
      item,
      count: itemMatches.length,
      targetIsItem,
      targetWithinItem,
      targetWithinItemCoverage,
      anchor,
      score: groupScore,
      confidence: getConfidence(groupScore, risks),
      risks,
      reason:
        targetWithinItem && targetWithinItemCoverage
          ? `${targetWithinItem.reason} across ${item.reason}`
          : `${item.reason} repeated group`,
    };
  });
}

function generateGroupPlans(
  element: Element,
  root: SelectorRoot,
): SelectorPlan[] {
  const tagName = element.localName.toLowerCase();
  const plans: SelectorPlan[] = [];
  const seen = new Set<string>();
  const add = (plan: SelectorPlan) => {
    const signature = stringifyPlan(plan);
    if (seen.has(signature)) return;
    seen.add(signature);
    plans.push(plan);
  };

  for (const attr of GROUP_ATTRIBUTES) {
    const value = attrValue(element, attr);
    if (!value) continue;
    const attrScore = TEST_ATTRIBUTES.includes(attr) ? 92 : 78;
    add({
      kind: "direct",
      engine: "css",
      selector: `[${attr}="${cssString(value)}"]`,
      score: attrScore,
      reason: `${attr} repeated group`,
    });
    add({
      kind: "direct",
      engine: "css",
      selector: `${tagName}[${attr}="${cssString(value)}"]`,
      score: attrScore + 2,
      reason: `${tagName} ${attr} repeated group`,
    });
  }

  const role = getElementRole(element);
  if (role) {
    add({
      kind: "direct",
      engine: "css",
      selector: `[role="${cssString(role)}"]`,
      score: role === "listitem" || role === "row" ? 42 : 34,
      reason: `${role} role repeated group`,
    });
    add({
      kind: "direct",
      engine: "css",
      selector: `${tagName}[role="${cssString(role)}"]`,
      score: role === "listitem" || role === "row" ? 46 : 38,
      reason: `${tagName} ${role} role repeated group`,
    });
  }

  for (const className of getStableClassNames(element).slice(0, 6)) {
    add({
      kind: "direct",
      engine: "css",
      selector: `.${cssIdent(className)}`,
      score: 50,
      reason: "class repeated group",
    });
    add({
      kind: "direct",
      engine: "css",
      selector: `${tagName}.${cssIdent(className)}`,
      score: 54,
      reason: `${tagName} class repeated group`,
    });
  }

  const classNames = getStableClassNames(element).slice(0, 5);
  for (const combo of combinations(classNames, 2)) {
    add({
      kind: "direct",
      engine: "css",
      selector: `${tagName}${combo
        .map((className) => `.${cssIdent(className)}`)
        .join("")}`,
      score: 60,
      reason: `${tagName} class combination repeated group`,
    });
  }

  if (role) {
    for (const className of classNames.slice(0, 4)) {
      add({
        kind: "direct",
        engine: "css",
        selector: `${tagName}[role="${cssString(role)}"].${cssIdent(className)}`,
        score: 62,
        reason: `${tagName} role and class repeated group`,
      });
    }
  }

  add({
    kind: "direct",
    engine: "css",
    selector: tagName,
    score: tagName === "li" || tagName === "tr" ? 28 : 12,
    reason: `${tagName} repeated group`,
  });

  return plans.filter((plan) =>
    resolveSelectorPlan(plan, root).some((match) => match.isSameNode(element)),
  );
}

function findAnchorPlans(
  ancestor: Element,
  target: Element,
  root: SelectorRoot,
  maxTextLength: number,
): DirectSelectorPlan[] {
  const anchors: DirectSelectorPlan[] = [];
  const seen = new Set<string>();
  for (const element of allElements(ancestor)) {
    if (element.isSameNode(target) || target.contains(element)) continue;
    if (!isVisibleToSelector(element)) continue;
    for (const plan of uniqueDirectPlans(
      element,
      ancestor,
      maxTextLength,
      false,
    )) {
      const signature = stringifyPlan(plan);
      if (seen.has(signature)) continue;
      seen.add(signature);
      const filteredAncestor = resolveSelectorPlan(
        {
          kind: "has",
          base: {
            kind: "direct",
            engine: "css",
            selector: ancestor.localName.toLowerCase(),
            score: 10,
            reason: "ancestor tag",
          },
          has: plan,
          score: plan.score,
          reason: plan.reason,
        },
        root,
      ).filter((match) => match.isSameNode(ancestor));
      if (filteredAncestor.length > 0) {
        anchors.push(plan);
      }
    }
  }
  return anchors.sort((left, right) => right.score - left.score);
}

function getReusableTargetWithinItemPlan(
  target: Element,
  itemElement: Element,
  itemMatches: Element[],
  maxTextLength: number,
): SelectorPlan | undefined {
  const minCoverage = getMinimumTargetCoverage(itemMatches.length);
  return uniqueDirectPlans(target, itemElement, maxTextLength, false)
    .map((plan) => ({
      plan,
      coverage: countItemsWithLocalMatch(itemMatches, plan),
      risks: getPlanRisks(plan),
    }))
    .filter(({ coverage }) => coverage >= minCoverage)
    .filter(({ risks }) => !risks.includes("structural-path"))
    .sort((left, right) => {
      if (right.coverage !== left.coverage)
        return right.coverage - left.coverage;
      const leftScore = scorePlanForSelection(left.plan);
      const rightScore = scorePlanForSelection(right.plan);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return stringifyPlan(left.plan).length - stringifyPlan(right.plan).length;
    })[0]?.plan;
}

function countItemsWithLocalMatch(
  itemMatches: Element[],
  targetWithinItem: SelectorPlan,
): number {
  return itemMatches.filter(
    (item) => resolveSelectorPlan(targetWithinItem, item).length === 1,
  ).length;
}

function getMinimumTargetCoverage(itemCount: number): number {
  if (itemCount <= 2) return itemCount;
  return Math.max(2, Math.ceil(itemCount * 0.8));
}

function scoreGroupCandidate(
  itemPlan: SelectorPlan,
  itemElement: Element,
  itemMatches: Element[],
  targetWithinItem: SelectorPlan | undefined,
  targetWithinItemCoverage: number | undefined,
  depth: number,
): number {
  const targetCoverageRatio =
    targetWithinItemCoverage === undefined
      ? 1
      : targetWithinItemCoverage / itemMatches.length;
  const targetScore = targetWithinItem
    ? Math.min(16, scorePlanForSelection(targetWithinItem) / 5)
    : 8;
  const score =
    scorePlanForSelection(itemPlan) +
    scoreGroupHomogeneity(itemElement, itemMatches) +
    scoreGroupSignals(itemElement) +
    targetScore +
    Math.round(targetCoverageRatio * 12) -
    depth * 3;
  return Math.max(1, Math.min(100, score));
}

function scoreGroupHomogeneity(
  itemElement: Element,
  itemMatches: Element[],
): number {
  let score = 0;
  if (itemMatches.every((match) => match.localName === itemElement.localName)) {
    score += 8;
  }
  if (
    itemElement.parentElement &&
    itemMatches.every(
      (match) => match.parentElement === itemElement.parentElement,
    )
  ) {
    score += 10;
  }
  if (itemMatches.length >= 2 && itemMatches.length <= 50) {
    score += 8;
  } else if (itemMatches.length <= 100) {
    score += 4;
  }

  const sampleSignature = getChildStructureSignature(itemElement);
  const matchingStructureCount = itemMatches.filter(
    (match) => getChildStructureSignature(match) === sampleSignature,
  ).length;
  if (matchingStructureCount >= getMinimumTargetCoverage(itemMatches.length)) {
    score += 8;
  }

  return score;
}

function scoreGroupSignals(element: Element): number {
  let score = 0;
  const tagName = element.localName.toLowerCase();
  const role = getElementRole(element);
  if (tagName === "article" || tagName === "li" || tagName === "tr")
    score += 10;
  if (role === "listitem" || role === "row") score += 10;
  if (hasGroupAttribute(element)) score += 12;
  if (getStableClassNames(element).some(isCollectionClassName)) score += 10;
  if (element.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']")) {
    score += 6;
  }
  if (element.querySelector("img, picture")) score += 4;
  if (element.querySelector("a[href], button")) score += 4;
  return Math.min(score, 28);
}

function isLikelyGroupItemElement(element: Element): boolean {
  const tagName = element.localName.toLowerCase();
  if (FIELD_ONLY_GROUP_TAGS.has(tagName)) return false;
  return scoreGroupSignals(element) >= 10;
}

function hasGroupAttribute(element: Element): boolean {
  return GROUP_ATTRIBUTES.some((attr) => Boolean(attrValue(element, attr)));
}

function isCollectionClassName(className: string): boolean {
  return /(^|[-_])(card|cell|entry|item|listing|product|result|row|tile)([-_]|$)/i.test(
    className,
  );
}

function getChildStructureSignature(element: Element): string {
  return Array.from(element.children)
    .slice(0, 8)
    .map((child) => {
      const tagName = child.localName.toLowerCase();
      const role = getElementRole(child);
      return role ? `${tagName}[${role}]` : tagName;
    })
    .join(">");
}

function selectBestPlan(
  single: SelectorPlanCandidate | null,
  group: SelectorGroupCandidate | undefined,
  target: Element,
): SelectorPlanSelection | null {
  if (single && group && shouldPreferSingleSelection(single, group, target)) {
    return buildSingleSelection(single);
  }

  if (group) {
    return {
      mode: "group",
      plan: group.item,
      groupPlan: group.item,
      itemCount: group.count,
      targetWithinItem: group.targetWithinItem,
      targetWithinItemCoverage: group.targetWithinItemCoverage,
      score: group.score,
      confidence: group.confidence,
      risks: group.risks,
      reason: group.reason,
    };
  }

  if (!single) return null;
  return buildSingleSelection(single);
}

function buildSingleSelection(
  single: SelectorPlanCandidate,
): SelectorPlanSelection {
  return {
    mode: "single",
    plan: single.plan,
    score: single.score,
    matchCount: 1,
    confidence: single.confidence,
    risks: single.risks,
    reason: single.reason,
  };
}

function shouldPreferSingleSelection(
  single: SelectorPlanCandidate,
  group: SelectorGroupCandidate,
  target: Element,
): boolean {
  if (single.confidence === "low") return false;
  if (isActionTarget(target) && single.score >= 45) return true;
  if (hasDurableSinglePlan(single.plan) && single.score >= 70) return true;
  return single.confidence === "high" && single.score >= group.score + 10;
}

function isActionTarget(element: Element): boolean {
  const tagName = element.localName.toLowerCase();
  if (tagName === "a" && element.hasAttribute("href")) return true;
  if (FORM_CONTROL_TAGS.has(tagName)) return true;
  const role = getElementRole(element);
  return Boolean(
    role &&
      [
        "button",
        "checkbox",
        "combobox",
        "link",
        "radio",
        "searchbox",
        "slider",
        "spinbutton",
        "textbox",
      ].includes(role),
  );
}

function hasDurableSinglePlan(plan: SelectorPlan): boolean {
  switch (plan.kind) {
    case "direct":
      return (
        plan.reason.includes("stable id") ||
        TEST_ATTRIBUTES.some((attr) => plan.selector.includes(`[${attr}=`)) ||
        plan.reason === "associated label"
      );
    case "within":
      return (
        hasDurableSinglePlan(plan.target) || hasDurableSinglePlan(plan.scope)
      );
    case "has":
      return hasDurableSinglePlan(plan.base) || hasDurableSinglePlan(plan.has);
  }
}

function resolveDirectPlan(
  plan: DirectSelectorPlan,
  root: SelectorRoot,
): Element[] {
  switch (plan.engine) {
    case "css":
      return queryCss(root, plan.selector);
    case "text":
      return smallestTextMatches(root, plan.text);
    case "role":
      return allElements(root).filter((element) => {
        if (getElementRole(element) !== plan.role) return false;
        if (plan.name === undefined) return true;
        return (
          normalizeWhitespace(getAccessibleName(element) ?? "") === plan.name
        );
      });
    case "label":
      return formControlsByLabel(root, plan.label);
  }
}

function queryCss(root: SelectorRoot, selector: string): Element[] {
  try {
    const matches = Array.from(root.querySelectorAll(selector));
    if (isElement(root) && !selector.trim().startsWith(":scope")) {
      try {
        if (root.matches(selector)) {
          return uniqueElements([root, ...matches]);
        }
      } catch {
        return matches;
      }
    }
    return matches;
  } catch {
    return [];
  }
}

function smallestTextMatches(root: SelectorRoot, text: string): Element[] {
  const matches = allElements(root).filter(
    (element) => getTextSelectorValue(element) === text,
  );
  return matches.filter(
    (element) =>
      !Array.from(element.children).some(
        (child) => getTextSelectorValue(child) === text,
      ),
  );
}

function formControlsByLabel(root: SelectorRoot, labelText: string): Element[] {
  const labels = allElements(root).filter(
    (element) =>
      element.localName.toLowerCase() === "label" &&
      normalizeWhitespace(element.textContent ?? "") === labelText,
  );
  const controls: Element[] = [];
  for (const label of labels) {
    const htmlLabel = label as HTMLLabelElement;
    if (htmlLabel.control) {
      controls.push(htmlLabel.control);
      continue;
    }
    const nested = label.querySelector("input, select, textarea, button");
    if (nested) controls.push(nested);
  }
  return uniqueElements(controls);
}

function getDefaultRoot(target: Element): SelectorRoot {
  const root = target.getRootNode();
  if (
    root.nodeType === Node.DOCUMENT_NODE ||
    root.nodeType === Node.DOCUMENT_FRAGMENT_NODE
  ) {
    return root as SelectorRoot;
  }
  return target.ownerDocument;
}

function containsElement(root: SelectorRoot, element: Element): boolean {
  if (root === element) return true;
  return Boolean("contains" in root && root.contains(element));
}

function allElements(root: SelectorRoot): Element[] {
  const elements = Array.from(root.querySelectorAll("*"));
  return isElement(root) ? [root, ...elements] : elements;
}

function getAncestors(
  target: Element,
  root: SelectorRoot,
  maxDepth: number,
): Element[] {
  const ancestors: Element[] = [];
  let current = target.parentElement;
  while (current && ancestors.length < maxDepth) {
    if (current.localName === "html" || current.localName === "body") break;
    if (!containsElement(root, current)) break;
    ancestors.push(current);
    current = current.parentElement;
  }
  return ancestors;
}

function getLabels(target: Element, maxTextLength = 80): string[] {
  const labels: string[] = [];
  const control = target as
    | HTMLInputElement
    | HTMLSelectElement
    | HTMLTextAreaElement;
  const labelList = "labels" in control ? control.labels : null;
  if (labelList) {
    for (const label of Array.from(labelList)) {
      const text = normalizeWhitespace(label.textContent ?? "");
      if (isUsableText(text, maxTextLength)) labels.push(text);
    }
  }
  const labelledBy = target.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/).filter(Boolean)) {
      const label = target.ownerDocument.getElementById(id);
      const text = normalizeWhitespace(label?.textContent ?? "");
      if (isUsableText(text, maxTextLength)) labels.push(text);
    }
  }
  return [...new Set(labels)];
}

function getAccessibleName(
  element: Element,
  maxTextLength = 80,
): string | null {
  const ariaLabel = normalizeWhitespace(
    element.getAttribute("aria-label") ?? "",
  );
  if (isUsableText(ariaLabel, maxTextLength)) return ariaLabel;

  const labels = getLabels(element, maxTextLength);
  if (labels[0]) return labels[0];

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ");
    const normalized = normalizeWhitespace(text);
    if (isUsableText(normalized, maxTextLength)) return normalized;
  }

  for (const attr of ["alt", "placeholder", "title"]) {
    const value = normalizeWhitespace(element.getAttribute(attr) ?? "");
    if (isUsableText(value, maxTextLength)) return value;
  }

  const text = getTextSelectorValue(element, maxTextLength);
  return text || null;
}

function getTextSelectorValue(
  element: Element,
  maxTextLength = 80,
): string | null {
  if (!isVisibleToSelector(element)) return null;
  const text = normalizeWhitespace(element.textContent ?? "");
  if (!isUsableText(text, maxTextLength)) return null;
  return text;
}

function getElementRole(element: Element): string | null {
  const explicitRole = element.getAttribute("role")?.trim().split(/\s+/)[0];
  if (
    explicitRole &&
    explicitRole !== "presentation" &&
    explicitRole !== "none"
  ) {
    return explicitRole;
  }

  const tag = element.localName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "button") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "img") return "img";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "li") return "listitem";
  if (tag === "table") return "table";
  if (tag === "tr") return "row";
  if (tag === "th") return "columnheader";
  if (tag === "td") return "cell";
  if (tag === "nav") return "navigation";
  if (tag === "main") return "main";
  if (tag === "form" && getAccessibleName(element)) return "form";
  if (tag !== "input") return null;

  const type = (element.getAttribute("type") ?? "text").toLowerCase();
  switch (type) {
    case "button":
    case "submit":
    case "reset":
      return "button";
    case "checkbox":
      return "checkbox";
    case "radio":
      return "radio";
    case "range":
      return "slider";
    case "number":
      return "spinbutton";
    case "search":
      return "searchbox";
    case "hidden":
      return null;
    default:
      return "textbox";
  }
}

function isVisibleToSelector(element: Element): boolean {
  if (element.hasAttribute("hidden")) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  const style = element.getAttribute("style") ?? "";
  return !/(^|;)\s*(display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style);
}

function attrValue(element: Element, attr: string): string | null {
  const value = element.getAttribute(attr);
  if (!value) return null;
  const normalized = normalizeWhitespace(value);
  if (!normalized || normalized.length > 140) return null;
  return normalized;
}

function scoreAttribute(attr: string, value: string): number {
  switch (attr) {
    case "aria-label":
      return 86;
    case "name":
      return isLikelyStableToken(value) ? 84 : 62;
    case "placeholder":
      return 76;
    case "alt":
      return 82;
    case "href":
      return 72;
    case "title":
      return 68;
    case "type":
      return 38;
    default:
      return 60;
  }
}

function getStableClassNames(element: Element): string[] {
  return Array.from(element.classList).filter(isLikelyStableClassName);
}

function isLikelyStableClassName(className: string): boolean {
  if (isLikelyGeneratedClassName(className)) return false;
  if (!isLikelyStableToken(className)) return false;
  if (
    /^(active|selected|open|closed|disabled|enabled|focus|hover)$/i.test(
      className,
    )
  ) {
    return false;
  }
  if (/^(mt|mb|ml|mr|pt|pb|pl|pr|px|py|mx|my|w|h|text|bg)-/i.test(className)) {
    return false;
  }
  if (
    /^(a-)?(color|section|size|spacing|text)-/i.test(className) ||
    /^(a-link-normal|celwidget|headline|truncate-\d*line)$/i.test(className)
  ) {
    return false;
  }
  return true;
}

function isLikelyGeneratedClassName(className: string): boolean {
  if (/^_[A-Za-z0-9]+_[A-Za-z0-9]+_\d+$/.test(className)) return true;
  if (/^[A-Za-z]+__[A-Za-z0-9_-]*__[A-Za-z0-9_-]+$/.test(className)) {
    return true;
  }
  if (/[A-Za-z]{2,}_[A-Za-z0-9]{5,}_\d+$/.test(className)) return true;
  if (
    /^[a-z][a-z0-9_]{2,}-[A-Za-z0-9]{4,}$/.test(className) &&
    /[A-Z0-9]/.test(className.split("-").at(-1) ?? "")
  ) {
    return true;
  }
  return false;
}

function isLikelyStableToken(value: string): boolean {
  const token = value.trim();
  if (token.length < 2 || token.length > 80) return false;
  if (/^\d+$/.test(token)) return false;
  if (/[0-9a-f]{8,}/i.test(token)) return false;
  if (/[0-9]{4,}/.test(token)) return false;
  if (/^[a-z]{1,3}-[A-Za-z0-9_-]{8,}$/.test(token) && /[A-Z0-9]/.test(token)) {
    return false;
  }
  if (
    /^[0-9a-f]{4,}-[0-9a-f]{4,}-[0-9a-f-]{8,}$/i.test(token) ||
    /^[A-Za-z0-9_-]{20,}$/.test(token)
  ) {
    return false;
  }
  return /[A-Za-z]/.test(token);
}

function buildStructuralCssSelector(
  target: Element,
  root: SelectorRoot,
): string | null {
  const parts: string[] = [];
  let current: Element | null = target;

  while (current) {
    if (isElement(root) && current.isSameNode(root)) {
      return parts.length > 0 ? `:scope > ${parts.join(" > ")}` : ":scope";
    }

    const parent = current.parentElement;
    const part = structuralPart(current);
    parts.unshift(part);

    if (!parent) {
      if (!isElement(root)) return parts.join(" > ");
      return null;
    }
    current = parent;
  }

  return null;
}

function structuralPart(element: Element): string {
  const tag = element.localName.toLowerCase();
  const parent = element.parentElement;
  if (!parent) return tag;
  const sameTagSiblings = Array.from(parent.children).filter(
    (sibling) => sibling.localName.toLowerCase() === tag,
  );
  if (sameTagSiblings.length <= 1) return tag;
  const index = sameTagSiblings.findIndex((sibling) =>
    sibling.isSameNode(element),
  );
  return `${tag}:nth-of-type(${index + 1})`;
}

function scoreCompositePlan(
  left: SelectorPlan,
  right: SelectorPlan,
  penalty: number,
): number {
  return Math.max(1, Math.min(left.score, right.score) - penalty);
}

function scorePlanForSelection(plan: SelectorPlan): number {
  const risks = getPlanRisks(plan);
  let score = plan.score;
  for (const risk of risks) {
    switch (risk) {
      case "structural-path":
        score -= 30;
        break;
      case "nth-of-type":
        score -= 20;
        break;
      case "generated-class":
        score -= 18;
        break;
      case "generic-tag":
        score -= 12;
        break;
      case "weak-class":
        score -= 8;
        break;
      case "long-selector":
        score -= 6;
        break;
      case "content-specific":
        score -= 4;
        break;
    }
  }
  return Math.max(1, score);
}

function getPlanRisks(plan: SelectorPlan): SelectorPlanRisk[] {
  switch (plan.kind) {
    case "direct":
      return getDirectPlanRisks(plan);
    case "within":
      return uniqueRisks([
        ...getPlanRisks(plan.scope),
        ...getPlanRisks(plan.target),
      ]);
    case "has":
      return uniqueRisks([
        ...getPlanRisks(plan.base),
        ...getPlanRisks(plan.has),
      ]);
  }
}

function getDirectPlanRisks(plan: DirectSelectorPlan): SelectorPlanRisk[] {
  const risks: SelectorPlanRisk[] = [];
  if (plan.reason.includes("structural")) risks.push("structural-path");
  if (plan.selector.includes("nth-of-type")) risks.push("nth-of-type");
  if (plan.selector.length > 120) risks.push("long-selector");
  if (plan.engine === "text" || plan.reason.includes("accessible name")) {
    risks.push("content-specific");
  }
  if (plan.engine === "css") {
    if (/\[(alt|aria-label|href|title)=/.test(plan.selector)) {
      risks.push("content-specific");
    }
    if (/^([a-z]+|\*)$/i.test(plan.selector)) risks.push("generic-tag");
    for (const className of extractClassNames(plan.selector)) {
      if (isLikelyGeneratedClassName(className)) {
        risks.push("generated-class");
      } else if (!isCollectionClassName(className)) {
        risks.push("weak-class");
      }
    }
  }
  return uniqueRisks(risks);
}

function getGroupRisks(
  itemPlan: SelectorPlan,
  itemElement: Element,
): SelectorPlanRisk[] {
  const risks = getPlanRisks(itemPlan);
  const selector = itemPlan.kind === "direct" ? itemPlan.selector : "";
  if (
    itemPlan.kind === "direct" &&
    itemPlan.engine === "css" &&
    selector === itemElement.localName.toLowerCase()
  ) {
    risks.push("generic-tag");
  }
  return uniqueRisks(risks);
}

function getConfidence(
  score: number,
  risks: SelectorPlanRisk[],
): SelectorPlanConfidence {
  if (
    risks.includes("structural-path") ||
    risks.includes("nth-of-type") ||
    risks.includes("generated-class") ||
    risks.includes("generic-tag")
  ) {
    return "low";
  }
  if (risks.includes("weak-class")) {
    return score >= 45 ? "medium" : "low";
  }
  if (
    score >= 75 &&
    !risks.includes("content-specific") &&
    risks.length === 0
  ) {
    return "high";
  }
  if (score >= 45) return "medium";
  return "low";
}

function applyLengthPenalty(score: number, selector: string): number {
  return Math.max(1, score - Math.min(8, selector.length / 80));
}

function compareCandidates(
  left: SelectorPlanCandidate,
  right: SelectorPlanCandidate,
): number {
  if (right.score !== left.score) return right.score - left.score;
  return stringifyPlan(left.plan).length - stringifyPlan(right.plan).length;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isUsableText(value: string, maxLength: number): boolean {
  if (!value) return false;
  if (value.length > maxLength) return false;
  if (/^[^\p{L}\p{N}]+$/u.test(value)) return false;
  return true;
}

function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function cssIdent(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value
    .split("")
    .map((char, index) => {
      if (/[_a-zA-Z0-9-]/.test(char)) {
        if (index === 0 && /[0-9-]/.test(char)) {
          return `\\${char}`;
        }
        return char;
      }
      return `\\${char.charCodeAt(0).toString(16)} `;
    })
    .join("");
}

function escapeSelectorDisplay(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function combinations<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [[]];
  if (items.length < size) return [];
  const result: T[][] = [];
  for (let i = 0; i <= items.length - size; i += 1) {
    for (const tail of combinations(items.slice(i + 1), size - 1)) {
      result.push([items[i]!, ...tail]);
    }
  }
  return result;
}

function extractClassNames(selector: string): string[] {
  const classNames: string[] = [];
  const classPattern = /\.((?:\\.|[\w-])+)/g;
  let match = classPattern.exec(selector);
  while (match) {
    classNames.push(match[1]!.replace(/\\/g, ""));
    match = classPattern.exec(selector);
  }
  return classNames;
}

function uniqueRisks(risks: SelectorPlanRisk[]): SelectorPlanRisk[] {
  return [...new Set(risks)];
}

function uniqueElements(elements: Element[]): Element[] {
  const result: Element[] = [];
  for (const element of elements) {
    if (!result.some((existing) => existing.isSameNode(element))) {
      result.push(element);
    }
  }
  return result;
}

function isElement(value: unknown): value is Element {
  return Boolean(value && (value as Element).nodeType === Node.ELEMENT_NODE);
}
