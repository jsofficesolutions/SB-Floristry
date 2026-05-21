export const prerender = false;

// Define pricing structures matching our elevated luxury tiering (£45 and £75)
const PLAN_PRICES = {
  test: { amount: 100, description: "SB Floristry - Developer Test Tier" },
  classic: { amount: 4500, description: "SB Floristry - The Signature Classic Box" },
  showstopper: { amount: 7500, description: "SB Floristry - The Grand Showstopper Box" }
};

export async function POST({ request, locals }) {
  const env = locals.runtime?.env || import.meta.env || process.env || {};
  const token = env.GOCARDLESS_ACCESS_TOKEN;
  
  if (!token) {
    console.error("CRITICAL ERROR: GOCARDLESS_ACCESS_TOKEN is missing!");
    return new Response(JSON.stringify({ error: "Configuration Error: Missing API Token." }), { status: 500 });
  }

  try {
    const body = await request.json();
    
    // Notice we no longer require address fields from the frontend!
    const { planTier, firstName, lastName, email, phone, frequency, reason } = body;
    
    if (!planTier || !PLAN_PRICES[planTier]) {
      return new Response(JSON.stringify({ error: "Invalid plan selected" }), { status: 400 });
    }

    const plan = PLAN_PRICES[planTier];
    const apiBase = env.PUBLIC_GC_ENVIRONMENT === 'live' 
      ? 'https://api.gocardless.com' 
      : 'https://api-sandbox.gocardless.com';

    console.log(`Step 1: Generating Billing Request for ${email}`);

    // 1. CREATE BILLING REQUEST
    // We do NOT pre-create the customer. We let GoCardless collect the address natively!
    const brResponse = await fetch(`${apiBase}/billing_requests`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'GoCardless-Version': '2015-07-06',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
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
              frequency: String(frequency || "Weekly"),
              // The phone number travels securely via metadata so GoCardless doesn't reject it
              order_notes: `Reason: ${reason || "Treat"} | Phone: ${phone || ""}`.substring(0, 500)
            }
          }
        }
      })
    });

    const brData = await brResponse.json();
    if (!brResponse.ok) {
      console.error("GoCardless Billing Request Error payload:", brData);
      throw new Error(`Failed to create billing request: ${brData.error?.message || 'API Error'}`);
    }

    const billingRequestId = brData.billing_requests.id;
    
    const successUrl = new URL(`${new URL(request.url).origin}/success`);
    successUrl.searchParams.set('name', firstName || '');
    successUrl.searchParams.set('plan', plan.description);

    console.log("Step 2: Creating Billing Request Flow.");

    // 2. PREFILL NAME AND EMAIL ONLY
    // This perfectly seeds the checkout screen. Because the address is missing,
    // GoCardless will gracefully prompt the customer to type their address alongside their bank details!
    const prefilled_customer = {};
    if (firstName) prefilled_customer.given_name = firstName;
    if (lastName) prefilled_customer.family_name = lastName;
    if (email) prefilled_customer.email = email;

    const flowPayload = {
      billing_request_flows: {
        redirect_uri: successUrl.toString(),
        exit_uri: `${new URL(request.url).origin}/subscriptions`,
        links: { billing_request: billingRequestId }
      }
    };

    if (Object.keys(prefilled_customer).length > 0) {
      flowPayload.billing_request_flows.prefilled_customer = prefilled_customer;
    }

    // 3. INSTANTIATE FLOW
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
      console.error("GoCardless Flow Error:", flowData);
      throw new Error(`Failed to create checkout flow: ${flowData.error?.message || 'API Flow Error'}`);
    }

    return new Response(JSON.stringify({ checkoutUrl: flowData.billing_request_flows.authorisation_url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error("CRITICAL CATCH ERROR:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), { status: 500 });
  }
}
