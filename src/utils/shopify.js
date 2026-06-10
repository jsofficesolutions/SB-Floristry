const domain = import.meta.env.SHOPIFY_STORE_DOMAIN;
const storefrontAccessToken = import.meta.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;

async function shopifyFetch({ query, variables }) {
  try {
    const result = await fetch(
      `https://${domain}/api/2024-01/graphql.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Storefront-Access-Token': storefrontAccessToken,
        },
        body: JSON.stringify({ query, variables }),
      }
    );

    if (!result.ok) {
      throw new Error(`Shopify API error: ${result.statusText}`);
    }

    return await result.json();
  } catch (error) {
    console.error('Error fetching from Shopify:', error);
    return { data: null };
  }
}

export async function getProducts(tag = null) {
  const query = `
    query GetProducts($query: String) {
      products(first: 20, query: $query) {
        edges {
          node {
            id
            title
            handle
            description
            images(first: 1) {
              edges {
                node {
                  url
                  altText
                }
              }
            }
            priceRange {
              minVariantPrice {
                amount
                currencyCode
              }
              maxVariantPrice {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  `;

  const variables = tag ? { query: `tag:${tag}` } : {};
  const response = await shopifyFetch({ query, variables });
  
  if (!response?.data?.products?.edges) return [];
  
  return response.data.products.edges.map(({ node }) => {
    const minPrice = node.priceRange?.minVariantPrice?.amount || "0";
    const maxPrice = node.priceRange?.maxVariantPrice?.amount || "0";
    const hasMultiplePrices = parseFloat(minPrice) !== parseFloat(maxPrice);

    return {
      id: node.id,
      title: node.title,
      handle: node.handle,
      description: node.description,
      image: node.images?.edges[0]?.node?.url || '/images/hero.jpg',
      imageAlt: node.images?.edges[0]?.node?.altText || node.title,
      price: minPrice,
      hasMultiplePrices,
      minPrice,
      maxPrice,
      currency: node.priceRange?.minVariantPrice?.currencyCode || 'GBP',
    };
  });
}

export async function getProductByHandle(handle) {
  const query = `
    query GetProductByHandle($handle: String!) {
      product(handle: $handle) {
        id
        title
        handle
        description
        images(first: 5) {
          edges {
            node {
              url
              altText
            }
          }
        }
        priceRange {
          minVariantPrice {
            amount
            currencyCode
          }
          maxVariantPrice {
            amount
            currencyCode
          }
        }
        variants(first: 20) {
          edges {
            node {
              id
              title
              availableForSale
              price {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  `;

  const response = await shopifyFetch({ query, variables: { handle } });
  
  if (!response?.data?.product) return null;
  
  const product = response.data.product;

  const variants = product.variants?.edges?.map(({ node }) => ({
    id: node.id,
    title: node.title,
    available: node.availableForSale,
    price: node.price?.amount || "0",
    currency: node.price?.currencyCode || "GBP",
  })) || [];

  const defaultVariant = variants[0];

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    description: product.description,
    images: product.images?.edges?.map(({ node }) => ({
      url: node.url,
      altText: node.altText || product.title,
    })) || [],
    price: defaultVariant ? defaultVariant.price : product.priceRange?.minVariantPrice?.amount || "0",
    currency: defaultVariant ? defaultVariant.currency : product.priceRange?.minVariantPrice?.currencyCode || "GBP",
    variantId: defaultVariant ? defaultVariant.id : null,
    variants,
  };
}
