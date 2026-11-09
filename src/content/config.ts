import { defineCollection, z } from 'astro:content';

const portfolioCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    service: z.enum(['Weddings', 'Events', 'Stem Bar', 'Hospitality', 'Sympathy', 'Commissions']),
    venue: z.string(),
    location: z.string(),
    season: z.string(),
    photographer: z.string(),
    hero: z.string(),
    gallery: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    excerpt: z.string(),
    order: z.number().default(99)
  })
});

export const collections = {
  portfolio: portfolioCollection
};
