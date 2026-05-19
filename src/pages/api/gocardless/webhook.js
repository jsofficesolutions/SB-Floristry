export const prerender = false;

export const POST = async ({ request }) => {
  try {
    const body = await request.json();
    const events = body.events || [];

    // 1. Filter for successful payments
    // 'confirmed' means the bank has accepted the direct debit and the money is on its way.
    const paymentEvents = events.filter(e => e.resource_type === 'payments' && e.action === 'confirmed');

    if (paymentEvents.length === 0) {
      // Return 200 OK immediately for events we don't care about (like mandate creations)
      return new Response(JSON.stringify({ message: "Ignored non-payment event" }), { 
        status: 200, headers: { 'Content-Type': 'application/json' } 
      });
    }

    // Load Environment Variables safely in Cloudflare
    const gcToken = import.meta.env.GOCARDLESS_ACCESS_TOKEN;
    const gcEnv = import.meta.env.PUBLIC_GC_ENVIRONMENT || 'sandbox';
    const shopifyDomain = import.meta.env.SHOPIFY_STORE_DOMAIN; // e.g. sb-floristry.myshopify.com
    const shopifyToken = import.meta.env.SHOPIFY_ADMIN_TOKEN;

    const gcApiBase = gcEnv === 'live' ? 'https://api.gocardless.com' : 'https://api-sandbox.gocardless.com';

    for (const event of paymentEvents) {
      const paymentId = event.links.payment;

      // 2. Fetch the Payment from GoCardless
      const payRes = await fetch(`${gcApiBase}/payments/${paymentId}`, {
        headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
      });
      const payData = await payRes.json();
      const amount = (payData.payments.amount / 100).toFixed(2);
      const description = payData.payments.description;
      const mandateId = payData.payments.links.mandate;

      // 3. Fetch the Mandate (This contains the custom Delivery Metadata!)
      const manRes = await fetch(`${gcApiBase}/mandates/${mandateId}`, {
        headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
      });
      const manData = await manRes.json();
      const customerId = manData.mandates.links.customer;
      const metadata = manData.mandates.metadata || {};

      // 4. Fetch the Customer (Name and Email)
      const custRes = await fetch(`${gcApiBase}/customers/${customerId}`, {
        headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
      });
      const custData = await custRes.json();
      const customer = custData.customers;

      // 5. Create the Order in Shopify
      if (shopifyDomain && shopifyToken) {
        const orderPayload = {
          order: {
            email: customer.email,
            financial_status: "paid",
            tags: "Subscription, GoCardless",
            note: `Subscription Delivery\nFrequency: ${metadata.frequency || 'N/A'}\nReason: ${metadata.reason || 'N/A'}\nMandate: ${mandateId}`,
            shipping_address: {
              first_name: customer.given_name,
              last_name: customer.family_name,
              address1: metadata.delivery_address || "See GoCardless Notes",
              country: "GB"
            },
            customer: {
              first_name: customer.given_name,
              last_name: customer.family_name,
              email: customer.email
            },
            line_items: [
              {
                title: description || "SB Floristry Subscription",
                price: amount,
                quantity: 1,
                requires_shipping: true
              }
            ]
          }
        };

        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Shopify-Access-Token': shopifyToken
          },
          body: JSON.stringify(orderPayload)
        });

        if (!shopifyRes.ok) {
          const shopifyError = await shopifyRes.text();
          console.error("Shopify Order Creation Failed:", shopifyError);
        }
      }
    }

    // Always tell GoCardless the webhook was received successfully so they don't retry
    return new Response(JSON.stringify({ message: "Webhook processed successfully" }), { 
      status: 200, headers: { 'Content-Type': 'application/json' } 
    });

  } catch (error) {
    console.error("Webhook processing error:", error);
    return new Response(JSON.stringify({ error: "Processing error" }), { 
      status: 200, headers: { 'Content-Type': 'application/json' } 
    }); 
  }
};
