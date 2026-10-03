import type { Product } from './types.ts';

/**
 * Demo catalogue. Generic, unbranded products with typical ingredient lists,
 * written for this project (not copied from any real product's label).
 */
export type CatalogItem = Omit<Product, 'id' | 'addedAt' | 'source'> & { catalogId: string };

export const CATALOG: CatalogItem[] = [
  {
    catalogId: 'foaming-cleanser',
    name: 'Foaming Gel Cleanser',
    category: 'cleanser',
    usage: 'both',
    frequency: 7,
    rinseOff: true,
    prescription: false,
    ingredientsRaw:
      'Aqua (Water), Cocamidopropyl Betaine, Sodium Cocoyl Glycinate, Glycerin, Sodium Chloride, Panthenol, Citric Acid, Parfum (Fragrance), Linalool, Limonene, Phenoxyethanol, Sodium Benzoate.',
  },
  {
    catalogId: 'glycolic-toner',
    name: 'Glow Tonic 7% Glycolic',
    category: 'toner',
    usage: 'pm',
    frequency: 7,
    rinseOff: false,
    prescription: false,
    ingredientsRaw:
      'Aqua, Glycolic Acid, Rosa Damascena Flower Water, Aloe Barbadensis Leaf Juice, Glycerin, Ammonium Hydroxide, Panthenol, Tocopherol, Hexylene Glycol, Sodium Benzoate, Parfum, Citronellol, Geraniol.',
  },
  {
    catalogId: 'bha-liquid',
    name: '2% BHA Liquid Exfoliant',
    category: 'exfoliant',
    usage: 'pm',
    frequency: 4,
    rinseOff: false,
    prescription: false,
    ingredientsRaw:
      'Water, Butylene Glycol, Salicylic Acid, Polysorbate 20, Camellia Oleifera Leaf Extract, Sodium Hydroxide, Tetrasodium EDTA.',
  },
  {
    catalogId: 'retinol-serum',
    name: 'Retinol 0.5% Night Serum',
    category: 'serum',
    usage: 'pm',
    frequency: 7,
    rinseOff: false,
    prescription: false,
    ingredientsRaw:
      'Aqua, Squalane, Glycerin, Caprylic/Capric Triglyceride, Retinol, Tocopherol, Bisabolol, Ceramide NP, Sodium Hyaluronate, Carbomer, Polysorbate 20, Phenoxyethanol, Ethylhexylglycerin.',
  },
  {
    catalogId: 'vitamin-c-serum',
    name: 'Vitamin C 15% Serum',
    category: 'serum',
    usage: 'am',
    frequency: 7,
    rinseOff: false,
    prescription: false,
    ingredientsRaw:
      'Aqua, Ascorbic Acid, Ethoxydiglycol, Glycerin, Ferulic Acid, Tocopherol, Sodium Hyaluronate, Triethanolamine, Phenoxyethanol.',
  },
  {
    catalogId: 'niacinamide-serum',
    name: 'Niacinamide 10% + Zinc Serum',
    category: 'serum',
    usage: 'both',
    frequency: 7,
    rinseOff: false,
    prescription: false,
    ingredientsRaw:
      'Aqua (Water), Niacinamide, Pentylene Glycol, Zinc PCA, Dimethyl Isosorbide, Tamarindus Indica Seed Gum, Xanthan Gum, Isoceteth-20, Ethoxydiglycol, Phenoxyethanol, Chlorphenesin.',
  },
  {
    catalogId: 'bpo-spot-gel',
    name: 'Benzoyl Peroxide 5% Spot Gel',
    category: 'treatment',
    usage: 'flex',
    frequency: 3,
    rinseOff: false,
    prescription: false,
    ingredientsRaw:
      'Active ingredient: Benzoyl Peroxide 5%. Inactive ingredients: Water, Carbomer, Sodium Hydroxide, Glycerin, Docusate Sodium, Disodium EDTA.',
  },
  {
    catalogId: 'barrier-cream',
    name: 'Ceramide Barrier Cream',
    category: 'moisturizer',
    usage: 'both',
    frequency: 7,
    rinseOff: false,
    prescription: false,
    ingredientsRaw:
      'Aqua, Glycerin, Cetearyl Alcohol, Caprylic/Capric Triglyceride, Ceramide NP, Ceramide AP, Ceramide EOP, Cholesterol, Phytosphingosine, Sodium Hyaluronate, Dimethicone, Petrolatum, Carbomer, Xanthan Gum, Phenoxyethanol.',
  },
  {
    catalogId: 'eye-cream',
    name: 'Brightening Eye Cream',
    category: 'eye',
    usage: 'both',
    frequency: 7,
    rinseOff: false,
    prescription: false,
    ingredientsRaw:
      'Aqua, Caffeine, Glycerin, Niacinamide, Butyrospermum Parkii (Shea) Butter, Cetyl Alcohol, Palmitoyl Tripeptide-1, Tocopheryl Acetate, Parfum, Phenoxyethanol.',
  },
  {
    catalogId: 'spf50-fluid',
    name: 'Daily Fluid SPF 50',
    category: 'sunscreen',
    usage: 'am',
    frequency: 7,
    rinseOff: false,
    prescription: false,
    ingredientsRaw:
      'Aqua, Homosalate, Ethylhexyl Salicylate, Butyl Methoxydibenzoylmethane, Octocrylene, Glycerin, Silica, Niacinamide, Tocopherol, Dimethicone, Phenoxyethanol.',
  },
  {
    catalogId: 'mineral-spf30',
    name: 'Mineral Sunscreen SPF 30',
    category: 'sunscreen',
    usage: 'am',
    frequency: 7,
    rinseOff: false,
    prescription: false,
    ingredientsRaw: 'Active: Zinc Oxide 18%. Inactive: Aqua, Caprylic/Capric Triglyceride, Glycerin, Squalane, Polyhydroxystearic Acid, Tocopherol, Allantoin.',
  },
  {
    catalogId: 'adapalene-gel',
    name: 'Adapalene 0.1% Gel',
    category: 'treatment',
    usage: 'pm',
    frequency: 3,
    rinseOff: false,
    prescription: false,
    ingredientsRaw: 'Active ingredient: Adapalene 0.1% (retinoid). Inactive ingredients: Carbomer 940, Edetate Disodium, Methylparaben, Poloxamer 182, Propylene Glycol, Purified Water, Sodium Hydroxide.',
  },
  {
    catalogId: 'tretinoin-cream',
    name: 'Tretinoin 0.025% Cream (prescribed)',
    category: 'treatment',
    usage: 'pm',
    frequency: 3,
    rinseOff: false,
    prescription: true,
    ingredientsRaw: 'Tretinoin 0.025%. Inactive: Purified Water, Stearic Acid, Isopropyl Myristate, Polyoxyl 40 Stearate, Stearyl Alcohol, Xanthan Gum, Sorbic Acid, Butylated Hydroxytoluene.',
  },
  {
    catalogId: 'cream-cleanser',
    name: 'Gentle Cream Cleanser (fragrance-free)',
    category: 'cleanser',
    usage: 'both',
    frequency: 7,
    rinseOff: true,
    prescription: false,
    ingredientsRaw: 'Aqua, Glycerin, Cetearyl Alcohol, Caprylic/Capric Triglyceride, Ceramide NP, Cholesterol, Sodium Lauroyl Lactylate, Carbomer, Phenoxyethanol.',
  },
  {
    catalogId: 'centella-gel',
    name: 'Centella Soothing Gel',
    category: 'moisturizer',
    usage: 'both',
    frequency: 7,
    rinseOff: false,
    prescription: false,
    ingredientsRaw: 'Centella Asiatica Leaf Extract, Aqua, Glycerin, Madecassoside, Panthenol, Allantoin, Beta-Glucan, Sodium Hyaluronate, Carbomer, Ethylhexylglycerin.',
  },
  {
    catalogId: 'peel-mask',
    name: 'AHA/BHA 10-Minute Peel Mask',
    category: 'mask',
    usage: 'pm',
    frequency: 1,
    rinseOff: true,
    prescription: false,
    ingredientsRaw: 'Aqua, Glycolic Acid, Lactic Acid, Salicylic Acid, Kaolin, Glycerin, Sodium Hydroxide, Xanthan Gum, Parfum, Phenoxyethanol.',
  },
  {
    catalogId: 'copper-serum',
    name: 'Copper Peptide Serum',
    category: 'serum',
    usage: 'flex',
    frequency: 7,
    rinseOff: false,
    prescription: false,
    ingredientsRaw: 'Aqua, Copper Tripeptide-1, Glycerin, Sodium Hyaluronate, Panthenol, Pentylene Glycol, Phenoxyethanol.',
  },
  {
    catalogId: 'azelaic-cream',
    name: 'Azelaic Acid 10% Cream',
    category: 'treatment',
    usage: 'flex',
    frequency: 7,
    rinseOff: false,
    prescription: false,
    ingredientsRaw: 'Aqua, Azelaic Acid, Dimethicone, Isodecyl Neopentanoate, Glycerin, Cetearyl Alcohol, Allantoin, Xanthan Gum, Phenoxyethanol.',
  },
];

/** The shelf the demo starts with: a typical over-stacked routine with no sunscreen. */
export const DEMO_SHELF_IDS = [
  'foaming-cleanser',
  'glycolic-toner',
  'bha-liquid',
  'retinol-serum',
  'vitamin-c-serum',
  'niacinamide-serum',
  'bpo-spot-gel',
  'barrier-cream',
  'eye-cream',
];

export function productFromCatalog(item: CatalogItem, id: string, addedAt: string): Product {
  const { catalogId: _ignored, ...rest } = item;
  return { ...rest, id, addedAt, source: 'catalog' };
}
