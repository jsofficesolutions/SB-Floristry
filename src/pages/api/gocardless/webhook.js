export const prerender = false;

// Define pricing structures for automated subscription generation
const PLAN_PRICES = {
  classic: { amount: 4000, description: "SB Floristry - The Classic Subscription" },
  signature: { amount: 6500, description: "SB Floristry - The Signature Subscription" },
  luxe: { amount: 10000, description: "SB Floristry - The Luxe Subscription" }
};

// Map customer frequency selections to GoCardless subscription schedule parameters
const FREQUENCY_INTERVALS = {
  Weekly: { interval_unit: "weekly", interval: 1 },
  Fortnightly: { interval_unit: "weekly", interval: 2 },
  Monthly: { interval_unit: "monthly", interval: 1 }
};

export async function POST({ request, locals }) {
  const env = locals.runtime?.env || process.env;
  const gcToken = env.GOCARDLESS_ACCESS_TOKEN;
  const webhookSecret = env.GOCARDLESS_WEBHOOK_SECRET;
  const shopifyToken = env.SHOPIFY_ADMIN_TOKEN;
  const shopifyDomain = env.SHOPIFY_STORE_DOMAIN;

  const apiBase = env.PUBLIC_GC_ENVIRONMENT === 'live' 
    ? 'https://api.gocardless.com' 
    : 'https://api-sandbox.gocardless.com';

  const bodyText = await request.text();
  const signature = request.headers.get('Webhook-Signature');

  console.log("Webhook triggered. Signature present:", !!signature);

  // 1. Verify Signature securely (Using Cloudflare's native Web Crypto engine)
  if (webhookSecret && signature) {
    const verified = await verifySignature(signature, bodyText, webhookSecret);
    if (!verified) {
      console.error("CRITICAL: Webhook signature verification failed!");
      return new Response("Invalid Signature", { status: 498 });
    }
    console.log("Webhook signature successfully verified.");
  }

  try {
    const payload = JSON.parse(bodyText);

    if (payload.events) {
      for (const event of payload.events) {
        // Trigger Shopify Order and setup GoCardless automated schedule when billing request is fulfilled
        if (event.resource_type === 'billing_requests' && event.action === 'fulfilled') {
          console.log(`Processing fulfilled Billing Request: ${event.links.billing_request}`);

          const mandateId = event.links.mandate_request_mandate;
          const customerId = event.links.customer;

          if (!mandateId) {
            console.error("No mandate attached to fulfilled billing request. Skipping.");
            continue;
          }

          // 2. Fetch Mandate from GoCardless to retrieve metadata
          const mandateRes = await fetch(`${apiBase}/mandates/${mandateId}`, {
            headers: {
              'Authorization': `Bearer ${gcToken}`,
              'GoCardless-Version': '2015-07-06'
            }
          });
          const mandateData = await mandateRes.json();
          if (!mandateRes.ok) throw new Error(`GoCardless Mandate Fetch Error: ${JSON.stringify(mandateData)}`);

          const meta = mandateData.mandates.metadata;
          console.log("Successfully extracted mandate metadata:", meta);

          // 3. Fetch Customer Details from GoCardless to construct the Shopify Order
          const customerRes = await fetch(`${apiBase}/customers/${customerId}`, {
            headers: {
              'Authorization': `Bearer ${gcToken}`,
              'GoCardless-Version': '2015-07-06'
            }
          });
          const customerData = await customerRes.json();
          if (!customerRes.ok) throw new Error(`GoCardless Customer Fetch Error: ${JSON.stringify(customerData)}`);

          const customer = customerData.customers;
          const fullName = `${customer.given_name} ${customer.family_name}`;

          // 4. Create the Shopify Order
          const planInfo = PLAN_PRICES[meta.plan_tier] || { amount: 0, description: "SB Floristry Subscription" };
          const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json`, {
            method: 'POST',
            headers: {
              'X-Shopify-Access-Token': shopifyToken,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              order: {
                line_items: [{
                  title: planInfo.description,
                  quantity: 1,
                  price: (planInfo.amount / 100).toString()
                }],
                customer: {
                  first_name: customer.given_name,
                  last_name: customer.family_name,
                  email: customer.email
                },
                note: `Subscription Details:\nFrequency: ${meta.frequency}\nReason: ${meta.reason}\nDelivery Address:\n${meta.delivery_address}`,
                financial_status: "paid"
              }
            })
          });

          const shopifyData = await shopifyRes.json();
          if (!shopifyRes.ok) {
            console.error("Shopify Order Creation Failed:", shopifyData);
          } else {
            console.log(`Shopify Order created successfully: ${shopifyData.order.id}`);
          }

          // 5. Establish the Automated GoCardless Subscription Schedule
          const schedule = FREQUENCY_INTERVALS[meta.frequency];
          if (schedule && meta.plan_tier) {
            console.log(`Setting up automated subscription for ${fullName} (${meta.frequency})`);
            
            const subRes = await fetch(`${apiBase}/subscriptions`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${gcToken}`,
                'GoCardless-Version': '2015-07-06',
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                subscriptions: {
                  amount: planInfo.amount,
                  currency: "GBP",
                  name: planInfo.description,
                  interval_unit: schedule.interval_unit,
                  interval: schedule.interval,
                  links: { mandate: mandateId }
                }
              })
            });

            const subData = await subRes.json();
            if (!subRes.ok) {
              console.error("GoCardless Subscription Scheduling Failed:", subData);
            } else {
              console.log(`Subscription schedule established: ${subData.subscriptions.id}`);
            }
          }
        }
      }
    }

    return new Response(JSON.stringify({ status: 'success' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error("WEBHOOK ERROR IN CATCH:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// Cloudflare worker native HMAC SHA-256 Signature Verification
async function verifySignature(signature, bodyText, secret) {
  try {
    const encoder = new TextEncoder();
    const keyBuf = encoder.encode(secret);
    const msgBuf = encoder.encode(bodyText);
    const key = await crypto.subtle.importKey(
      'raw',
      keyBuf,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify', 'sign']
    );
    const signatureBuf = new Uint8Array(
      signature.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
    );
    return await crypto.subtle.verify('HMAC', key, signatureBuf, msgBuf);
  } catch (err) {
    console.error("Signature verification internal error:", err);
    return false;
  }
}
