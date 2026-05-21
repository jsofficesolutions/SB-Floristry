export const prerender = false;

const PLAN_PRICES = {
  test: { amount: 100, description: "SB Floristry - Developer Test Tier" },
  classic: { amount: 2800, description: "SB Floristry - The Classic Subscription" },
  showstopper: { amount: 4100, description: "SB Floristry - The Showstopper Subscription" }
};

export async function POST({ request, locals }) {
  const env = locals.runtime?.env || import.meta.env || process.env || {};
  const token = env.GOCARDLESS_ACCESS_TOKEN;
  
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing API Token." }), { status: 500 });
  }

  try {
    const body = await request.json();
    
    // Fallback empty strings to null/undefined or clean defaults immediately
    const planTier = body.planTier && body.planTier.trim() !== '' ? body.planTier.trim() : 'test';
    const firstName = body.firstName && body.firstName.trim() !== '' ? body.firstName.trim() : '';
    const lastName = body.lastName && body.lastName.trim() !== '' ? body.lastName.trim() : '';
    const email = body.email && body.email.trim() !== '' ? body.email.trim() : '';
    const phone = body.phone && body.phone.trim() !== '' ? body.phone.trim() : '';
    const frequency = body.frequency && body.frequency.trim() !== '' ? body.frequency.trim() : 'Weekly';
    const reason = body.reason && body.reason.trim() !== '' ? body.reason.trim() : 'Treating Myself';

    const plan = PLAN_PRICES[planTier] || PLAN_PRICES.test;
    const apiBase = env.PUBLIC_GC_ENVIRONMENT === 'live' ? 'https://api.gocardless.com' : 'https://api-sandbox.gocardless.com';

    // Build order notes cleanly
    const fullName = `${firstName} ${lastName}`.trim() || 'Anonymous Customer';
    const orderNotes = `Name: ${fullName} | Email: ${email} | Phone: ${phone} | Reason: ${reason} | Addr: Collected via GoCardless`;

    const brPayload = {
      billing_requests: {
        payment_request: {
          amount: plan.amount,
          currency: 'GBP',
          description: plan.description
        },
        mandate_request: { 
          scheme: 'bacs',
          metadata: {
            plan_tier: String(planTier),
            frequency: String(frequency),
            order_notes: orderNotes.substring(0, 500)
          }
        }
      }
    };

    const brResponse = await fetch(`${apiBase}/billing_requests`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'GoCardless-Version': '2015-07-06',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(brPayload)
    });

    const brData = await brResponse.json();
    if (!brResponse.ok) {
      console.error("GoCardless Billing Request API Error Detail:", brData.error);
      return new Response(JSON.stringify({ error: brData.error?.message || 'API Billing Request Error' }), { status: 400 });
    }

    const billingRequestId = brData.billing_requests?.id;
    if (!billingRequestId) {
      return new Response(JSON.stringify({ error: "Failed to generate valid Billing Request ID." }), { status: 400 });
    }
    
    const successUrl = new URL(`${new URL(request.url).origin}/success`);
    successUrl.searchParams.set('name', firstName);
    successUrl.searchParams.set('plan', plan.description);

    // Build prefilled_customer dynamically without empty properties
    const customerData = {};
    if (firstName) customerData.given_name = firstName;
    if (lastName) customerData.family_name = lastName;
    if (email) customerData.email = email;
    
    // Normalize phone formatting (remove spaces) to comply with international verification checks
    if (phone) {
      customerData.phone_number = phone.replace(/\s+/g, ''); 
    }
    
    // Always default country code to GB for BACS processing
    customerData.country_code = "GB";

    const flowPayload = {
      billing_request_flows: {
        redirect_uri: successUrl.toString(),
        exit_uri: `${new URL(request.url).origin}/subscriptions`,
        links: { billing_request: billingRequestId }
      }
    };

    // Attach prefilled customer configurations safely
    if (Object.keys(customerData).length > 1) {
      flowPayload.billing_request_flows.prefilled_customer = customerData;
    }

    const flowResponse = await fetch(`${apiBase}/billing_request_flows`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'GoCardless-Version': '2015-07-06',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(flowPayload)
    });

    const flowData = await flowResponse.json();
    if (!flowResponse.ok) {
      console.error("GoCardless Flow API Error Detail:", flowData.error);
      return new Response(JSON.stringify({ error: flowData.error?.message || 'API Flow Error' }), { status: 400 });
    }

    return new Response(JSON.stringify({ checkoutUrl: flowData.billing_request_flows.authorisation_url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error("CATCH ERROR:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
