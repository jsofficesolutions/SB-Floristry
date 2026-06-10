import GoCardless from 'gocardless-nodejs';

const accessToken = import.meta.env.GOCARDLESS_ACCESS_TOKEN;
const environment = import.meta.env.GOCARDLESS_ENVIRONMENT || 'sandbox';

const client = new GoCardless.Client({
  accessToken: accessToken,
  environment: environment,
});

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

    // Create a Billing Request
    const billingRequest = await client.billingRequests.create({
      mandateRequest: {
        scheme: 'bacs',
      },
    });

    // Create Billing Request Flow
    const billingRequestFlow = await client.billingRequestFlows.create({
      billingRequest: {
        id: billingRequest.id,
      },
      redirectUri: `${request.url.replace('/api/gocardless/create-checkout', '/success')}?amount=${totalAmount}&desc=${encodeURIComponent(description)}`,
    });

    return new Response(JSON.stringify({ url: billingRequestFlow.authorisationUrl }), {
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
