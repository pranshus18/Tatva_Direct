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

export function hasUpstreamProjectCartLines(project) {
  if (!project || typeof project !== 'object') return false;

  const selectedMine =
    project.selectedMine && typeof project.selectedMine === 'object' ? project.selectedMine : {};
  if (Object.values(selectedMine).some((qty) => Number(qty) > 0)) return true;

  const items = Array.isArray(project.items) ? project.items : [];
  return items.some((item) => {
    const mineId = String(item?.mineSupplierProductId || item?.mineId || '').trim();
    const qty = Number(item?.quantity);
    return mineId && Number.isFinite(qty) && qty > 0;
  });
}

export function countSupplierUpstreamCartLines(project) {
  if (!hasUpstreamProjectCartLines(project)) return 0;

  const items = Array.isArray(project?.items) ? project.items : [];
  if (items.length > 0) {
    return items.filter((item) => {
      const mineId = String(item?.mineSupplierProductId || item?.mineId || '').trim();
      const qty = Number(item?.quantity);
      return mineId && Number.isFinite(qty) && qty > 0;
    }).length;
  }

  const selectedMine =
    project?.selectedMine && typeof project.selectedMine === 'object' ? project.selectedMine : {};
  return Object.values(selectedMine).filter((qty) => Number(qty) > 0).length;
}

export function countSupplierUpstreamCartDraft(draft) {
  if (!draft || typeof draft !== 'object') return 0;

  const projects = Array.isArray(draft.projects) ? draft.projects : [];
  if (projects.length > 0) {
    return projects.reduce((sum, project) => sum + countSupplierUpstreamCartLines(project), 0);
  }

  return countSupplierUpstreamCartLines({ selectedMine: draft.selectedMine, items: draft.items });
}
