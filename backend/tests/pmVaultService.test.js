import test from 'node:test';
import assert from 'node:assert/strict';

// Balance fields from PM are treated as paise by default (1 INR = 100 paise).
process.env.PM_VAULT_BALANCE_IN_PAISE = 'true';

const {
  convertInrToPaise,
  mapPmVaultToWalletView,
  mapPmVaultTransactions,
  summarizePmVaultLedger,
  usesPlatformVault
} = await import('../services/pmVaultService.js');

test('convertInrToPaise converts rupee input to paise for Razorpay/PM APIs', () => {
  assert.equal(convertInrToPaise(100), 10000);
  assert.equal(convertInrToPaise(10), 1000);
  assert.equal(convertInrToPaise(1.5), 150);
});

test('convertInrToPaise rejects invalid amounts', () => {
  assert.throws(() => convertInrToPaise(0), /greater than zero/);
  assert.throws(() => convertInrToPaise('abc'), /greater than zero/);
});

test('mapPmVaultToWalletView maps nested vault object', () => {
  const view = mapPmVaultToWalletView({
    success: true,
    data: {
      vault: {
        _id: 'vault123',
        balanceInPaise: 25000,
        currency: 'INR',
        transactions: [{ id: 't1', type: 'credit', amount: 25000, description: 'Top-up' }]
      }
    }
  });

  assert.equal(view.balance, 250);
  assert.equal(view.wallet.id, 'vault123');
  assert.equal(view.transactions.length, 1);
  assert.equal(view.transactions[0].amount, 250);
});

test('mapPmVaultToWalletView converts plain balance from paise to INR', () => {
  const view = mapPmVaultToWalletView({
    success: true,
    data: {
      balance: 50000,
      currency: 'INR',
      transactions: [
        {
          _id: 'txn1',
          description: 'Vault top-up',
          type: 'credit',
          amount: 50000,
          createdAt: '2026-07-17T10:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(view.balance, 500);
  assert.equal(view.wallet.source, 'pm_vault');
  assert.equal(view.transactions.length, 1);
  assert.equal(view.transactions[0].direction, 'credit');
  assert.equal(view.transactions[0].amount, 500);
});

test('mapPmVaultToWalletView converts paise balance when flagged', () => {
  const view = mapPmVaultToWalletView({
    data: {
      balanceInPaise: 50000,
      transactions: []
    }
  });
  assert.equal(view.balance, 500);
});

test('usesPlatformVault applies to service providers and suppliers with phone', () => {
  assert.equal(
    usesPlatformVault({ user_type: 'service_provider', phone: '9876543210' }),
    true
  );
  assert.equal(usesPlatformVault({ user_type: 'supplier', phone: '9876543210' }), true);
  assert.equal(usesPlatformVault({ user_type: 'service_provider', phone: '' }), false);
});

test('summarizePmVaultLedger totals credits and debits', () => {
  const summary = summarizePmVaultLedger([
    { direction: 'credit', amount: 100 },
    { direction: 'debit', amount: 40 }
  ]);
  assert.equal(summary.totalCredit, 100);
  assert.equal(summary.totalDebit, 40);
  assert.equal(summary.netFlow, 60);
  assert.equal(summary.transactionCount, 2);
});

test('mapPmVaultTransactions converts ledger amounts from paise to INR', () => {
  const rows = mapPmVaultTransactions({
    ledger: [{ id: 'l1', type: 'debit', amount: 25000, description: 'Order payment' }]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].direction, 'debit');
  assert.equal(rows[0].amount, 250);
});
