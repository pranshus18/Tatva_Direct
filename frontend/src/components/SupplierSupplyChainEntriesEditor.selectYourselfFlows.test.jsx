import React, { useRef, useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SupplierSupplyChainEntriesEditor from './SupplierSupplyChainEntriesEditor';
import {
  buildSelectYourselfChainEntryRowsSignature,
  buildSelectYourselfChainFormSignature,
  buildSupplierChainSavePayload,
  buildSupplyChainFormProfile,
  ensureAtLeastOneCompanyInfoEntry,
  mergeFormStepProfile,
  shouldBlockProfileSnapshotRefresh,
  syncBrandEntriesForSupplyChainStep
} from '../utils/supplierSelectYourselfProfile';

const CATALOG = [
  { name: 'acc', status: 'approved' },
  { name: 'Safari', status: 'approved' }
];

vi.mock('../hooks/useSupplierBrands', () => ({
  useSupplierBrands: () => ({
    brands: [
      { name: 'acc', status: 'approved' },
      { name: 'Safari', status: 'approved' }
    ],
    brandNames: ['acc', 'Safari'],
    loading: false,
    error: '',
    reload: vi.fn()
  })
}));

vi.mock('./BrandSelect', () => ({
  default: function MockBrandSelect({ brandNames = [], onChange, disabled }) {
    return (
      <div data-testid="brand-select">
        {brandNames.map((name) => (
          <button
            key={name}
            type="button"
            disabled={disabled}
            onClick={() => onChange?.(name)}
          >
            {`Pick ${name}`}
          </button>
        ))}
      </div>
    );
  }
}));

vi.mock('./BrandAuthorizationDocuments', () => ({
  default: ({ entry, editing, uploading, onUpload, onRemove, onUploadIntent, resolveUrls }) => {
    const urls = resolveUrls?.(entry) || [];
    return (
      <div data-testid={editing ? 'docs-editable' : 'docs-readonly'}>
        {urls.map((url) => (
          <span key={url} data-testid="doc-url">
            {url}
          </span>
        ))}
        {editing ? (
          <button
            type="button"
            onClick={() => {
              onUploadIntent?.();
              onUpload?.([new File(['x'], 'doc.pdf', { type: 'application/pdf' })]);
            }}
          >
            {uploading ? 'Uploading…' : 'Upload document'}
          </button>
        ) : null}
        {editing && urls.length > 0 ? (
          <button type="button" onClick={() => onRemove?.(urls[0])}>
            Remove document
          </button>
        ) : null}
      </div>
    );
  }
}));

function makeProfile(entries) {
  return { companyInfoEntries: entries };
}

const APPROVED_ROW = {
  id: 'entry-approved',
  brands: 'acc',
  role: '',
  gstin: '',
  companyName: '',
  ownershipDetails: '',
  minimumOrderValue: ''
};

/**
 * Mirrors SupplierSelectYourself: signature-guarded merges, draft-protection window and the
 * background profile poll, so editor behaviour is exercised against the real page contract.
 */
function BrandStepHarness({
  initialEntries = [APPROVED_ROW],
  initialMode = null,
  serverEntries = null,
  onBrandPicked = null,
  onProtect = null,
  supplierBrandRequests = [],
  initialLockedBrand = ''
}) {
  const [brandPathMode, setBrandPathMode] = useState(initialMode);
  const [profile, setProfile] = useState(() => makeProfile(initialEntries));
  const [lockedBrand, setLockedBrand] = useState(initialLockedBrand);
  const dirtyRef = useRef(false);
  const blockUntilRef = useRef(0);
  const [refreshOutcome, setRefreshOutcome] = useState('');

  const markLocalDraftEdit = (options = {}) => {
    if (options?.dirty !== false) dirtyRef.current = true;
    blockUntilRef.current = Date.now() + (Number(options?.blockMs) > 0 ? Number(options.blockMs) : 4000);
    onProtect?.(options);
  };

  const applyBrandStepProfile = (next) => {
    const entries = syncBrandEntriesForSupplyChainStep(ensureAtLeastOneCompanyInfoEntry(next));
    const payload = buildSupplierChainSavePayload({ ...next, companyInfoEntries: entries }, null, {
      dedupeByBrand: false
    });
    setProfile((prev) => {
      const sameContent =
        buildSelectYourselfChainFormSignature(payload) === buildSelectYourselfChainFormSignature(prev);
      const sameRows =
        buildSelectYourselfChainEntryRowsSignature(payload) ===
        buildSelectYourselfChainEntryRowsSignature(prev);
      if (sameContent && sameRows) return prev;
      markLocalDraftEdit(sameContent ? { dirty: false } : {});
      return payload;
    });
  };

  // Page equivalent: unlockBrandSelection → clearIncompleteBrandSetup.
  const handleBrandSelectionCleared = (clearedBrand) => {
    const label = String(clearedBrand || lockedBrand || '').trim();
    setLockedBrand('');
    setBrandPathMode(null);
    if (!label) return;
    setProfile((prev) => ({
      ...prev,
      companyInfoEntries: (prev?.companyInfoEntries || []).map((entry) =>
        String(entry?.brands || '').trim().toLowerCase() === label.trim().toLowerCase()
          ? { ...entry, brands: '', role: '', supplyChainRegistrationStarted: false }
          : entry
      )
    }));
  };

  const runBackgroundRefresh = () => {
    if (
      shouldBlockProfileSnapshotRefresh({
        hasUnsavedChanges: dirtyRef.current,
        blockUntilMs: blockUntilRef.current
      })
    ) {
      setRefreshOutcome('blocked');
      return;
    }
    setRefreshOutcome('applied');
    setProfile(makeProfile(serverEntries || initialEntries));
  };

  return (
    <>
      <button type="button" onClick={runBackgroundRefresh}>
        Run background profile refresh
      </button>
      <span data-testid="refresh-outcome">{refreshOutcome}</span>
      <SupplierSupplyChainEntriesEditor
        profile={profile}
        setProfile={applyBrandStepProfile}
        editing
        sectionView="brand"
        selectionMode="dropdown"
        allowEntryManagement
        showAddEntry={false}
        catalogBrands={CATALOG}
        catalogBrandsLoading={false}
        catalogBrandsError=""
        onReloadCatalogBrands={vi.fn()}
        supplierApprovedBrands={[]}
        supplierBrandRequests={supplierBrandRequests}
        brandPathMode={brandPathMode}
        onBrandPathModeChange={setBrandPathMode}
        lockedBrandName={lockedBrand}
        onBrandSelectionCleared={handleBrandSelectionCleared}
        onBrandPickedWithoutRole={(brand) => {
          setLockedBrand(String(brand || '').trim());
          onBrandPicked?.(brand);
        }}
        onProtectLocalDraft={markLocalDraftEdit}
      />
    </>
  );
}

function openPathB() {
  fireEvent.click(screen.getByRole('button', { name: /Or use Path B — request a new brand/i }));
}

function typeNewBrand(value) {
  fireEvent.change(screen.getByPlaceholderText(/Enter your brand name/i), { target: { value } });
}

describe('Select yourself — Path B new brand request', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'test-token');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete global.fetch;
  });

  it('opens with a brand name field and document upload', () => {
    render(<BrandStepHarness />);
    openPathB();

    expect(screen.getByText(/Path B only/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Enter your brand name/i)).toBeInTheDocument();
    expect(screen.getByTestId('docs-editable')).toBeInTheDocument();
  });

  it('starts a new Path B request with empty brand documents even when a leftover file is on the draft row', () => {
    render(
      <BrandStepHarness
        initialEntries={[
          {
            id: 'entry-leftover',
            brands: '',
            role: '',
            gstin: '',
            companyName: '',
            ownershipDetails: '',
            minimumOrderValue: '',
            brandApprovalDocumentUrl: 'https://files.test/old-brand.png',
            brandApprovalDocumentUrls: ['https://files.test/old-brand.png']
          },
          { ...APPROVED_ROW, id: 'entry-existing', brands: 'acc' }
        ]}
      />
    );
    openPathB();

    expect(screen.getByPlaceholderText(/Enter your brand name/i)).toHaveValue('');
    expect(screen.queryByTestId('doc-url')).not.toBeInTheDocument();
    expect(screen.getByText(/Brand docs: optional/i)).toBeInTheDocument();
    expect(screen.getByTestId('docs-editable')).toBeInTheDocument();
  });

  it('does not reattach leftover documents after canceling Path B and starting a new request', () => {
    render(
      <BrandStepHarness
        initialEntries={[
          {
            id: 'entry-leftover',
            brands: '',
            role: '',
            brandApprovalDocumentUrl: 'https://files.test/old-brand.png',
            brandApprovalDocumentUrls: ['https://files.test/old-brand.png']
          }
        ]}
      />
    );
    openPathB();
    expect(screen.queryByTestId('doc-url')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Cancel setup/i }));
    openPathB();

    expect(screen.getByPlaceholderText(/Enter your brand name/i)).toHaveValue('');
    expect(screen.queryByTestId('doc-url')).not.toBeInTheDocument();
    expect(screen.getByText(/Brand docs: optional/i)).toBeInTheDocument();
  });

  it('keeps the typed brand name on the draft row', () => {
    render(<BrandStepHarness />);
    openPathB();
    typeNewBrand('brand new co');

    expect(screen.getByPlaceholderText(/Enter your brand name/i)).toHaveValue('brand new co');
    expect(screen.getByText(/Path B only/i)).toBeInTheDocument();
  });

  it('protects the typed draft from the background profile refresh', () => {
    render(<BrandStepHarness serverEntries={[APPROVED_ROW]} />);
    openPathB();
    typeNewBrand('brand new co');

    fireEvent.click(screen.getByRole('button', { name: /Run background profile refresh/i }));

    expect(screen.getByTestId('refresh-outcome')).toHaveTextContent('blocked');
    expect(screen.getByPlaceholderText(/Enter your brand name/i)).toHaveValue('brand new co');
  });

  it('restores the Path B input when a background refresh drops the untouched draft row', async () => {
    render(<BrandStepHarness serverEntries={[APPROVED_ROW]} />);
    openPathB();
    expect(screen.getByPlaceholderText(/Enter your brand name/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Run background profile refresh/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Enter your brand name/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Path B only/i)).toBeInTheDocument();
  });

  it('Cancel setup clears the Path B draft and returns to the path chooser', () => {
    render(<BrandStepHarness />);
    openPathB();
    typeNewBrand('brand new co');

    fireEvent.click(screen.getByRole('button', { name: /Cancel setup/i }));

    expect(screen.getByText(/Path A — select approved brand/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Or use Path B — request a new brand/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Enter your brand name/i)).not.toBeInTheDocument();
  });

  it('locks documents and shows the review notice while the request is pending', () => {
    render(
      <BrandStepHarness
        initialEntries={[{ ...APPROVED_ROW, id: 'entry-pending', brands: 'pending co' }]}
        initialLockedBrand="pending co"
        supplierBrandRequests={[{ name: 'pending co', status: 'pending', submittedAt: '2026-08-01T10:00:00Z' }]}
      />
    );

    expect(screen.getByText(/Pending Admin Approval/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Waiting for admin review — no need to submit again/i)
    ).toBeInTheDocument();
    expect(screen.getByText(/pending admin review/i)).toBeInTheDocument();
    expect(screen.queryByTestId('docs-editable')).not.toBeInTheDocument();
  });

  it('Switch to Path A leaves Path B and shows the approved-brand picker', () => {
    render(<BrandStepHarness />);
    openPathB();

    fireEvent.click(screen.getByRole('button', { name: /Switch to Path A/i }));

    expect(screen.getByText(/Path A — select approved brand/i)).toBeInTheDocument();
    expect(screen.getByTestId('brand-select')).toBeInTheDocument();
  });

  it('shows an approved-brand suggestion without autofilling or locking the input', () => {
    render(<BrandStepHarness />);
    openPathB();
    typeNewBrand('safa');

    const input = screen.getByPlaceholderText(/Enter your brand name/i);
    expect(input).toHaveValue('safa');
    expect(input).not.toBeDisabled();
    expect(screen.getAllByText(/may refer to approved brand/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Use [“"]Safari[”"]/i })).toBeInTheDocument();
    expect(screen.getByText(/Path B only/i)).toBeInTheDocument();
    expect(screen.queryByText(/Path A only/i)).not.toBeInTheDocument();

    typeNewBrand('safal');
    expect(input).toHaveValue('safal');
    expect(input).not.toBeDisabled();
    expect(screen.getByText(/Path B only/i)).toBeInTheDocument();
  });

  it('autofills the suggested brand only after the supplier clicks Use', () => {
    const onBrandPicked = vi.fn();
    render(<BrandStepHarness onBrandPicked={onBrandPicked} />);
    openPathB();
    typeNewBrand('safa');

    fireEvent.click(screen.getByRole('button', { name: /Use [“"]Safari[”"]/i }));

    expect(onBrandPicked).toHaveBeenCalledWith('Safari');
    expect(screen.getByText(/Path A only/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Enter your brand name/i)).not.toBeInTheDocument();
  });

  it('does not lock Path A when the typed name exactly matches an approved brand', () => {
    render(<BrandStepHarness />);
    openPathB();
    typeNewBrand('Safari');

    const input = screen.getByPlaceholderText(/Enter your brand name/i);
    expect(input).toHaveValue('Safari');
    expect(input).not.toBeDisabled();
    expect(screen.getByText(/Path B only/i)).toBeInTheDocument();
    expect(screen.queryByText(/Path A only/i)).not.toBeInTheDocument();

    typeNewBrand('SafariPlus');
    expect(input).toHaveValue('SafariPlus');
    expect(screen.getByText(/Path B only/i)).toBeInTheDocument();
  });

  it('lets the supplier keep typing past an already-approved brand like Safari to safarii', () => {
    render(
      <BrandStepHarness initialEntries={[{ ...APPROVED_ROW, id: 'entry-safari', brands: 'Safari' }]} />
    );
    openPathB();

    const input = screen.getByPlaceholderText(/Enter your brand name/i);
    fireEvent.focus(input);
    typeNewBrand('safari');
    expect(input).toHaveValue('safari');
    expect(input).not.toBeDisabled();
    expect(screen.getByText(/Path B only/i)).toBeInTheDocument();

    typeNewBrand('safarii');
    expect(input).toHaveValue('safarii');
    expect(input).not.toBeDisabled();
    expect(screen.getByText(/Path B only/i)).toBeInTheDocument();
    expect(screen.queryByText(/Path A only/i)).not.toBeInTheDocument();
  });
});

