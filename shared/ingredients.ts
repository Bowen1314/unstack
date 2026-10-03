import type { DetectedIngredient, Family, Product, ProductAnalysis } from './types.ts';

/**
 * Ingredient knowledge base. Each entry maps INCI names (and common label
 * spellings) to a cosmetic function family. `maxPosition` limits detection to
 * the top of the list for ingredients that are also used in tiny amounts for a
 * different purpose (citric acid as a pH adjuster, ethanol as a solvent).
 */
interface KbEntry {
  family: Family;
  inci: string;
  aliases: string[];
  pattern?: RegExp;
  variant?: DetectedIngredient['variant'];
  maxPosition?: number;
}

const KB: KbEntry[] = [
  // Retinoids
  { family: 'retinoid', inci: 'tretinoin', aliases: ['tretinoin', 'retinoic acid', 'all-trans retinoic acid'], variant: 'tretinoin' },
  { family: 'retinoid', inci: 'tazarotene', aliases: ['tazarotene'], variant: 'other_rx' },
  { family: 'retinoid', inci: 'trifarotene', aliases: ['trifarotene'], variant: 'other_rx' },
  { family: 'retinoid', inci: 'adapalene', aliases: ['adapalene'], variant: 'adapalene' },
  { family: 'retinoid', inci: 'retinol', aliases: ['retinol', 'encapsulated retinol'], variant: 'retinol' },
  { family: 'retinoid', inci: 'retinal', aliases: ['retinal', 'retinaldehyde'], variant: 'retinal' },
  { family: 'retinoid', inci: 'hydroxypinacolone retinoate', aliases: ['hydroxypinacolone retinoate', 'granactive retinoid'], variant: 'hpr' },
  { family: 'retinoid', inci: 'retinyl palmitate', aliases: ['retinyl palmitate', 'retinyl acetate', 'retinyl propionate', 'retinyl retinoate', 'retinyl linoleate'], variant: 'retinyl_ester' },

  // Chemical exfoliants
  { family: 'aha', inci: 'glycolic acid', aliases: ['glycolic acid', 'ammonium glycolate'] },
  { family: 'aha', inci: 'lactic acid', aliases: ['lactic acid'], maxPosition: 12 },
  { family: 'aha', inci: 'mandelic acid', aliases: ['mandelic acid'] },
  { family: 'aha', inci: 'malic acid', aliases: ['malic acid'], maxPosition: 8 },
  { family: 'aha', inci: 'tartaric acid', aliases: ['tartaric acid'], maxPosition: 8 },
  { family: 'aha', inci: 'citric acid', aliases: ['citric acid'], maxPosition: 3 },
  { family: 'bha', inci: 'salicylic acid', aliases: ['salicylic acid', 'betaine salicylate', 'capryloyl salicylic acid'] },
  { family: 'pha', inci: 'gluconolactone', aliases: ['gluconolactone', 'lactobionic acid', 'maltobionic acid'] },
  { family: 'physical_exfoliant', inci: 'juglans regia shell powder', aliases: ['juglans regia shell powder', 'walnut shell powder', 'prunus armeniaca seed powder', 'apricot seed powder', 'pumice', 'prunus amygdalus dulcis shell powder'] },

  // Blemish-care actives
  { family: 'benzoyl_peroxide', inci: 'benzoyl peroxide', aliases: ['benzoyl peroxide', 'hydrous benzoyl peroxide'] },
  { family: 'azelaic_acid', inci: 'azelaic acid', aliases: ['azelaic acid', 'potassium azeloyl diglycinate'] },
  { family: 'sulfur', inci: 'sulfur', aliases: ['sulfur', 'sulphur', 'colloidal sulfur'] },

  // Vitamin C
  { family: 'vitamin_c_laa', inci: 'ascorbic acid', aliases: ['ascorbic acid', 'l-ascorbic acid'] },
  {
    family: 'vitamin_c_derivative',
    inci: 'sodium ascorbyl phosphate',
    aliases: [
      'sodium ascorbyl phosphate',
      'magnesium ascorbyl phosphate',
      'ascorbyl glucoside',
      'ethyl ascorbic acid',
      '3-o-ethyl ascorbic acid',
      'tetrahexyldecyl ascorbate',
      'ascorbyl tetraisopalmitate',
    ],
  },

  // Supporting actives
  { family: 'niacinamide', inci: 'niacinamide', aliases: ['niacinamide', 'nicotinamide'] },
  { family: 'copper_peptide', inci: 'copper tripeptide-1', aliases: ['copper tripeptide-1', 'copper peptide', 'ghk-cu'] },
  { family: 'peptide', inci: 'palmitoyl tripeptide-1', aliases: ['acetyl hexapeptide-8', 'argireline'], pattern: /^(palmitoyl|acetyl|myristoyl)?\s?(di|tri|tetra|penta|hexa|hepta|octa|oligo)peptide-\d+/ },
  { family: 'brightener', inci: 'tranexamic acid', aliases: ['tranexamic acid', 'alpha-arbutin', 'arbutin', 'kojic acid', '4-butylresorcinol', 'hydroquinone', 'glycyrrhiza glabra root extract', 'licorice root extract'] },
  { family: 'caffeine', inci: 'caffeine', aliases: ['caffeine'] },
  { family: 'antioxidant', inci: 'tocopherol', aliases: ['tocopherol', 'tocopheryl acetate', 'ferulic acid', 'resveratrol', 'camellia sinensis leaf extract', 'ubiquinone', 'ascorbyl palmitate'] },

  // Hydration and barrier
  { family: 'humectant', inci: 'glycerin', aliases: ['glycerin', 'glycerine', 'sodium hyaluronate', 'hyaluronic acid', 'hydrolyzed hyaluronic acid', 'sodium pca', 'urea', 'betaine', 'trehalose', 'sodium lactate', 'polyglutamic acid'] },
  { family: 'barrier_lipid', inci: 'ceramide np', aliases: ['cholesterol', 'phytosphingosine'], pattern: /^ceramide\s?(np|ap|eop|ns|as|eos|ng|1|2|3|6 ii)\b/ },
  { family: 'occlusive', inci: 'petrolatum', aliases: ['petrolatum', 'dimethicone', 'squalane', 'butyrospermum parkii butter', 'shea butter', 'mineral oil', 'paraffinum liquidum', 'lanolin'] },
  {
    family: 'soothing',
    inci: 'centella asiatica extract',
    aliases: ['centella asiatica extract', 'centella asiatica leaf extract', 'madecassoside', 'asiaticoside', 'allantoin', 'bisabolol', 'panthenol', 'avena sativa kernel flour', 'colloidal oatmeal', 'aloe barbadensis leaf juice', 'beta-glucan', 'dipotassium glycyrrhizate'],
  },

  // Sunscreen filters
  {
    family: 'sunscreen_filter',
    inci: 'zinc oxide',
    aliases: [
      'zinc oxide',
      'titanium dioxide',
      'avobenzone',
      'butyl methoxydibenzoylmethane',
      'homosalate',
      'octisalate',
      'ethylhexyl salicylate',
      'octocrylene',
      'oxybenzone',
      'benzophenone-3',
      'octinoxate',
      'ethylhexyl methoxycinnamate',
      'ensulizole',
      'phenylbenzimidazole sulfonic acid',
      'bemotrizinol',
      'bis-ethylhexyloxyphenol methoxyphenyl triazine',
      'bisoctrizole',
      'methylene bis-benzotriazolyl tetramethylbutylphenol',
      'diethylamino hydroxybenzoyl hexyl benzoate',
      'ethylhexyl triazone',
      'drometrizole trisiloxane',
      'terephthalylidene dicamphor sulfonic acid',
      'tris-biphenyl triazine',
    ],
    maxPosition: 12,
  },

  // Irritant-load markers
  {
    family: 'fragrance',
    inci: 'parfum',
    aliases: [
      'parfum',
      'fragrance',
      'aroma',
      'linalool',
      'limonene',
      'citronellol',
      'geraniol',
      'eugenol',
      'isoeugenol',
      'coumarin',
      'citral',
      'farnesol',
      'cinnamal',
      'hexyl cinnamal',
      'amyl cinnamal',
      'benzyl salicylate',
      'benzyl benzoate',
      'benzyl cinnamate',
      'hydroxycitronellal',
      'alpha-isomethyl ionone',
    ],
  },
  {
    family: 'essential_oil',
    inci: 'lavandula angustifolia oil',
    aliases: ['tea tree oil'],
    pattern: /\b(lavandula|citrus|mentha|eucalyptus|melaleuca|rosmarinus|cananga|rosa damascena|pelargonium|cymbopogon|bergamia|cinnamomum)\b.*\boil\b/,
  },
  { family: 'drying_alcohol', inci: 'alcohol denat.', aliases: ['alcohol denat', 'alcohol denat.', 'sd alcohol', 'sd alcohol 40', 'alcohol', 'ethanol', 'isopropyl alcohol'], maxPosition: 5 },
];

