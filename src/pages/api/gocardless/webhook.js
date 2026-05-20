export const prerender = false;

// Define pricing structures for automated subscription generation (including Developer sandbox)
const PLAN_PRICES = {
  test: { amount: 1, description: "SB Floristry - Developer Test Tier" },
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

  // 1. Verify Webhook Signature securely via Web Crypto API (required for Cloudflare worker environments)
  if (webhookSecret && signature) {
    const verified = await verifySignature(signature, bodyText, webhookSecret);
    if (!verified) {
      console.error("CRITICAL: Webhook signature verification failed!");
      return new Response("Invalid Signature", { status: 498 });
    }
    console.log("Webhook signature successfully verified.");
  } else if (webhookSecret) {
    console.warn("Webhook Secret is configured but no Webhook-Signature header was received.");
    return new Response("Missing Signature", { status: 400 });
  }

  try {
    const payload = JSON.parse(bodyText);

    if (payload.events) {
      for (const event of payload.events) {
        // Trigger Shopify Order and setup GoCardless automated schedule when billing request is fulfilled
        if (event.resource_type === 'billing_requests' && event.action === 'fulfilled') {
          const billingRequestId = event.links?.billing_request;
          console.log(`Processing fulfilled Billing Request: ${billingRequestId}`);

          if (!billingRequestId) {
            console.error("Event payload lacks billing_request ID link. Skipping.");
            continue;
          }

          // FALLBACK LOGIC: Check if mandate or customer link is directly missing from webhook payload
          let mandateId = event.links?.mandate_request_mandate || event.links?.mandate;
          let customerId = event.links?.customer;

          if (!mandateId || !customerId) {
            console.log(`Missing mandate or customer link directly in event. Querying GoCardless Billing Request API for ${billingRequestId}...`);
            const brRes = await fetch(`${apiBase}/billing_requests/${billingRequestId}`, {
              headers: {
                'Authorization': `Bearer ${gcToken}`,
                'GoCardless-Version': '2015-07-06'
              }
            });
            const brData = await brRes.json();
            if (brRes.ok && brData.billing_requests) {
              const br = brData.billing_requests;
              mandateId = mandateId || br.links?.mandate || br.links?.mandate_request_mandate;
              customerId = customerId || br.links?.customer;
              console.log(`Successfully fetched links from API. Mandate: ${mandateId}, Customer: ${customerId}`);
            } else {
              console.error(`Failed to retrieve Billing Request details from API: ${JSON.stringify(brData)}`);
            }
          }

          if (!mandateId || !customerId) {
            console.error("Mandate ID or Customer ID could not be retrieved. Skipping event execution.");
            continue;
          }

          // 2. Fetch Mandate details to extract checkout metadata configuration
          const mandateRes = await fetch(`${apiBase}/mandates/${mandateId}`, {
            headers: {
              'Authorization': `Bearer ${gcToken}`,
              'GoCardless-Version': '2015-07-06'
            }
          });
          const mandateData = await mandateRes.json();
          if (!mandateRes.ok) throw new Error(`GoCardless Mandate Fetch Error: ${JSON.stringify(mandateData)}`);

          const meta = mandateData.mandates.metadata || {};
          console.log("Successfully extracted mandate metadata:", meta);

          const planTier = meta.plan_tier || "test";

          // 3. Fetch Customer Details from GoCardless to assemble Shopify order payload
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

          // 4. Fire the order injection into headless Shopify Admin API
          const planInfo = PLAN_PRICES[planTier] || { amount: 1, description: "SB Floristry Subscription" };
          
          console.log(`Injecting paid subscription order into Shopify for ${customer.email}...`);
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
                note: `Subscription Details:\nFrequency: ${meta.frequency || "Weekly"}\nReason: ${meta.reason || "Gift/Treat"}\nDelivery Address:\n${meta.delivery_address || "Provided on file"}`,
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
          const schedule = FREQUENCY_INTERVALS[meta.frequency || "Weekly"];
          if (schedule) {
            console.log(`Setting up automated subscription schedule for ${fullName} (${meta.frequency || "Weekly"})`);
            
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
          } else {
            console.warn(`No schedule frequency match found for metadata frequency: ${meta.frequency}. Skipping automated recurring scheduler.`);
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

// Clean HMAC SHA-256 validation for Cloudflare Workers / Pages functions
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
      signature.trim().match(/.{1,2}/g).map(byte => parseInt(byte, 16))
    );
    return await crypto.subtle.verify('HMAC', key, signatureBuf, msgBuf);
  } catch (err) {
    console.error("Signature verification internal error:", err);
    return false;
  }
}
