export function resolveAuthorizationCertificateUrls(entry) {
  const urls = [];
  const seen = new Set();

  const add = (value) => {
    const url = String(value || '').trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  add(entry?.authorizationCertificateUrl);
  if (Array.isArray(entry?.authorizationCertificateUrls)) {
    entry.authorizationCertificateUrls.forEach(add);
  }

  return urls;
}

export function setAuthorizationCertificateUrls(entry, urls) {
  const list = [
    ...new Set((Array.isArray(urls) ? urls : []).map((u) => String(u || '').trim()).filter(Boolean))
  ];
  return {
    ...(entry || {}),
    authorizationCertificateUrls: list,
    authorizationCertificateUrl: list[0] || ''
  };
}

export function appendAuthorizationCertificateUrl(entry, url) {
  const next = resolveAuthorizationCertificateUrls(entry);
  const value = String(url || '').trim();
  if (!value || next.includes(value)) {
    return setAuthorizationCertificateUrls(entry, next);
  }
  return setAuthorizationCertificateUrls(entry, [...next, value]);
}

export function removeAuthorizationCertificateUrl(entry, urlToRemove) {
  const value = String(urlToRemove || '').trim();
  if (!value) {
    return setAuthorizationCertificateUrls(entry, []);
  }
  const next = resolveAuthorizationCertificateUrls(entry).filter((u) => u !== value);
  return setAuthorizationCertificateUrls(entry, next);
}

export function resolveBrandApprovalDocumentUrls(entry) {
  const urls = [];
  const seen = new Set();

  const add = (value) => {
    const url = String(value || '').trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  add(entry?.brandApprovalDocumentUrl);
  if (Array.isArray(entry?.brandApprovalDocumentUrls)) {
    entry.brandApprovalDocumentUrls.forEach(add);
  }

  return urls;
}

export function setBrandApprovalDocumentUrls(entry, urls) {
  const list = [
    ...new Set((Array.isArray(urls) ? urls : []).map((u) => String(u || '').trim()).filter(Boolean))
  ];
  return {
    ...(entry || {}),
    brandApprovalDocumentUrls: list,
    brandApprovalDocumentUrl: list[0] || ''
  };
}

export function appendBrandApprovalDocumentUrl(entry, url) {
  const next = resolveBrandApprovalDocumentUrls(entry);
  const value = String(url || '').trim();
  const withBrand =
    !value || next.includes(value)
      ? setBrandApprovalDocumentUrls(entry, next)
      : setBrandApprovalDocumentUrls(entry, [...next, value]);
  return stripBrandDocumentsFromRoleFields({ ...(entry || {}), ...withBrand });
}

export function removeBrandApprovalDocumentUrl(entry, urlToRemove) {
  const value = String(urlToRemove || '').trim();
  if (!value) {
    return setBrandApprovalDocumentUrls(entry, []);
  }
  const next = resolveBrandApprovalDocumentUrls(entry).filter((u) => u !== value);
  return setBrandApprovalDocumentUrls(entry, next);
}

function isBrandApprovalStorageUrl(url) {
  return /\/brand-approval-documents\//i.test(String(url || '').trim());
}

/** Role verification docs only — excludes URLs stored for Step 1 brand approval. */
export function resolveRoleVerificationDocumentUrls(entry) {
  const brandUrls = new Set(resolveBrandApprovalDocumentUrls(entry));
  return resolveAuthorizationCertificateUrls(entry).filter(
    (url) => !brandUrls.has(url) && !isBrandApprovalStorageUrl(url)
  );
}

/** Remove brand-approval URLs mistakenly stored on supply-chain role document fields. */
export function stripBrandDocumentsFromRoleFields(entry) {
  const brandUrls = new Set(resolveBrandApprovalDocumentUrls(entry));
  if (brandUrls.size === 0) return entry;
  const roleUrls = resolveAuthorizationCertificateUrls(entry).filter((url) => !brandUrls.has(url));
  return {
    ...(entry || {}),
    ...setAuthorizationCertificateUrls({}, roleUrls)
  };
}

/** Normalize brand vs role document fields after merges or profile loads. */
export function normalizeEntryDocumentFields(entry) {
  const brandFields = setBrandApprovalDocumentUrls({}, resolveBrandApprovalDocumentUrls(entry));
  return stripBrandDocumentsFromRoleFields({ ...(entry || {}), ...brandFields });
}
