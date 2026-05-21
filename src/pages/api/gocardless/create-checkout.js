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
    
    const plan = PLAN_PRICES[planTier] || PLAN_PRICES.test;
    const apiBase = env.PUBLIC_GC_ENVIRONMENT === 'live' ? 'https://api.gocardless.com' : 'https://api-sandbox.gocardless.com';

    // FIX 1: Safely handle order notes when address fields are omitted from the form
    const mergedAddress = [address1, city, postcode].filter(Boolean).join(', ') || 'Not provided on form';
    const fullName = `${firstName || ''} ${lastName || ''}`.trim();

    const orderNotes = `Name: ${fullName} | Email: ${email || ''} | Phone: ${phone || ''} | Reason: ${reason || 'Treat'} | Addr: ${mergedAddress}`;

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
    if (!brResponse.ok) throw new Error(brData.error?.message || 'API Error');

    const billingRequestId = brData.billing_requests.id;
    
    const successUrl = new URL(`${new URL(request.url).origin}/success`);
    successUrl.searchParams.set('name', firstName || '');
    successUrl.searchParams.set('plan', plan.description);

    // FIX 2: Only attach fields to prefilled_customer if they actually have values
    const prefilled_customer = {};
    if (firstName) prefilled_customer.given_name = firstName;
    if (lastName) prefilled_customer.family_name = lastName;
    if (email) prefilled_customer.email = email;
    if (phone) prefilled_customer.phone_number = phone;
    
    // Explicitly enforce the UK country code so GoCardless defaults to the correct region
    prefilled_customer.country_code = "GB";

    // Only inject address keys if they are passed in from your frontend
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
    if (!flowResponse.ok) throw new Error(flowData.error?.message || 'API Flow Error');

    return new Response(JSON.stringify({ checkoutUrl: flowData.billing_request_flows.authorisation_url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error("CATCH ERROR:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