/** Families that count as "actives": the ones conflict rules care about. */
export const ACTIVE_FAMILIES: ReadonlySet<Family> = new Set<Family>([
  'retinoid',
  'aha',
  'bha',
  'pha',
  'benzoyl_peroxide',
  'vitamin_c_laa',
  'azelaic_acid',
  'sulfur',
  'copper_peptide',
  'physical_exfoliant',
]);

export const FAMILY_LABEL: Record<Family, string> = {
  retinoid: 'Retinoid',
  aha: 'AHA exfoliant',
  bha: 'BHA exfoliant',
  pha: 'PHA exfoliant',
  benzoyl_peroxide: 'Benzoyl peroxide',
  vitamin_c_laa: 'Vitamin C (L-ascorbic acid)',
  vitamin_c_derivative: 'Vitamin C derivative',
  niacinamide: 'Niacinamide',
  azelaic_acid: 'Azelaic acid',
  sulfur: 'Sulfur',
  copper_peptide: 'Copper peptide',
  peptide: 'Peptide',
  brightener: 'Brightening agent',
  humectant: 'Humectant',
  barrier_lipid: 'Barrier lipid',
  occlusive: 'Occlusive',
  soothing: 'Soothing',
  sunscreen_filter: 'UV filter',
  fragrance: 'Fragrance',
  essential_oil: 'Essential oil',
  drying_alcohol: 'Drying alcohol',
  physical_exfoliant: 'Physical scrub',
  caffeine: 'Caffeine',
  antioxidant: 'Antioxidant',
};