describe('Select yourself — Path B document upload', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'test-token');
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete global.fetch;
  });

  function mockUploadResponse(body, { ok = true, status = 200 } = {}) {
    global.fetch = vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => body
    });
  }

  it('links the document to the draft row and confirms only after the server saved it', async () => {
    mockUploadResponse({
      status: 'success',
      url: 'https://files.test/brand-doc.pdf',
      savedToProfile: true
    });
    const onProtect = vi.fn();
    render(<BrandStepHarness onProtect={onProtect} />);
    openPathB();
    typeNewBrand('brand new co');

    fireEvent.click(screen.getByRole('button', { name: /Upload document/i }));

    await waitFor(() => {
      expect(screen.getByTestId('doc-url')).toHaveTextContent('https://files.test/brand-doc.pdf');
    });
    expect(
      await screen.findByText(/Brand documents uploaded and linked to your profile/i)
    ).toBeInTheDocument();
    // Draft protection must be armed before the request so a poll cannot wipe the upload.
    expect(onProtect).toHaveBeenCalled();
  });

  it('shows no success confirmation when the server could not link the document', async () => {
    mockUploadResponse({
      status: 'success',
      url: 'https://files.test/brand-doc.pdf',
      savedToProfile: false
    });
    render(<BrandStepHarness />);
    openPathB();
    typeNewBrand('brand new co');

    fireEvent.click(screen.getByRole('button', { name: /Upload document/i }));

    await waitFor(() => {
      expect(screen.getByTestId('doc-url')).toHaveTextContent('https://files.test/brand-doc.pdf');
    });
    expect(screen.queryByText(/uploaded and linked to your profile/i)).not.toBeInTheDocument();
  });

  it('surfaces the server message and no confirmation when linking is rejected', async () => {
    mockUploadResponse(
      {
        status: 'error',
        message: 'File uploaded, but it could not be linked to your brand entry.',
        savedToProfile: false
      },
      { ok: false, status: 422 }
    );
    render(<BrandStepHarness />);
    openPathB();
    typeNewBrand('brand new co');

    fireEvent.click(screen.getByRole('button', { name: /Upload document/i }));

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(
        'File uploaded, but it could not be linked to your brand entry.'
      );
    });
    expect(screen.queryByText(/uploaded and linked to your profile/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('doc-url')).not.toBeInTheDocument();
  });

  it('removes an uploaded document from the draft row', async () => {
    mockUploadResponse({
      status: 'success',
      url: 'https://files.test/brand-doc.pdf',
      savedToProfile: true
    });
    render(<BrandStepHarness />);
    openPathB();
    typeNewBrand('brand new co');
    fireEvent.click(screen.getByRole('button', { name: /Upload document/i }));
    await waitFor(() => expect(screen.getByTestId('doc-url')).toBeInTheDocument());

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', savedToProfile: true })
    });
    fireEvent.click(screen.getByRole('button', { name: /Remove document/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('doc-url')).not.toBeInTheDocument();
    });
  });
});

