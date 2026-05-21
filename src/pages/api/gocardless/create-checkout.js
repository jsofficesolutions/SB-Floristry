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

    // Handle order notes cleanly without depending on frontend address inputs
    const mergedAddress = [address1, city, postcode].filter(val => val && val.trim() !== '').join(', ') || 'Collected via GoCardless';
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
              plan_tier: String(planTier || "test"),
              frequency: String(frequency || "Weekly"),
              order_notes: orderNotes.substring(0, 500)
            }
          }
        }
      })
    });

    const brData = await brResponse.json();
    if (!brResponse.ok) {
      console.error("GoCardless Billing Request API Error Detail:", brData.error);
      return new Response(JSON.stringify({ error: brData.error?.message || 'API Billing Request Error' }), { status: 400 });
    }

    const billingRequestId = brData.billing_requests?.id;
    if (!billingRequestId) {
      return new Response(JSON.stringify({ error: "Failed to generate valid Billing Request ID from GoCardless." }), { status: 400 });
    }
    
    const successUrl = new URL(`${new URL(request.url).origin}/success`);
    successUrl.searchParams.set('name', firstName || '');
    successUrl.searchParams.set('plan', plan.description);

    // Build prefilled_customer dynamically to prevent validation failures.
    const customerData = {};
    if (firstName && firstName.trim() !== '') customerData.given_name = firstName.trim();
    if (lastName && lastName.trim() !== '') customerData.family_name = lastName.trim();
    if (email && email.trim() !== '') customerData.email = email.trim();
    
    // Sanitize phone number to prevent custom format syntax errors
    if (phone && phone.trim() !== '') {
      customerData.phone_number = phone.replace(/\s+/g, ''); 
    }
    
    // Always default country code to GB for BACS scheme processing
    customerData.country_code = "GB";

    // Only inject individual address keys if they actually exist on our incoming object
    if (address1 && address1.trim() !== '') customerData.address_line1 = address1.trim();
    if (city && city.trim() !== '') customerData.city = city.trim();
    if (postcode && postcode.trim() !== '') customerData.postal_code = postcode.trim();

    const flowPayload = {
      billing_request_flows: {
        redirect_uri: successUrl.toString(),
        exit_uri: `${new URL(request.url).origin}/subscriptions`,
        links: { billing_request: billingRequestId }
      }
    };

    // Only attach prefilled_customer if we have user metrics beyond just the default country_code
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