const HEADER = /^(?:(?:active|inactive|other)(?:\s+ingredients?)?|ingredients?|inci|composition)\s*[:：-]\s*/i;
/** "...5%. Inactive ingredients: ..." – a sentence break before a section label is a separator. */
const SECTION_BREAK = /\.\s+(?=(?:active|inactive|other|ingredients?)\b[^:,]{0,20}:)/gi;
const MAY_CONTAIN = /(?:\[\s*)?(?:may\s+contain|\+\/-|±)\s*[:：]?/i;

/**
 * Split an INCI list into individual ingredient strings.
 * Handles commas inside parentheses ("Water (Aqua, Eau)") and inside chemical
 * names ("1,2-Hexanediol"), section headers, bullets and line breaks.
 */
export function splitInci(raw: string): string[] {
  const text = raw.replace(/\r/g, '\n').replace(SECTION_BREAK, '\n').replace(/[•·|]/g, ',');
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    const isSeparator = ch === ',' || ch === ';' || ch === '\n';
    const digitComma = ch === ',' && /\d/.test(text[i - 1] ?? '') && /\d/.test(text[i + 1] ?? '');
    if (isSeparator && depth === 0 && !digitComma) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);

  const out: string[] = [];
  for (const part of parts) {
    let item = part.trim();
    if (!item) continue;
    // A header can sit on its own line or prefix the first ingredient.
    item = item.replace(HEADER, '').trim();
    const mayContain = item.search(MAY_CONTAIN);
    if (mayContain >= 0) item = item.slice(mayContain).replace(MAY_CONTAIN, '').replace(/^[\s\[\]]+|[\s\[\]]+$/g, '');
    item = item.replace(/[.\s]+$/, '').trim();
    if (item) out.push(item);
  }
  return out;
}

