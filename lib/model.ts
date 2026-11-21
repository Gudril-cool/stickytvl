// StickyTVL — a durability-adjusted token launch radar (entry #8, token-radar-01).
//
// Thesis: TVL that stays is worth more than TVL that flashes. Two protocols
// with equal TVL deserve different multiples when one's TVL is stable across
// the snapshot's window and the other's whipsaws. The multiple is a peer
// multiple (category median FDV/TVL of protocols that already record a token,
// winsorized and shrunk toward the global median), scaled by a durability
// factor built from the protocol's own weekly TVL swing.
//
// HONEST DATA NOTE — the sealed snapshot carries exactly ONE change window:
// `change_7d`. There is no change_1d and no change_30d field, so durability
// cannot be measured as agreement between two windows. It is instead a
// single-window stickiness proxy: the smaller the protocol's absolute 7-day
// TVL move, the stickier its TVL is judged to be. The dashboard and README
// say exactly this; nothing here pretends a second window exists.
//
// Implied value (whole dollars):
//   implied = round(TVL x baseMultiple x durabilityFactor x survival x breadth)
//   baseMultiple  = shrunk category median FDV/TVL of tokenized peers
//   durability    = clamp(1 - |change_7d| / 75, 0.60, 1.00); null -> 0.80
//   durabilityFactor = 0.75 + 0.45 x durability        (1.02x .. 1.20x)
//   survival      = 0.92 + 0.08 x min(ageYears / 4, 1); null listed_at -> 0.95
//   breadth       = 1 + 0.02 x min(chains - 1, 3)       (1.00x .. 1.06x)
//
// Board: every pre-token protocol that passes the rankability rule below
// (all 40 watchlist slugs plus the other early ones), ranked by implied
// value. Protocols that already record a token are NOT ranked: they are set
// aside as the "Already trading" list the dashboard shows on its second tab.
// Wording is careful throughout: a protocol "records no token", never "has
// no token" — the snapshot's record is not proof.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'stickytvl-1';

/** Durability divisor: a |change_7d| of 75% (or more) hits the durability floor. */
export const DURABILITY_DIVISOR = 75;
/** Durability is bounded: even the wildest weekly swing keeps 0.60. */
export const DURABILITY_MIN = 0.6;
export const DURABILITY_MAX = 1.0;
/** Protocols with no reported 7d change get a neutral durability. */
export const DURABILITY_UNKNOWN = 0.8;
/** Pseudo-peer count shrinking each category median toward the global median. */
export const SHRINK_PEERS = 6;

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  category: string;
  tvl_usd: number;
  change_7d: number | null;
  durability: number;
  base_multiple: number;
  adjusted_multiple: number;
  survival: number;
  breadth: number;
  watchlist: boolean;
  age_days: number | null;
  chains: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

export interface RadarData {
  version: string;
  as_of: string;
  rows: RadarRow[];
  live: LiveRow[];
  early_size: number;
  live_size: number;
  watchlist_size: number;
  durability_buckets: { label: string; count: number }[];
  method: string;
}

export class SnapshotError extends Error {}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot is not valid JSON');
  }
  const s = raw as Partial<Snapshot>;
  if (!s || !Array.isArray(s.protocols) || !Array.isArray(s.watchlist) || typeof s.as_of !== 'string') {
    throw new SnapshotError('snapshot is missing protocols, watchlist or as_of');
  }
  return s as Snapshot;
}

/** Days between the snapshot date and the day DefiLlama began tracking a protocol. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const ms = Date.parse(asOf) - Date.parse(listedAt);
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.floor(ms / 86_400_000);
}

/**
 * Durability of a protocol's TVL, from its own 7-day move alone.
 *
 * The snapshot carries a single change window, so stickiness is the size of
 * the weekly swing: |change_7d| = 0% scores 1.00, 15% scores 0.80, 30% scores
 * 0.60 (the floor), and anything wilder stays at the floor. Monotone
 * decreasing in |change_7d|, bounded, and fully determined by the snapshot.
 * A null change_7d (unreported) scores the neutral 0.80.
 */
