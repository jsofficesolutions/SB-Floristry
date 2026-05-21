export const prerender = false;

// Define pricing structures matching our elevated luxury tiering (£45 and £75)
const PLAN_PRICES = {
  test: { amount: 100, description: "SB Floristry - Developer Test Tier" }, // £1.00 testing tier
  classic: { amount: 4500, description: "SB Floristry - The Signature Classic Box" }, // £45.00 per delivery
  showstopper: { amount: 7500, description: "SB Floristry - The Grand Showstopper Box" } // £75.00 per delivery
};

export async function POST({ request, locals }) {
  // Access environment variables with robust fallbacks
  const env = locals.runtime?.env || import.meta.env || process.env || {};
  const token = env.GOCARDLESS_ACCESS_TOKEN;
  
  if (!token) {
    console.error("CRITICAL ERROR: GOCARDLESS_ACCESS_TOKEN is missing!");
    return new Response(JSON.stringify({ error: "Configuration Error: Missing API Token." }), { status: 500 });
  }

  try {
    const body = await request.json();
    
    // Deconstruct the separate form inputs from subscriptions.astro
    const { planTier, firstName, lastName, email, address1, city, postcode, frequency, reason } = body;
    
    if (!planTier || !PLAN_PRICES[planTier]) {
      return new Response(JSON.stringify({ error: "Invalid plan selected" }), { status: 400 });
    }

    const plan = PLAN_PRICES[planTier];
    const apiBase = env.PUBLIC_GC_ENVIRONMENT === 'live' 
      ? 'https://api.gocardless.com' 
      : 'https://api-sandbox.gocardless.com';

    // Combine address elements with commas to avoid exceeding GoCardless metadata 3-key limit
    const mergedAddress = [address1, city, postcode].filter(Boolean).join(', ');

    console.log(`Step 1: Creating Customer in GoCardless for ${email}`);

    // 1. Create the customer record first to register identity and bypass "John Doe" sandbox fallback
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
      throw new Error(`Failed to pre-create customer: ${customerData.error?.message || 'API Customer Validation Error'}`);
    }

    const customerId = customerData.customers.id;
    console.log(`Customer successfully created: ${customerId}. Step 2: Generating Billing Request.`);

    // 2. Create Billing Request (Linking the pre-created customer ID)
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
          },
          links: {
            customer: customerId
          }
        }
      })
    });

    const brData = await brResponse.json();
    if (!brResponse.ok) {
      console.error("GoCardless Billing Request Error payload:", brData);
      throw new Error(`Failed to create billing request: ${brData.error?.message || 'API Billing Request Error'}.`);
    }

    const billingRequestId = brData.billing_requests.id;
    
    // Safely configure success callback URL
    const successUrl = new URL(`${new URL(request.url).origin}/success`);
    successUrl.searchParams.set('name', firstName || '');
    successUrl.searchParams.set('plan', plan.description);

    // 3. Build prefilled_customer parameters explicitly for the hosted checkout page flow UI
    // This forces the hosted form fields to automatically pre-populate so the customer doesn't have to retype them
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

    console.log("Step 3: Creating Billing Request Flow with autofill metadata.");

    // 4. Instantiate Billing Request Flow (The hosted authorization interface)
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
