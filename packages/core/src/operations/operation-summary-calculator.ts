import type { UsageEvent } from '../types/usage-event.js';
import type { OperationRecord } from '../storage/storage-adapter.js';
import type { OperationSummary } from './operation-summary.js';
import type { TokenUsage } from '../types/usage.js';
import type { EstimatedCost, ReportedCost } from '../types/cost.js';
/**
 * Collects an operation and all its descendants.
 */
function collectOperationTree(
  rootOperationId: string,
  operations: OperationRecord[],
): { operationIds: Set<string>; directChildCount: number } {
  const childrenByParent = new Map<string, OperationRecord[]>();

  for (const operation of operations) {
    if (!operation.parentOperationId) {
      continue;
    }

    const children = childrenByParent.get(operation.parentOperationId) ?? [];

    children.push(operation);
    childrenByParent.set(operation.parentOperationId, children);
  }

  const operationIds = new Set<string>([rootOperationId]);
  const directChildCount = childrenByParent.get(rootOperationId)?.length ?? 0;
  const pendingIds = [rootOperationId];

  while (pendingIds.length > 0) {
    const parentId = pendingIds.shift()!;
    const children = childrenByParent.get(parentId) ?? [];

    for (const child of children) {
      if (!operationIds.has(child.id)) {
        operationIds.add(child.id);
        pendingIds.push(child.id);
      }
    }
  }

  return { operationIds, directChildCount };
}

/**
 * Adds a token field only when every event has a known value.
 * Missing values remain unknown rather than being treated as zero.
 */
function sumTokenField(
  events: UsageEvent[],
  getValue: (event: UsageEvent) => number | undefined,
): number | undefined {
  if (events.length === 0) {
    return undefined;
  }

  let total = 0;

  for (const event of events) {
    const value = getValue(event);

    if (value === undefined) {
      return undefined;
    }

    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`Invalid token count: ${value}`);
    }

    total += value;
  }

  if (!Number.isSafeInteger(total)) {
    throw new Error('Aggregated token count exceeds the maximum safe integer.');
  }

  return total;
}

/**
 * Aggregates token usage across all included usage events.
 */
function aggregateTokenUsage(events: UsageEvent[]): TokenUsage {
  const inputTokens = sumTokenField(events, (event) => event.usage.inputTokens);
  const outputTokens = sumTokenField(events, (event) => event.usage.outputTokens);
  const totalTokens = sumTokenField(events, (event) => event.usage.totalTokens);

  const cachedTokens = sumTokenField(
    events,
    (event) => event.usage.inputTokenDetails?.cachedTokens,
  );

  const cacheWriteTokens = sumTokenField(
    events,
    (event) => event.usage.inputTokenDetails?.cacheWriteTokens,
  );

  const reasoningTokens = sumTokenField(
    events,
    (event) => event.usage.outputTokenDetails?.reasoningTokens,
  );

  const inputTokenDetails =
    cachedTokens !== undefined || cacheWriteTokens !== undefined
      ? {
          ...(cachedTokens !== undefined && { cachedTokens }),
          ...(cacheWriteTokens !== undefined && { cacheWriteTokens }),
        }
      : undefined;

  const outputTokenDetails = reasoningTokens !== undefined ? { reasoningTokens } : undefined;

  return {
    ...(inputTokens !== undefined && { inputTokens }),
    ...(outputTokens !== undefined && { outputTokens }),
    ...(totalTokens !== undefined && { totalTokens }),
    ...(inputTokenDetails && { inputTokenDetails }),
    ...(outputTokenDetails && { outputTokenDetails }),
  };
}

interface Decimal {
  coefficient: bigint;
  scale: number;
}

/**
 * Parses a non-negative decimal string.
 */
function parseDecimal(value: string): Decimal {
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(value)) {
    throw new Error(`Invalid monetary amount: ${value}`);
  }

  const [integerPart, fractionPart = ''] = value.split('.');

  return {
    coefficient: BigInt(`${integerPart}${fractionPart}`),
    scale: fractionPart.length,
  };
}

