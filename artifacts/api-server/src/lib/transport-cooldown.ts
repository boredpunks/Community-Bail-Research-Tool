import { and, desc, eq, gt, inArray, or } from "drizzle-orm";
import { db, discoveryRequestsTable, discoverySourceTable } from "@workspace/db";
import {
  isTransportCooldownBlock, transportCooldownDeadline, transportOutcomesForBlock,
} from "./discovery-safety";

type QueryStore = Pick<typeof db, "select">;
type Source = Pick<typeof discoverySourceTable.$inferSelect, "blockedReason" | "pausedUntil"> | undefined;

/** Return recent quota/penalty history plus the latest matching legacy stop. */
export async function transportCooldownHistory(
  store: QueryStore,
  source: Source,
  now = new Date(),
) {
  if (!isTransportCooldownBlock(source?.blockedReason)) return [];
  const [recent, latestMatching] = await Promise.all([
    store.select().from(discoveryRequestsTable).where(and(
      eq(discoveryRequestsTable.sourceId, "UJS"),
      or(gt(discoveryRequestsTable.startedAt, new Date(now.getTime() - 86_400_000)),
        eq(discoveryRequestsTable.outcome, "IN_FLIGHT")),
    )),
    transportOutcomesForBlock(source?.blockedReason).length
      ? store.select().from(discoveryRequestsTable).where(and(
        eq(discoveryRequestsTable.sourceId, "UJS"),
        inArray(discoveryRequestsTable.outcome, [...transportOutcomesForBlock(source?.blockedReason)]),
        )).orderBy(desc(discoveryRequestsTable.startedAt)).limit(1)
      : Promise.resolve([]),
  ]);
  const latest = latestMatching[0];
  const rows = latest && !recent.some(row => row.id === latest.id) ? [...recent, latest] : recent;
  return rows;
}

export async function sourceTransportCooldownUntil(
  store: QueryStore,
  source: Source,
  now = new Date(),
) {
  const history = await transportCooldownHistory(store, source, now);
  return transportCooldownDeadline(source?.blockedReason, source?.pausedUntil, history);
}
