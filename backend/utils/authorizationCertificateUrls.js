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
  if (!value || next.includes(value)) {
    return setBrandApprovalDocumentUrls(entry, next);
  }
  return setBrandApprovalDocumentUrls(entry, [...next, value]);
}

export function removeBrandApprovalDocumentUrl(entry, urlToRemove) {
  const value = String(urlToRemove || '').trim();
  if (!value) {
    return setBrandApprovalDocumentUrls(entry, []);
  }
  const next = resolveBrandApprovalDocumentUrls(entry).filter((u) => u !== value);
  return setBrandApprovalDocumentUrls(entry, next);
}
