import { analyseProduct, FAMILY_LABEL, isSunscreen, retinoidVariants } from './ingredients.ts';
import type { ClearedPair, Concern, Evidence, Family, Finding, Product, ProductAnalysis, Severity, SunProfile } from './types.ts';

/**
 * The shelf rule engine. Every rule is cosmetic layering guidance with a cited
 * source and an honest evidence label. Nothing here diagnoses or treats.
 */

export interface ShelfContext {
  sun: SunProfile;
  /** Concerns the user is focusing on (from their latest scan or chosen manually). */
  focus: Concern[];
  now: Date;
}

export interface SessionConflict {
  a: string;
  b: string;
  ruleId: string;
  reason: string;
}

export interface ShelfReport {
  analyses: Record<string, ProductAnalysis>;
  findings: Finding[];
  cleared: ClearedPair[];
  /** Product pairs that must never share an AM or PM session. Fed to the planner. */
  sessionConflicts: SessionConflict[];
  hasSunscreen: boolean;
  photosensitisers: string[];
}

const EXFOLIANTS: Family[] = ['aha', 'bha', 'pha', 'physical_exfoliant'];
const DUPLICATE_WATCH: Family[] = ['retinoid', 'aha', 'bha', 'benzoyl_peroxide', 'vitamin_c_laa', 'niacinamide', 'azelaic_acid', 'brightener'];

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

function has(a: ProductAnalysis, f: Family): boolean {
  return a.families.includes(f);
}

function names(products: Product[], ids: string[]): string {
  const list = ids.map((id) => products.find((p) => p.id === id)?.name ?? id);
  if (list.length <= 2) return list.join(' and ');
  return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

function pairs<T>(items: T[]): [T, T][] {
  const out: [T, T][] = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) out.push([items[i]!, items[j]!]);
  return out;
}

