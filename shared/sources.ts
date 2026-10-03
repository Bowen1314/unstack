/**
 * Every citation the app shows. Each URL was opened and read on 2026-10-02;
 * `supports` is the short sentence on that page that backs the rule.
 * Nothing else in the codebase may invent a URL: rules reference these ids.
 */
export interface Source {
  id: SourceId;
  label: string;
  url: string;
  supports: string;
}

export type SourceId =
  | 'fda-aha'
  | 'aad-retinoid'
  | 'dailymed-adapalene'
  | 'aad-exfoliate'
  | 'martin-1998'
  | 'smpc-adapalene'
  | 'dailymed-bpo'
  | 'pmc-ascorbic-stability'
  | 'pmc-vitc-niacinamide'
  | 'aad-fragrance-free'
  | 'aad-acne-timeline'
  | 'aad-patch-test'
  | 'aad-sunscreen';

export const SOURCES: Record<SourceId, Source> = {
  'fda-aha': {
    id: 'fda-aha',
    label: 'US FDA: Alpha Hydroxy Acids in cosmetics',
    url: 'https://www.fda.gov/cosmetics/cosmetic-ingredients/alpha-hydroxy-acids',
    supports: 'Applying AHAs to the skin results in increased UV sensitivity.',
  },
  'aad-retinoid': {
    id: 'aad-retinoid',
    label: 'American Academy of Dermatology: retinoids and retinol',
    url: 'https://www.aad.org/public/everyday-care/skin-care-secrets/anti-aging/retinoid-retinol',
    supports: 'Use the least-intense retinoid formula, every other night to start; use it at night.',
  },
  'dailymed-adapalene': {
    id: 'dailymed-adapalene',
    label: 'DailyMed: adapalene gel 0.1% (OTC) Drug Facts',
    url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=ec6811f7-4728-41b1-8647-d63bb135e24e',
    supports: 'Irritation is more likely if using more than one topical acne medication at a time; use sunscreen.',
  },
  'aad-exfoliate': {
    id: 'aad-exfoliate',
    label: 'American Academy of Dermatology: how to safely exfoliate at home',
    url: 'https://www.aad.org/public/everyday-care/skin-care-secrets/routine/safely-exfoliate-at-home',
    supports: 'The more aggressive the exfoliation, the less often it needs to be done; retinoids or benzoyl peroxide make skin more sensitive.',
  },
  'martin-1998': {
    id: 'martin-1998',
    label: 'Martin et al., Br J Dermatol 1998 (in-vitro stability with benzoyl peroxide)',
    url: 'https://pubmed.ncbi.nlm.nih.gov/9990414/',
    supports: 'Adapalene exhibits a remarkable stability whereas tretinoin is very sensitive to light and oxidation.',
  },
  'smpc-adapalene': {
    id: 'smpc-adapalene',
    label: 'UK SmPC: adapalene (Differin)',
    url: 'https://www.medicines.org.uk/emc/product/921/smpc',
    supports: 'Adapalene at night with benzoyl peroxide in the morning: no mutual degradation or cumulative irritation.',
  },
  'dailymed-bpo': {
    id: 'dailymed-bpo',
    label: 'DailyMed: benzoyl peroxide gel Drug Facts',
    url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=1e11e62e-9377-4b32-b1c8-402619bf4140&audience=consumer',
    supports: 'Avoid contact with hair or dyed fabrics, which may be bleached by this product.',
  },
  'pmc-ascorbic-stability': {
    id: 'pmc-ascorbic-stability',
    label: 'Review: stability of ascorbic acid in topical formulations (Antioxidants, 2022)',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8773188/',
    supports: 'Ascorbic acid forms dehydroascorbic acid in the presence of oxygen; transition metals can make it pro-oxidant.',
  },
  'pmc-vitc-niacinamide': {
    id: 'pmc-vitc-niacinamide',
    label: 'Review: vitamin C and nicotinamide (Molecules, 2022)',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9370691/',
    supports: 'Topical use of vitamin C and nicotinamide has also shown excellent safety.',
  },
  'aad-fragrance-free': {
    id: 'aad-fragrance-free',
    label: 'American Academy of Dermatology: choosing skin-friendly products',
    url: 'https://www.aad.org/public/diseases/eczema/childhood/triggers/friendly-products',
    supports: 'Unscented means a fragrance is masked; fragrance-free means the product is free of all fragrances.',
  },
  'aad-acne-timeline': {
    id: 'aad-acne-timeline',
    label: 'American Academy of Dermatology: how long products take to work',
    url: 'https://www.aad.org/public/diseases/acne/skin-care/clearer-skin/acne-how-to-clear',
    supports: 'If a treatment works for you, you should notice some improvement in 4 to 6 weeks.',
  },
  'aad-patch-test': {
    id: 'aad-patch-test',
    label: 'American Academy of Dermatology: how to test skin care products',
    url: 'https://www.aad.org/public/everyday-care/skin-care-secrets/prevent-skin-problems/test-skin-care-products',
    supports: 'Apply the product to a test spot twice daily for seven to 10 days.',
  },
  'aad-sunscreen': {
    id: 'aad-sunscreen',
    label: 'American Academy of Dermatology: how to select a sunscreen',
    url: 'https://www.aad.org/public/everyday-care/sun-protection/shade-clothing-sunscreen/how-to-select-sunscreen',
    supports: 'Select a broad-spectrum sunscreen with an SPF rating of 30 or higher.',
  },
};

export function sourcesFor(ids: readonly SourceId[]): Source[] {
  return ids.map((id) => SOURCES[id]);
}
