export const prerender = false;

// Define pricing structures matching our elevated luxury tiering (£45 and £75)
const PLAN_PRICES = {
  test: { amount: 100, description: "SB Floristry - Developer Test Tier" },
  classic: { amount: 4500, description: "SB Floristry - The Signature Classic Box" },
  showstopper: { amount: 7500, description: "SB Floristry - The Grand Showstopper Box" }
};

// Map customer frequency selections (including Three-Weekly) to GoCardless subscription parameters
const FREQUENCY_INTERVALS = {
  Weekly: { interval_unit: "weekly", interval: 1 },
  Fortnightly: { interval_unit: "weekly", interval: 2 },
  "Three-Weekly": { interval_unit: "weekly", interval: 3 }
};

// Defensive Phone Number formatting to prevent Shopify 422 API errors on unprocessable strings
function cleanPhoneForShopify(phone) {
  if (!phone) return null;
  // Remove spaces, dashes, brackets
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  // Format local UK mobile & landline numbers to correct E.164 standard
  if (cleaned.startsWith('0') && !cleaned.startsWith('00')) {
    cleaned = '+44' + cleaned.slice(1);
  }
  
  // Append + if it's country-prefix-only
  if (!cleaned.startsWith('+') && cleaned.length >= 10) {
    cleaned = '+' + cleaned;
  }
  
  // Strict check: Shopify requires leading plus followed by 10-15 digits
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test(cleaned) ? cleaned : null;
}

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
    const eventId = event.id;
    console.log(`Processing Webhook Event ID: ${eventId} | Resource: ${event.resource_type} | Action: ${event.action}`);

    // ==========================================
    // LIFECYCLE EVENT 1: Initial Signup (Billing Request Fulfilled)
    // ==========================================
    if (event.resource_type === 'billing_requests' && event.action === 'fulfilled') {
      const billingRequestId = event.links?.billing_request;
      if (!billingRequestId) continue;

      try {
        // IDEMPOTENCY CHECK: Query Shopify to check if an order with this Billing Request ID tag already exists
        const checkRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json?status=any&tag=GC-BRQ-${billingRequestId}`, {
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }
        });
        
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.orders && checkData.orders.length > 0) {
            console.log(`DUPLICATE DETECTED: Shopify order already exists for Billing Request ${billingRequestId}. Skipping.`);
            continue;
          }
        }

        // Fetch parent Billing Request
        const brRes = await fetch(`${apiBase}/billing_requests/${billingRequestId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const brData = await brRes.json();
        if (!brRes.ok) continue;

        const br = brData.billing_requests;
        
        // Metadata in create-checkout is nested under mandate_request.metadata, fallback to root metadata
        const meta = br.mandate_request?.metadata || br.metadata || {};
        const planTier = meta.plan_tier || "test";
        const mandateId = br.links?.mandate || br.links?.mandate_request_mandate;
        const customerId = br.links?.customer;

        if (!mandateId || !customerId) continue;

        // Fetch Customer Details
        const customerRes = await fetch(`${apiBase}/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const customerData = await customerRes.json();
        if (!customerRes.ok) continue;

        const customer = customerData.customers;
        const fullName = `${customer.given_name} ${customer.family_name}`;
        const planInfo = PLAN_PRICES[planTier] || { amount: 100, description: "SB Floristry Subscription" };
        const frequency = meta.frequency || "Weekly";
        const orderNotes = meta.order_notes || "Provided on file";

        // Parse fallback address from order notes in case GoCardless fields are missing
        let reasonPart = "Subscription";
        let rawAddress = "Address on file";
        if (orderNotes.includes('| Addr: ')) {
            const parts = orderNotes.split('| Addr: ');
            reasonPart = parts[0].replace('Reason:', '').trim();
            rawAddress = parts[1].trim();
        } else {
            rawAddress = orderNotes;
        }

        const addressLines = rawAddress.split(',').map(l => l.trim()).filter(l => l);
        const fallbackAddress1 = addressLines[0] || rawAddress;
        const fallbackCity = addressLines[1] || "";
        const fallbackZip = addressLines.length > 2 ? addressLines[addressLines.length - 1] : (addressLines[2] || "");

        // Build precise Shipping & Billing Addresses using verified GoCardless Customer fields
        const finalAddress1 = customer.address_line1 || fallbackAddress1;
        const finalAddress2 = customer.address_line2 || "";
        const finalCity = customer.city || fallbackCity;
        const finalProvince = customer.region || "";
        const finalZip = customer.postal_code || fallbackZip;
        const finalCountryCode = customer.country_code || "GB";

        // Extract and defensively format phone numbers (falling back to our metadata)
        const rawPhone = customer.phone_number || meta.customer_phone || "";
        const cleanedPhone = cleanPhoneForShopify(rawPhone);

        // Inject first order into Shopify
        console.log(`Injecting initial subscription order into Shopify for ${customer.email}...`);
        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order: {
              line_items: [{ title: planInfo.description, quantity: 1, price: (planInfo.amount / 100).toString() }],
              customer: { 
                first_name: customer.given_name, 
                last_name: customer.family_name, 
                email: customer.email,
                phone: cleanedPhone || undefined // Only pass if strictly E.164 compliant to avoid 422 failures
              },
              shipping_address: { 
                first_name: customer.given_name, 
                last_name: customer.family_name, 
                address1: finalAddress1,
                address2: finalAddress2,
                city: finalCity,
                province: finalProvince,
                zip: finalZip,
                country_code: finalCountryCode,
                phone: rawPhone || undefined // Address cards are less strict; pass the raw/cleaned number here
              },
              billing_address: { 
                first_name: customer.given_name, 
                last_name: customer.family_name, 
                address1: finalAddress1,
                address2: finalAddress2,
                city: finalCity,
                province: finalProvince,
                zip: finalZip,
                country_code: finalCountryCode,
                phone: rawPhone || undefined
              },
              note: `Subscription Details:\nFrequency: ${frequency}\nReason: ${reasonPart}\nPhone: ${rawPhone}`,
              financial_status: "paid",
              tags: `GC-BRQ-${billingRequestId}, Active-Subscriber`
            }
          })
        });

        // Establish GoCardless Subscription Schedule
        const schedule = FREQUENCY_INTERVALS[frequency];
        if (schedule) {
          console.log(`Setting up automated subscription schedule for ${fullName} (${frequency})`);
          await fetch(`${apiBase}/subscriptions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06', 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subscriptions: {
                amount: planInfo.amount,
                currency: "GBP",
                name: planInfo.description,
                interval_unit: schedule.interval_unit,
                interval: schedule.interval,
                links: { mandate: mandateId },
                metadata: {
                  plan_tier: planTier,
                  frequency: frequency,
                  shipping_address: rawAddress,
                  reason: reasonPart,
                  customer_phone: rawPhone || ""
                }
              }
            })
          });
        }
      } catch (err) {
        console.error("Error handling billing request fulfilled event:", err);
      }
    }

    // ==========================================
    // LIFECYCLE EVENT 2: Automated Subscription Charges (Future Orders)
    // ==========================================
    if (event.resource_type === 'payments' && event.action === 'confirmed') {
      const paymentId = event.links?.payment;
      if (!paymentId) continue;

      try {
        // Query GoCardless to fetch payment details
        const paymentRes = await fetch(`${apiBase}/payments/${paymentId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const paymentData = await paymentRes.json();
        if (!paymentRes.ok) continue;

        const payment = paymentData.payments;
        const subscriptionId = payment.links?.subscription;

        // Only process if the payment came from an active subscription schedule
        if (!subscriptionId) {
          console.log(`Payment ${paymentId} is a one-off payment, not a subscription renewal. Skipping order generation.`);
          continue;
        }

        // IDEMPOTENCY CHECK: Ensure we haven't already processed this recurring payment ID
        const checkRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json?status=any&tag=GC-PM-${paymentId}`, {
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }
        });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.orders && checkData.orders.length > 0) {
            console.log(`DUPLICATE DETECTED: Shopify order already exists for Subscription Payment ${paymentId}. Skipping.`);
            continue;
          }
        }

        // Fetch parent Subscription metadata to get shipping details & plans
        const subRes = await fetch(`${apiBase}/subscriptions/${subscriptionId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const subData = await subRes.json();
        if (!subRes.ok) continue;

        const sub = subData.subscriptions;
        const subMeta = sub.metadata || {};

        const planTier = subMeta.plan_tier || "classic";
        const frequency = subMeta.frequency || "Weekly";
        const rawAddress = subMeta.shipping_address || "Address on file";
        const reason = subMeta.reason || "Subscription";
        const subPhone = subMeta.customer_phone || "";

        // Fetch Customer details to get email and names
        const customerId = sub.links?.customer || payment.links?.customer;
        const customerRes = await fetch(`${apiBase}/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const customerData = await customerRes.json();
        if (!customerRes.ok) continue;

        const customer = customerData.customers;
        const planInfo = PLAN_PRICES[planTier] || PLAN_PRICES.classic;

        const addressLines = rawAddress.split(',').map(l => l.trim()).filter(l => l);
        const fallbackAddress1 = addressLines[0] || rawAddress;
        const fallbackCity = addressLines[1] || "";
        const fallbackZip = addressLines.length > 2 ? addressLines[addressLines.length - 1] : (addressLines[2] || "");

        // Build final validated address properties
        const finalAddress1 = customer.address_line1 || fallbackAddress1;
        const finalAddress2 = customer.address_line2 || "";
        const finalCity = customer.city || fallbackCity;
        const finalProvince = customer.region || "";
        const finalZip = customer.postal_code || fallbackZip;
        const finalCountryCode = customer.country_code || "GB";

        // Extract and defensively format phone numbers
        const rawPhone = customer.phone_number || subPhone || "";
        const cleanedPhone = cleanPhoneForShopify(rawPhone);

        // Inject the recurring shipment order into Shopify automatically
        console.log(`Injecting recurring subscription shipment into Shopify for ${customer.email} (Payment: ${paymentId})`);
        await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order: {
              line_items: [{ title: `${planInfo.description} (Renewal)`, quantity: 1, price: (payment.amount / 100).toString() }],
              customer: { 
                first_name: customer.given_name, 
                last_name: customer.family_name, 
                email: customer.email,
                phone: cleanedPhone || undefined
              },
              shipping_address: { 
                first_name: customer.given_name, 
                last_name: customer.family_name, 
                address1: finalAddress1,
                address2: finalAddress2,
                city: finalCity,
                province: finalProvince,
                zip: finalZip,
                country_code: finalCountryCode,
                phone: rawPhone || undefined
              },
              billing_address: { 
                first_name: customer.given_name, 
                last_name: customer.family_name, 
                address1: finalAddress1,
                address2: finalAddress2,
                city: finalCity,
                province: finalProvince,
                zip: finalZip,
                country_code: finalCountryCode,
                phone: rawPhone || undefined
              },
              note: `Subscription Renewal Order:\nFrequency: ${frequency}\nReason: ${reason}\nLinked Subscription ID: ${subscriptionId}\nPhone: ${rawPhone}`,
              financial_status: "paid",
              tags: `GC-PM-${paymentId}, Subscription-Renewal`
            }
          })
        });

      } catch (err) {
        console.error(`Error processing recurring subscription payment ${paymentId}:`, err);
      }
    }

    // ==========================================
    // LIFECYCLE EVENT 3: Failed Payments & Protection (Fulfillment Lockout)
    // ==========================================
    if (event.resource_type === 'payments' && event.action === 'failed') {
      const paymentId = event.links?.payment;
      if (!paymentId) continue;

      try {
        const paymentRes = await fetch(`${apiBase}/payments/${paymentId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const paymentData = await paymentRes.json();
        if (!paymentRes.ok) continue;

        const customerId = paymentData.payments.links?.customer;
        const customerRes = await fetch(`${apiBase}/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const customerData = await customerRes.json();
        if (!customerRes.ok) continue;

        const customerEmail = customerData.customers.email;

        // Query Shopify for this customer profile to lock fulfillment
        console.log(`CRITICAL: Payment failed for subscriber email: ${customerEmail}. Querying Shopify to hold customer orders.`);
        const shopifyCustomerSearch = await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/search.json?query=email:${customerEmail}`, {
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }
        });

        if (shopifyCustomerSearch.ok) {
          const searchData = await shopifyCustomerSearch.json();
          const shopifyCustomer = searchData.customers?.[0];
          if (shopifyCustomer) {
            const currentTags = shopifyCustomer.tags ? shopifyCustomer.tags.split(',').map(t => t.trim()) : [];
            const newTags = [...new Set([...currentTags, 'Payment-Failed-Hold'])].filter(t => t !== 'Active-Subscriber').join(', ');

            await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/${shopifyCustomer.id}.json`, {
              method: 'PUT',
              headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
              body: JSON.stringify({ customer: { id: shopifyCustomer.id, tags: newTags } })
            });
            console.log(`Successfully locked customer ${shopifyCustomer.id} in Shopify with 'Payment-Failed-Hold' tag.`);
          }
        }
      } catch (err) {
        console.error(`Error handling failed payment ${paymentId}:`, err);
      }
    }

    // ==========================================
    // LIFECYCLE EVENT 4: Subscription Cancellation
    // ==========================================
    if (event.resource_type === 'subscriptions' && event.action === 'cancelled') {
      const subscriptionId = event.links?.subscription;
      if (!subscriptionId) continue;

      try {
        const subRes = await fetch(`${apiBase}/subscriptions/${subscriptionId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const subData = await subRes.json();
        if (!subRes.ok) continue;

        const customerId = subData.subscriptions.links?.customer;
        const customerRes = await fetch(`${apiBase}/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const customerData = await customerRes.json();
        if (!customerRes.ok) continue;

        const customerEmail = customerData.customers.email;

        console.log(`Subscription ${subscriptionId} cancelled. Adjusting Shopify tags for subscriber email: ${customerEmail}`);
        const shopifyCustomerSearch = await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/search.json?query=email:${customerEmail}`, {
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }
        });

        if (shopifyCustomerSearch.ok) {
          const searchData = await shopifyCustomerSearch.json();
          const shopifyCustomer = searchData.customers?.[0];
          if (shopifyCustomer) {
            const currentTags = shopifyCustomer.tags ? shopifyCustomer.tags.split(',').map(t => t.trim()) : [];
            const newTags = [...new Set([...currentTags, 'Subscription-Cancelled'])].filter(t => t !== 'Active-Subscriber').join(', ');

            await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/${shopifyCustomer.id}.json`, {
              method: 'PUT',
              headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
              body: JSON.stringify({ customer: { id: shopifyCustomer.id, tags: newTags } })
            });
            console.log(`Removed active state and applied 'Subscription-Cancelled' to Shopify customer ${shopifyCustomer.id}.`);
          }
        }
      } catch (err) {
        console.error(`Error processing subscription cancellation for ${subscriptionId}:`, err);
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
