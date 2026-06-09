import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.sbfloristry.co.uk', 
  
  // Enforce consistent trailing slashes across your whole site to prevent duplicate content indexing
  trailingSlash: 'always',

  // Hybrid rendering compiles the site statically, but lets our GoCardless routes run SSR
  output: 'hybrid',
  adapter: cloudflare(),

  integrations: [
    tailwind(),
    sitemap({
      // Automated filter to remove internal testing paths and duplicate clone pages from Google's crawlers
      filter: (page) => 
        !page.includes('/success') && 
        !page.includes('-copy') && 
        !page.includes('untitled')
    })
  ],
  image: {
    domains: ['cdn.shopify.com'],
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover'
  }
});
