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

  const isSandboxName = !firstName || firstName.toLowerCase() === 'john' || firstName.toLowerCase() === 'jane' || lastName.toLowerCase() === 'doe';
  const isSandboxEmail = !email || email.toLowerCase().includes('gocardless') || email.toLowerCase().includes('sandbox');
  const isSandboxAddress = !address1 || address1 === "No address" || address1.toLowerCase().includes('gocardless') || address1.toLowerCase().includes('sandbox');

  if (isSandboxName && parsedMeta.name) {
    const nameParts = parsedMeta.name.split(' ').filter(Boolean);
    firstName = nameParts[0] || "Valued";
    lastName = nameParts.slice(1).join(' ') || "Customer";
  }
  if (isSandboxEmail && parsedMeta.email) email = parsedMeta.email;
  if (isSandboxAddress && parsedMeta.address) {
    const addrParts = parsedMeta.address.split(',').map(p => p.trim());
    address1 = addrParts[0] || parsedMeta.address;
    city = addrParts[1] || "";
    zip = addrParts.length > 2 ? addrParts[addrParts.length - 1] : (addrParts[2] || "");
  }
  if (!phone && parsedMeta.phone) phone = parsedMeta.phone;

  // Final safety – ensure no blank last name sent to Shopify
  if (!lastName) lastName = "Customer";

  return { firstName, lastName, email, address1, city, zip, phone, countryCode: gcCustomer.country_code || "GB" };
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

  for (const event of payload.events) {

    // ==========================================
    // Handle initial subscription creation
    // ==========================================
    if (event.resource_type === 'subscriptions' && event.action === 'created') {
      const subscriptionId = event.links?.subscription;
      if (!subscriptionId) continue;

      try {
        // Check for existing order with this subscription tag (idempotent)
        const checkRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json?status=any&tag=GC-SUB-${subscriptionId}`, {
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }
        });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.orders && checkData.orders.length > 0) continue;
        }

        const subMeta = event.resource_metadata || event.metadata || {};
        const planTier = subMeta.plan_tier || "test";
        const frequency = subMeta.frequency || "Weekly";
        const orderNotes = subMeta.order_notes || "";

        // Fetch subscription details
        const subRes = await fetch(`${apiBase}/subscriptions/${subscriptionId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const subData = await subRes.json();
        if (!subRes.ok) {
          console.error("Failed to fetch subscription details:", JSON.stringify(subData));
          continue;
        }

        // Try to get customer ID from subscription, mandate, or billing request
        let customerId = subData.subscriptions.links?.customer;
        
        if (!customerId) {
          // Try fetching the mandate linked to this subscription
          const mandateId = subData.subscriptions.links?.mandate;
          if (mandateId) {
            const mandateRes = await fetch(`${apiBase}/mandates/${mandateId}`, {
              headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
            });
            const mandateData = await mandateRes.json();
            if (mandateRes.ok) {
              customerId = mandateData.mandates.links?.customer;
            }
          }
        }

        // If still no customer, skip this event
        if (!customerId) {
          console.error("No customer linked to subscription", subscriptionId);
          continue;
        }

        // Get customer details from GoCardless
        const customerRes = await fetch(`${apiBase}/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const customerData = await customerRes.json();
        if (!customerRes.ok) {
          console.error("Failed to fetch customer:", JSON.stringify(customerData));
          continue;
        }

        const parsedMeta = parseOrderNotes(orderNotes);
        const resolved = resolveCustomerDetails(customerData.customers, parsedMeta);
        const cleanedPhone = cleanPhoneForShopify(resolved.phone);
        const planInfo = PLAN_PRICES[planTier] || PLAN_PRICES.test;

        // Final safety – ensure no blank last name sent to Shopify
        if (!resolved.lastName) resolved.lastName = "Customer";

        console.log(`Creating initial Shopify order for ${resolved.email} (subscription ${subscriptionId})`);

        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order: {
              line_items: [{ title: planInfo.description, quantity: 1, price: (planInfo.amount / 100).toString() }],
              customer: { first_name: resolved.firstName, last_name: resolved.lastName, email: resolved.email, phone: cleanedPhone || undefined },
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
              note: `Subscription Details:\nFrequency: ${frequency}\nReason: ${parsedMeta.reason}`,
              financial_status: "paid",
              tags: `GC-SUB-${subscriptionId}, Active-Subscriber`
            }
          })
        });

        const shopifyData = await shopifyRes.json();
        if (!shopifyRes.ok) {
          console.error("Shopify Order Creation Failed:", JSON.stringify(shopifyData, null, 2));
        } else {
          console.log(`Successfully created Shopify order for ${resolved.email}`);
          if (shopifyData.order?.customer?.id && cleanedPhone) {
            await forceShopifyCustomerPhoneUpdate(shopifyData.order.customer.id, cleanedPhone, shopifyDomain, shopifyToken);
          }
        }

        // Update subscription metadata
        await fetch(`${apiBase}/subscriptions/${subscriptionId}`, {
          method: 'PUT',
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06', 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriptions: {
              metadata: {
                plan_tier: planTier,
                frequency: frequency,
                order_notes: orderNotes.substring(0, 500)
              }
            }
          })
        });

      } catch (err) {
        console.error("Error handling subscription created:", err);
      }
    }

    // ==========================================
    // Billing Request Fulfilled (fallback)
    // ==========================================
    if (event.resource_type === 'billing_requests' && event.action === 'fulfilled') {
      const billingRequestId = event.links?.billing_request;
      if (!billingRequestId) continue;

      try {
        const checkRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json?status=any&tag=GC-BRQ-${billingRequestId}`, {
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }
        });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.orders && checkData.orders.length > 0) continue; 
        }

        const brRes = await fetch(`${apiBase}/billing_requests/${billingRequestId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const brData = await brRes.json();
        if (!brRes.ok) continue;

        const br = brData.billing_requests;
        const meta = br.mandate_request?.metadata || br.metadata || {};
        
        const planTier = meta.plan_tier || "test";
        const mandateId = br.links?.mandate || br.links?.mandate_request_mandate;
        const customerId = br.links?.customer;
        const frequency = meta.frequency || "Weekly";
        const orderNotes = meta.order_notes || "";

        if (!mandateId || !customerId) continue;

        const customerRes = await fetch(`${apiBase}/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const customerData = await customerRes.json();
        if (!customerRes.ok) continue;

        const parsedMeta = parseOrderNotes(orderNotes);
        const resolved = resolveCustomerDetails(customerData.customers, parsedMeta);
        const cleanedPhone = cleanPhoneForShopify(resolved.phone);
        const planInfo = PLAN_PRICES[planTier] || PLAN_PRICES.test;

        if (!resolved.lastName) resolved.lastName = "Customer";

        console.log(`Injecting initial order for ${resolved.email}...`);
        
        const shopifyRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order: {
              line_items: [{ title: planInfo.description, quantity: 1, price: (planInfo.amount / 100).toString() }],
              customer: { first_name: resolved.firstName, last_name: resolved.lastName, email: resolved.email, phone: cleanedPhone || undefined },
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
              note: `Subscription Details:\nFrequency: ${frequency}\nReason: ${parsedMeta.reason}`,
              financial_status: "paid",
              tags: `GC-BRQ-${billingRequestId}, Active-Subscriber`
            }
          })
        });

        const shopifyData = await shopifyRes.json();
        if (!shopifyRes.ok) {
           console.error("Shopify Order Creation Failed:", shopifyData);
        } else if (shopifyData.order?.customer?.id && cleanedPhone) {
           await forceShopifyCustomerPhoneUpdate(shopifyData.order.customer.id, cleanedPhone, shopifyDomain, shopifyToken);
        }

        // Establish subscription schedule
        const schedule = FREQUENCY_INTERVALS[frequency];
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
                  order_notes: orderNotes.substring(0, 500)
                }
              }
            })
          });
        }
      } catch (err) {
        console.error("Error handling billing request:", err);
      }
    }

    // ==========================================
    // Recurring Payments (Future Renewals)
    // ==========================================
    if (event.resource_type === 'payments' && event.action === 'confirmed') {
      const paymentId = event.links?.payment;
      if (!paymentId) continue;

      try {
        const paymentRes = await fetch(`${apiBase}/payments/${paymentId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const paymentData = await paymentRes.json();
        if (!paymentRes.ok) continue;

        const payment = paymentData.payments;
        const subscriptionId = payment.links?.subscription;
        if (!subscriptionId) continue; 

        const checkRes = await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json?status=any&tag=GC-PM-${paymentId}`, {
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' }
        });
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          if (checkData.orders && checkData.orders.length > 0) continue;
        }

        const subRes = await fetch(`${apiBase}/subscriptions/${subscriptionId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const subData = await subRes.json();
        if (!subRes.ok) continue;

        const subMeta = subData.subscriptions.metadata || {};
        const planTier = subMeta.plan_tier || "classic";
        const frequency = subMeta.frequency || "Weekly";

        const customerId = subData.subscriptions.links?.customer || payment.links?.customer;
        const customerRes = await fetch(`${apiBase}/customers/${customerId}`, {
          headers: { 'Authorization': `Bearer ${gcToken}`, 'GoCardless-Version': '2015-07-06' }
        });
        const customerData = await customerRes.json();
        if (!customerRes.ok) continue;

        const parsedMeta = parseOrderNotes(subMeta.order_notes);
        const resolved = resolveCustomerDetails(customerData.customers, parsedMeta);
        const cleanedPhone = cleanPhoneForShopify(resolved.phone);
        const planInfo = PLAN_PRICES[planTier] || PLAN_PRICES.classic;

        if (!resolved.lastName) resolved.lastName = "Customer";

        console.log(`Injecting recurring order for ${resolved.email}...`);
        await fetch(`https://${shopifyDomain}/admin/api/2024-01/orders.json`, {
          method: 'POST',
          headers: { 'X-Shopify-Access-Token': shopifyToken, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order: {
              line_items: [{ title: `${planInfo.description} (Renewal)`, quantity: 1, price: (payment.amount / 100).toString() }],
              customer: { first_name: resolved.firstName, last_name: resolved.lastName, email: resolved.email, phone: cleanedPhone || undefined },
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
              note: `Subscription Renewal Order:\nFrequency: ${frequency}\nReason: ${parsedMeta.reason}\nLinked Subscription ID: ${subscriptionId}`,
              financial_status: "paid",
              tags: `GC-PM-${paymentId}, Subscription-Renewal`
            }
          })
        });

      } catch (err) {
        console.error(`Error processing recurring payment:`, err);
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
