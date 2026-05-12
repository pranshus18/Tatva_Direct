import { getApiUrl } from '../config/api';

export const SERVICE_PROVIDER_THEME_STORAGE_KEY = 'serviceProviderPortalThemePrefs';

export const SERVICE_PROVIDER_THEMES = [
  {
    id: 'default',
    label: 'Default',
    backgroundImage: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)'
  },
  {
    id: 'sunset',
    label: 'Sunset',
    backgroundImage: 'linear-gradient(135deg, #ffe5d4 0%, #ffd2dd 40%, #dbeafe 100%)'
  },
  {
    id: 'ocean',
    label: 'Ocean',
    backgroundImage: 'linear-gradient(135deg, #dbeafe 0%, #cffafe 45%, #e0f2fe 100%)'
  },
  {
    id: 'forest',
    label: 'Forest',
    backgroundImage: 'linear-gradient(135deg, #dcfce7 0%, #d1fae5 45%, #e2e8f0 100%)'
  },
  {
    id: 'city-lights',
    label: 'City Lights',
    backgroundImage:
      "url('https://images.unsplash.com/photo-1489515217757-5fd1be406fef?auto=format&fit=crop&w=1800&q=80')"
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    backgroundImage:
      "url('https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1800&q=80')"
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

export const getServiceProviderThemePrefs = () => {
  try {
    const raw = localStorage.getItem(SERVICE_PROVIDER_THEME_STORAGE_KEY);
    if (!raw) return DEFAULT_THEME_PREFS;
    const parsed = JSON.parse(raw);
    const validTheme = SERVICE_PROVIDER_THEMES.some((theme) => theme.id === parsed?.themeId);
    return {
      themeId: validTheme ? parsed.themeId : DEFAULT_THEME_PREFS.themeId,
      customImageDataUrl: String(parsed?.customImageDataUrl || '')
    };
  } catch {
    return DEFAULT_THEME_PREFS;
  }
};

export const saveServiceProviderThemePrefs = (prefs) => {
  const nextPrefs = {
    themeId: String(prefs?.themeId || DEFAULT_THEME_PREFS.themeId),
    customImageDataUrl: String(prefs?.customImageDataUrl || '')
  };
  localStorage.setItem(SERVICE_PROVIDER_THEME_STORAGE_KEY, JSON.stringify(nextPrefs));
  window.dispatchEvent(new CustomEvent('service-provider-theme-updated', { detail: nextPrefs }));
  return nextPrefs;
};

export const loadServiceProviderThemePrefsFromApi = async () => {
  const token = localStorage.getItem('token');
  if (!token) return null;
  const response = await fetch(getApiUrl('/api/profile/service-provider/theme'), {
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
  return saveServiceProviderThemePrefs(prefs);
};

export const saveServiceProviderThemePrefsToApi = async (prefs) => {
  const local = saveServiceProviderThemePrefs(prefs);
  const token = localStorage.getItem('token');
  if (!token) return local;
  try {
    await fetch(getApiUrl('/api/profile/service-provider/theme'), {
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

export const resolveServiceProviderThemeBackground = (prefs) => {
  const themeId = String(prefs?.themeId || DEFAULT_THEME_PREFS.themeId);
  if (themeId === 'custom' && prefs?.customImageDataUrl) {
    return `url('${prefs.customImageDataUrl}')`;
  }
  const theme = SERVICE_PROVIDER_THEMES.find((entry) => entry.id === themeId);
  return theme?.backgroundImage || SERVICE_PROVIDER_THEMES[0].backgroundImage;
};
