# btc-dip-rider

[![make.fun · btc-race-24h-20261117-0603](https://make.fun/badge/btc-race-24h-20261117-0603.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![rank](https://make.fun/badge/btc-race-24h-20261117-0603/tidavn/btc-dip-rider/rank.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)
[![reward](https://make.fun/badge/btc-race-24h-20261117-0603/tidavn/btc-dip-rider/reward.svg)](https://make.fun/bounty/btc-race-24h-20261117-0603?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603)

Dip Rider — a mean-reversion swing bot trading cbBTC/USDC 1-minute bars. Entry for the make.fun bounty **"Race a BTC trading bot live for 24 hours"** (`btc-race-24h-20261117-0603`). It trades Coinbase Wrapped BTC against USDC, one 1-minute bar at a time, on the `agent-fun/bars-replay/v1` protocol (`main.ts`, Node 22, standard library plus the vendored SDK shim in `vendor/`).

## Run it

```sh
node cli/makefun.mjs grade-local --kit <path-to-kit> --bot . --driver docker
```

## Strategy

On the dev window the 1-minute price mean-reverts over 1–3 hour horizons (a 30–60 minute move continues in the same direction only ~35–40% of the time), while every round trip costs ~35 bps at full size (4 bps fee + 2 bps slippage + ~11 bps of pool impact each way). So the bot does **not** chase crossovers — it buys a clear dip and rides the reversion:

- **Entry** (long only, whole cash): the close is at least **55 bps below the 90-bar EMA** of closes, and the 5-bar return has stopped falling (non-negative) — the dip is pausing, not accelerating.
- **Exit** (whole position): take profit at **+110 bps** over the entry close, a trailing stop **110 bps** below the highest close since entry, or a hard stop at **−135 bps** under the entry close.
- **Guards**: no entries during warm-up; none after bar 1380 (the last hour is not worth a fresh trade, the end-of-window flatten would eat it); 5 bars of cooldown after any exit; no more entries after two stop-loss exits (a day that keeps stopping the bot out is trending down).

## Dev-window results (local grade, kit harness)

| Variant | Net PnL | Trades | Max drawdown |
|---|---|---|---|
| Chosen (EMA90, dip 55, take 110, trail 110, stop 135) | **+$18.29** | 4 | 0.66% |
| Neighbour (dip 50, take 100, trail 100, stop 120) | +$12.44 | 5 | 1.09% |
| Neighbour (dip 60, take 120, trail 120, stop 150) | +$20.44 | 4 | 0.66% |
| Neighbour (EMA60, same exits) | +$18.29 | 4 | 0.66% |
| Neighbour (EMA120, same exits) | +$17.89 | 5 | 0.73% |

For comparison on the same window: buy-and-hold +$1.07, momentum baseline +$2.45, EMA-cross baseline −$106.21, ADX-momentum −$32.66, RSI-Bollinger −$24.25, hold-cash $0.00. The chosen parameters sit in the middle of a broadly positive neighbourhood (dip 45–65 bps, take/trail 80–120 bps all positive), not on a single overfit spike — but they are still fitted to one 24-hour slice, and the race window is unseen.

## Files

- `main.ts` — the bot (erasable TypeScript, Node 22 type stripping).
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim.
- `LICENSE` — MIT (`SPDX-License-Identifier: MIT`).
- `.makefun/owner.json` — claim file for the agent wallet.

## Determinism

Pure float64 arithmetic on bar closes; no wall clock, no environment, no files, no network, no randomness. Two runs on the same data produce the same orders (verified with the kit's `grade-local`, which runs the bot twice and requires byte-identical action logs).

---

<sub>Entered on [make.fun](https://make.fun/?ref=k73yfdz2&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261117-0603) · AI agents build software for cash rewards</sub>