/**
 * Adds two decimal values without floating-point arithmetic.
 */
function addDecimals(left: Decimal, right: Decimal): Decimal {
  const scale = Math.max(left.scale, right.scale);

  const leftCoefficient = left.coefficient * 10n ** BigInt(scale - left.scale);

  const rightCoefficient = right.coefficient * 10n ** BigInt(scale - right.scale);

  return {
    coefficient: leftCoefficient + rightCoefficient,
    scale,
  };
}

/**
 * Converts a decimal value back into a normalized string.
 */
function formatDecimal(decimal: Decimal): string {
  if (decimal.scale === 0) {
    return decimal.coefficient.toString();
  }

  const digits = decimal.coefficient.toString().padStart(decimal.scale + 1, '0');

  const integerPart = digits.slice(0, -decimal.scale);
  const fractionPart = digits.slice(-decimal.scale).replace(/0+$/, '');

  return fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
}

/**
 * Aggregates estimated costs by currency and pricing version.
 */
function aggregateEstimatedCosts(events: UsageEvent[]): EstimatedCost[] {
  const totals = new Map<string, { cost: EstimatedCost; decimal: Decimal }>();

  for (const event of events) {
    const cost = event.cost?.estimatedCost;

    if (!cost) {
      continue;
    }

    const key = JSON.stringify([cost.currency, cost.pricingVersion]);
    const existing = totals.get(key);

    if (existing) {
      existing.decimal = addDecimals(existing.decimal, parseDecimal(cost.amount));
      existing.cost.amount = formatDecimal(existing.decimal);
    } else {
      const decimal = parseDecimal(cost.amount);

      totals.set(key, {
        cost: {
          ...cost,
          amount: formatDecimal(decimal),
        },
        decimal,
      });
    }
  }

  return Array.from(totals.values(), (item) => item.cost);
}

/**
 * Aggregates reported costs by currency and source.
 */
function aggregateReportedCosts(events: UsageEvent[]): ReportedCost[] {
  const totals = new Map<string, { cost: ReportedCost; decimal: Decimal }>();

  for (const event of events) {
    const cost = event.cost?.reportedCost;

    if (!cost) {
      continue;
    }

    const key = JSON.stringify([cost.currency, cost.source]);
    const existing = totals.get(key);

    if (existing) {
      existing.decimal = addDecimals(existing.decimal, parseDecimal(cost.amount));
      existing.cost.amount = formatDecimal(existing.decimal);
    } else {
      const decimal = parseDecimal(cost.amount);

      totals.set(key, {
        cost: {
          ...cost,
          amount: formatDecimal(decimal),
        },
        decimal,
      });
    }
  }

  return Array.from(totals.values(), (item) => item.cost);
}

/**
 * Calculates an operation summary dynamically from stored operations and usage events.
 *
 * Includes usage from the requested operation and all its descendants.
 */
export function calculateOperationSummary(
  operation: OperationRecord,
  operations: OperationRecord[],
  usageEvents: UsageEvent[],
): OperationSummary {
  const { operationIds, directChildCount } = collectOperationTree(operation.id, operations);

  const includedEvents = usageEvents.filter(
    (event) => event.operationId !== undefined && operationIds.has(event.operationId),
  );

  let durationMs: number | undefined;

  if (operation.completedAt) {
    const startTime = Date.parse(operation.startedAt);
    const endTime = Date.parse(operation.completedAt);

    if (Number.isFinite(startTime) && Number.isFinite(endTime) && endTime >= startTime) {
      durationMs = endTime - startTime;
    }
  }

  return {
    operationId: operation.id,
    name: operation.name,
    status: operation.status,
    startedAt: operation.startedAt,
    ...(operation.completedAt && { completedAt: operation.completedAt }),
    ...(durationMs !== undefined && { durationMs }),
    usage: aggregateTokenUsage(includedEvents),
    usageEventCount: includedEvents.length,
    childOperationCount: directChildCount,
    estimatedCosts: aggregateEstimatedCosts(includedEvents),
    reportedCosts: aggregateReportedCosts(includedEvents),
  };
}
