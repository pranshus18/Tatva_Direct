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

export function isImageCertificateUrl(url) {
  return /\.(jpe?g|png|webp|gif)(\?|#|$)/i.test(String(url || ''));
}

export function certificateLabelFromUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return 'Document';
  try {
    const path = new URL(raw).pathname;
    const name = decodeURIComponent(path.split('/').pop() || '');
    return name || 'Document';
  } catch {
    const parts = raw.split('/');
    return decodeURIComponent(parts[parts.length - 1] || 'Document');
  }
}