describe('Select yourself — Path A approved brand', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'test-token');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete global.fetch;
  });

  it('picking an approved brand locks Path A, hides Path B and hands off to role setup', () => {
    const onBrandPicked = vi.fn();
    render(<BrandStepHarness initialEntries={[{ ...APPROVED_ROW, brands: '' }]} onBrandPicked={onBrandPicked} />);

    fireEvent.click(screen.getByRole('button', { name: /Pick acc/i }));

    expect(onBrandPicked).toHaveBeenCalledWith('acc');
    expect(screen.getByText(/Path A only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Or use Path B/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId('docs-editable')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Document verification is not required — this brand is already approved/i)
    ).toBeInTheDocument();
  });

  it('Change brand from Path A returns to the chooser', () => {
    render(<BrandStepHarness initialEntries={[{ ...APPROVED_ROW, brands: '' }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Pick acc/i }));

    fireEvent.click(screen.getByRole('button', { name: /Change brand/i }));

    expect(screen.getByText(/Path A — select approved brand/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Or use Path B — request a new brand/i })).toBeInTheDocument();
  });

  it('Cancel setup unlocks Path A when the approved brand was already on the profile', () => {
    render(
      <BrandStepHarness
        initialEntries={[{ ...APPROVED_ROW, brands: 'acc' }]}
        initialMode="pathA"
        initialLockedBrand=""
      />
    );

    expect(screen.getByText(/Path A only/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Cancel setup/i }));

    expect(screen.getByText(/Path A — select approved brand/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Or use Path B — request a new brand/i })).toBeInTheDocument();
    expect(screen.queryByText(/Path A only/i)).not.toBeInTheDocument();
  });
});

