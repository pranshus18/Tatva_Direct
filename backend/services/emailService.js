/**
 * Email sender with a safe fallback:
 * - Preferred: OAuth2 (no SMTP password stored)
 * - Optional fallback: classic SMTP username/password
 * - If not configured, we skip sending (but we still create receipts/notifications).
 * - Uses nodemailer if installed; if not installed, also skips and logs a warning.
 */

let cachedTransporter = null;

function isGmailOauthProvider() {
  return String(process.env.OAUTH2_PROVIDER || 'gmail').trim().toLowerCase() === 'gmail';
}

function hasOauth2Config() {
  return !!(
    process.env.OAUTH2_EMAIL &&
    process.env.OAUTH2_CLIENT_ID &&
    process.env.OAUTH2_CLIENT_SECRET &&
    process.env.OAUTH2_REFRESH_TOKEN
  );
}

function hasSmtpConfig() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

async function getTransporter() {
  if (cachedTransporter) return cachedTransporter;

  let nodemailer;
  try {
    nodemailer = await import('nodemailer');
  } catch (e) {
    console.warn('[emailService] nodemailer not installed; skipping email send.');
    return null;
  }

  // Preferred: OAuth2 (works great for Gmail / Google Workspace; also usable for other providers)
  if (hasOauth2Config()) {
    const provider = (process.env.OAUTH2_PROVIDER || 'gmail').toLowerCase();

    // For Gmail, nodemailer supports service='gmail'. For other providers, you may prefer
    // setting SMTP_HOST/SMTP_PORT and still using OAuth2, but we keep it simple here.
    const transportConfig =
      provider === 'gmail'
        ? {
            service: 'gmail',
            auth: {
              type: 'OAuth2',
              user: process.env.OAUTH2_EMAIL,
              clientId: process.env.OAUTH2_CLIENT_ID,
              clientSecret: process.env.OAUTH2_CLIENT_SECRET,
              refreshToken: process.env.OAUTH2_REFRESH_TOKEN
            }
          }
        : {
            service: provider,
            auth: {
              type: 'OAuth2',
              user: process.env.OAUTH2_EMAIL,
              clientId: process.env.OAUTH2_CLIENT_ID,
              clientSecret: process.env.OAUTH2_CLIENT_SECRET,
              refreshToken: process.env.OAUTH2_REFRESH_TOKEN
            }
          };

    cachedTransporter = nodemailer.createTransport(transportConfig);
    return cachedTransporter;
  }

  // Optional: classic SMTP password auth fallback
  if (!hasSmtpConfig()) return null;

  const port = Number(process.env.SMTP_PORT);
  const secure = process.env.SMTP_SECURE
    ? String(process.env.SMTP_SECURE).toLowerCase() === 'true'
    : port === 465;

  cachedTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  return cachedTransporter;
}

async function fetchOauthAccessToken() {
  if (!hasOauth2Config()) return null;
  const params = new URLSearchParams({
    client_id: process.env.OAUTH2_CLIENT_ID,
    client_secret: process.env.OAUTH2_CLIENT_SECRET,
    refresh_token: process.env.OAUTH2_REFRESH_TOKEN,
    grant_type: 'refresh_token'
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!response.ok) {
    const errPayload = await response.text().catch(() => '');
    throw new Error(`OAuth token fetch failed (${response.status}): ${errPayload}`);
  }
  const payload = await response.json();
  return payload?.access_token || null;
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

async function sendViaGmailApi({ from, to, subject, text, html }) {
  const sender = process.env.OAUTH2_EMAIL;
  if (!sender) return { ok: false, skipped: true, reason: 'missing_oauth2_email' };

  const accessToken = await fetchOauthAccessToken();
  if (!accessToken) return { ok: false, skipped: true, reason: 'missing_access_token' };

  const boundary = `tatva-${Date.now()}`;
  const plain = String(text || '').trim();
  const rich = String(html || '').trim();
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    plain,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    '',
    rich || `<p>${plain}</p>`,
    `--${boundary}--`
  ].join('\r\n');

  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(sender)}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: toBase64Url(mime) })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      skipped: false,
      reason: 'gmail_api_send_failed',
      error: payload?.error?.message || `HTTP ${response.status}`
    };
  }
  return { ok: true, messageId: payload.id || null, via: 'gmail_api' };
}

export async function sendEmail({ to, subject, text, html }) {
  const transporter = await getTransporter();
  if (!transporter) {
    return { ok: false, skipped: true, reason: 'email_not_configured_or_unavailable' };
  }

  const from =
    process.env.EMAIL_FROM ||
    process.env.OAUTH2_FROM ||
    process.env.SMTP_FROM ||
    process.env.OAUTH2_EMAIL ||
    process.env.SMTP_USER;

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html
    });
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    console.error('[emailService] sendMail failed:', e?.message || e);
    // Fallback for environments where SMTP socket is blocked but OAuth token works.
    if (hasOauth2Config() && isGmailOauthProvider()) {
      try {
        const fallbackResult = await sendViaGmailApi({ from, to, subject, text, html });
        if (fallbackResult?.ok) return fallbackResult;
        return fallbackResult;
      } catch (fallbackErr) {
        return {
          ok: false,
          skipped: false,
          reason: 'send_failed',
          error: fallbackErr?.message || e?.message || String(e)
        };
      }
    }
    return { ok: false, skipped: false, reason: 'send_failed', error: e?.message || String(e) };
  }
}

