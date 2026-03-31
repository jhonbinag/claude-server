/**
 * src/services/emailService.js
 *
 * Simple email sender using nodemailer.
 * Configure via env vars: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * When SMTP_HOST is not set (dev/local), logs the email to console instead of sending.
 */

const nodemailer = require('nodemailer');

/**
 * Resolve SMTP config: DB config (if enabled) → env vars → null (dev/log mode).
 * Returns null when neither is configured.
 */
async function resolveSmtpConfig() {
  // Try DB config first
  try {
    const store = require('./smtpConfigStore');
    const cfg = await store.getSmtpConfig();
    if (cfg.enabled && cfg.host && cfg.user && cfg.pass) {
      return { host: cfg.host, port: cfg.port, secure: cfg.secure, user: cfg.user, pass: cfg.pass, from: cfg.from };
    }
  } catch { /* ignore — store may not be available */ }

  // Fall back to env vars
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return {
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      user:   process.env.SMTP_USER,
      pass:   process.env.SMTP_PASS,
      from:   process.env.SMTP_FROM || '"HL Pro Tools" <noreply@hlprotools.com>',
    };
  }

  return null; // not configured
}

async function getTransporter() {
  const cfg = await resolveSmtpConfig();
  if (!cfg) return null;
  return {
    transport: nodemailer.createTransport({
      host:   cfg.host,
      port:   cfg.port,
      secure: cfg.secure,
      auth:   { user: cfg.user, pass: cfg.pass },
    }),
    from: cfg.from,
  };
}

/**
 * Send activation email to a new Admin Dashboard credential.
 * @param {{ to, name, username, password, activationUrl }} opts
 */
async function sendActivationEmail({ to, name, username, password, activationUrl }) {
  const cfg = await getTransporter();

  if (!cfg) {
    console.log('[emailService] SMTP not configured — printing activation email to console:');
    console.log(`  To: ${to}`);
    console.log(`  Username: ${username}`);
    console.log(`  Password: ${password}`);
    console.log(`  Activation URL: ${activationUrl}`);
    return { sent: false, skipped: true };
  }

  const { transport: transporter, from } = cfg;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #07080f; color: #e5e7eb; margin: 0; padding: 40px 16px; }
    .wrap { max-width: 520px; margin: 0 auto; background: #0f1117; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 36px 32px; }
    .logo { font-size: 34px; text-align: center; margin-bottom: 8px; }
    h1 { color: #f1f5f9; font-size: 20px; text-align: center; margin: 0 0 6px; }
    .sub { color: #4b5563; font-size: 13px; text-align: center; margin: 0 0 28px; }
    .field { background: #0a0f1a; border: 1px solid #1f2937; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; }
    .field-label { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
    .field-value { font-family: monospace; font-size: 15px; color: #a5b4fc; letter-spacing: 0.03em; }
    .btn { display: block; background: #6366f1; color: #fff !important; text-decoration: none; text-align: center; padding: 14px 24px; border-radius: 10px; font-size: 15px; font-weight: 600; margin: 28px 0; }
    .note { font-size: 12px; color: #374151; margin-top: 20px; line-height: 1.7; border-top: 1px solid #1f2937; padding-top: 16px; }
    .step { display: flex; align-items: flex-start; gap: 10px; margin-bottom: 10px; font-size: 13px; color: #9ca3af; }
    .step-num { background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.3); color: #a5b4fc; width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; margin-top: 1px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="logo">🧩</div>
    <h1>Admin Dashboard Access</h1>
    <p class="sub">HL Pro Tools</p>

    <p style="color:#9ca3af;font-size:14px;margin:0 0 20px;line-height:1.7;">
      Hi <strong style="color:#e5e7eb;">${name || username}</strong>, your Admin Dashboard account has been created.
      Use the credentials below and click the button to activate your access.
    </p>

    <div class="field">
      <div class="field-label">Username</div>
      <div class="field-value">${username}</div>
    </div>
    <div class="field">
      <div class="field-label">Password</div>
      <div class="field-value">${password}</div>
    </div>

    <a href="${activationUrl}" class="btn">Activate My Account &rarr;</a>

    <div style="margin-bottom:20px;">
      <div class="step"><span class="step-num">1</span><span>Click the button above to activate your account.</span></div>
      <div class="step"><span class="step-num">2</span><span>You'll be redirected to the login page automatically.</span></div>
      <div class="step"><span class="step-num">3</span><span>Sign in with the username and password shown above.</span></div>
    </div>

    <div class="note">
      This activation link expires in <strong>72 hours</strong>. You must activate before you can log in.<br>
      If you did not expect this email, you can safely ignore it — no action needed.
    </div>
  </div>
</body>
</html>`;

  await transporter.sendMail({
    from,
    to,
    subject: 'Activate Your Admin Dashboard Access — HL Pro Tools',
    html,
    text: `Hi ${name || username},\n\nYour Admin Dashboard account has been created.\n\nUsername: ${username}\nPassword: ${password}\n\nActivate your account here:\n${activationUrl}\n\nThis link expires in 72 hours. You must activate before you can log in.\n\n— HL Pro Tools`,
  });

  return { sent: true };
}

/**
 * Send a test email using only the DB-stored SMTP config (never env vars).
 */
async function sendTestEmail(to) {
  let dbCfg = null;
  try {
    const store = require('./smtpConfigStore');
    const cfg = await store.getSmtpConfig();
    if (cfg.host && cfg.user && cfg.pass) dbCfg = cfg;
  } catch { /* ignore */ }

  if (!dbCfg) return { sent: false, error: 'SMTP not configured. Save your SMTP settings first.' };

  const transport = nodemailer.createTransport({
    host:   dbCfg.host,
    port:   dbCfg.port,
    secure: dbCfg.secure,
    auth:   { user: dbCfg.user, pass: dbCfg.pass },
  });
  await transport.sendMail({
    from: dbCfg.from || dbCfg.user,
    to,
    subject: 'HL Pro Tools — SMTP Test',
    html: '<p>Your SMTP configuration is working correctly.</p>',
    text: 'Your SMTP configuration is working correctly.',
  });
  return { sent: true };
}

module.exports = { sendActivationEmail, sendTestEmail, resolveSmtpConfig };
