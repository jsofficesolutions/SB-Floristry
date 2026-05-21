export const prerender = false;

// Define pricing structures for subscriptions (including Developer testing)
const PLAN_PRICES = {
  test: { amount: 100, description: "SB Floristry - Developer Test Tier" },
  classic: { amount: 4000, description: "SB Floristry - The Classic Subscription" },
  signature: { amount: 6500, description: "SB Floristry - The Signature Subscription" },
  luxe: { amount: 10000, description: "SB Floristry - The Luxe Subscription" }
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
    
    // Explicitly parse the separated address fields from the new frontend form
    const { planTier, firstName, lastName, email, address1, city, postcode, frequency, reason } = body;
    
    if (!planTier || !PLAN_PRICES[planTier]) {
      return new Response(JSON.stringify({ error: "Invalid plan selected" }), { status: 400 });
    }

    const plan = PLAN_PRICES[planTier];
    const apiBase = env.PUBLIC_GC_ENVIRONMENT === 'live' 
      ? 'https://api.gocardless.com' 
      : 'https://api-sandbox.gocardless.com';

    // Merge the explicit address parts into a single string to bypass the GoCardless 3-key metadata limit
    const mergedAddress = [address1, city, postcode].filter(Boolean).join(', ');

    console.log(`Initializing Billing Request for ${email} - Plan: ${planTier} (${plan.amount}p)`);

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
              plan_tier: planTier,
              frequency: frequency || "Weekly",
              order_notes: `Reason: ${reason || "Treat"} | Addr: ${mergedAddress}`.substring(0, 500)
            }
          }
        }
      })
    });

    const brData = await brResponse.json();
    if (!brResponse.ok) {
      console.error("GoCardless Billing Request Error payload:", brData);
      throw new Error(`Failed to create billing request: ${brData.error?.message || 'API Validation Error'}.`);
    }

    const billingRequestId = brData.billing_requests.id;
    
    const successUrl = new URL(`${new URL(request.url).origin}/success`);
    successUrl.searchParams.set('name', firstName || '');
    successUrl.searchParams.set('plan', plan.description);

    // Conditionally build customer payload to prevent GoCardless throwing 422 for empty strings
    const prefilled_customer = {};
    if (firstName) prefilled_customer.given_name = firstName;
    if (lastName) prefilled_customer.family_name = lastName;
    if (email) prefilled_customer.email = email;
    if (address1) prefilled_customer.address_line1 = address1;
    if (city) prefilled_customer.city = city;
    if (postcode) prefilled_customer.postal_code = postcode;

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
