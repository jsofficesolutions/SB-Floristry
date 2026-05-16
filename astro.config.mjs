import { defineConfig } from 'astro:config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.sbfloristry.co.uk', 
  integrations: [
    tailwind(),
    sitemap()
  ],
  image: {
    // This allows Astro to optimize images coming from your Shopify store
    domains: ['cdn.shopify.com'],
  },
  // Enable prefetching for a faster "feel" when users hover over links
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover'
  }
});
