// Cloudflare Workers require routes intended to run server-side to be marked with prerender = false
export const prerender = false;

const PLAN_CONFIG = {
  classic: {
    amount: 4000, // in pence (£40.00)
    name: "The Classic Subscription"
  },
  signature: {
    amount: 6500, // (£65.00)
    name: "The Signature Subscription"
  },
  luxe: {
    amount: 10000, // (£100.00)
    name: "The Luxe Subscription"
  }
};

export const POST = async ({ request, locals }) => {
  try {
    const { planTier } = await request.json();
    const selectedPlan = PLAN_CONFIG[planTier];

    if (!selectedPlan) {
      return new Response(JSON.stringify({ error: "Invalid plan selection" }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Access Cloudflare environment variables safely
    // Cloudflare Pages matches variables defined in the dashboard to both import.meta.env & locals
    const gcToken = import.meta.env.GOCARDLESS_ACCESS_TOKEN || (locals?.runtime?.env?.GOCARDLESS_ACCESS_TOKEN);
    const gcEnv = import.meta.env.PUBLIC_GC_ENVIRONMENT || (locals?.runtime?.env?.PUBLIC_GC_ENVIRONMENT) || 'sandbox';

    if (!gcToken) {
      return new Response(JSON.stringify({ error: "GoCardless integration is not configured with an access token." }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const apiBase = gcEnv === 'live' 
      ? 'https://api.gocardless.com' 
      : 'https://api-sandbox.gocardless.com';

    // 1. Create a Billing Request
    const brResponse = await fetch(`${apiBase}/billing_requests`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gcToken}`,
        'GoCardless-Version': '2015-07-06',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        billing_requests: {
          payment_request: {
            description: `SB Floristry - ${selectedPlan.name}`,
            amount: selectedPlan.amount,
            currency: 'GBP'
          },
          mandate_request: {
            scheme: 'bacs' // UK Direct Debit Scheme
          }
        }
      })
    });

    const brData = await brResponse.json();

    if (!brResponse.ok) {
      throw new Error(brData.error?.message || 'Failed to create Billing Request');
    }

    const billingRequestId = brData.billing_requests.id;

    // 2. Generate the Billing Request Flow (Hosted Checkout Flow)
    const flowResponse = await fetch(`${apiBase}/billing_request_flows`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gcToken}`,
        'GoCardless-Version': '2015-07-06',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        billing_request_flows: {
          redirect_uri: 'https://www.sbfloristry.co.uk/success',
          exit_uri: 'https://www.sbfloristry.co.uk/subscriptions',
          links: {
            billing_request: billingRequestId
          }
        }
      })
    });

    const flowData = await flowResponse.json();

    if (!flowResponse.ok) {
      throw new Error(flowData.error?.message || 'Failed to create Billing Request Flow');
    }

    return new Response(JSON.stringify({ 
      checkoutUrl: flowData.billing_request_flows.authorisation_url 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error("GoCardless API Error:", error);
    return new Response(JSON.stringify({ error: error.message || "Internal server error" }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
