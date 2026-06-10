SB Floristry 🌸SB Floristry is a premium, modern e-commerce platform and bespoke brand experience website for a family-run floristry business. Built on Astro and styled with Tailwind CSS, it integrates with Shopify for headless product management and GoCardless for subscription-based payments via Direct Debit.🚀 Key FeaturesAstro Framework Integration: Utilizing Astro's zero-JS-by-default architecture for lightning-fast performance, static page generation, and dynamic API endpoints.Shopify Storefront API Integration: Headless product loading, collections generation, and product detail rendering directly from your Shopify store inventory.GoCardless Payment Flows: Secure endpoints (/api/gocardless/create-checkout) to facilitate recurring subscription plans via direct debits alongside webhook verifications.Occasion Finder: An interactive helper tool assisting users in discovering the perfect floral collection for anniversaries, sympathy, birthdays, and celebrations.Tailored Corporate & Funeral Journeys: Bespoke pages targeting Hotels, Spas, Events, and Sympathy/Funerals arrangements.Responsive Shopping Cart: Lightweight, custom-designed sliding modal cart tracking user sessions and processing cart checkouts seamlessly.🛠️ Tech StackFrontend Framework: AstroCSS Framework: Tailwind CSSHeadless Commerce: Shopify Storefront API (GraphQL)Payment Processor: GoCardless Node SDKLanguage: TypeScript / JavaScript (ES6+)📁 Directory StructureThe structure of the codebase is highly modularized to separate pages, components, configuration, and API services:├── .astro/                 # Astro build/runtime configurations
├── .vscode/                # Editor settings & recommended extensions
├── public/                 # Static local assets (logos, high-res images)
│   └── images/             # Product fallbacks, hero backdrops, gallery assets
└── src/
    ├── components/         # Modular Astro components (Header, Footer, Cart, etc.)
    │   ├── CartModal.astro
    │   ├── Footer.astro
    │   ├── Header.astro
    │   ├── ProductCard.astro
    │   └── Testimonials.astro
    ├── config/             # Local structured JSON configs (e.g., delivery rates)
    ├── layouts/            # Global application page layout wrapping pages
    ├── pages/              # Routing & endpoints mapping (Astro file-based router)
    │   ├── api/            # Serverless API routes (GoCardless webhooks/checkout)
    │   ├── collections/    # Tag-based dynamic collection routing
    │   ├── corporate/      # Specialized B2B and venue floral services
    │   ├── products/       # Dynamic Shopify handle-based product templates
    │   ├── index.astro     # Homepage landing template
    │   └── ...other static routes (our-story, contact, subscriptions)
    ├── utils/              # Helper utilities (Shopify GraphQL fetcher)
    │   └── shopify.js
    └── env.d.ts            # Type definitions for environment variables
⚙️ Setup and InstallationPrerequisitesNode.js (v18.x or newer recommended)npm (packaged with Node.js) or yarn / pnpm1. Clone the repository and install dependenciesgit clone <repository-url>
cd SB-Floristry
npm install
2. Configure Environment VariablesCreate a .env file in the root directory and configure your credentials for Shopify and GoCardless:# Shopify Storefront credentials
SHOPIFY_STOREFRONT_ACCESS_TOKEN=your_shopify_storefront_access_token
SHOPIFY_STORE_DOMAIN=your-store-name.myshopify.com

# GoCardless credentials (test sandbox or live production keys)
GOCARDLESS_ACCESS_TOKEN=your_gocardless_api_token
GOCARDLESS_ENVIRONMENT=sandbox # or 'live'
GOCARDLESS_WEBHOOK_SECRET=your_gocardless_webhook_secret_key

# Public Site URL
SITE_URL=http://localhost:4321
3. Run Development ServerStart the local server. The page automatically reloads upon saving directory edits.npm run dev
Open http://localhost:4321 in your browser to view the site.4. Build for ProductionTo generate a fully optimized static build with compiled serverless API endpoints:npm run build
You can preview the built production bundle locally using:npm run preview
🌐 API IntegrationsShopify Integration (src/utils/shopify.js)Queries products, collections, and variations through Shopify's Storefront API using GraphQL. To modify queries or update query fields, modify this utility file.GoCardless API Integration (src/pages/api/gocardless/)Create Checkout (create-checkout.js): Creates redirect flow endpoints to sign up customers to subscription-based direct debits.Webhooks (webhook.js): Listens to event triggers (payouts, confirmation, cancellations) dispatched by GoCardless to keep customer statuses up to date securely.📄 LicenseThis project is proprietary and confidential. All rights reserved by the original owners.