export function durabilityOf(change7d: number | null): number {
  if (change7d === null || !Number.isFinite(change7d)) return DURABILITY_UNKNOWN;
  const raw = 1 - Math.abs(change7d) / DURABILITY_DIVISOR;
  return Math.min(DURABILITY_MAX, Math.max(DURABILITY_MIN, raw));
}

/** Survival factor: older protocols have survived longer, so they keep a little more value. */
export function survivalOf(age: number | null): number {
  if (age === null) return 0.95;
  return 0.92 + 0.08 * Math.min(age / (4 * 365), 1);
}

/** Breadth factor: a protocol live on more chains is a little harder to kill. */
export function breadthOf(chainCount: number): number {
  return 1 + 0.02 * Math.min(Math.max(chainCount - 1, 0), 3);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return NaN;
  return n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return NaN;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/** A protocol records a token when DefiLlama carries either a gecko id or a symbol for it. */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Rankable pre-token protocols: records no token, and is not a wrapped /
 * staked / bridged product of a token that already trades (the same
 * exclusion the snapshot's own watchlist rule applies).
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (recordsToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return false;
  if (/\s(V2|v2|2\.0|V3|v3|3\.0)\s*$/.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/** Category peer multiples from tokenized protocols: median FDV/TVL, winsorized, shrunk. */
export function peerMultiples(snapshot: Snapshot): Map<string, number> {
  const peers = snapshot.protocols.filter(
    (p) => recordsToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const ratios = peers.map((p) => p.mcap_usd! / p.tvl_usd);
  const globalMedian = median(ratios);
  const lo = quantile(ratios, 0.1);
  const hi = quantile(ratios, 0.9);
  const byCategory = new Map<string, number[]>();
  for (const p of peers) {
    const r = Math.min(hi, Math.max(lo, p.mcap_usd! / p.tvl_usd));
    const key = p.category ?? 'Uncategorized';
    const list = byCategory.get(key) ?? [];
    list.push(r);
    byCategory.set(key, list);
  }
  const out = new Map<string, number>();
  for (const [cat, list] of byCategory) {
    const m = median(list);
    out.set(cat, (list.length * m + SHRINK_PEERS * globalMedian) / (list.length + SHRINK_PEERS));
  }
  return out;
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const multiples = peerMultiples(snapshot);
  const peers = snapshot.protocols.filter(
    (p) => recordsToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const globalMedian = median(peers.map((p) => p.mcap_usd! / p.tvl_usd));
  const watchlist = new Set(snapshot.watchlist);

  const scored: Omit<RadarRow, 'rank'>[] = [];
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    const base = multiples.get(p.category ?? 'Uncategorized') ?? globalMedian;
    const durability = durabilityOf(p.change_7d);
    const durabilityFactor = 0.75 + 0.45 * durability;
    const adjusted = base * durabilityFactor;
    const age = ageDays(snapshot.as_of, p.listed_at);
    const survival = survivalOf(age);
    const breadth = breadthOf(p.chains.length);
    const implied = Math.max(1, Math.round(p.tvl_usd * adjusted * survival * breadth));
    scored.push({
      slug: p.slug,
      name: p.name,
      implied_value_usd: implied,
      farm_steps: farmSteps(p, durability, age),
      category: p.category ?? 'Uncategorized',
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      durability,
      base_multiple: base,
      adjusted_multiple: adjusted,
      survival,
      breadth,
      watchlist: watchlist.has(p.slug),
      age_days: age,
      chains: p.chains.length,
    });
  }
  // Rank by implied value; ties break by TVL, then slug, so the order is deterministic.
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  const rows: RadarRow[] = scored.map((r, i) => ({ ...r, rank: i + 1 }));
  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));

  // Already-trading set-aside: the 24 largest tokenized protocols by market cap.
  const live: LiveRow[] = [...peers]
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorized',
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: p.mcap_usd! / p.tvl_usd,
    }));

  const buckets = [
    { label: '0.95–1.00 · glacier', count: 0 },
    { label: '0.85–0.95 · steady', count: 0 },
    { label: '0.75–0.85 · drifting', count: 0 },
    { label: '0.60–0.75 · restless', count: 0 },
  ];
  for (const r of rows) {
    if (r.durability >= 0.95) buckets[0]!.count++;
    else if (r.durability >= 0.85) buckets[1]!.count++;
    else if (r.durability >= 0.75) buckets[2]!.count++;
    else buckets[3]!.count++;
  }

  const radar: RadarData = {
    version: MODEL_VERSION,
    as_of: snapshot.as_of,
    rows,
    live,
    early_size: rows.filter((r) => !r.watchlist).length,
    live_size: live.length,
    watchlist_size: snapshot.watchlist.length,
    durability_buckets: buckets,
    method:
      'StickyTVL: implied = TVL x category median FDV/TVL (winsorized, shrunk toward the global median) ' +
      'x (0.75 + 0.45 x durability) x survival x breadth. Durability = clamp(1 - |change_7d| / 75, 0.60, 1.00); ' +
      'the snapshot carries only the 7-day change window, so durability is a single-window stickiness proxy, ' +
      'not a cross-window consistency check. Survival from listed_at age; breadth from chain count.',
  };
  return { board, radar };
}

