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
    const { planTier, firstName, lastName, email, phone, address1, city, postcode, frequency, reason } = body;
    
    // Validate required address fields
    if (!address1 || !city || !postcode) {
      return new Response(JSON.stringify({ error: "Address fields (address1, city, postcode) are required." }), { status: 400 });
    }

    const plan = PLAN_PRICES[planTier] || PLAN_PRICES.test;
    const apiBase = env.PUBLIC_GC_ENVIRONMENT === 'live' ? 'https://api.gocardless.com' : 'https://api-sandbox.gocardless.com';

    const fullName = `${firstName || ''} ${lastName || ''}`.trim();
    const mergedAddress = [address1, city, postcode].filter(Boolean).join(', ');

    // Pack all customer info into metadata for later use in webhook
    const orderNotes = `Name: ${fullName} | Email: ${email || ''} | Phone: ${phone || ''} | Reason: ${reason || 'Treat'} | Addr: ${mergedAddress}`;

    // Step 1: Create billing request
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
              order_notes: orderNotes.substring(0, 500)
            }
          }
        }
      })
    });

    const brData = await brResponse.json();
    if (!brResponse.ok) {
      // Log full error for debugging
      console.error("GoCardless billing_request error:", JSON.stringify(brData, null, 2));
      return new Response(JSON.stringify({ 
        error: brData.error?.message || 'Failed to create billing request',
        details: brData.error?.errors || null
      }), { status: brResponse.status });
    }

    const billingRequestId = brData.billing_requests.id;
    
    // Build success redirect URL
    const successUrl = new URL(`${new URL(request.url).origin}/success`);
    successUrl.searchParams.set('name', firstName || '');
    successUrl.searchParams.set('plan', plan.description);

    // Prepare prefilled customer data (always include address)
    const prefilled_customer = {
      given_name: firstName || '',
      family_name: lastName || '',
      email: email || '',
      phone_number: phone || '',
      address_line1: address1,
      city: city,
      postal_code: postcode,
      country_code: 'GB'
    };

    // Step 2: Create billing request flow
    const flowPayload = {
      billing_request_flows: {
        redirect_uri: successUrl.toString(),
        exit_uri: `${new URL(request.url).origin}/subscriptions`,
        links: { billing_request: billingRequestId },
        prefilled_customer: prefilled_customer
      }
    };

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
      console.error("GoCardless billing_request_flow error:", JSON.stringify(flowData, null, 2));
      return new Response(JSON.stringify({ 
        error: flowData.error?.message || 'Failed to create checkout flow',
        details: flowData.error?.errors || null
      }), { status: flowResponse.status });
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
