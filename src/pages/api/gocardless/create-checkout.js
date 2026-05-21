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
    
    // Deconstruct the separate form inputs from subscriptions.astro
    const { planTier, firstName, lastName, email, phone, address1, city, postcode, frequency, reason } = body;
    
    if (!planTier || !PLAN_PRICES[planTier]) {
      return new Response(JSON.stringify({ error: "Invalid plan selected" }), { status: 400 });
    }

    const plan = PLAN_PRICES[planTier];
    const apiBase = env.PUBLIC_GC_ENVIRONMENT === 'live' 
      ? 'https://api.gocardless.com' 
      : 'https://api-sandbox.gocardless.com';

    console.log(`Step 1: Creating Customer natively in GoCardless for ${email}`);

    // 1. PRE-CREATE THE CUSTOMER
    // This permanently locks their true identity and address, bypassing the Sandbox "John Doe" bug.
    // Because we create them here, GoCardless will intentionally SKIP the address confirmation screen 
    // to give the customer a faster, frictionless checkout experience.
    const customerResponse = await fetch(`${apiBase}/customers`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'GoCardless-Version': '2015-07-06',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        customers: {
          given_name: firstName || "Valued",
          family_name: lastName || "Customer",
          email: email || "",
          phone_number: phone || undefined,
          address_line1: address1 || "No address",
          city: city || "",
          postal_code: postcode || "",
          country_code: "GB"
        }
      })
    });

    const customerData = await customerResponse.json();
    if (!customerResponse.ok) {
      console.error("GoCardless Customer Creation Error payload:", customerData);
      throw new Error(`Failed to pre-create customer: ${customerData.error?.message || 'API Validation Error'}`);
    }

    const customerId = customerData.customers.id;
    console.log(`Customer locked: ${customerId}. Step 2: Generating Billing Request.`);

    // 2. CREATE BILLING REQUEST (Linked to the newly created customer)
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
              order_notes: `Reason: ${reason || "Treat"}`
            }
          },
          links: {
            customer: customerId // Hard-linking the customer here
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

    console.log("Step 3: Creating Billing Request Flow.");

    // 3. CREATE CHECKOUT FLOW
    // We intentionally DO NOT send a prefilled_customer object here.
    // The customer is already linked. The API will generate the flow instantly with 0 errors.
    const flowResponse = await fetch(`${apiBase}/billing_request_flows`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'GoCardless-Version': '2015-07-06',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        billing_request_flows: {
          redirect_uri: successUrl.toString(),
          exit_uri: `${new URL(request.url).origin}/subscriptions`,
          links: { billing_request: billingRequestId }
        }
      })
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
