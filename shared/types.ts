/** Core domain types shared by the browser and the server. */

export type ProductCategory =
  | 'cleanser'
  | 'toner'
  | 'serum'
  | 'treatment'
  | 'moisturizer'
  | 'sunscreen'
  | 'eye'
  | 'exfoliant'
  | 'mask'
  | 'oil'
  | 'other';

/** When the user applies it. 'flex' lets the planner decide. */
export type UsageTime = 'am' | 'pm' | 'both' | 'flex';

/** Desired applications per week for one time-of-day slot (7 = daily). */
export type WeeklyFrequency = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type ProductSource = 'catalog' | 'paste' | 'label-photo';

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  /** Raw INCI list as printed on the pack or pasted by the user. */
  ingredientsRaw: string;
  usage: UsageTime;
  frequency: WeeklyFrequency;
  /** Washed off within a minute or two (cleansers, wash-off masks). */
  rinseOff: boolean;
  /** Prescribed by a clinician. The app never suggests changing these. */
  prescription: boolean;
  source: ProductSource;
  addedAt: string;
}

/**
 * Ingredient families the rule engine reasons about. A family is a cosmetic
 * function group, not a medical class.
 */
export type Family =
  | 'retinoid'
  | 'aha'
  | 'bha'
  | 'pha'
  | 'benzoyl_peroxide'
  | 'vitamin_c_laa'
  | 'vitamin_c_derivative'
  | 'niacinamide'
  | 'azelaic_acid'
  | 'sulfur'
  | 'copper_peptide'
  | 'peptide'
  | 'brightener'
  | 'humectant'
  | 'barrier_lipid'
  | 'occlusive'
  | 'soothing'
  | 'sunscreen_filter'
  | 'fragrance'
  | 'essential_oil'
  | 'drying_alcohol'
  | 'physical_exfoliant'
  | 'caffeine'
  | 'antioxidant';

export interface DetectedIngredient {
  family: Family;
  /** Canonical INCI name as matched. */
  inci: string;
  /** 1-based position in the ingredient list (earlier ≈ higher concentration). */
  position: number;
  /** Retinoid sub-type, where it matters for interaction rules. */
  variant?: 'tretinoin' | 'adapalene' | 'retinol' | 'retinal' | 'retinyl_ester' | 'other_rx' | 'hpr';
}

export interface ProductAnalysis {
  productId: string;
  ingredients: string[];
  detected: DetectedIngredient[];
  families: Family[];
  /** Families strong enough to count as "actives" for conflict purposes. */
  actives: Family[];
  unrecognised: number;
}

// ----- Skin scan results (normalised from YouCam) -----

/** Concern ids without the hd_ prefix. dark_circle_v2 (SD) and hd_dark_circle (HD) both map to dark_circle. */
export type Concern =
  | 'wrinkle'
  | 'pore'
  | 'texture'
  | 'acne'
  | 'oiliness'
  | 'radiance'
  | 'eye_bag'
  | 'age_spot'
  | 'dark_circle'
  | 'droopy_upper_eyelid'
  | 'droopy_lower_eyelid'
  | 'firmness'
  | 'moisture'
  | 'redness'
  | 'tear_trough'
  | 'skin_type';

export type ScanQuality = 'sd' | 'hd';

export interface ConcernScore {
  concern: Exclude<Concern, 'skin_type'>;
  region: string;
  /** YouCam raw_score (1–100, higher = healthier-looking). Used for trends. */
  raw: number;
  /** YouCam ui_score (1–100, adjusted upward by YouCam for display). */
  ui: number;
  /** Mask image as a data: URL (copied before the YouCam task is deleted), or null. */
  mask: string | null;
}

export interface SkinTypeReading {
  region: string;
  value: string;
  mask: string | null;
}

export type CaptureMethod = 'upload' | 'camera-kit' | 'sample';

export interface ScanResult {
  id: string;
  takenAt: string;
  quality: ScanQuality;
  captureMethod: CaptureMethod;
  concerns: Concern[];
  scores: ConcernScore[];
  skinType: SkinTypeReading[];
  skinAge: number | null;
  overall: number | null;
  unitsCharged: number;
  mode: 'mock' | 'live';
  /** True once the server confirmed task/delete at YouCam. */
  remoteDeleted: boolean;
}

export type FitzpatrickScale = 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI';

export interface SunProfile {
  scale: FitzpatrickScale | null;
  source: 'self-report' | 'youcam' | 'unset';
  updatedAt: string | null;
}

// ----- Rule engine output -----

export type Severity = 'high' | 'medium' | 'low' | 'info';
export type Evidence = 'strong' | 'moderate' | 'limited';

export interface Finding {
  ruleId: string;
  severity: Severity;
  evidence: Evidence;
  title: string;
  detail: string;
  suggestion: string;
  productIds: string[];
  sourceIds: import('./sources.ts').SourceId[];
}

export interface ClearedPair {
  id: string;
  title: string;
  detail: string;
  evidence: Evidence;
  productIds: string[];
  sourceIds: import('./sources.ts').SourceId[];
}

// ----- Experiments -----

export interface Experiment {
  id: string;
  title: string;
  change: { kind: 'add' | 'remove'; productId: string; productName: string };
  targetConcerns: Exclude<Concern, 'skin_type'>[];
  startedAt: string;
  weeks: number;
  /** Scan ids in chronological order; the first one (or two) are the baseline. */
  scanIds: string[];
  /** Other shelf edits made while the experiment was running (confounders). */
  otherChanges: { at: string; description: string }[];
  status: 'running' | 'finished' | 'abandoned';
}
