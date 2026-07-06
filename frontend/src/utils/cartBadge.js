/** Cart badge counts — kept in sync with the Cart page line-item logic. */

export function getServiceProviderCartGroups(draft) {
  if (!draft || typeof draft !== 'object') return [];

  if (Array.isArray(draft.boqGroups)) {
    return draft.boqGroups.filter(
      (group) => Array.isArray(group?.items) && group.items.length > 0
    );
  }

  if (Array.isArray(draft.items) && draft.items.length > 0) {
    return [
      {
        groupId: 'legacy-cart',
        boqName: 'Cart Items',
        items: draft.items
      }
    ];
  }

  return [];
}

/** Number of cart lines (matches Cart page `allItems.length`). */
export function countServiceProviderCartDraft(draft) {
  return getServiceProviderCartGroups(draft).reduce((sum, group) => {
    const items = Array.isArray(group?.items) ? group.items : [];
    return (
      sum +
      items.filter((item) => {
        const qty = Number(item?.quantity);
        return !Number.isFinite(qty) || qty > 0;
      }).length
    );
  }, 0);
}

export function countSupplierUpstreamCartDraft(draft) {
  if (!draft || typeof draft !== 'object') return 0;

  const countSelectedMine = (selectedMine) => {
    const map = selectedMine && typeof selectedMine === 'object' ? selectedMine : {};
    return Object.values(map).filter((qty) => Number(qty) > 0).length;
  };

  const projects = Array.isArray(draft.projects) ? draft.projects : [];
  if (projects.length > 0) {
    return projects.reduce(
      (sum, project) => sum + countSelectedMine(project?.selectedMine),
      0
    );
  }

  return countSelectedMine(draft.selectedMine);
}
