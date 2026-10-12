import raw from "./content/catalog.json";
import { parseCatalog } from "./validation";
import type { ProductionItem, ProgressData } from "./types";
export const catalog = parseCatalog(raw);
export const publishedCatalog = {
  ...catalog,
  cards: catalog.cards.filter((x) => x.review.status !== "draft"),
  keigoDrills: catalog.keigoDrills.filter((x) => x.review.status !== "draft"),
  diagnostic: catalog.diagnostic.filter((x) => x.review.status !== "draft"),
  passages: catalog.passages.filter((x) => x.review.status !== "draft"),
  scenarios: catalog.scenarios.filter((x) => x.review.status !== "draft"),
};
export function allCards(data: ProgressData): ProductionItem[] {
  const current = [
    ...publishedCatalog.cards,
    ...publishedCatalog.keigoDrills,
    ...data.userCards,
  ];
  const ids = new Set(current.map((x) => x.id));
  for (const snapshot of Object.values(data.snapshots)) {
    if (
      "kind" in snapshot &&
      snapshot.kind !== "diagnostic" &&
      !ids.has(snapshot.id)
    ) {
      current.push({ ...snapshot, retired: true });
      ids.add(snapshot.id);
    }
  }
  return current;
}
export function findCard(data: ProgressData, id: string) {
  return allCards(data).find((x) => x.id === id);
}
