// Email through Resend (https://resend.com), over its REST API with fetch (no SDK, no dependency):
// the design's link when it's ready, a kit order's confirmation, and "find my designs" (the links for an
// email address). RESEND_API_KEY turns it on; BRICKHOUSE_MAIL_FROM is the sender, on a domain verified
// at Resend (its test sender, onboarding@resend.dev, only delivers to the Resend account's own address).
// The emails say what we made and link to it; like the site, they never mention how it's made.

const API = 'https://api.resend.com/emails';
const EMAIL = /^[^\s@<>()",;:]{1,64}@[^\s@<>()",;:]{1,190}\.[a-z]{2,}$/i;
const cleanEmail = (e) => (typeof e === 'string' && EMAIL.test(e.trim()) && e.trim().length <= 254 ? e.trim().toLowerCase() : null);

function makeMailer({ apiKey, from = 'Brickhouse <onboarding@resend.dev>', fetchImpl = fetch }) {
  if (!apiKey) return null;
  return {
    async send({ to, subject, html, text }) {
      const res = await fetchImpl(API, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, html, text }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Resend: ${j.message || res.status}`);
      return j;
    },
  };
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// one simple layout in the site's colors, with a plain-text twin
function layout(title, paragraphs, button) {
  // a paragraph is text, or a link {label, href}
  const p = paragraphs.map((t) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5;color:#27211B">${typeof t === 'string' ? esc(t) : `<a href="${esc(t.href)}" style="color:#B4462A;font-weight:600">${esc(t.label)}</a>`}</p>`).join('');
  const b = button ? `<p style="margin:22px 0"><a href="${esc(button.href)}" style="background:#B4462A;color:#fff;text-decoration:none;font-weight:600;border-radius:999px;padding:12px 22px;display:inline-block">${esc(button.label)}</a></p>` : '';
  return `<div style="background:#F7F1E8;padding:28px 16px;font-family:Arial,Helvetica,sans-serif"><div style="max-width:520px;margin:0 auto;background:#FFFDF9;border-radius:16px;padding:26px 24px">`
    + `<p style="margin:0 0 18px;font-size:20px;font-weight:700;color:#B4462A">Brickhouse</p><h1 style="margin:0 0 14px;font-size:24px;color:#27211B">${esc(title)}</h1>${p}${b}`
    + `<p style="margin:18px 0 0;font-size:13px;color:#7A6E62">Keep this email: the link is how you get back to your design. We use your email only for your design and kit, and never share it.</p></div></div>`;
}
const text = (title, paragraphs, button) => [title, '', ...paragraphs.map((t) => (typeof t === 'string' ? t : `${t.label}: ${t.href}`)), ...(button ? ['', `${button.label}: ${button.href}`] : [])].join('\n');
const mail = (subject, title, paragraphs, button) => ({ subject, html: layout(title, paragraphs, button), text: text(title, paragraphs, button) });

const readyEmail = ({ name, link }) => mail(`Your brick house is ready: ${name || 'your house'}`, 'Your house is ready',
  [`We've finished designing ${name || 'your house'} in bricks. Turn it around in 3D, look through the first steps of the building guide, and order the kit when you're happy with it.`],
  { label: 'See your house', href: link });
const kitEmail = ({ name, link }) => mail(`Your kit is ordered: ${name || 'your house'}`, 'Thank you for your order',
  [`Your kit for ${name || 'your house'} is ordered. We'll sort every piece into bags and send it to you with the baseplate.`, 'The full building guide and parts list are unlocked now, whenever you want to look ahead.'],
  { label: 'Open your guide', href: link });
const shippedEmail = ({ name, link, tracking }) => mail(`Your kit is on its way: ${name || 'your house'}`, 'Your kit has shipped',
  [`Your kit for ${name || 'your house'} is on its way.`, `Tracking: ${tracking}`, 'The building guide is waiting for you whenever it arrives.'],
  { label: 'Open your guide', href: link });
const mineEmail = ({ count, link }) => mail('Your Brickhouse designs', 'Your designs',
  [`Here's the link to the ${count === 1 ? 'design' : `${count} designs`} made with this email address. It opens them on this device, and the device remembers them after that.`,
    'The link works for 24 hours. If you didn\'t ask for it, you can ignore this email.'],
  { label: 'See my designs', href: link });

module.exports = { makeMailer, cleanEmail, readyEmail, kitEmail, shippedEmail, mineEmail };
