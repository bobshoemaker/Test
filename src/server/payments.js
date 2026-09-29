// Stripe Checkout for the design fee and the kit, over Stripe's REST API with fetch (no SDK, no dependency).
// The server creates a Checkout Session for a job, the owner pays on Stripe's page, and on return
// the server reads the session back from Stripe to confirm it's paid before any design runs.

const API = 'https://api.stripe.com/v1';

// Stripe takes form-encoded bodies with bracketed keys: line_items[0][price_data][currency]=usd.
function form(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (typeof v === 'object') form(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join('&');
}

function makeStripe({ secretKey, fetchImpl = fetch, apiBase = API }) {
  if (!secretKey) return null;
  async function call(method, path, body) {
    const res = await fetchImpl(apiBase + path, {
      method,
      headers: { authorization: `Bearer ${secretKey}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: body ? form(body) : undefined,
    });
    const j = await res.json();
    if (!res.ok) throw new Error(`Stripe: ${(j.error && j.error.message) || res.status}`);
    return j;
  }
  return {
    // One-off payment for one job; the job id rides in metadata and client_reference_id.
    // kind: 'fee' (the design fee) or 'kit'; shipping asks for a US shipping address (a kit is shipped)
    createCheckout: ({ jobId, amountCents, currency = 'usd', name, successUrl, cancelUrl, kind = 'fee', shipping = false }) => call('POST', '/checkout/sessions', {
      mode: 'payment',
      client_reference_id: jobId,
      metadata: { job: jobId, kind },
      ...(shipping ? { shipping_address_collection: { allowed_countries: ['US'] } } : {}),
      line_items: [{ quantity: 1, price_data: { currency, unit_amount: amountCents, product_data: { name } } }],
      success_url: successUrl,
      cancel_url: cancelUrl,
    }),
    getSession: (id) => call('GET', `/checkout/sessions/${encodeURIComponent(id)}`),
  };
}

module.exports = { makeStripe, form };
