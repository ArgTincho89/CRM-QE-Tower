export const COLLAPSED_CARD_LIMIT = 3;

export function getColumnVisibility(cards, isExpanded) {
  return {
    visibleCards: isExpanded ? cards : cards.slice(0, COLLAPSED_CARD_LIMIT),
    hiddenCount: Math.max(0, cards.length - COLLAPSED_CARD_LIMIT),
    canToggle: cards.length > COLLAPSED_CARD_LIMIT,
  };
}

export function toggleColumnExpanded(expandedColumns, stageId) {
  return { ...expandedColumns, [stageId]: !expandedColumns[stageId] };
}

export function moveOpportunityToStage(list, id, stageId) {
  const index = list.findIndex((item) => item.id === id);
  if (index === -1 || list[index].stage === stageId) return list;
  return list.map((item, itemIndex) => itemIndex === index ? { ...item, stage: stageId } : item);
}
