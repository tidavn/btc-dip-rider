// Dip Rider: a mean-reversion swing bot for cbBTC/USDC 1-minute bars.
//
// Idea: on this market the 1-minute price mean-reverts over 1-3 hour horizons
// (a 30-60 minute move continues in the same direction only ~35-40% of the
// time on the dev window), so the bot buys a clear dip below a slow moving
// average and rides the reversion back up, instead of chasing crossovers.
// Every round trip costs ~35 bps at full size (4 bps fee + 2 bps slippage +
// ~11 bps of pool impact each way), so entries wait for a dip of at least
// 55 bps and exits let winners run to ~110 bps before taking profit.
//
//   - Entry (long only, whole cash): the close sits at least 55 bps below
//     the 90-bar EMA of closes, and the 5-bar return has stopped falling
//     (non-negative), i.e. the dip is pausing rather than accelerating.
//   - Exit (whole position): take profit at +110 bps over the entry close,
//     a trailing stop 110 bps below the highest close since entry, or a
//     hard stop at -135 bps under the entry close.
//   - Guards: no entries during warm-up, none after bar 1380 (the last hour
//     is not worth a fresh trade, the end-of-window flatten would eat it),
//     5 bars of cooldown after any exit, and no more entries after two
//     stop-loss exits (a day that keeps stopping the bot out is trending
//     down, and averaging into it only loses more).
//   - Deterministic: float64 arithmetic on bar closes only, seeded from
//     hello.seed only in the sense that nothing random is used at all; no
//     wall clock, no environment, no files, no network.

import { runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Bars in the slow mean: 90 one-minute closes, about an hour and a half. */
const EMA_SPAN = 90;
/** Entry needs the close this far below the EMA, in basis points. */
const DIP_BPS = 55;
/** Take profit, in bps over the close the buy was decided on. */
const TAKE_BPS = 110;
/** Trailing stop, in bps below the highest close since entry. */
const TRAIL_BPS = 110;
/** Hard stop, in bps under the close the buy was decided on. */
const STOP_BPS = 135;
/** Bars to wait after an exit before the next entry. */
const COOLDOWN_BARS = 5;
/** Slippage cap on every order, in bps from the latest close. */
const MAX_SLIPPAGE_BPS = 100;
/** No fresh entries on or after this batch: the window has 1440 bars. */
const LAST_ENTRY_SEQ = 1380;
/** Stop entering after this many stop-loss exits. */
const MAX_STOP_OUTS = 2;

interface MeanState {
  /** Closes seen so far, in order (only CBBTC bars). */
  closes: number[];
  /** EMA warm-up closes, until the first EMA_SPAN of them seed it. */
  warm: number[];
  /** The EMA once seeded, else null. */
  ema: number | null;
  /** Close the open position's buy was decided on, else null. */
  entryClose: number | null;
  /** Highest close since entry, else null. */
  peakClose: number | null;
  /** Batch the last exit was decided on (-1 before any exit). */
  lastExitSeq: number;
  /** Stop-loss exits so far. */
  stopOuts: number;
}

const mean: MeanState = {
  closes: [],
  warm: [],
  ema: null,
  entryClose: null,
  peakClose: null,
  lastExitSeq: -1,
  stopOuts: 0,
};

/** Step the EMA with a new close: seed with the mean of the first span. */
function stepEma(close: number): void {
  if (mean.ema !== null) {
    mean.ema += (2 / (EMA_SPAN + 1)) * (close - mean.ema);
    return;
  }
  mean.warm.push(close);
  if (mean.warm.length === EMA_SPAN) {
    mean.ema = mean.warm.reduce((a, x) => a + x, 0) / EMA_SPAN;
  }
}

/** Basis points of `value` against `base` (both > 0). */
function bps(value: number, base: number): number {
  return ((value - base) / base) * 10000;
}

/** Why a held position exits on this close, or null to keep holding. */
function exitReason(entryClose: number, peakClose: number, close: number): 'take' | 'trail' | 'stop' | null {
  const gain = bps(close, entryClose);
  if (gain >= TAKE_BPS) return 'take';
  if (bps(close, peakClose) <= -TRAIL_BPS) return 'trail';
  if (gain <= -STOP_BPS) return 'stop';
  return null;
}

await runBars({
  onBatch(state: BarsState, batch: { bars: Bar[] }): (BuyInput | SellInput)[] {
    for (const bar of batch.bars) {
      if (bar.symbol !== SYMBOL) continue;
      const close = Number(bar.c);
      mean.closes.push(close);
      stepEma(close);
    }
    if (state.warmingUp) return [];
    const held = state.positions.get(SYMBOL);
    const close = state.close(SYMBOL);
    if (close === null) return [];
    const closeNum = Number(close);

    if (held !== undefined) {
      if (mean.entryClose === null) {
        // A position we did not open (should not happen with one symbol):
        // use this close as the entry reference so exits still work.
        mean.entryClose = closeNum;
        mean.peakClose = closeNum;
      }
      if (mean.peakClose === null || closeNum > mean.peakClose) mean.peakClose = closeNum;
      const reason = exitReason(mean.entryClose, mean.peakClose, closeNum);
      if (reason !== null) {
        if (reason === 'stop') mean.stopOuts += 1;
        mean.entryClose = null;
        mean.peakClose = null;
        mean.lastExitSeq = state.seq;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
      }
      return [];
    }

    // Flat: look for a dip to buy.
    if (mean.ema === null) return [];
    if (mean.stopOuts >= MAX_STOP_OUTS) return [];
    if (state.seq >= LAST_ENTRY_SEQ) return [];
    if (state.seq < mean.lastExitSeq + COOLDOWN_BARS) return [];
    if (mean.closes.length < 6) return [];
    const dip = bps(closeNum, mean.ema);
    if (dip > -DIP_BPS) return [];
    const fiveBack = mean.closes[mean.closes.length - 6];
    if (bps(closeNum, fiveBack) < 0) return [];
    const notional = state.cash;
    if (notional < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    mean.entryClose = closeNum;
    mean.peakClose = closeNum;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: notional, max_slippage_bps: MAX_SLIPPAGE_BPS }];
  },
});
