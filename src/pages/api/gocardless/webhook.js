export const prerender = false;

const PLAN_PRICES = {
  test: { amount: 100, description: "SB Floristry - Developer Test Tier" },
  classic: { amount: 2800, description: "SB Floristry - The Classic Subscription" },
  showstopper: { amount: 4100, description: "SB Floristry - The Showstopper Subscription" }
};

const FREQUENCY_INTERVALS = {
  Weekly: { interval_unit: "weekly", interval: 1 },
  Fortnightly: { interval_unit: "weekly", interval: 2 },
  "Three-Weekly": { interval_unit: "weekly", interval: 3 }
};

function cleanPhoneForShopify(phone) {
  if (!phone) return null;
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('0') && !cleaned.startsWith('00')) cleaned = '+44' + cleaned.slice(1);
  if (!cleaned.startsWith('+') && cleaned.length >= 10) cleaned = '+' + cleaned;
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test(cleaned) ? cleaned : null;
}

function parseOrderNotes(notes) {
  const result = { name: "", email: "", phone: "", reason: "Subscription", address: "" };
  if (!notes || typeof notes !== 'string') return result;

  const parts = notes.split('|').map(p => p.trim());
  parts.forEach(part => {
    if (part.startsWith("Name:")) {
      const rawName = part.replace("Name:", "").trim();
      const nameParts = rawName.split(' ').filter(Boolean);
      if (nameParts.length >= 2) {
        result.name = rawName;
      } else if (nameParts.length === 1) {
        result.name = rawName + " Customer";
      } else {
        result.name = "Valued Customer";
      }
    }
    else if (part.startsWith("Email:")) result.email = part.replace("Email:", "").trim();
    else if (part.startsWith("Phone:")) result.phone = part.replace("Phone:", "").trim();
    else if (part.startsWith("Reason:")) result.reason = part.replace("Reason:", "").trim();
    else if (part.startsWith("Addr:")) result.address = part.replace("Addr:", "").trim();
  });
  return result;
}

function resolveCustomerDetails(gcCustomer, parsedMeta) {
  let firstName = gcCustomer.given_name || "";
  let lastName = gcCustomer.family_name || "";
  let email = gcCustomer.email || "";
  let address1 = gcCustomer.address_line1 || "";
  let city = gcCustomer.city || "";
  let zip = gcCustomer.postal_code || "";
  let phone = gcCustomer.phone_number || "";

  // 1. ALWAYS prefer the name from the metadata (the real form data)
  if (parsedMeta.name) {
    const nameParts = parsedMeta.name.split(' ').filter(Boolean);
    firstName = nameParts[0] || "Valued";
    lastName = nameParts.slice(1).join(' ') || "Customer";
  }
  // 2. If metadata is empty but GoCardless returned a full name in given_name, split it
  else if (!lastName && firstName.includes(' ')) {
    const nameParts = firstName.split(' ').filter(Boolean);
    firstName = nameParts[0] || firstName;
    lastName = nameParts.slice(1).join(' ') || "Customer";
  }

  // 3. Still handle the original sandbox fallbacks for email, address, etc.
  const isSandboxEmail = !email || email.toLowerCase().includes('gocardless') || email.toLowerCase().includes('sandbox');
  const isSandboxAddress = !address1 || address1 === "No address" || address1.toLowerCase().includes('gocardless') || address1.toLowerCase().includes('sandbox');

  if (isSandboxEmail && parsedMeta.email) email = parsedMeta.email;
  if (isSandboxAddress && parsedMeta.address) {
    const addrParts = parsedMeta.address.split(',').map(p => p.trim());
    address1 = addrParts[0] || parsedMeta.address;
    city = addrParts[1] || "";
    zip = addrParts.length > 2 ? addrParts[addrParts.length - 1] : (addrParts[2] || "");
  }
  if (!phone && parsedMeta.phone) phone = parsedMeta.phone;

  // final safety net
  if (!firstName) firstName = "Valued";
  if (!lastName) lastName = "Customer";

  return { firstName, lastName, email, address1, city, zip, phone, countryCode: gcCustomer.country_code || "GB" };
}

