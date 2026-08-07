// Entity creation routes through blank shared information modals.
function openCreateModal(entityType = 'space', prefillName = '', prefillFac = '', returnInfoContext = null) {
  const type = String(entityType || 'space').toLowerCase();
  const facility = String(prefillFac || db.facilities[0]?._facility || '').trim();
  if (type === 'document') {
    const rowName = String(prefillName || facility || '').trim();
    openNewDocumentInfoModal('Facility', rowName, facility, returnInfoContext);
    return;
  }
  openNewEntityInfoModal(type, prefillName, facility, returnInfoContext);
}
