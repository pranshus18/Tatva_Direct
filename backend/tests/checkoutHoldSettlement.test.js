import test from 'node:test';
import assert from 'node:assert/strict';

function checkoutHoldReleaseMovementNote(reservationId) {
  return `Checkout hold released:${reservationId}`;
}

function computeRestockQuantity(row) {
  const reservedQty = Number(row?.reserved_quantity);
  return Number.isFinite(reservedQty) && reservedQty > 0 ? reservedQty : 0;
}

test('restock on hold release restores exactly reserved_quantity', () => {
  const row = {
    id: 'res-1',
    reserved_quantity: 1,
    metadata: { stockBeforeHold: 84, physicalHold: true }
  };
  assert.equal(computeRestockQuantity(row), 1);
});

test('restock does not use stockBeforeHold gap (prevents 81 -> 84 over-restore)', () => {
  const row = {
    id: 'res-1',
    reserved_quantity: 1,
    metadata: { stockBeforeHold: 83, physicalHold: true }
  };
  const currentStock = 81;
  const buggyGap = row.metadata.stockBeforeHold - currentStock;
  assert.equal(buggyGap, 2);
  assert.equal(computeRestockQuantity(row), 1);
});

test('release movement note is unique per reservation for idempotency', () => {
  const id = '3c7e2103-ca03-4964-8fa1-a7e2ea597786';
  assert.equal(
    checkoutHoldReleaseMovementNote(id),
    'Checkout hold released:3c7e2103-ca03-4964-8fa1-a7e2ea597786'
  );
});