/**
 * Search for an existing Shopify customer by email, then by phone.
 * If found and the name looks like the sandbox placeholder, update it with the real name.
 * Returns the customer ID (or null).
 */
async function findOrCreateShopifyCustomer(resolved, shopifyDomain, shopifyToken) {
  // 1) Search by email
  if (resolved.email) {
    const searchRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(resolved.email)}`, {
      headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.customers?.length > 0) {
        const cust = searchData.customers[0];
        // Always update the customer name if it differs from what we have
        if (cust.first_name !== resolved.firstName || cust.last_name !== resolved.lastName) {
          console.log(`Updating customer ${cust.id} name from "${cust.first_name} ${cust.last_name}" to "${resolved.firstName} ${resolved.lastName}"`);
          await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/${cust.id}.json`, {
            method: 'PUT',
            headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customer: {
                id: cust.id,
                first_name: resolved.firstName,
                last_name: resolved.lastName
              }
            })
          });
        }
        return cust.id;
      }
    }
  }

  // 2) Search by phone
  if (resolved.phone) {
    const searchRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/search.json?query=phone:${encodeURIComponent(resolved.phone)}`, {
      headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }
    });
    if (searchRes.ok) {
      const searchData = await searchRes.json();
      if (searchData.customers?.length > 0) {
        const cust = searchData.customers[0];
        if (cust.first_name !== resolved.firstName || cust.last_name !== resolved.lastName) {
          console.log(`Updating customer ${cust.id} name from "${cust.first_name} ${cust.last_name}" to "${resolved.firstName} ${resolved.lastName}"`);
          await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/${cust.id}.json`, {
            method: 'PUT',
            headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              customer: {
                id: cust.id,
                first_name: resolved.firstName,
                last_name: resolved.lastName
              }
            })
          });
        }
        return cust.id;
      }
    }
  }

  return null;
}