describe('Select yourself — role setup step', () => {
  beforeEach(() => {
    localStorage.setItem('token', 'test-token');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        roles: ['dealer', 'retailer'],
        brands: [
          {
            brand: 'acc',
            supplierHasAccess: true,
            hasSupplyChainDefinition: true,
            canSelectRoles: true,
            approvalStatus: 'approved'
          }
        ]
      })
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete global.fetch;
  });

  function FormStepHarness({ onSaveEntry = null }) {
    const [profile, setProfile] = useState(() => makeProfile([{ ...APPROVED_ROW, brands: 'acc' }]));
    return (
      <SupplierSupplyChainEntriesEditor
        profile={profile}
        setProfile={setProfile}
        editing
        sectionView="form"
        selectionMode="all"
        allowEntryManagement={false}
        showAddEntry={false}
        catalogBrands={CATALOG}
        catalogBrandsLoading={false}
        catalogBrandsError=""
        onReloadCatalogBrands={vi.fn()}
        supplierApprovedBrands={['acc']}
        supplierBrandRequests={[]}
        savedBaselineEntries={[]}
        onSaveEntry={onSaveEntry || vi.fn()}
        filterBrandName="acc"
      />
    );
  }

  it('removes a role document from the registration list after confirm', async () => {
    const roleDoc = 'https://cdn.example.com/role-doc.pdf';
    const entry = {
      id: 'entry-approved',
      brands: 'acc',
      role: 'dealer',
      authorizationCertificateUrls: [roleDoc],
      supplyChainRegistrationStarted: true
    };

    function MergingFormHarness() {
      const [profile, setProfile] = useState(() => makeProfile([entry]));
      const applyFormStepProfile = (next) => {
        setProfile((prev) => mergeFormStepProfile(prev, next));
      };
      const formProfile = buildSupplyChainFormProfile(profile, [entry]);
      return (
        <SupplierSupplyChainEntriesEditor
          profile={formProfile}
          setProfile={applyFormStepProfile}
          editing
          sectionView="form"
          selectionMode="all"
          allowEntryManagement={false}
          showAddEntry={false}
          catalogBrands={CATALOG}
          catalogBrandsLoading={false}
          catalogBrandsError=""
          onReloadCatalogBrands={vi.fn()}
          supplierApprovedBrands={['acc']}
          supplierBrandRequests={[]}
          savedBaselineEntries={[]}
          onSaveEntry={vi.fn()}
          filterBrandName="acc"
        />
      );
    }

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<MergingFormHarness />);
    expect(await screen.findByTestId('doc-url')).toHaveTextContent(roleDoc);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', savedToProfile: true })
    });

    fireEvent.click(screen.getByRole('button', { name: /Remove document/i }));

    await waitFor(() => {
      expect(screen.queryByTestId('doc-url')).not.toBeInTheDocument();
    });
  });

  it('shows loading instead of no-supply-chain while role options fetch is pending', async () => {
    let resolveFetch;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    global.fetch = vi.fn(() => fetchPromise);

    const catalogWithChain = [{ name: 'acc', status: 'approved', hasAdminSupplyChain: true }];

    render(
      <SupplierSupplyChainEntriesEditor
        profile={makeProfile([{ ...APPROVED_ROW, brands: 'acc' }])}
        setProfile={vi.fn()}
        editing
        sectionView="form"
        selectionMode="all"
        allowEntryManagement={false}
        showAddEntry={false}
        catalogBrands={catalogWithChain}
        catalogBrandsLoading={false}
        catalogBrandsError=""
        onReloadCatalogBrands={vi.fn()}
        supplierApprovedBrands={['acc']}
        supplierBrandRequests={[]}
        savedBaselineEntries={[]}
        filterBrandName="acc"
      />
    );

    expect(
      screen.queryByText(/No supply-chain roles are currently configured/i)
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Loading supply-chain roles for this brand/i)).toBeInTheDocument();

    resolveFetch({
      ok: true,
      status: 200,
      json: async () => ({
        roles: ['dealer', 'retailer'],
        brands: [
          {
            brand: 'acc',
            supplierHasAccess: true,
            hasSupplyChainDefinition: true,
            canSelectRoles: true,
            approvalStatus: 'approved'
          }
        ]
      })
    });

    const roleSelect = await screen.findByLabelText(/Select your position/i);
    await waitFor(() => expect(roleSelect).not.toBeDisabled());
    expect(screen.queryByText(/No supply-chain roles are currently configured/i)).not.toBeInTheDocument();
  });

  it('shows no-roles status without a role-configuration request action', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        roles: [],
        brands: [
          {
            brand: 'acc',
            supplierHasAccess: true,
            hasSupplyChainDefinition: false,
            canSelectRoles: false,
            approvalStatus: 'approved'
          }
        ]
      })
    });

    const catalogWithoutChain = [{ name: 'acc', status: 'approved', hasAdminSupplyChain: false }];

    render(
      <SupplierSupplyChainEntriesEditor
        profile={makeProfile([{ ...APPROVED_ROW, brands: 'acc' }])}
        setProfile={vi.fn()}
        editing
        sectionView="form"
        selectionMode="all"
        allowEntryManagement={false}
        showAddEntry={false}
        catalogBrands={catalogWithoutChain}
        catalogBrandsLoading={false}
        catalogBrandsError=""
        onReloadCatalogBrands={vi.fn()}
        supplierApprovedBrands={['acc']}
        supplierBrandRequests={[]}
        savedBaselineEntries={[]}
        filterBrandName="acc"
      />
    );

    expect(
      await screen.findByText(/No supply-chain roles are currently configured/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request Role Configuration/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request Role Change/i })).not.toBeInTheDocument();
    expect(screen.getByText(/No roles configured by admin/i)).toBeInTheDocument();
  });

  it('shows loading instead of no-supply-chain while catalog brands are loading', () => {
    render(
      <SupplierSupplyChainEntriesEditor
        profile={makeProfile([{ ...APPROVED_ROW, brands: 'acc' }])}
        setProfile={vi.fn()}
        editing
        sectionView="form"
        selectionMode="all"
        allowEntryManagement={false}
        showAddEntry={false}
        catalogBrands={[]}
        catalogBrandsLoading
        catalogBrandsError=""
        onReloadCatalogBrands={vi.fn()}
        supplierApprovedBrands={['acc']}
        supplierBrandRequests={[]}
        savedBaselineEntries={[]}
        filterBrandName="acc"
      />
    );

    expect(
      screen.queryByText(/No supply-chain roles are currently configured/i)
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Loading supply-chain roles for this brand/i)).toBeInTheDocument();
  });

  it('enables the admin-defined roles for an approved brand and keeps the pick', async () => {
    render(<FormStepHarness />);

    const roleSelect = await screen.findByLabelText(/Select your position/i);
    await waitFor(() => expect(roleSelect).not.toBeDisabled());

    fireEvent.change(roleSelect, { target: { value: 'dealer' } });

    expect(await screen.findByLabelText(/Assigned supply-chain role/i)).toHaveValue('Dealer');
    expect(screen.queryByRole('combobox', { name: /Select your position/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Change role/i }));
    const reopened = await screen.findByRole('combobox', { name: /Select your position/i });
    expect(reopened).toHaveValue('dealer');
    expect(screen.getByRole('option', { name: 'Dealer' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Retailer' })).toBeInTheDocument();
  });

  it('blocks role document upload while the brand is not approved for supply chain', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        roles: [],
        brands: [
          {
            brand: 'waiting co',
            supplierHasAccess: false,
            hasSupplyChainDefinition: false,
            canSelectRoles: false,
            approvalStatus: 'pending'
          }
        ]
      })
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    function UnapprovedFormHarness() {
      const [profile, setProfile] = useState(() =>
        makeProfile([{ ...APPROVED_ROW, id: 'entry-waiting', brands: 'waiting co' }])
      );
      return (
        <SupplierSupplyChainEntriesEditor
          profile={profile}
          setProfile={setProfile}
          editing
          sectionView="form"
          selectionMode="all"
          allowEntryManagement={false}
          showAddEntry={false}
          catalogBrands={CATALOG}
          catalogBrandsLoading={false}
          catalogBrandsError=""
          onReloadCatalogBrands={vi.fn()}
          supplierApprovedBrands={[]}
          supplierBrandRequests={[{ name: 'waiting co', status: 'pending' }]}
          savedBaselineEntries={[]}
          filterBrandName="waiting co"
        />
      );
    }

    render(<UnapprovedFormHarness />);

    const roleSelect = await screen.findByLabelText(/Select your position/i);
    expect(roleSelect).toBeDisabled();
    // Upload control is withheld entirely, so no document can be attached to an unapproved brand.
    await waitFor(() => expect(screen.getByTestId('docs-readonly')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Upload document/i })).not.toBeInTheDocument();
    expect(
      await screen.findByText(/has not yet been approved by the admin|not approved/i)
    ).toBeInTheDocument();
  });

  it('offers Save entry once the role is chosen', async () => {
    render(<FormStepHarness />);

    const roleSelect = await screen.findByLabelText(/Select your position/i);
    await waitFor(() => expect(roleSelect).not.toBeDisabled());
    fireEvent.change(roleSelect, { target: { value: 'dealer' } });

    expect(await screen.findByRole('button', { name: /Save entry|Saved/i })).toBeInTheDocument();
  });

  it('keeps the selected role until the supplier explicitly clicks Change role', async () => {
    render(<FormStepHarness />);

    const roleSelect = await screen.findByLabelText(/Select your position/i);
    await waitFor(() => expect(roleSelect).not.toBeDisabled());
    fireEvent.change(roleSelect, { target: { value: 'dealer' } });

    expect(await screen.findByLabelText(/Assigned supply-chain role/i)).toHaveValue('Dealer');
    expect(screen.queryByRole('combobox', { name: /Select your position/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Assigned supply-chain role/i));
    expect(screen.queryByRole('combobox', { name: /Select your position/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Role change request/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Change role/i }));
    expect(await screen.findByRole('combobox', { name: /Select your position/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Keep current role/i }));
    expect(screen.getByLabelText(/Assigned supply-chain role/i)).toHaveValue('Dealer');
    expect(screen.queryByRole('combobox', { name: /Select your position/i })).not.toBeInTheDocument();
  });

  it('locks the role picker after onboarding is complete and exposes Request Role Change', async () => {
    const completeEntry = {
      id: 'entry-approved',
      brands: 'acc',
      role: 'dealer',
      authorizationCertificateUrls: ['https://cdn.example.com/doc.pdf'],
      minimumOrderValue: 25000,
      supplyChainRegistrationStarted: true
    };

    function CompletedFormHarness() {
      const [profile] = useState(() => makeProfile([completeEntry]));
      return (
        <SupplierSupplyChainEntriesEditor
          profile={profile}
          setProfile={vi.fn()}
          editing
          sectionView="form"
          selectionMode="all"
          allowEntryManagement={false}
          showAddEntry={false}
          catalogBrands={CATALOG}
          catalogBrandsLoading={false}
          catalogBrandsError=""
          onReloadCatalogBrands={vi.fn()}
          supplierApprovedBrands={['acc']}
          supplierBrandRequests={[]}
          savedBaselineEntries={[completeEntry]}
          approvedBaselineEntries={[completeEntry]}
          filterBrandName="acc"
          chainProfileApprovalStatus="approved"
        />
      );
    }

    render(<CompletedFormHarness />);

    expect(await screen.findByText(/Active approved role: Dealer/i)).toBeInTheDocument();
    const requestBtn = screen.getByRole('button', { name: /Request Role Change/i });
    expect(requestBtn).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Select your position/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Assigned supply-chain role/i)).toHaveValue('Dealer');

    fireEvent.click(requestBtn);

    expect(await screen.findByText(/Role change request/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Select your position/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Assigned supply-chain role/i)).not.toBeInTheDocument();
  });

  it('blocks submitting a role-change request when the role is unchanged', async () => {
    const completeEntry = {
      id: 'entry-approved',
      brands: 'acc',
      role: 'retailer',
      authorizationCertificateUrls: ['https://cdn.example.com/doc.pdf'],
      supplyChainRegistrationStarted: true
    };
    const onSaveEntry = vi.fn();

    function RoleChangeHarness() {
      const [profile, setProfile] = useState(() => makeProfile([completeEntry]));
      return (
        <SupplierSupplyChainEntriesEditor
          profile={profile}
          setProfile={setProfile}
          editing
          sectionView="form"
          selectionMode="all"
          allowEntryManagement={false}
          showAddEntry={false}
          catalogBrands={CATALOG}
          catalogBrandsLoading={false}
          catalogBrandsError=""
          onReloadCatalogBrands={vi.fn()}
          supplierApprovedBrands={['acc']}
          supplierBrandRequests={[]}
          savedBaselineEntries={[completeEntry]}
          approvedBaselineEntries={[completeEntry]}
          filterBrandName="acc"
          chainProfileApprovalStatus="approved"
          onSaveEntry={onSaveEntry}
        />
      );
    }

    render(<RoleChangeHarness />);

    fireEvent.click(await screen.findByRole('button', { name: /Request Role Change/i }));
    expect(await screen.findByText(/Role change request/i)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Select your position/i })).toHaveValue('retailer');
    expect(
      screen.getByText(/Select a different supply-chain role before submitting this change request/i)
    ).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /Submit role change/i });
    expect(submitBtn).toBeDisabled();
    fireEvent.click(submitBtn);
    expect(onSaveEntry).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('combobox', { name: /Select your position/i }), {
      target: { value: 'dealer' }
    });
    expect(await screen.findByRole('button', { name: /Submit role change/i })).not.toBeDisabled();
  });

  it('does not allow extra documents to be added for the same approved role', async () => {
    const completeEntry = {
      id: 'entry-approved',
      brands: 'acc',
      role: 'retailer',
      authorizationCertificateUrls: ['https://cdn.example.com/doc.pdf'],
      supplyChainRegistrationStarted: true
    };

    function RoleChangeHarness() {
      const [profile, setProfile] = useState(() => makeProfile([completeEntry]));
      return (
        <SupplierSupplyChainEntriesEditor
          profile={profile}
          setProfile={setProfile}
          editing
          sectionView="form"
          selectionMode="all"
          allowEntryManagement={false}
          showAddEntry={false}
          catalogBrands={CATALOG}
          catalogBrandsLoading={false}
          catalogBrandsError=""
          onReloadCatalogBrands={vi.fn()}
          supplierApprovedBrands={['acc']}
          supplierBrandRequests={[]}
          savedBaselineEntries={[completeEntry]}
          approvedBaselineEntries={[completeEntry]}
          filterBrandName="acc"
          chainProfileApprovalStatus="approved"
          onSaveEntry={vi.fn()}
        />
      );
    }

    render(<RoleChangeHarness />);

    fireEvent.click(await screen.findByRole('button', { name: /Request Role Change/i }));
    expect(await screen.findByText(/Role change request/i)).toBeInTheDocument();
    expect(screen.queryByTestId('doc-url')).not.toBeInTheDocument();
    expect(screen.getByText(/New role verification documents/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Documents from the current role are not carried over/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upload document/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove document/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/Extra documents cannot be saved for your current approved role/i)
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: /Select your position/i }), {
      target: { value: 'dealer' }
    });

    await waitFor(() => {
      expect(screen.queryByTestId('doc-url')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Upload document/i })).toBeInTheDocument();
  });

  it('starts Change role with a fresh document section and restores docs if cancelled', async () => {
    const draftEntry = {
      id: 'entry-draft',
      brands: 'acc',
      role: 'dealer',
      authorizationCertificateUrls: ['https://cdn.example.com/dealer-doc.pdf'],
      supplyChainRegistrationStarted: true
    };

    function ChangeRoleHarness() {
      const [profile, setProfile] = useState(() => makeProfile([draftEntry]));
      return (
        <SupplierSupplyChainEntriesEditor
          profile={profile}
          setProfile={setProfile}
          editing
          sectionView="form"
          selectionMode="all"
          allowEntryManagement={false}
          showAddEntry={false}
          catalogBrands={CATALOG}
          catalogBrandsLoading={false}
          catalogBrandsError=""
          onReloadCatalogBrands={vi.fn()}
          supplierApprovedBrands={['acc']}
          supplierBrandRequests={[]}
          savedBaselineEntries={[]}
          onSaveEntry={vi.fn()}
          filterBrandName="acc"
        />
      );
    }

    render(<ChangeRoleHarness />);
    expect(await screen.findByTestId('doc-url')).toHaveTextContent(
      'https://cdn.example.com/dealer-doc.pdf'
    );

    fireEvent.click(screen.getByRole('button', { name: /Change role/i }));
    expect(await screen.findByRole('combobox', { name: /Select your position/i })).toBeInTheDocument();
    expect(screen.queryByTestId('doc-url')).not.toBeInTheDocument();
    expect(screen.getByText(/New role verification documents/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Upload document/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: /Select your position/i }), {
      target: { value: 'retailer' }
    });
    expect(screen.queryByTestId('doc-url')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Upload document/i })).toBeInTheDocument();
  });

  it('restores the previous role documents when Keep current role is clicked', async () => {
    const draftEntry = {
      id: 'entry-draft',
      brands: 'acc',
      role: 'dealer',
      authorizationCertificateUrls: ['https://cdn.example.com/dealer-doc.pdf'],
      supplyChainRegistrationStarted: true
    };

    function ChangeRoleHarness() {
      const [profile, setProfile] = useState(() => makeProfile([draftEntry]));
      return (
        <SupplierSupplyChainEntriesEditor
          profile={profile}
          setProfile={setProfile}
          editing
          sectionView="form"
          selectionMode="all"
          allowEntryManagement={false}
          showAddEntry={false}
          catalogBrands={CATALOG}
          catalogBrandsLoading={false}
          catalogBrandsError=""
          onReloadCatalogBrands={vi.fn()}
          supplierApprovedBrands={['acc']}
          supplierBrandRequests={[]}
          savedBaselineEntries={[]}
          onSaveEntry={vi.fn()}
          filterBrandName="acc"
        />
      );
    }

    render(<ChangeRoleHarness />);
    fireEvent.click(await screen.findByRole('button', { name: /Change role/i }));
    expect(screen.queryByTestId('doc-url')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Keep current role/i }));
    expect(await screen.findByTestId('doc-url')).toHaveTextContent(
      'https://cdn.example.com/dealer-doc.pdf'
    );
  });

  it('locks role, documents, and save while the onboarding request is pending', async () => {
    const pendingEntry = {
      id: 'entry-pending-role',
      brands: 'acc',
      role: 'retailer',
      authorizationCertificateUrls: ['https://cdn.example.com/doc.png'],
      supplyChainRegistrationStarted: true
    };

    render(
      <SupplierSupplyChainEntriesEditor
        profile={makeProfile([pendingEntry])}
        setProfile={vi.fn()}
        editing
        sectionView="form"
        selectionMode="all"
        allowEntryManagement={false}
        showAddEntry={false}
        catalogBrands={CATALOG}
        catalogBrandsLoading={false}
        catalogBrandsError=""
        onReloadCatalogBrands={vi.fn()}
        supplierApprovedBrands={['acc']}
        supplierBrandRequests={[]}
        savedBaselineEntries={[pendingEntry]}
        approvedBaselineEntries={[]}
        filterBrandName="acc"
        chainProfileApprovalStatus="pending"
        onSaveEntry={vi.fn()}
      />
    );

    expect(await screen.findByText(/Request submitted successfully and sent for approval/i)).toBeInTheDocument();
    expect(screen.getByText(/Status: Pending approval/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Assigned supply-chain role/i)).toHaveValue('Retailer');
    expect(screen.queryByRole('button', { name: /Change role/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Request Role Change/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save entry/i })).not.toBeInTheDocument();
    expect(screen.getByTestId('docs-readonly')).toBeInTheDocument();
    expect(screen.queryByTestId('docs-editable')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Documents already submitted cannot be changed while this request is under processing/i)
    ).toBeInTheDocument();
  });
});