/** The gate's own shape, checked before anything is written. Returns a reason or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const watchlist = new Set(snapshot.watchlist);
  const seen = new Set<string>();
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (const row of board) {
    if (!slugs.has(row.slug)) return `unknown slug ${row.slug}`;
    if (seen.has(row.slug)) return `duplicate slug ${row.slug}`;
    seen.add(row.slug);
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `bad implied value for ${row.slug}`;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `bad farm step count for ${row.slug}`;
    for (const s of row.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `bad farm step length for ${row.slug}`;
    }
  }
  for (const w of watchlist) if (!seen.has(w)) return `watchlist slug missing: ${w}`;
  const ranks = [...board.map((r) => r.rank)].sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return 'ranks are not 1..N';
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return 'implied value rises with rank';
  }
  if (board.length > 1 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'all implied values are equal';
  }
  return null;
}

/** The dashboard's data file: one assignment, no imports, no network. */
export function dataScript(radar: RadarData): string {
  return `window.STICKY = ${JSON.stringify(radar)};\n`;
}

// ---------------------------------------------------------------------------
// Farm plans — long-hold voice. Seven steps per protocol: position once,
// lock in, check in monthly, rebalance on durability, keep clean records,
// mind the risks, and harvest in stages when a token launches. Category
// playbooks change step 1 and step 4; the rest adapt by name, TVL and
// durability tier. Every step is written to land inside 20–600 chars.
// ---------------------------------------------------------------------------

const DURABILITY_WORD: Record<string, string> = {
  glacier: 'glacier-steady: its TVL barely moved in the last 7 days, so size this as a core long hold',
  steady: 'steady: its TVL moved only a little in the last 7 days, so it suits a patient position',
  drifting: 'drifting: its TVL moved noticeably in the last 7 days, so start small and let it prove itself',
  restless: 'restless: its TVL swung hard in the last 7 days, so keep this a small, watchful position',
};

