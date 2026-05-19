export const prerender = false;

const PLAN_CONFIG = {
  classic: { amount: 4000, name: "The Classic Subscription" },
  signature: { amount: 6500, name: "The Signature Subscription" },
  luxe: { amount: 10000, name: "The Luxe Subscription" }
};

export const POST = async ({ request, locals }) => {
  try {
    const data = await request.json();
    const { planTier, firstName, lastName, email, address, frequency, reason } = data;
    const selectedPlan = PLAN_CONFIG[planTier];

    const gcToken = import.meta.env.GOCARDLESS_ACCESS_TOKEN || locals?.runtime?.env?.GOCARDLESS_ACCESS_TOKEN;
    const gcEnv = import.meta.env.PUBLIC_GC_ENVIRONMENT || locals?.runtime?.env?.PUBLIC_GC_ENVIRONMENT || 'sandbox';
    const apiBase = gcEnv === 'live' ? 'https://api.gocardless.com' : 'https://api-sandbox.gocardless.com';

    // 1. Create the CUSTOMER first to lock in the name
    const custRes = await fetch(`${apiBase}/customers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gcToken}`,
        'GoCardless-Version': '2015-07-06',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customers: { given_name: firstName, family_name: lastName, email: email }
      })
    });
    const custData = await custRes.json();
    const customerId = custData.customers.id;

    // 2. Create the Billing Request (linked to the new Customer ID)
    const brResponse = await fetch(`${apiBase}/billing_requests`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gcToken}`,
        'GoCardless-Version': '2015-07-06',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        billing_requests: {
          links: { customer: customerId }, // Link it here!
          payment_request: {
            description: `SB Floristry - ${selectedPlan.name}`,
            amount: selectedPlan.amount,
            currency: 'GBP'
          },
          mandate_request: {
            scheme: 'bacs',
            metadata: { frequency, reason, delivery_address: address.substring(0, 450) }
          }
        }
      })
    });
    const brData = await brResponse.json();
    const billingRequestId = brData.billing_requests.id;

    // 3. Generate Checkout Flow
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
          links: { billing_request: billingRequestId }
        }
      })
    });
    const flowData = await flowResponse.json();

    return new Response(JSON.stringify({ checkoutUrl: flowData.billing_request_flows.authorisation_url }), { status: 200 });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
};
