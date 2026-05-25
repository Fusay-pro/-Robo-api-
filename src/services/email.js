// Email service — uses Resend when RESEND_API_KEY is set, else logs to console.
// Sign up at https://resend.com (free 3k emails/mo), verify a sending domain,
// then add RESEND_API_KEY=... and RESEND_FROM_EMAIL=... to .env

const FROM = process.env.RESEND_FROM_EMAIL || 'RoboKids <onboarding@resend.dev>';

let resendClient = null;
if (process.env.RESEND_API_KEY) {
  try {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  } catch (e) {
    console.warn('[email] failed to init Resend:', e.message);
  }
} else {
  console.warn('[email] RESEND_API_KEY not set — OTP codes will be logged to console only');
}

async function sendOtpEmail(to, code) {
  const subject = `Your RoboKids verification code: ${code}`;
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:480px;margin:24px auto;padding:32px;background:#fff;border-radius:16px;border:1px solid #e5e7eb;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
        <div style="width:36px;height:36px;background:linear-gradient(135deg,#0ea5e9 0%,#006686 100%);border-radius:10px;"></div>
        <span style="font-size:20px;font-weight:700;color:#006686;">RoboKids</span>
      </div>
      <h2 style="margin:0 0 12px;font-size:22px;color:#111;">Verify your email</h2>
      <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.5;">
        Use this 4-digit code in the RoboKids parent app to finish signing up. The code expires in 10 minutes.
      </p>
      <div style="text-align:center;margin:24px 0;">
        <span style="display:inline-block;font-size:36px;font-weight:800;letter-spacing:0.4em;color:#0ea5e9;background:#f0f9ff;padding:18px 28px;border-radius:12px;font-family:'Courier New',monospace;">${code}</span>
      </div>
      <p style="margin:24px 0 0;color:#888;font-size:12px;line-height:1.5;">
        If you didn't try to register, you can safely ignore this email — nothing was created.
      </p>
    </div>
  `;
  const text = `Your RoboKids verification code is: ${code}\n\nThis code expires in 10 minutes.\nIf you didn't request this, ignore this email.`;

  if (!resendClient) {
    console.log(`[email] OTP for ${to}: ${code} (console fallback — set RESEND_API_KEY to send for real)`);
    return { mocked: true };
  }

  try {
    const result = await resendClient.emails.send({ from: FROM, to, subject, html, text });
    if (result.error) {
      console.error('[email] Resend error:', result.error);
      throw new Error(result.error.message || 'Failed to send email');
    }
    return result.data;
  } catch (err) {
    console.error('[email] send failed:', err.message);
    throw err;
  }
}

module.exports = { sendOtpEmail };
