import { getApiUrl } from '../config/api';

export const SUPPLIER_PORTAL_THEME_STORAGE_KEY = 'supplierPortalThemePrefs';

/** Sky/blue presets aligned with supplier portal branding */
export const SUPPLIER_PORTAL_THEMES = [
  {
    id: 'default',
    label: 'Tatva Blue',
    backgroundImage: 'linear-gradient(180deg, #f6fbff 0%, #f4f8ff 100%)'
  },
  {
    id: 'ocean',
    label: 'Ocean',
    backgroundImage:
      'radial-gradient(circle at 0% 0%, rgba(14, 165, 233, 0.14), transparent 34%), radial-gradient(circle at 100% 100%, rgba(59, 130, 246, 0.1), transparent 36%), linear-gradient(180deg, #f6fbff 0%, #e0f2fe 100%)'
  },
  {
    id: 'sky',
    label: 'Sky',
    backgroundImage: 'linear-gradient(135deg, #e0f2fe 0%, #f0f9ff 50%, #f4f8ff 100%)'
  },
  {
    id: 'slate',
    label: 'Cool Slate',
    backgroundImage: 'linear-gradient(135deg, #f1f5f9 0%, #e0f2fe 45%, #f6fbff 100%)'
  },
  {
    id: 'custom',
    label: 'Custom Upload',
    backgroundImage: ''
  }
];

const DEFAULT_THEME_PREFS = {
  themeId: 'default',
  customImageDataUrl: ''
};

export const getSupplierPortalThemePrefs = () => {
  try {
    const raw = localStorage.getItem(SUPPLIER_PORTAL_THEME_STORAGE_KEY);
    if (!raw) return DEFAULT_THEME_PREFS;
    const parsed = JSON.parse(raw);
    const validTheme = SUPPLIER_PORTAL_THEMES.some((theme) => theme.id === parsed?.themeId);
    return {
      themeId: validTheme ? parsed.themeId : DEFAULT_THEME_PREFS.themeId,
      customImageDataUrl: String(parsed?.customImageDataUrl || '')
    };
  } catch {
    return DEFAULT_THEME_PREFS;
  }
};

export const saveSupplierPortalThemePrefs = (prefs) => {
  const nextPrefs = {
    themeId: String(prefs?.themeId || DEFAULT_THEME_PREFS.themeId),
    customImageDataUrl: String(prefs?.customImageDataUrl || '')
  };
  localStorage.setItem(SUPPLIER_PORTAL_THEME_STORAGE_KEY, JSON.stringify(nextPrefs));
  window.dispatchEvent(new CustomEvent('supplier-portal-theme-updated', { detail: nextPrefs }));
  return nextPrefs;
};

export const loadSupplierPortalThemePrefsFromApi = async () => {
  const token = localStorage.getItem('token');
  if (!token) return null;
  const response = await fetch(getApiUrl('/api/profile/supplier/theme'), {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  if (payload?.status !== 'success') return null;
  const prefs = {
    themeId: String(payload?.theme?.themeId || 'default'),
    customImageDataUrl: String(payload?.theme?.customImageDataUrl || '')
  };
  return saveSupplierPortalThemePrefs(prefs);
};

export const saveSupplierPortalThemePrefsToApi = async (prefs) => {
  const local = saveSupplierPortalThemePrefs(prefs);
  const token = localStorage.getItem('token');
  if (!token) return local;
  try {
    await fetch(getApiUrl('/api/profile/supplier/theme'), {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(local)
    });
  } catch {
    // Keep local save even if remote sync fails.
  }
  return local;
};

export const resolveSupplierPortalThemeBackground = (prefs) => {
  const themeId = String(prefs?.themeId || DEFAULT_THEME_PREFS.themeId);
  if (themeId === 'custom' && prefs?.customImageDataUrl) {
    return `url('${prefs.customImageDataUrl}')`;
  }
  const theme = SUPPLIER_PORTAL_THEMES.find((entry) => entry.id === themeId);
  return theme?.backgroundImage || SUPPLIER_PORTAL_THEMES[0].backgroundImage;
};
