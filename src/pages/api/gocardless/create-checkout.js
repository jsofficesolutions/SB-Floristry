export const prerender = false;

// Define your pricing map
const PLAN_PRICES = {
  classic: { amount: 4000, description: "SB Floristry - The Classic Subscription" },
  signature: { amount: 6500, description: "SB Floristry - The Signature Subscription" },
  luxe: { amount: 10000, description: "SB Floristry - The Luxe Subscription" }
};

export async function POST({ request, locals }) {
  // Access environment variables with fallbacks
  const env = locals.runtime?.env || process.env;
  const token = env.GOCARDLESS_ACCESS_TOKEN;
  
  // 1. Validate environment
  if (!token) {
    console.error("CRITICAL ERROR: GOCARDLESS_ACCESS_TOKEN is missing!");
    return new Response(JSON.stringify({ error: "Configuration Error" }), { status: 500 });
  }

  try {
    const body = await request.json();
    const { planTier } = body;
    
    if (!planTier || !PLAN_PRICES[planTier]) {
      return new Response(JSON.stringify({ error: "Invalid plan selected" }), { status: 400 });
    }

    const plan = PLAN_PRICES[planTier];
    const apiBase = env.PUBLIC_GC_ENVIRONMENT === 'live' 
      ? 'https://api.gocardless.com' 
      : 'https://api-sandbox.gocardless.com';

    // 2. Create Billing Request (The Intent)
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
          mandate_request: { scheme: 'bacs' }
        }
      })
    });

    const brData = await brResponse.json();
    if (!brResponse.ok) {
      console.error("GoCardless Billing Request Error:", brData);
      throw new Error("Failed to create billing request");
    }

    // 3. Create Flow (The Hosted UI)
    const billingRequestId = brData.billing_requests.id;
    const flowResponse = await fetch(`${apiBase}/billing_request_flows`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'GoCardless-Version': '2015-07-06',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        billing_request_flows: {
          redirect_uri: `${new URL(request.url).origin}/success`,
          exit_uri: `${new URL(request.url).origin}/subscriptions`,
          links: { billing_request: billingRequestId }
        }
      })
    });

    const flowData = await flowResponse.json();
    if (!flowResponse.ok) {
      console.error("GoCardless Flow Error:", flowData);
      throw new Error("Failed to create checkout flow");
    }

    return new Response(JSON.stringify({ checkoutUrl: flowData.billing_request_flows.authorisation_url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error("CRITICAL CATCH ERROR:", err);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500 });
  }
}
