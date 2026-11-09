import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.sbfloristry.co.uk', 
  
  // Enforce consistent trailing slashes across your whole site to prevent duplicate content indexing
  trailingSlash: 'always',

  // Hybrid rendering compiles the site statically, but lets SSR routes run on Cloudflare Pages
  output: 'hybrid',
  adapter: cloudflare({
    imageService: 'cloudflare'
  }),

  // Redirects table for retired paths and legacy aliases
  redirects: {
    '/contact': '/enquire/',
    '/occasion-finder': '/',
    '/corporate': '/events/',
    '/corporate/events': '/events/',
    '/corporate/hotels': '/hospitality/',
    '/corporate/spas-wellness': '/hospitality/',
    '/funerals': '/sympathy/',
    '/our-story': '/studio/'
  },

  integrations: [
    tailwind(),
    sitemap({
      // Automated filter to remove redirects, internal testing paths, and private trade pages
      filter: (page) => {
        const path = new URL(page).pathname;
        const excludedPrefixes = [
          '/success',
          '/trade',
          '/corporate',
          '/contact',
          '/funerals',
          '/our-story',
          '/occasion-finder',
          '/enquire/received'
        ];
        return !excludedPrefixes.some(prefix => path.startsWith(prefix));
      }
    })
  ],
  image: {
    domains: ['cdn.shopify.com'],
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover'
  },
  vite: {
    plugins: [
      {
        name: 'dev-trailing-slash-redirect',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            const url = req.url || '';
            const [pathname, search] = url.split('?');
            if (
              pathname &&
              !pathname.endsWith('/') &&
              !pathname.includes('.') &&
              !pathname.startsWith('/api') &&
              !pathname.startsWith('/@') &&
              !pathname.startsWith('/_')
            ) {
              res.writeHead(301, {
                Location: `${pathname}/${search ? `?${search}` : ''}`
              });
              res.end();
              return;
            }
            next();
          });
        }
      }
    ]
  }
});
