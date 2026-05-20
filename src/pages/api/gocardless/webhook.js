export const prerender = false;

export async function POST({ request }) {
  try {
    const body = await request.text();
    const payload = JSON.parse(body);

    const gcToken = import.meta.env.GOCARDLESS_ACCESS_TOKEN;
    const shopifyToken = import.meta.env.SHOPIFY_ADMIN_TOKEN;
    const shopifyDomain = import.meta.env.SHOPIFY_STORE_DOMAIN;
    const apiBase = import.meta.env.PUBLIC_GC_ENVIRONMENT === 'live' 
      ? 'https://api.gocardless.com' 
      : 'https://api-sandbox.gocardless.com';

    for (const event of payload.events) {
      if (event.resource_type === 'payments' && event.action === 'confirmed') {
        
        // 1. Fetch Mandate Metadata from GoCardless
        const paymentRes = await fetch(`${apiBase}/payments/${event.links.payment}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const paymentData = await paymentRes.json();
        const mandateId = paymentData.payments.links.mandate;

        const mandateRes = await fetch(`${apiBase}/mandates/${mandateId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const mandateData = await mandateRes.json();
        const meta = mandateData.mandates.metadata;

        // 2. Create Order in Shopify
        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': shopifyToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            order: {
              line_items: [{ title: "Subscription Delivery", quantity: 1, price: (paymentData.payments.amount / 100).toString() }],
              note: `Subscription Details:\nFrequency: ${meta.frequency}\nReason: ${meta.reason}\nAddress: ${meta.delivery_address}`,
              financial_status: "paid"
            }
          })
        });

        if (!shopifyRes.ok) throw new Error("Shopify API Error: " + await shopifyRes.text());
        console.log("Successfully created order in Shopify!");
      }
    }

    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  } catch (err) {
    console.error('Webhook error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
