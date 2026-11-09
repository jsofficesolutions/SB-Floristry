/**
 * SB Floristry - Services, Pricing & Qualification Configuration
 * 
 * Central registry for all service tiers, starting minimums, budget bands,
 * and lead-scoring thresholds. Read by EnquiryForm, API endpoint, and marketing pages.
 */

export interface BudgetBand {
  id: string;
  label: string;
  minAmount: number;
  maxAmount?: number;
  tier: 'A' | 'B' | 'C';
  isBelowMinimum?: boolean;
}

export interface ServiceDefinition {
  id: string;
  name: string;
  slug: string;
  eyebrow: string;
  tagline: string;
  minimumInvestment: string;
  minNumeric: number;
  pricingNote?: string;
  belowMinimumNote?: string;
  budgetBands: BudgetBand[];
}

export const services: Record<string, ServiceDefinition> = {
  weddings: {
    id: 'weddings',
    name: 'Weddings & Private Estates',
    slug: '/weddings/',
    eyebrow: 'Bridal Architecture',
    tagline: 'Immersive floral environments for historic manors, country estates, and London celebrations.',
    minimumInvestment: 'From £3,500',
    minNumeric: 3500,
    belowMinimumNote:
      'Our founder-led wedding commissions begin at £3,500 to ensure bespoke sourcing, mockups, and on-site architectural installation. For smaller floral requirements, we recommend our curated seasonal services or contacting our studio team directly.',
    budgetBands: [
      { id: 'weddings-below', label: 'Under £3,500', minAmount: 0, maxAmount: 3499, tier: 'C', isBelowMinimum: true },
      { id: 'weddings-tier-1', label: '£3,500 – £6,000', minAmount: 3500, maxAmount: 6000, tier: 'C' },
      { id: 'weddings-tier-2', label: '£6,000 – £10,000', minAmount: 6000, maxAmount: 10000, tier: 'B' },
      { id: 'weddings-tier-3', label: '£10,000 – £20,000', minAmount: 10000, maxAmount: 20000, tier: 'A' },
      { id: 'weddings-tier-4', label: '£20,000+', minAmount: 20000, tier: 'A' }
    ]
  },
  events: {
    id: 'events',
    name: 'Private & Brand Events',
    slug: '/events/',
    eyebrow: 'Galas & Showcases',
    tagline: 'High-contrast tablescapes, brand debuts, and sculptural ballroom staging.',
    minimumInvestment: 'From £2,500',
    minNumeric: 2500,
    belowMinimumNote:
      'Our event floristry begins at £2,500 to allow complete venue reconnaissance, load-in coordination, and after-hours collection. For intimate dinner gatherings, speak to our studio about bespoke dining packages.',
    budgetBands: [
      { id: 'events-below', label: 'Under £2,500', minAmount: 0, maxAmount: 2499, tier: 'C', isBelowMinimum: true },
      { id: 'events-tier-1', label: '£2,500 – £5,000', minAmount: 2500, maxAmount: 5000, tier: 'C' },
      { id: 'events-tier-2', label: '£5,000 – £10,000', minAmount: 5000, maxAmount: 10000, tier: 'B' },
      { id: 'events-tier-3', label: '£10,000+', minAmount: 10000, tier: 'A' }
    ]
  },
  stembar: {
    id: 'stembar',
    name: 'The Living Stem Bar',
    slug: '/stem-bar/',
    eyebrow: 'Interactive Experience',
    tagline: 'An interactive sommelier-style floral activation for receptions, galas, and celebrations.',
    minimumInvestment: 'From £1,500',
    minNumeric: 1500,
    belowMinimumNote:
      'Stem Bar activations begin at £1,500 for a half-day session, which includes two senior studio florists, display vessels, fresh stems for up to 100 guests, silk ribbon, and wax seal stamps.',
    budgetBands: [
      { id: 'stembar-below', label: 'Under £1,500', minAmount: 0, maxAmount: 1499, tier: 'C', isBelowMinimum: true },
      { id: 'stembar-tier-1', label: '£1,500 – £3,000', minAmount: 1500, maxAmount: 3000, tier: 'C' },
      { id: 'stembar-tier-2', label: '£3,000 – £6,000', minAmount: 3000, maxAmount: 6000, tier: 'B' },
      { id: 'stembar-tier-3', label: '£6,000+', minAmount: 6000, tier: 'A' }
    ]
  },
  hospitality: {
    id: 'hospitality',
    name: 'Hospitality & Residencies',
    slug: '/hospitality/',
    eyebrow: 'Contract Botanicals',
    tagline: 'Weekly floral foyer curation, spa botanicals, and seasonal venue transformations.',
    minimumInvestment: 'From £250/week or £750 one-off',
    minNumeric: 250,
    belowMinimumNote:
      'Weekly corporate and hotel residencies begin at £250/week (under a 3-month seasonal agreement), with one-off dining and event installations starting at £750.',
    budgetBands: [
      { id: 'hosp-below', label: 'Under £250/wk or £750 one-off', minAmount: 0, maxAmount: 249, tier: 'C', isBelowMinimum: true },
      { id: 'hosp-tier-1', label: '£250 – £500 / week', minAmount: 250, maxAmount: 500, tier: 'B' },
      { id: 'hosp-tier-2', label: '£500 – £1,000 / week', minAmount: 500, maxAmount: 1000, tier: 'A' },
      { id: 'hosp-tier-3', label: '£1,000+ / week', minAmount: 1000, tier: 'A' },
      { id: 'hosp-oneoff', label: 'One-off Installation (£750 – £2,500)', minAmount: 750, maxAmount: 2500, tier: 'B' }
    ]
  },
  commissions: {
    id: 'commissions',
    name: 'Private Commissions & Editorial Art',
    slug: '/commissions/',
    eyebrow: 'Bespoke Creations',
    tagline: 'Site-specific botanical sculpture, residential holiday staging, and fashion editorial styling.',
    minimumInvestment: 'From £500',
    minNumeric: 500,
    belowMinimumNote:
      'Private artistic commissions begin at £500, covering consultation, bespoke specimen sourcing, vessel staging, and personal installation.',
    budgetBands: [
      { id: 'comm-below', label: 'Under £500', minAmount: 0, maxAmount: 499, tier: 'C', isBelowMinimum: true },
      { id: 'comm-tier-1', label: '£500 – £1,500', minAmount: 500, maxAmount: 1500, tier: 'C' },
      { id: 'comm-tier-2', label: '£1,500 – £5,000', minAmount: 1500, maxAmount: 5000, tier: 'B' },
      { id: 'comm-tier-3', label: '£5,000+', minAmount: 5000, tier: 'A' }
    ]
  },
  sympathy: {
    id: 'sympathy',
    name: 'Sympathy & Memorial Tributes',
    slug: '/sympathy/',
    eyebrow: 'Quiet Solace',
    tagline: 'Naturalistic casket sprays, wreaths, and chapel memorials crafted with reverent care.',
    minimumInvestment: 'From £225 (Wreaths) / £350 (Casket Sprays)',
    minNumeric: 225,
    pricingNote: 'Wreaths from £225 · Casket Sprays from £350 · Name Tributes from £300 · Chapel Urns from £1,000',
    belowMinimumNote:
      'Our artisanal memorial tributes begin at £225 for circular statement wreaths and £350 for casket sprays, using sustainable foam-free mechanics and direct delivery to the chapel of rest.',
    budgetBands: [
      { id: 'symp-tier-1', label: 'Under £300 (Wreath / Posy tribute)', minAmount: 0, maxAmount: 299, tier: 'C' },
      { id: 'symp-tier-2', label: '£300 – £600 (Casket Spray / Name letters)', minAmount: 300, maxAmount: 600, tier: 'B' },
      { id: 'symp-tier-3', label: '£600 – £1,200 (Full Casket & Family Tributes)', minAmount: 600, maxAmount: 1200, tier: 'A' },
      { id: 'symp-tier-4', label: '£1,200+ (Comprehensive Chapel Sanctuary Installation)', minAmount: 1200, tier: 'A' }
    ]
  }
};

