const accessToken = import.meta.env.GOCARDLESS_ACCESS_TOKEN;
const environment = import.meta.env.GOCARDLESS_ENVIRONMENT || 'sandbox';

const baseUrl = environment === 'sandbox' 
  ? 'https://api-sandbox.gocardless.com' 
  : 'https://api.gocardless.com';

export async function POST({ request }) {
  try {
    const { items, deliveryType, deliveryCost, postcode } = await request.json();

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ error: 'Cart is empty' }), { status: 400 });
    }

    // Calculate subtotal
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const totalAmount = Math.round((subtotal + (deliveryCost || 0)) * 100); // Amount in pence

    // Generate product descriptions, appending sizes if they exist
    const itemDescriptions = items.map(item => {
      const variantSuffix = item.variantTitle && item.variantTitle !== 'Default Title' ? ` - ${item.variantTitle}` : '';
      return `${item.quantity}x ${item.title}${variantSuffix}`;
    }).join(', ');
    
    const description = `SB Floristry - ${itemDescriptions} (${deliveryType === 'local' ? `Delivery to ${postcode}` : 'Store Collection'})`;

    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'GoCardless-Version': '2015-07-06',
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    // 1. Create a Billing Request
    const brResponse = await fetch(`${baseUrl}/billing_requests`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        billing_requests: {
          mandate_request: {
            scheme: 'bacs',
          }
        }
      })
    });

    if (!brResponse.ok) {
      const errorText = await brResponse.text();
      throw new Error(`Failed to create billing request: ${errorText}`);
    }

    const brData = await brResponse.json();
    const billingRequestId = brData.billing_requests.id;

    // 2. Create Billing Request Flow
    const redirectUri = `${request.url.replace('/api/gocardless/create-checkout', '/success')}?amount=${totalAmount}&desc=${encodeURIComponent(description)}`;

    const flowResponse = await fetch(`${baseUrl}/billing_request_flows`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        billing_request_flows: {
          redirect_uri: redirectUri,
          links: {
            billing_request: billingRequestId
          }
        }
      })
    });

    if (!flowResponse.ok) {
      const errorText = await flowResponse.text();
      throw new Error(`Failed to create billing request flow: ${errorText}`);
    }

    const flowData = await flowResponse.json();

    return new Response(JSON.stringify({ url: flowData.billing_request_flows.authorisation_url }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('GoCardless Checkout Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}