function durabilityTier(d: number): string {
  if (d >= 0.95) return 'glacier';
  if (d >= 0.85) return 'steady';
  if (d >= 0.75) return 'drifting';
  return 'restless';
}

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${Math.round(n / 1000)}k`;
}

function entryPlaybook(p: SnapshotProtocol): string {
  const cat = p.category ?? 'Uncategorized';
  switch (cat) {
    case 'Lending':
      return `Open a lending position on ${p.name}: supply a blue-chip asset you already hold, borrow nothing at first, and leave the deposit untouched for at least 90 days. Budget about $15–$40 of gas for the supply and approval transactions.`;
    case 'Dexs':
      return `Provide liquidity on ${p.name} in its deepest pool, in the pair you can hold for months without watching the price daily. Budget about $20–$50 of gas for the approvals and the deposit, and accept the position as a long hold.`;
    case 'Yield':
    case 'Yield Aggregator':
      return `Deposit into ${p.name}'s flagship vault with funds you will not need for at least 90 days, and choose the vault whose strategy you understand. Budget about $15–$40 of gas for the approvals and the deposit.`;
    case 'RWA':
      return `Take a position in ${p.name}'s flagship real-world-asset product with money you can leave parked for 90 days or more, after reading its redemption terms. Budget about $20–$50 of gas for the approvals and the deposit.`;
    case 'Derivatives':
      return `Open a small, collateralised position on ${p.name} — no leverage above 2x — and leave the margin in place for at least 60 days. Budget about $20–$60 of gas for the approvals, deposit and first trade.`;
    case 'CDP':
      return `Mint against your collateral on ${p.name} at a conservative ratio (below 50% of the maximum), and leave the vault open for at least 90 days. Budget about $20–$50 of gas for the approvals and the mint.`;
    case 'Risk Curators':
      return `Allocate to a curated vault on ${p.name} whose curator publishes regular reports, with funds you can leave for 90 days or more. Budget about $15–$40 of gas for the approvals and the deposit.`;
    case 'Onchain Capital Allocator':
      return `Allocate to ${p.name}'s flagship strategy with funds you can leave untouched for at least 90 days, after reading how it deploys capital. Budget about $20–$50 of gas for the approvals and the deposit.`;
    default:
      return `Take a first position on ${p.name} with funds you can leave untouched for at least 90 days, using its flagship product. Budget about $15–$50 of gas for the approvals and the deposit, and keep the position simple.`;
  }
}

function rebalancePlaybook(p: SnapshotProtocol): string {
  const cat = p.category ?? 'Uncategorized';
  switch (cat) {
    case 'Dexs':
      return `Rebalance only when the pool's TVL moves more than 25% in a week or your range drifts out of the active band: withdraw, re-enter at the new range, and do it at most once a month. Each rebalance costs roughly $20–$60 in gas.`;
    case 'Lending':
      return `Rebalance only when your health factor falls below 1.8 or the supplied asset's TVL swings more than 25% in a week: top up collateral or repay a little, at most once a month. Each adjustment costs roughly $10–$30 in gas.`;
    default:
      return `Rebalance only when ${p.name}'s TVL moves more than 25% in a week or its durability tier drops a level: trim a third of the position or top it up by a third, at most once a month. Each move costs roughly $15–$50 in gas.`;
  }
}

export function farmSteps(p: SnapshotProtocol, durability: number, age: number | null): string[] {
  const tier = durabilityTier(durability);
  const tierNote = DURABILITY_WORD[tier]!;
  const ageNote =
    age === null
      ? 'its listing date is unreported, so treat its history as unknown'
      : age < 365
        ? `it has been tracked for only about ${Math.max(1, Math.round(age / 30))} months, so it is still young`
        : `it has been tracked for about ${(age / 365).toFixed(1)} years, so it has survived more than one cycle`;
  return [
    entryPlaybook(p),
    `Commit to the long hold: prefer ${p.name}'s longest lockup or staking option over the flexible one, and write down the unlock date before you confirm. A locked position is the point — it is ${tierNote}, and ${ageNote}.`,
    `Check in once a month, no more: confirm your position is still active, note ${p.name}'s TVL (${money(p.tvl_usd)}) and its 7-day change (${p.change_7d === null ? 'unreported' : (p.change_7d >= 0 ? '+' : '') + p.change_7d.toFixed(2) + '%'}), and record whether its durability tier moved. A monthly check costs about 15 minutes and no gas.`,
    rebalancePlaybook(p),
    `Keep a clean farming record: save every transaction hash, the dates you deposited, and screenshots of your position each month. If ${p.name} later asks for proof of activity, this file is what you show — keep it for at least a year.`,
    `Mind the risks before adding more: ${p.name} is a protocol that records no token, so there may never be one; smart-contract risk is real, so never deposit more than you can afford to lose, and keep an exit path ready.`,
    `Plan the harvest in stages: if ${p.name} ever issues a token, claim in the first week, sell a third at once, hold a third for 90 days, and keep the last third only while the protocol's TVL stays steady. Never rush the whole claim in one day.`,
  ];
}