/**
 * Lead scoring helper: classifies enquiry into Tier A, B, or C
 * based on service, budget band, and notice window.
 */
export function calculateLeadTier(
  serviceKey: string,
  budgetBandId?: string,
  eventDate?: string
): { tier: 'A' | 'B' | 'C'; reason: string } {
  const service = services[serviceKey];
  if (!service) {
    return { tier: 'C', reason: 'Unrecognized service' };
  }

  // Sympathy is handled with express priority
  if (serviceKey === 'sympathy') {
    return { tier: 'A', reason: 'Sympathy commission (rapid priority turnaround)' };
  }

  const band = service.budgetBands.find((b) => b.id === budgetBandId);
  let baseTier: 'A' | 'B' | 'C' = band?.tier || 'B';

  if (band?.isBelowMinimum) {
    return { tier: 'C', reason: 'Budget below service minimum' };
  }

  // Check lead time
  if (eventDate) {
    const target = new Date(eventDate);
    const now = new Date();
    const diffDays = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { tier: 'C', reason: 'Date in the past' };
    }

    // Short notice: under 6 weeks (42 days)
    if (diffDays <= 42 && baseTier === 'A') {
      return { tier: 'A', reason: 'High-value commission with urgent timeline (< 6 weeks)' };
    }
  }

  return { tier: baseTier, reason: `Standard ${baseTier}-tier qualification based on investment tier` };
}