export function evaluateShelf(products: Product[], ctx: ShelfContext): ShelfReport {
  const analyses: Record<string, ProductAnalysis> = {};
  for (const p of products) analyses[p.id] = analyseProduct(p);
  const A = (p: Product) => analyses[p.id]!;
  const leaveOn = products.filter((p) => !p.rinseOff);

  const findings: Finding[] = [];
  const cleared: ClearedPair[] = [];
  const sessionConflicts: SessionConflict[] = [];

  const add = (f: Finding) => findings.push(f);
  const conflict = (a: Product, b: Product, ruleId: string, reason: string) => {
    if (a.id !== b.id && !sessionConflicts.some((c) => c.ruleId === ruleId && ((c.a === a.id && c.b === b.id) || (c.a === b.id && c.b === a.id)))) {
      sessionConflicts.push({ a: a.id, b: b.id, ruleId, reason });
    }
  };

  // --- Retinoid + exfoliating acid in the same session -------------------
  const retinoids = leaveOn.filter((p) => has(A(p), 'retinoid'));
  const acids = leaveOn.filter((p) => has(A(p), 'aha') || has(A(p), 'bha'));
  const retinoidAcidPairs = retinoids.flatMap((r) => acids.filter((x) => x.id !== r.id).map((x) => [r, x] as const));
  if (retinoidAcidPairs.length > 0) {
    for (const [r, x] of retinoidAcidPairs) conflict(r, x, 'retinoid-acid', 'Retinoid and exfoliating acid');
    const ids = [...new Set(retinoidAcidPairs.flatMap(([r, x]) => [r.id, x.id]))];
    add({
      ruleId: 'retinoid-acid',
      severity: 'medium',
      evidence: 'strong',
      title: 'Retinoid and exfoliating acid on the same night',
      detail: `${names(products, ids)} combine a retinoid with an AHA/BHA. Both thin out the outer layer of skin, and using them in the same session makes dryness and irritation more likely.`,
      suggestion: 'Use them on different nights. Your weekly plan already keeps them apart.',
      productIds: ids,
      sourceIds: ['dailymed-adapalene', 'aad-exfoliate', 'aad-retinoid'],
    });
  }
  for (const p of leaveOn) {
    const a = A(p);
    if (has(a, 'retinoid') && (has(a, 'aha') || has(a, 'bha'))) {
      add({
        ruleId: 'retinoid-acid-same-product',
        severity: 'low',
        evidence: 'moderate',
        title: `${p.name} already pairs a retinoid with an acid`,
        detail: 'It is formulated that way on purpose, so use it as directed. Just avoid adding another exfoliant in the same session.',
        suggestion: 'Treat it as both your retinoid and your exfoliant for that night.',
        productIds: [p.id],
        sourceIds: ['aad-exfoliate'],
      });
    }
  }

  // --- Benzoyl peroxide with tretinoin (oxidation) vs adapalene (stable) --
  const bpo = leaveOn.filter((p) => has(A(p), 'benzoyl_peroxide'));
  for (const b of bpo) {
    for (const r of retinoids) {
      if (b.id === r.id) continue;
      const variants = retinoidVariants(A(r));
      if (variants.includes('tretinoin')) {
        conflict(b, r, 'bpo-tretinoin', 'Benzoyl peroxide degrades tretinoin');
        add({
          ruleId: 'bpo-tretinoin',
          severity: 'high',
          evidence: 'moderate',
          title: 'Benzoyl peroxide can break down tretinoin',
          detail: `In lab tests, tretinoin lost more than half its strength within about 2 hours when mixed with benzoyl peroxide and exposed to light. ${b.name} and ${r.name} should not go on together.`,
          suggestion: r.prescription
            ? 'Follow your prescriber’s instructions. A common pattern is benzoyl peroxide in the morning and tretinoin at night, but check with them first.'
            : 'Keep them in separate sessions: benzoyl peroxide in the morning, tretinoin at night.',
          productIds: [b.id, r.id],
          sourceIds: ['martin-1998'],
        });
      } else if (variants.includes('adapalene')) {
        conflict(b, r, 'bpo-retinoid-irritation', 'Two drying blemish actives');
        cleared.push({
          id: `adapalene-bpo:${b.id}:${r.id}`,
          title: 'Adapalene stays stable with benzoyl peroxide',
          detail: `Unlike tretinoin, adapalene is not broken down by benzoyl peroxide, so ${r.name} and ${b.name} don’t cancel each other out. The only issue is that together they are drying, which is why the plan staggers them.`,
          evidence: 'moderate',
          productIds: [b.id, r.id],
          sourceIds: ['martin-1998', 'smpc-adapalene'],
        });
        add({
          ruleId: 'bpo-retinoid-irritation',
          severity: 'medium',
          evidence: 'strong',
          title: 'Two drying blemish actives',
          detail: `${b.name} (benzoyl peroxide) and ${r.name} (adapalene) are both drying. The adapalene label says irritation is more likely when using more than one topical acne product at a time.`,
          suggestion: 'Stagger them: benzoyl peroxide in the morning, adapalene at night, and scale back if skin gets dry.',
          productIds: [b.id, r.id],
          sourceIds: ['dailymed-adapalene', 'smpc-adapalene'],
        });
      } else {
        conflict(b, r, 'bpo-retinoid-irritation', 'Two drying actives');
        add({
          ruleId: 'bpo-retinoid-irritation',
          severity: 'medium',
          evidence: 'moderate',
          title: 'Benzoyl peroxide and a retinoid in one routine',
          detail: `${b.name} and ${r.name} are both drying. Retinoids and benzoyl peroxide each make skin more sensitive to further exfoliation.`,
          suggestion: 'Keep them in separate sessions and introduce one at a time.',
          productIds: [b.id, r.id],
          sourceIds: ['aad-exfoliate'],
        });
      }
    }
  }
  for (const b of products.filter((p) => has(A(p), 'benzoyl_peroxide') && !p.rinseOff)) {
    add({
      ruleId: 'bpo-bleach',
      severity: 'info',
      evidence: 'strong',
      title: 'Benzoyl peroxide bleaches fabric',
      detail: `${b.name} can bleach hair, towels, pillowcases and dyed clothing.`,
      suggestion: 'Let it dry fully, and use white pillowcases and towels.',
      productIds: [b.id],
      sourceIds: ['dailymed-bpo'],
    });
  }

  // --- Too many exfoliants -----------------------------------------------
  const exfoliating = products.filter((p) => EXFOLIANTS.some((f) => has(A(p), f)));
  const exfoliationsPerWeek = exfoliating.reduce((sum, p) => sum + p.frequency * (p.usage === 'both' ? 2 : 1) * (p.rinseOff ? 0.5 : 1), 0);
  if (exfoliating.length >= 3 || (exfoliating.length >= 2 && retinoids.length > 0) || exfoliationsPerWeek > 7) {
    for (const [a, b] of pairs(exfoliating.filter((p) => !p.rinseOff))) conflict(a, b, 'exfoliant-stack', 'Two exfoliants');
    add({
      ruleId: 'exfoliant-stack',
      severity: retinoids.length > 0 || exfoliating.length >= 3 ? 'medium' : 'low',
      evidence: 'moderate',
      title: `${exfoliating.length} exfoliating products${retinoids.length > 0 ? ' plus a retinoid' : ''}`,
      detail: `${names(products, exfoliating.map((p) => p.id))} all exfoliate. That adds up to about ${Math.round(exfoliationsPerWeek)} exfoliating applications a week. Over-exfoliated skin turns red and irritated, and retinoid users are more sensitive to begin with.`,
      suggestion: 'Pick one exfoliant, use it 2–3 times a week, and never on retinoid nights. Keep the others for when you finish it.',
      productIds: exfoliating.map((p) => p.id),
      sourceIds: ['aad-exfoliate'],
    });
  }

  // --- Sun sensitivity without sunscreen -----------------------------------
  const hasSunscreen = products.some((p) => isSunscreen(p, A(p)));
  const photosensitisers = products.filter((p) => has(A(p), 'retinoid') || has(A(p), 'aha')).map((p) => p.id);
  const fairSkin = ctx.sun.scale === 'I' || ctx.sun.scale === 'II';
  if (photosensitisers.length > 0 && !hasSunscreen) {
    add({
      ruleId: 'photosensitiser-no-spf',
      severity: 'high',
      evidence: 'strong',
      title: 'Sun-sensitising actives, but no sunscreen on your shelf',
      detail: `${names(products, photosensitisers)} contain${photosensitisers.length === 1 ? 's' : ''} a retinoid or AHA. The FDA notes that AHAs increase UV sensitivity, and retinoid labels say to use sunscreen.${fairSkin ? ` Your Fitzpatrick type (${ctx.sun.scale}) burns most easily.` : ''}`,
      suggestion: 'Add a broad-spectrum SPF 30+ and use it every morning. This matters more than any other product on this shelf.',
      productIds: photosensitisers,
      sourceIds: ['fda-aha', 'dailymed-adapalene', 'aad-sunscreen'],
    });
  } else if (!hasSunscreen) {
    add({
      ruleId: 'no-spf',
      severity: fairSkin ? 'medium' : 'low',
      evidence: 'strong',
      title: 'No sunscreen on your shelf',
      detail: `Dermatologists recommend a broad-spectrum SPF 30 or higher.${fairSkin ? ` With Fitzpatrick type ${ctx.sun.scale}, your skin burns easily.` : ''}`,
      suggestion: 'Add a broad-spectrum SPF 30+ moisturiser or sunscreen to your morning routine.',
      productIds: [],
      sourceIds: ['aad-sunscreen'],
    });
  } else {
    const spf = products.filter((p) => isSunscreen(p, A(p)));
    const usedEveryMorning = spf.some((p) => (p.usage === 'am' || p.usage === 'both' || p.usage === 'flex') && p.frequency === 7);
    if (photosensitisers.length > 0 && !usedEveryMorning) {
      add({
        ruleId: 'spf-not-daily',
        severity: 'medium',
        evidence: 'strong',
        title: 'Sunscreen isn’t set to every morning',
        detail: `You use sun-sensitising actives (${names(products, photosensitisers)}), but your sunscreen isn’t scheduled daily.`,
        suggestion: 'Set your SPF to every morning.',
        productIds: [...spf.map((p) => p.id), ...photosensitisers],
        sourceIds: ['fda-aha', 'aad-sunscreen'],
      });
    }
  }

  // --- Vitamin C stability -------------------------------------------------
  const laa = leaveOn.filter((p) => has(A(p), 'vitamin_c_laa'));
  for (const c of laa) {
    for (const b of bpo) {
      if (b.id === c.id) continue;
      conflict(c, b, 'bpo-vitamin-c', 'Benzoyl peroxide is an oxidiser');
      add({
        ruleId: 'bpo-vitamin-c',
        severity: 'low',
        evidence: 'limited',
        title: 'Vitamin C next to benzoyl peroxide',
        detail: `L-ascorbic acid (in ${c.name}) breaks down when it oxidises, and benzoyl peroxide (in ${b.name}) is an oxidiser. We found no direct study of the pair, so this is a precaution, not an established conflict.`,
        suggestion: 'To be safe, use vitamin C in the morning and benzoyl peroxide at a different time.',
        productIds: [c.id, b.id],
        sourceIds: ['pmc-ascorbic-stability'],
      });
    }
    for (const cu of leaveOn.filter((p) => has(A(p), 'copper_peptide') && p.id !== c.id)) {
      conflict(c, cu, 'copper-vitamin-c', 'Copper can oxidise vitamin C');
      add({
        ruleId: 'copper-vitamin-c',
        severity: 'low',
        evidence: 'limited',
        title: 'Copper peptides with vitamin C',
        detail: `Transition metals such as copper can push ascorbic acid to oxidise. There is no skin study of ${cu.name} with ${c.name} specifically, so treat this as a precaution.`,
        suggestion: 'Use them in different sessions, for example vitamin C in the morning and copper peptides at night.',
        productIds: [c.id, cu.id],
        sourceIds: ['pmc-ascorbic-stability'],
      });
    }
  }

  // --- Things people wrongly avoid ------------------------------------------
  const niacin = products.filter((p) => has(A(p), 'niacinamide'));
  const vitC = products.filter((p) => has(A(p), 'vitamin_c_laa') || has(A(p), 'vitamin_c_derivative'));
  if (niacin.length > 0 && vitC.length > 0) {
    cleared.push({
      id: 'niacinamide-vitamin-c',
      title: 'Niacinamide and vitamin C are fine together',
      detail: `A common online myth says these cancel out. Reviews report that topical vitamin C and nicotinamide together have a good safety profile. You don’t need to separate ${names(products, [...new Set([...niacin, ...vitC].map((p) => p.id))])}.`,
      evidence: 'limited',
      productIds: [...new Set([...niacin, ...vitC].map((p) => p.id))],
      sourceIds: ['pmc-vitc-niacinamide'],
    });
  }

  // --- Paying twice for the same active -------------------------------------
  for (const fam of DUPLICATE_WATCH) {
    const holders = leaveOn.filter((p) => has(A(p), fam));
    if (holders.length >= 2) {
      const doubleRetinoid = fam === 'retinoid';
      if (doubleRetinoid) for (const [a, b] of pairs(holders)) conflict(a, b, 'duplicate-retinoid', 'Two retinoids');
      add({
        ruleId: doubleRetinoid ? 'duplicate-retinoid' : 'duplicate-active',
        severity: doubleRetinoid ? 'medium' : 'info',
        evidence: doubleRetinoid ? 'moderate' : 'strong',
        title: `${FAMILY_LABEL[fam]} in ${holders.length} products`,
        detail: doubleRetinoid
          ? `${names(products, holders.map((p) => p.id))} are both retinoids. Layering two adds irritation without a clear benefit.`
          : `${names(products, holders.map((p) => p.id))} all provide ${FAMILY_LABEL[fam].toLowerCase()}. Using them together rarely adds much. You could finish one before reopening the next.`,
        suggestion: doubleRetinoid ? 'Use one retinoid at a time.' : 'No need to re-buy all of them. Keep the one you like best.',
        productIds: holders.map((p) => p.id),
        sourceIds: doubleRetinoid ? ['aad-retinoid'] : [],
      });
    }
  }

  // --- Fragrance when redness is a focus -------------------------------------
  const fragranced = leaveOn.filter((p) => has(A(p), 'fragrance') || has(A(p), 'essential_oil'));
  const rednessFocus = ctx.focus.includes('redness');
  if (fragranced.length > 0 && (rednessFocus || fragranced.length >= 3)) {
    add({
      ruleId: 'fragrance-load',
      severity: rednessFocus ? 'medium' : 'low',
      evidence: 'moderate',
      title: rednessFocus ? 'Fragrance in leave-on products while redness is a focus' : `${fragranced.length} fragranced leave-on products`,
      detail: `${names(products, fragranced.map((p) => p.id))} contain fragrance or essential oils. For skin that reddens easily, dermatologists suggest fragrance-free products. “Unscented” is not the same thing.`,
      suggestion: 'When these run out, consider fragrance-free replacements, starting with whatever stays on your face longest.',
      productIds: fragranced.map((p) => p.id),
      sourceIds: ['aad-fragrance-free'],
    });
  }

  // --- Newly added actives: patch test -------------------------------------
  const tenDays = 10 * 24 * 3600 * 1000;
  const fresh = products.filter((p) => A(p).actives.length > 0 && ctx.now.getTime() - new Date(p.addedAt).getTime() < tenDays);
  if (fresh.length > 0) {
    add({
      ruleId: 'patch-test',
      severity: 'info',
      evidence: 'strong',
      title: 'Patch-test new actives first',
      detail: `${names(products, fresh.map((p) => p.id))} ${fresh.length === 1 ? 'was' : 'were'} added in the last 10 days. Dermatologists suggest testing a new product on a small spot twice a day for 7–10 days before using it on your whole face.`,
      suggestion: 'Introduce one new active at a time. Start an experiment to track it.',
      productIds: fresh.map((p) => p.id),
      sourceIds: ['aad-patch-test'],
    });
  }

  // --- Prescriptions -------------------------------------------------------
  const rx = products.filter((p) => p.prescription);
  if (rx.length > 0) {
    add({
      ruleId: 'prescription',
      severity: 'info',
      evidence: 'strong',
      title: 'Prescribed products are left as they are',
      detail: `${names(products, rx.map((p) => p.id))} ${rx.length === 1 ? 'is' : 'are'} marked as prescribed. Unstack schedules around ${rx.length === 1 ? 'it' : 'them'} but never suggests changing ${rx.length === 1 ? 'it' : 'them'}.`,
      suggestion: 'Ask your prescriber before adding other actives.',
      productIds: rx.map((p) => p.id),
      sourceIds: [],
    });
  }

  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.title.localeCompare(b.title));
  return { analyses, findings, cleared, sessionConflicts, hasSunscreen, photosensitisers };
}

export function severityCounts(findings: Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) out[f.severity]++;
  return out;
}

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  strong: 'Strong evidence',
  moderate: 'Moderate evidence',
  limited: 'Limited evidence',
};
