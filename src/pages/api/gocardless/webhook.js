export const prerender = false;

// Define pricing structures for automated subscription generation (including Developer sandbox)
const PLAN_PRICES = {
  test: { amount: 100, description: "SB Floristry - Developer Test Tier" },
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

// GET handler to confirm the routing is active and prevent browser 404s
export async function GET() {
  return new Response("GoCardless Webhook Endpoint is Active. Send signed POST payloads to trigger.", {
    status: 200,
    headers: { 'Content-Type': 'text/plain' }
  });
}

export async function POST(context) {
  const { request, locals } = context;
  const env = locals.runtime?.env || import.meta.env || process.env || {};
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

  // 1. Verify Webhook Signature securely via Web Crypto API
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

  // Parse the payload safely
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch (err) {
    console.error("Failed to parse webhook JSON body:", err);
    return new Response("Invalid JSON", { status: 400 });
  }

  // 2. DEFENSIVE ARCHITECTURE: Process events in the background and respond instantly!
  const processPromise = handleWebhookEvents(payload, {
    apiBase,
    gcToken,
    shopifyDomain,
    shopifyToken
  });

  if (locals.runtime?.ctx?.waitUntil) {
    console.log("Cloudflare waitUntil context detected. Executing worker background tasks...");
    locals.runtime.ctx.waitUntil(processPromise);
  } else {
    console.log("Local or non-Cloudflare environment. Awaiting synchronously...");
    await processPromise;
  }

  // Instantly return 200 OK to GoCardless to prevent timeouts
  return new Response(JSON.stringify({ status: 'received' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Separate heavy background processing logic from GoCardless HTTP lifecycle
async function handleWebhookEvents(payload, config) {
  const { apiBase, gcToken, shopifyDomain, shopifyToken } = config;

  if (!payload.events) return;

  for (const event of payload.events) {
    if (event.resource_type === 'billing_requests' && event.action === 'fulfilled') {
      const billingRequestId = event.links?.billing_request;
      console.log(`Processing fulfilled Billing Request in background: ${billingRequestId}`);

      if (!billingRequestId) {
        console.error("Event payload lacks billing_request ID link. Skipping.");
        continue;
      }

      try {
        // IDEMPOTENCY CHECK: Query Shopify to check if an order with this Billing Request ID tag already exists
        console.log(`Checking Shopify for existing orders tagged with: GC-BRQ-${billingRequestId}`);
        const checkRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json?status=any&tag=GC-BRQ-${billingRequestId}`, {
          headers: {
            'X-Shopify-Access-Token': shopifyToken,
            'Content-Type': 'application/json'
          }
        });
        
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.orders && checkData.orders.length > 0) {
            console.log(`DUPLICATE DETECTED: Shopify order already exists (Order ID: ${checkData.orders[0].id}) for Billing Request ${billingRequestId}. Skipping duplicate generation.`);
            continue;
          }
        } else {
          console.warn(`Shopify existence check returned non-200 status: ${checkRes.status}. Attempting to proceed defensively.`);
        }

        // Fetch the parent Billing Request to reliably pull root metadata and links
        console.log(`Querying GoCardless Billing Request API for ${billingRequestId}...`);
        const brRes = await fetch(`${apiBase}/billing_requests/${billingRequestId}`, {
          headers: {
            'Authorization': `Bearer ${gcToken}`,
            'GoCardless-Version': '2015-07-06'
          }
        });
        const brData = await brRes.json();
        if (!brRes.ok) {
          console.error(`Failed to retrieve Billing Request details from API: ${JSON.stringify(brData)}`);
          continue;
        }

        const br = brData.billing_requests;
        const meta = br.metadata || {};
        console.log("Successfully extracted billing request metadata:", meta);

        const planTier = meta.plan_tier || "test";
        const mandateId = br.links?.mandate || br.links?.mandate_request_mandate;
        const customerId = br.links?.customer;

        if (!mandateId || !customerId) {
          console.error(`Mandate ID (${mandateId}) or Customer ID (${customerId}) is missing from the Billing Request links. Skipping.`);
          continue;
        }

        // Fetch Customer Details from GoCardless
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

        // Prepare Shopify Data
        const planInfo = PLAN_PRICES[planTier] || { amount: 100, description: "SB Floristry Subscription" };
        const frequency = meta.frequency || "Weekly";
        const orderNotes = meta.order_notes || "Provided on file";

        // Parse the merged address and reason back out
        let reasonPart = "Subscription";
        let rawAddress = "Address on file";
        
        if (orderNotes.includes('| Addr: ')) {
            const parts = orderNotes.split('| Addr: ');
            reasonPart = parts[0].replace('Reason:', '').trim();
            rawAddress = parts[1].trim();
        } else {
            rawAddress = orderNotes;
        }

        // Split by commas to find explicitly separated address1, city, and postcode for Shopify
        const addressLines = rawAddress.split(',').map(l => l.trim()).filter(l => l);
        const address1 = addressLines[0] || rawAddress;
        const city = addressLines[1] || "";
        // Safely extract postcode (handles cases where city might be the last array element)
        const zip = addressLines.length > 2 ? addressLines[addressLines.length - 1] : (addressLines[2] || "");

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
              shipping_address: {
                first_name: customer.given_name,
                last_name: customer.family_name,
                address1: address1.substring(0, 255),
                city: city.substring(0, 255),
                zip: zip.substring(0, 255)
              },
              note: `Subscription Details:\nFrequency: ${frequency}\nReason: ${reasonPart}`,
              financial_status: "paid",
              tags: `GC-BRQ-${billingRequestId}` // Stamped to search and avoid future duplicates
            }
          })
        });

        const shopifyData = await shopifyRes.json();
        if (!shopifyRes.ok) {
          console.error("Shopify Order Creation Failed:", shopifyData);
        } else {
          console.log(`Shopify Order created successfully: ${shopifyData.order.id}`);
        }

        // Establish the Automated GoCardless Subscription Schedule
        const schedule = FREQUENCY_INTERVALS[frequency];
        if (schedule) {
          console.log(`Setting up automated subscription schedule for ${fullName} (${frequency})`);
          
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
          console.warn(`No schedule frequency match found for metadata frequency: ${frequency}. Skipping automated scheduler.`);
        }

      } catch (err) {
        console.error(`Error processing event inside webhook background loop for ${billingRequestId}:`, err);
      }
    }
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