/** Lower-case, strip percentages, footnote marks and noise; keep parentheses for alternates. */
export function normaliseIngredient(name: string): string {
  return name
    .toLowerCase()
    .replace(/[*†‡¹²³°]/g, '')
    .replace(/\b\d+(?:\.\d+)?\s?%/g, '')
    .replace(/\s*\(\s*nano\s*\)/g, '')
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** All the spellings worth matching for one ingredient, e.g. "butyrospermum parkii (shea) butter". */
function candidateNames(normalised: string): string[] {
  const names = new Set<string>();
  const withoutParens = normalised.replace(/\s*[([][^)\]]*[)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  names.add(withoutParens);
  names.add(normalised.replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim());
  for (const m of normalised.matchAll(/[([]([^)\]]+)[)\]]/g)) {
    for (const alt of m[1]!.split(/[,/]/)) {
      const a = alt.trim();
      if (a) names.add(a);
    }
  }
  return [...names].filter(Boolean);
}

function matchEntry(names: string[]): { entry: KbEntry; name: string } | undefined {
  // Exact alias matches win over patterns so "ascorbic acid" never shadows "ethyl ascorbic acid".
  for (const entry of KB) {
    const name = names.find((n) => entry.aliases.includes(n));
    if (name) return { entry, name };
  }
  for (const entry of KB) {
    const name = entry.pattern ? names.find((n) => entry.pattern!.test(n)) : undefined;
    if (name) return { entry, name };
  }
  return undefined;
}

export function detectIngredients(raw: string): { ingredients: string[]; detected: DetectedIngredient[]; unrecognised: number } {
  const ingredients = splitInci(raw).map(normaliseIngredient).filter(Boolean);
  const detected: DetectedIngredient[] = [];
  let unrecognised = 0;
  ingredients.forEach((ing, idx) => {
    const position = idx + 1;
    const match = matchEntry(candidateNames(ing));
    if (!match) {
      unrecognised++;
      return;
    }
    const { entry, name } = match;
    if (entry.maxPosition !== undefined && position > entry.maxPosition) return;
    const hit: DetectedIngredient = { family: entry.family, inci: name, position };
    if (entry.variant) hit.variant = entry.variant;
    detected.push(hit);
  });
  return { ingredients, detected, unrecognised };
}

export function analyseProduct(product: Product): ProductAnalysis {
  const { ingredients, detected, unrecognised } = detectIngredients(product.ingredientsRaw);
  const families = [...new Set(detected.map((d) => d.family))];
  if (product.category === 'sunscreen' && !families.includes('sunscreen_filter')) families.push('sunscreen_filter');
  const actives = families.filter((f) => ACTIVE_FAMILIES.has(f));
  return { productId: product.id, ingredients, detected, families, actives, unrecognised };
}

/** True if the product provides daily UV protection. */
export function isSunscreen(product: Product, analysis: ProductAnalysis): boolean {
  if (product.category === 'sunscreen') return true;
  if (/\bspf\s?\d{2}/i.test(product.name)) return true;
  return analysis.detected.filter((d) => d.family === 'sunscreen_filter').length >= 2;
}

export function retinoidVariants(analysis: ProductAnalysis): NonNullable<DetectedIngredient['variant']>[] {
  return analysis.detected.filter((d) => d.family === 'retinoid' && d.variant).map((d) => d.variant!);
}
