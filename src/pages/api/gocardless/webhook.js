export const prerender = false;

// Define pricing structures for automated subscription generation (including Developer sandbox)
const PLAN_PRICES = {
  test: { amount: 100, description: "SB Floristry - Developer Test Tier" },
  classic: { amount: 2800, description: "SB Floristry - The Classic Subscription" },
  showstopper: { amount: 4100, description: "SB Floristry - The Showstopper Subscription" }
};

// Map customer frequency selections to GoCardless subscription schedule parameters
const FREQUENCY_INTERVALS = {
  Weekly: { interval_unit: "weekly", interval: 1 },
  Fortnightly: { interval_unit: "weekly", interval: 2 },
  "Three-Weekly": { interval_unit: "weekly", interval: 3 }
};

// Defensive Phone Number formatting to prevent Shopify 422 API errors on unprocessable strings
function cleanPhoneForShopify(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^\d+]/g, '');
  
  if (cleaned.startsWith('0') && !cleaned.startsWith('00')) {
    cleaned = '+44' + cleaned.slice(1);
  }
  
  if (!cleaned.startsWith('+') && cleaned.length >= 10) {
    cleaned = '+' + cleaned;
  }
  
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test(cleaned) ? cleaned : null;
}

// Parse combined order notes metadata cleanly using key-value splitting (safer than raw regex match)
function parseOrderNotes(notes) {
  const result = {
    name: "",
    email: "",
    phone: "",
    reason: "Subscription",
    address: ""
  };
  if (!notes) return result;

  const parts = notes.split('|').map(p => p.trim());
  parts.forEach(part => {
    if (part.startsWith("Name:")) {
      result.name = part.replace("Name:", "").trim();
    } else if (part.startsWith("Email:")) {
      result.email = part.replace("Email:", "").trim();
    } else if (part.startsWith("Phone:")) {
      result.phone = part.replace("Phone:", "").trim();
    } else if (part.startsWith("Reason:")) {
      result.reason = part.replace("Reason:", "").trim();
    } else if (part.startsWith("Addr:")) {
      result.address = part.replace("Addr:", "").trim();
    }
  });

  return result;
}

// Explicitly update the customer's parent Shopify contact card with the phone number
async function forceShopifyCustomerPhoneUpdate(customerId, phone, shopifyDomain, shopifyToken) {
  if (!customerId || !phone) return;
  try {
    const res = await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/${customerId}.json`, {
      method: 'PUT',
      headers: {
        'X-Shopify-Access-Token': shopifyToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customer: { id: customerId, phone: phone }
      })
    });
    if (res.ok) {
      console.log(`Successfully hard-updated Shopify Customer Contact Card Phone for ID: ${customerId}`);
    } else {
      const errData = await res.json();
      console.warn(`Shopify primary phone update failed (the number might be in use on another customer record):`, errData);
    }
  } catch (err) {
    console.error("Failed to execute explicit customer phone update:", err);
  }
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
        const meta = br.metadata || br.mandate_request?.metadata || {};
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

        // Parse our combined metadata object
        const orderNotes = meta.order_notes || "";
        const parsedMeta = parseOrderNotes(orderNotes);

        // BYPASS SANDBOX OVERRIDE: 
        // If customer details default back to sandbox placeholders, swap in our real parsed values.
        let firstName = customer.given_name;
        let lastName = customer.family_name;
        const isSandboxPlaceholder = 
          !firstName || 
          firstName.toLowerCase() === 'john' || 
          firstName.toLowerCase() === 'jane' || 
          lastName.toLowerCase() === 'doe' ||
          customer.email?.toLowerCase().includes('gocardless') ||
          customer.email?.toLowerCase().includes('sandbox');

        if (isSandboxPlaceholder && parsedMeta.name) {
          const nameParts = parsedMeta.name.split(' ');
          firstName = nameParts[0];
          lastName = nameParts.slice(1).join(' ') || "Customer";
        }

        let finalEmail = customer.email;
        if (!finalEmail || finalEmail.toLowerCase().includes("gocardless") || finalEmail.toLowerCase().includes("sandbox")) {
          finalEmail = parsedMeta.email || finalEmail;
        }

        // Prepare address elements. Fall back to metadata values if GoCardless has sandbox placeholders.
        let address1 = customer.address_line1;
        let city = customer.city;
        let zip = customer.postal_code;

        const isSandboxAddress = 
          !address1 || 
          address1 === "No address" || 
          address1.toLowerCase().includes("gocardless") ||
          address1.toLowerCase().includes("sandbox");

        if (isSandboxAddress && parsedMeta.address) {
          const addressLines = parsedMeta.address.split(',').map(l => l.trim()).filter(l => l);
          address1 = addressLines[0] || parsedMeta.address;
          city = addressLines[1] || "";
          zip = addressLines.length > 2 ? addressLines[addressLines.length - 1] : (addressLines[2] || "");
        }

        const rawPhone = customer.phone_number || parsedMeta.phone || "";
        const cleanedPhone = cleanPhoneForShopify(rawPhone);

        // Prepare Shopify Data
        const planInfo = PLAN_PRICES[planTier] || { amount: 100, description: "SB Floristry Subscription" };
        const frequency = meta.frequency || "Weekly";

        console.log(`Injecting paid subscription order into Shopify for ${finalEmail}...`);
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
                first_name: firstName,
                last_name: lastName,
                email: finalEmail,
                phone: cleanedPhone || undefined
              },
              shipping_address: {
                first_name: firstName,
                last_name: lastName,
                address1: address1.substring(0, 255),
                city: city.substring(0, 255),
                zip: zip.substring(0, 255),
                phone: rawPhone || undefined
              },
              billing_address: {
                first_name: firstName,
                last_name: lastName,
                address1: address1.substring(0, 255),
                city: city.substring(0, 255),
                zip: zip.substring(0, 255),
                phone: rawPhone || undefined
              },
              note: `Subscription Details:\nFrequency: ${frequency}\nReason: ${parsedMeta.reason}\nPhone: ${rawPhone}`,
              financial_status: "paid",
              tags: `GC-BRQ-${billingRequestId}`
            }
          })
        });

        const shopifyData = await shopifyRes.json();
        if (!shopifyRes.ok) {
          console.error("Shopify Order Creation Failed:", shopifyData);
        } else {
          console.log(`Shopify Order created successfully: ${shopifyData.order.id}`);
          
          // HARD UPDATE CONTACT INFORMATION CARD:
          // Triggers an explicit PUT request to store the validated number directly in Shopify's main customer contact profile.
          if (shopifyData.order?.customer?.id && cleanedPhone) {
            await forceShopifyCustomerPhoneUpdate(
              shopifyData.order.customer.id, 
              cleanedPhone, 
              shopifyDomain, 
              shopifyToken
            );
          }
        }

        // Establish the Automated GoCardless Subscription Schedule
        const schedule = FREQUENCY_INTERVALS[frequency];
        if (schedule) {
          console.log(`Setting up automated subscription schedule for ${firstName} ${lastName} (${frequency})`);
          
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
