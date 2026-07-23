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
  // Balance API view must not expose ledger rows (reconciliation uses /transactions).
  assert.equal(view.transactions, undefined);
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
  assert.equal(view.transactions, undefined);
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

test('mapPmVaultTransactions keeps decimal amount fields as INR', () => {
  const rows = mapPmVaultTransactions({
    ledger: [{ id: 'l1', type: 'debit', amount: 250.5, description: 'Order payment' }]
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].direction, 'debit');
  assert.equal(rows[0].amount, 250.5);
});

test('mapPmVaultTransactions converts explicit amountInPaise to INR', () => {
  const rows = mapPmVaultTransactions({
    ledger: [{ id: 'l1', type: 'debit', amountInPaise: 25000, description: 'Order payment' }]
  });
  assert.equal(rows[0].amount, 250);
});

test('mapPmVaultTransactions maps PM credit/debit paise fields to INR amount', () => {
  const rows = mapPmVaultTransactions({
    success: true,
    data: [
      {
        id: '6a60aa7828dcdc262742b30a',
        transactionId: 'VTX202600000154',
        credit: 5000,
        debit: 0,
        type: 'credit',
        balanceAfter: 102604,
        details: 'Vault top-up via Razorpay',
        paymentMode: 'online',
        projectId: null,
        transactionDate: '2026-07-22',
        createdAt: '2026-07-22T17:03:12.750+05:30'
      },
      {
        id: '6a5f3a24ff20dbaef7a8af26',
        transactionId: 'VTX202600000100',
        credit: 0,
        debit: 138400,
        type: 'debit',
        details: 'Milestone 1 Payment',
        paymentMode: 'wallet',
        projectId: '0F4532',
        transactionDate: '2026-07-21'
      }
    ]
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].amount, 50);
  assert.equal(rows[0].debit_credit, 'Credit');
  assert.equal(rows[0].payment_method, 'Online');
  assert.equal(rows[0].transaction_id, '6a60aa7828dcdc262742b30a');
  assert.equal(rows[0].reference, 'VTX202600000154');
  assert.equal(rows[0].balance_after, 1026.04);
  assert.equal(rows[1].amount, 1384);
  assert.equal(rows[1].debit_credit, 'Debit');
  assert.equal(rows[1].payment_method, 'Wallet');
  assert.equal(rows[1].project_id, '0F4532');
});

test('mapPmVaultTransactions maps reconciliation statement fields from dedicated API payload', () => {
  const rows = mapPmVaultTransactions({
    success: true,
    data: {
      transactions: [
        {
          _id: '6a60a25246e81d46de6930bd',
          details: 'Order Payment',
          amount: 823.01,
          type: 'credit',
          paymentMethod: 'wallet',
          date: '2026-07-22T10:00:00.000Z'
        },
        {
          transactionId: '6a5f3a24ff20dbaef7a8af26',
          description: 'Milestone 1 Payment',
          amount: 1384,
          direction: 'credit',
          payment_method: 'Wallet',
          projectId: '0F4532',
          createdAt: '2026-07-21T10:00:00.000Z'
        }
      ]
    }
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].details, 'Order Payment');
  assert.equal(rows[0].amount, 823.01);
  assert.equal(rows[0].debit_credit, 'Credit');
  assert.equal(rows[0].payment_method, 'Wallet');
  assert.equal(rows[0].project_id, null);
  assert.equal(rows[1].project_id, '0F4532');
});

test('extractPmTransactionRows reads paginated docs arrays', () => {
  const rows = mapPmVaultTransactions({
    success: true,
    data: {
      docs: [
        {
          _id: '6a60a25246e81d46de6930bd',
          details: 'Order Payment',
          amount: 823.01,
          type: 'Credit',
          paymentMethod: 'Wallet',
          date: '2026-07-22T10:00:00.000Z'
        }
      ],
      totalDocs: 1
    }
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].details, 'Order Payment');
  assert.equal(rows[0].amount, 823.01);
  assert.equal(rows[0].debit_credit, 'Credit');
});

test('extractPmTransactionRows reads nested results arrays', () => {
  const rows = mapPmVaultTransactions({
    success: true,
    data: {
      results: [
        {
          transactionId: 'abc123',
          description: 'Milestone 1 Payment',
          amount: 1384,
          direction: 'credit',
          projectId: '0F4532'
        }
      ]
    }
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].project_id, '0F4532');
});
