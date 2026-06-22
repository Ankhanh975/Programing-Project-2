# Report Materials

Generated from the local Minecraft PvP physics simulation.

## Files

- `summary.csv` - one row per scenario with winner, final health, attack count, distance statistics, and MCTS visits.
- `win-rate-by-variant.csv` - Alpha win rate grouped by strategy variant.
- `action-distribution-by-variant.csv` - action counts and percentages grouped by strategy variant.
- `episodes.csv` - full decision log for every agent action.
- `action-counts.csv` - action frequency table for comparing strategy choices.
- `tick-series.csv` - per-tick health, distance, and attack timing for charts.
- `duel-runs.json` - complete raw data for all scenarios.
- `health-over-time.svg` - health chart for the baseline duel.
- `distance-over-time.svg` - spacing chart with attack reach marked.
- `win-rate-by-variant.svg` - bar chart of Alpha win rate for each strategy variant.
- `action-distribution-by-variant.svg` - stacked action distribution chart for each strategy variant.
- `action-distribution.svg` - action frequency visual across every scenario.
- `outcome-summary.svg` - final health comparison across scenarios.
- `arena-path.svg` - top-down movement path for the baseline duel.
- `visual-index.html` - one-page preview containing every generated visual.

## Dataset Size

- Scenarios: 42
- Logged decisions: 4598
- Logged attacks: 373

## Suggested Report Points

- MCTS searches several possible combat actions each decision and chooses the action with the best simulated rollout score.
- The distance chart shows the approach phase before attacks become available.
- The health chart shows that damage occurs in bursts because sword attacks have cooldown.
- The action distribution shows that movement dominates early decisions, while attack actions appear only after entering melee range.