async function forceShopifyCustomerPhoneUpdate(customerId, phone, shopifyDomain, shopifyToken) {
  if (!customerId || !phone) return;
  try {
    const res = await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/${customerId}.json`, {
      method: 'PUT',
      headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: { id: customerId, phone: phone } })
    });
    if (res.ok) console.log(`Successfully updated Shopify Customer Phone for ID: ${customerId}`);
  } catch (err) {
    console.error("Failed to update customer phone:", err);
  }
}

async function createShopifyOrder(customerDetails, planInfo, frequency, reason, tag, shopifyDomain, shopifyToken) {
  const resolved = customerDetails;
  const cleanedPhone = cleanPhoneForShopify(resolved.phone);

  // Find existing customer (or update placeholder names)
  const existingCustomerId = await findOrCreateShopifyCustomer(resolved, shopifyDomain, shopifyToken);

  const orderPayload = {
    order: {
      line_items: [{ title: planInfo.description, quantity: 1, price: (planInfo.amount / 100).toString() }],
      shipping_address: { 
        first_name: resolved.firstName, last_name: resolved.lastName, 
        address1: resolved.address1, city: resolved.city, zip: resolved.zip, 
        country_code: resolved.countryCode, phone: resolved.phone || undefined
      },
      billing_address: { 
        first_name: resolved.firstName, last_name: resolved.lastName, 
        address1: resolved.address1, city: resolved.city, zip: resolved.zip, 
        country_code: resolved.countryCode, phone: resolved.phone || undefined
      },
      note: `Subscription Details:\nFrequency: ${frequency}\nReason: ${reason}`,
      financial_status: "paid",
      tags: tag
    }
  };

  if (existingCustomerId) {
    // Attach to existing customer (name already updated if was placeholder)
    orderPayload.order.customer = { id: existingCustomerId };
  } else {
    // Create a new customer
    orderPayload.order.customer = {
      first_name: resolved.firstName,
      last_name: resolved.lastName,
      email: resolved.email,
      phone: cleanedPhone || undefined
    };
  }

  const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json`, {
    method: 'POST',
    headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(orderPayload)
  });

  const shopifyData = await shopifyRes.json();
  if (!shopifyRes.ok) {
    console.error("Shopify Order Creation Failed:", JSON.stringify(shopifyData, null, 2));
    return { success: false, error: shopifyData };
  }

  // Update phone if missing on existing customer
  if (existingCustomerId && cleanedPhone) {
    const custRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/${existingCustomerId}.json`, {
      headers: { 'X-Shopify-Access-Token': shopifyToken }
    });
    if (custRes.ok) {
      const custData = await custRes.json();
      if (!custData.customer.phone) {
        await forceShopifyCustomerPhoneUpdate(existingCustomerId, cleanedPhone, shopifyDomain, shopifyToken);
      }
    }
  }

  console.log(`Successfully created Shopify order for ${resolved.email}`);
  return { success: true, orderId: shopifyData.order?.id };
}

export async function GET() {
  return new Response("GoCardless Webhook Endpoint is Active.", { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(context) {
  const { request, locals } = context;
  const env = locals.runtime?.env || import.meta.env || process.env || {};
  const gcToken = env.GOCARDLESS_ACCESS_TOKEN;
  const webhookSecret = env.GOCARDLESS_WEBHOOK_SECRET;
  const shopifyToken = env.SHOPIFY_ADMIN_TOKEN;
  const shopifyDomain = env.SHOPIFY_STORE_DOMAIN;
  const apiBase = env.PUBLIC_GC_ENVIRONMENT === 'live' ? 'https://api.gocardless.com' : 'https://api-sandbox.gocardless.com';

  const bodyText = await request.text();
  const signature = request.headers.get('Webhook-Signature');

  if (webhookSecret && signature) {
    const verified = await verifySignature(signature, bodyText, webhookSecret);
    if (!verified) return new Response("Invalid Signature", { status: 498 });
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch (err) {
    return new Response("Invalid JSON", { status: 400 });
  }

  const processPromise = handleWebhookEvents(payload, { apiBase, gcToken, shopifyDomain, shopifyToken });
  if (locals.runtime?.ctx?.waitUntil) locals.runtime.ctx.waitUntil(processPromise);
  else await processPromise;

  return new Response(JSON.stringify({ status: 'received' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function handleWebhookEvents(payload, config) {
  const { apiBase, gcToken, shopifyDomain, shopifyToken } = config;
  if (!payload.events) return;

  // Helper: wait a short time (gives Shopify search a moment to index)
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  for (const event of payload.events) {

    // ==========================================
    // BILLING REQUEST FULFILLED – only ensure subscription exists
    // ==========================================
    if (event.resource_type === 'billing_requests' && event.action === 'fulfilled') {
      const billingRequestId = event.links?.billing_request;
      if (!billingRequestId) continue;

      try {
        // Fetch billing request to get mandate & metadata
        const brRes = await fetch(`${apiBase}/billing_requests/${billingRequestId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        if (!brRes.ok) continue;
        const brData = await brRes.json();
        const br = brData.billing_requests;
        const mandateId = br.links?.mandate || br.links?.mandate_request_mandate;
        const meta = br.mandate_request?.metadata || br.metadata || {};
        const planTier = meta.plan_tier || 'test';
        const frequency = meta.frequency || 'Weekly';
        const planInfo = PLAN_PRICES[planTier] || PLAN_PRICES.test;
        const schedule = FREQUENCY_INTERVALS[frequency];

        // Check if a subscription already exists for this mandate
        const existingSubsRes = await fetch(`${apiBase}/subscriptions?mandate=${mandateId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        if (existingSubsRes.ok) {
          const existingSubsData = await existingSubsRes.json();
          if (existingSubsData.subscriptions?.length > 0) continue; // already created – do nothing
        }

        // Create the subscription
        if (schedule) {
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
                  plan_tier: String(planTier),
                  frequency: String(frequency),
                  order_notes: (meta.order_notes || '').substring(0, 500)
                }
              }
            })
          });
        }
      } catch (err) {
        console.error("Error in billing_request.fulfilled:", err);
      }
    }

    // ==========================================
    // SUBSCRIPTION CREATED – create the ONE initial Shopify order
    // ==========================================
    if (event.resource_type === 'subscriptions' && event.action === 'created') {
      const subscriptionId = event.links?.subscription;
      if (!subscriptionId) continue;

      try {
        // Idempotency: wait a beat, then check for any existing order with this subscription tag
        await delay(2000);
        const checkRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json?status=any&tag=GC-SUB-${subscriptionId}`, {
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }
        });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.orders && checkData.orders.length > 0) continue; // already done
        }

        // Grab subscription & customer details
        const subRes = await fetch(`${apiBase}/subscriptions/${subscriptionId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const subData = await subRes.json();
        if (!subRes.ok) continue;

        const subMeta = subData.subscriptions.metadata || {};
        const planTier = subMeta.plan_tier || 'test';
        const frequency = subMeta.frequency || 'Weekly';
        const orderNotes = subMeta.order_notes || '';

        // Resolve customer ID (check subscription, then mandate, then billing request if needed)
        let customerId = subData.subscriptions.links?.customer;
        if (!customerId) {
          const mandateId = subData.subscriptions.links?.mandate;
          if (mandateId) {
            const mandateRes = await fetch(`${apiBase}/mandates/${mandateId}`, {
              headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
            });
            const mandateData = await mandateRes.json();
            if (mandateRes.ok) customerId = mandateData.mandates.links?.customer;
          }
        }
        if (!customerId) continue;

        const customerRes = await fetch(`${apiBase}/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const customerData = await customerRes.json();
        if (!customerRes.ok) continue;

        const parsedMeta = parseOrderNotes(orderNotes);
        const resolved = resolveCustomerDetails(customerData.customers, parsedMeta);
        const planInfo = PLAN_PRICES[planTier] || PLAN_PRICES.test;

        console.log(`Creating INITIAL order for ${resolved.email} (sub ${subscriptionId})`);
        await createShopifyOrder(
          resolved,
          planInfo,
          frequency,
          parsedMeta.reason,
          `GC-SUB-${subscriptionId}, Active-Subscriber`,
          shopifyDomain,
          shopifyToken
        );

        // Optional: mark subscription metadata with flag
        await fetch(`${apiBase}/subscriptions/${subscriptionId}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriptions: {
              metadata: {
                ...subMeta,
                initial_order_created: 'true'
              }
            }
          })
        });

      } catch (err) {
        console.error("Error in subscriptions.created:", err);
      }
    }

    // ==========================================
    // RECURRING PAYMENTS – only for renewals, NOT the first charge
    // ==========================================
    if (event.resource_type === 'payments' && event.action === 'confirmed') {
      const paymentId = event.links?.payment;
      if (!paymentId) continue;

      try {
        // Get payment details
        const paymentRes = await fetch(`${apiBase}/payments/${paymentId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const paymentData = await paymentRes.json();
        if (!paymentRes.ok) continue;
        const payment = paymentData.payments;
        const subscriptionId = payment.links?.subscription;
        if (!subscriptionId) continue; // must be linked to a subscription

        // If this is the first payment, an initial order should already exist.
        // We skip this payment entirely (it was already covered by the subscription.created event).
        const initialOrderCheck = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json?status=any&tag=GC-SUB-${subscriptionId}`, {
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }
        });
        if (initialOrderCheck.ok) {
          const checkData = await initialOrderCheck.json();
          if (checkData.orders && checkData.orders.length > 0) {
            // There's already an initial order – this is a renewal (or the very first payment that we deliberately ignore)
            // Now create the renewal order if we haven't already
            const renewalCheck = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json?status=any&tag=GC-PM-${paymentId}`, {
              headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }
            });
            if (renewalCheck.ok) {
              const renewalData = await renewalCheck.json();
              if (renewalData.orders?.length > 0) continue; // already processed this payment
            }

            // Fetch customer & metadata
            const subRes = await fetch(`${apiBase}/subscriptions/${subscriptionId}`, {
              headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
            });
            const subData = await subRes.json();
            if (!subRes.ok) continue;
            const subMeta = subData.subscriptions.metadata || {};
            const planTier = subMeta.plan_tier || 'classic';
            const frequency = subMeta.frequency || 'Weekly';
            const orderNotes = subMeta.order_notes || '';

            const customerId = subData.subscriptions.links?.customer || payment.links?.customer;
            const customerRes = await fetch(`${apiBase}/customers/${customerId}`, {
              headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
            });
            const customerData = await customerRes.json();
            if (!customerRes.ok) continue;

            const parsedMeta = parseOrderNotes(orderNotes);
            const resolved = resolveCustomerDetails(customerData.customers, parsedMeta);
            const planInfo = PLAN_PRICES[planTier] || PLAN_PRICES.classic;

            console.log(`Creating RENEWAL order for ${resolved.email} (payment ${paymentId})`);
            await createShopifyOrder(
              resolved,
              { amount: payment.amount, description: `${planInfo.description} (Renewal)` },
              frequency,
              parsedMeta.reason,
              `GC-PM-${paymentId}, Subscription-Renewal`,
              shopifyDomain,
              shopifyToken
            );
          }
        }
        // If no initial order exists at all (edge case – should not happen), do nothing.
      } catch (err) {
        console.error("Error in payments.confirmed:", err);
      }
    }

    // ==========================================
    // Failures & Cancellations 
    // ==========================================
    if (event.resource_type === 'payments' && event.action === 'failed') {
      const paymentId = event.links?.payment;
      if (!paymentId) continue;
      try {
        const paymentRes = await fetch(`${apiBase}/payments/${paymentId}`, { headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }});
        const paymentData = await paymentRes.json();
        const customerId = paymentData.payments?.links?.customer;
        const customerRes = await fetch(`${apiBase}/customers/${customerId}`, { headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }});
        const customerData = await customerRes.json();
        const customerEmail = customerData.customers?.email;
        const shopifyCustomerSearch = await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/search.json?query=email:${customerEmail}`, { headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }});
        if (shopifyCustomerSearch.ok) {
          const searchData = await shopifyCustomerSearch.json();
          const shopifyCustomer = searchData.customers?.[0];
          if (shopifyCustomer) {
            const currentTags = shopifyCustomer.tags ? shopifyCustomer.tags.split(',').map(t => t.trim()) : [];
            const newTags = [...new Set([...currentTags, 'Payment-Failed-Hold'])].filter(t => t !== 'Active-Subscriber').join(', ');
            await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/${shopifyCustomer.id}.json`, {
              method: 'PUT', headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
              body: JSON.stringify({ customer: { id: shopifyCustomer.id, tags: newTags } })
            });
          }
        }
      } catch(err) {}
    }

    if (event.resource_type === 'subscriptions' && event.action === 'cancelled') {
      const subscriptionId = event.links?.subscription;
      if (!subscriptionId) continue;
      try {
        const subRes = await fetch(`${apiBase}/subscriptions/${subscriptionId}`, { headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }});
        const subData = await subRes.json();
        const customerId = subData.subscriptions?.links?.customer;
        const customerRes = await fetch(`${apiBase}/customers/${customerId}`, { headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }});
        const customerData = await customerRes.json();
        const customerEmail = customerData.customers?.email;
        const shopifyCustomerSearch = await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/search.json?query=email:${customerEmail}`, { headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }});
        if (shopifyCustomerSearch.ok) {
          const searchData = await shopifyCustomerSearch.json();
          const shopifyCustomer = searchData.customers?.[0];
          if (shopifyCustomer) {
            const currentTags = shopifyCustomer.tags ? shopifyCustomer.tags.split(',').map(t => t.trim()) : [];
            const newTags = [...new Set([...currentTags, 'Subscription-Cancelled'])].filter(t => t !== 'Active-Subscriber').join(', ');
            await fetch(`https://${shopifyDomain}/admin/api/2024-01/customers/${shopifyCustomer.id}.json`, {
              method: 'PUT', headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
              body: JSON.stringify({ customer: { id: shopifyCustomer.id, tags: newTags } })
            });
          }
        }
      } catch(err) {}
    }
  }
}

async function verifySignature(signature, bodyText, secret) {
  try {
    const encoder = new TextEncoder();
    const keyBuf = encoder.encode(secret);
    const msgBuf = encoder.encode(bodyText);
    const key = await crypto.subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify', 'sign']);
    const signatureBuf = new Uint8Array(signature.trim().match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
    return await crypto.subtle.verify('HMAC', key, signatureBuf, msgBuf);
  } catch (err) {
    return false;
  }
}
