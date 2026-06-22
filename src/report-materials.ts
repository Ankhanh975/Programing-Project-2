import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Vec3 } from 'vec3';

import { recordPhysicsDuelEpisodes, type DuelEpisode, type DuelTraceOptions } from './combat.js';

type Scenario = {
  id: string;
  label: string;
  variant: string;
  repeat: number;
  options: DuelTraceOptions;
};

type RunRecord = {
  id: string;
  label: string;
  variant: string;
  repeat: number;
  trace: ReturnType<typeof recordPhysicsDuelEpisodes>;
};

const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'debug', 'report');

// Project-specific experiment grid used by the report. The repeated jittered
// openings provide basic mean and variance estimates for each MCTS variation.
const repeats = 8;

const strategyVariants = [
  {
    id: 'standard-mcts',
    label: 'Standard MCTS',
    leftConfig: {},
    rightConfig: {},
  },
  {
    id: 'hybrid-heuristic',
    label: 'Hybrid MCTS + heuristic evaluation',
    leftConfig: { heuristicWeight: 2.5 },
    rightConfig: {},
  },
  {
    id: 'risk-aware',
    label: 'Risk-aware MCTS',
    leftConfig: { riskBias: 1.8 },
    rightConfig: {},
  },
  {
    id: 'exploratory',
    label: 'High-exploration MCTS',
    leftConfig: { exploration: 2.2 },
    rightConfig: {},
  },
  {
    id: 'high-budget',
    label: 'Higher-budget MCTS',
    leftConfig: { iterations: 56, rolloutDepth: 5 },
    rightConfig: {},
  },
];

const opponentStyles = [
  {
    label: 'balanced opponent',
    config: {},
    rightHealth: 20,
    rightAttackDamage: 4,
  },
  {
    label: 'defensive opponent',
    config: { engageDistance: 3.2, sprintDistance: 5.2, riskBias: 1.5 },
    rightHealth: 21,
    rightAttackDamage: 4,
  },
  {
    label: 'aggressive opponent',
    config: { engageDistance: 1.8, sprintDistance: 3.4, heuristicWeight: 1.2 },
    rightHealth: 20,
    rightAttackDamage: 4,
  },
  {
    label: 'strong opponent',
    config: { iterations: 40, rolloutDepth: 4, exploration: 1.8 },
    rightHealth: 20,
    rightAttackDamage: 5,
  },
];

const scenarios: Scenario[] = strategyVariants.flatMap((variant) => {
  const rows: Scenario[] = [];
  for (let repeat = 1; repeat <= repeats; repeat++) {
    const rng = seededRandom(`${variant.id}-${repeat}`);
    const opponent = opponentStyles[(repeat - 1) % opponentStyles.length];
    const leftDistanceJitter = (rng() - 0.5) * 1.8;
    const rightDistanceJitter = (rng() - 0.5) * 1.8;
    const leftLateralJitter = (rng() - 0.5) * 2.4;
    const rightLateralJitter = (rng() - 0.5) * 2.4;
    const leftHealth = 19 + Math.floor(rng() * 3);
    rows.push({
      id: `${variant.id}-r${repeat}`,
      label: `${variant.label} run ${repeat} vs ${opponent.label}`,
      variant: variant.label,
      repeat,
      options: {
        maxTicks: 80,
        episodeLimit: 160,
        leftStart: new Vec3(-4 - leftDistanceJitter, 64, -0.75 - leftLateralJitter),
        rightStart: new Vec3(4 + rightDistanceJitter, 64, 0.75 + rightLateralJitter),
        leftHealth,
        rightHealth: opponent.rightHealth,
        leftAttackDamage: 4,
        rightAttackDamage: opponent.rightAttackDamage,
        leftConfig: {
          engageDistance: 2.0,
          sprintDistance: 3.4,
          iterations: 32,
          rolloutDepth: 4,
          ...variant.leftConfig,
        },
        rightConfig: {
          engageDistance: 2.8,
          sprintDistance: 4.8,
          iterations: 30,
          rolloutDepth: 3,
          ...opponent.config,
          ...variant.rightConfig,
        },
      },
    });
  }

  return rows;
});

const illustrativeScenarios: Scenario[] = [
  {
    id: 'wide-arena-example',
    label: 'Wide arena example',
    variant: 'Environment stress test',
    repeat: 1,
    options: {
      maxTicks: 90,
      episodeLimit: 180,
      leftStart: new Vec3(-6, 64, -1),
      rightStart: new Vec3(6, 64, 1),
      leftConfig: { sprintDistance: 3.2, heuristicWeight: 2.5 },
      rightConfig: { sprintDistance: 4.4 },
    },
  },
  {
    id: 'low-health-example',
    label: 'Low-health example',
    variant: 'Environment stress test',
    repeat: 2,
    options: {
      maxTicks: 80,
      episodeLimit: 160,
      leftStart: new Vec3(-4, 64, -0.75),
      rightStart: new Vec3(4, 64, 0.75),
      leftHealth: 14,
      rightHealth: 22,
      leftAttackDamage: 4,
      rightAttackDamage: 5,
      leftConfig: { riskBias: 1.8 },
    },
  },
];

async function main() {
  const runs = [...scenarios, ...illustrativeScenarios].map<RunRecord>((scenario) => ({
    id: scenario.id,
    label: scenario.label,
    variant: scenario.variant,
    repeat: scenario.repeat,
    trace: recordPhysicsDuelEpisodes({
      version: '1.20.4',
      leftName: 'Alpha',
      rightName: 'Bravo',
      ...scenario.options,
    }),
  }));

  await mkdir(outputDir, { recursive: true });

  await writeFile(resolve(outputDir, 'duel-runs.json'), `${JSON.stringify(runs, null, 2)}\n`, 'utf8');
  await writeFile(resolve(outputDir, 'summary.csv'), toCsv(summaryRows(runs)), 'utf8');
  await writeFile(
    resolve(outputDir, 'aggregate-summary.csv'),
    toCsv(aggregateRows(runs.filter((run) => run.variant !== 'Environment stress test'))),
    'utf8',
  );
  await writeFile(
    resolve(outputDir, 'win-rate-by-variant.csv'),
    toCsv(winRateRows(runs.filter((run) => run.variant !== 'Environment stress test'))),
    'utf8',
  );
  await writeFile(
    resolve(outputDir, 'action-distribution-by-variant.csv'),
    toCsv(actionDistributionByVariantRows(runs.filter((run) => run.variant !== 'Environment stress test'))),
    'utf8',
  );
  await writeFile(resolve(outputDir, 'episodes.csv'), toCsv(episodeRows(runs)), 'utf8');
  await writeFile(resolve(outputDir, 'action-counts.csv'), toCsv(actionCountRows(runs)), 'utf8');
  await writeFile(resolve(outputDir, 'tick-series.csv'), toCsv(tickSeriesRows(runs)), 'utf8');

  const baseline = runs[0];
  await writeFile(resolve(outputDir, 'health-over-time.svg'), healthChart(baseline), 'utf8');
  await writeFile(resolve(outputDir, 'distance-over-time.svg'), distanceChart(baseline), 'utf8');
  await writeFile(resolve(outputDir, 'action-distribution.svg'), actionDistributionChart(runs), 'utf8');
  await writeFile(resolve(outputDir, 'win-rate-by-variant.svg'), winRateByVariantChart(runs), 'utf8');
  await writeFile(resolve(outputDir, 'action-distribution-by-variant.svg'), actionDistributionByVariantChart(runs), 'utf8');
  await writeFile(resolve(outputDir, 'outcome-summary.svg'), outcomeChart(runs), 'utf8');
  await writeFile(resolve(outputDir, 'arena-path.svg'), arenaPathChart(baseline), 'utf8');
  await writeFile(resolve(outputDir, 'visual-index.html'), visualIndex(), 'utf8');
  await writeFile(resolve(outputDir, 'README.md'), reportGuide(runs), 'utf8');

  console.log(`Wrote report materials to ${outputDir}`);
  console.log(`Runs: ${runs.length}`);
  console.log(`Episodes: ${runs.reduce((total, run) => total + run.trace.episodes.length, 0)}`);
}

function summaryRows(runs: RunRecord[]) {
  return runs.map((run) => {
    const episodes = run.trace.episodes;
    const distances = episodes.map((episode) => episode.distance);
    const firstAttack = episodes.find((episode) => episode.attack);
    return {
      runId: run.id,
      scenario: run.label,
      variant: run.variant,
      repeat: run.repeat,
      winner: run.trace.winner,
      episodes: episodes.length,
      ticks: Math.max(...episodes.map((episode) => episode.tick)),
      attacks: episodes.filter((episode) => episode.attack).length,
      alphaFinalHealth: run.trace.left.health,
      bravoFinalHealth: run.trace.right.health,
      firstAttackTick: firstAttack?.tick ?? '',
      averageDistance: round(average(distances)),
      minDistance: round(Math.min(...distances)),
      maxDistance: round(Math.max(...distances)),
      averageMctsVisits: round(average(episodes.map((episode) => episode.visits))),
      uniqueActions: new Set(episodes.map((episode) => episode.action)).size,
    };
  });
}

function aggregateRows(runs: RunRecord[]) {
  const groups = new Map<string, RunRecord[]>();
  for (const run of runs) {
    groups.set(run.variant, [...(groups.get(run.variant) ?? []), run]);
  }

  return [...groups.entries()].map(([variant, group]) => {
    const summaries = summaryRows(group);
    const ticks = summaries.map((row) => Number(row.ticks));
    const attacks = summaries.map((row) => Number(row.attacks));
    const firstAttackTicks = summaries
      .map((row) => Number(row.firstAttackTick))
      .filter((value) => Number.isFinite(value));
    const distances = summaries.map((row) => Number(row.averageDistance));
    const visits = summaries.map((row) => Number(row.averageMctsVisits));
    const alphaWins = summaries.filter((row) => row.winner === 'Alpha').length;

    return {
      variant,
      runs: group.length,
      alphaWinRate: round(alphaWins / group.length),
      meanTicks: round(average(ticks)),
      varianceTicks: round(variance(ticks)),
      meanAttacks: round(average(attacks)),
      varianceAttacks: round(variance(attacks)),
      meanFirstAttackTick: round(average(firstAttackTicks)),
      meanAverageDistance: round(average(distances)),
      meanMctsVisits: round(average(visits)),
    };
  });
}

function winRateRows(runs: RunRecord[]) {
  return aggregateRows(runs).map((row) => ({
    variant: row.variant,
    runs: row.runs,
    alphaWinRate: row.alphaWinRate,
    alphaWins: round(Number(row.alphaWinRate) * Number(row.runs)),
  }));
}

function actionDistributionByVariantRows(runs: RunRecord[]) {
  const actions = ['sprint-advance', 'advance', 'close-attack', 'jump-sprint', 'jump-advance', 'hold-attack', 'other'];
  const groups = new Map<string, DuelEpisode[]>();
  for (const run of runs) {
    groups.set(run.variant, [...(groups.get(run.variant) ?? []), ...run.trace.episodes]);
  }

  return [...groups.entries()].flatMap(([variant, episodes]) => {
    const counts = countBy(episodes, (episode) => actions.includes(episode.action) ? episode.action : 'other');
    return actions.map((action) => ({
      variant,
      action,
      count: counts[action] ?? 0,
      percent: round(((counts[action] ?? 0) / episodes.length) * 100),
    }));
  });
}

function episodeRows(runs: RunRecord[]) {
  return runs.flatMap((run) => run.trace.episodes.map((episode) => ({
    runId: run.id,
    scenario: run.label,
    variant: run.variant,
    repeat: run.repeat,
    tick: episode.tick,
    side: episode.side,
    actor: episode.actor,
    opponent: episode.opponent,
    action: episode.action,
    attack: episode.attack,
    distance: round(episode.distance),
    score: round(episode.score),
    visits: episode.visits,
    healthDiff: episode.healthDiff,
    actorCooldown: episode.actorCooldown,
    opponentCooldown: episode.opponentCooldown,
    actorHealth: episode.actorHealth,
    opponentHealth: episode.opponentHealth,
    actorX: round(episode.actorPosition.x),
    actorZ: round(episode.actorPosition.z),
    opponentX: round(episode.opponentPosition.x),
    opponentZ: round(episode.opponentPosition.z),
    forward: episode.controls.forward,
    sprint: episode.controls.sprint,
    jump: episode.controls.jump,
    strafeLeft: episode.controls.left,
    strafeRight: episode.controls.right,
    back: episode.controls.back,
  })));
}

function actionCountRows(runs: RunRecord[]) {
  return runs.flatMap((run) => {
    const counts = countBy(run.trace.episodes, (episode) => episode.action);
    return Object.entries(counts)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([action, count]) => ({
        runId: run.id,
        scenario: run.label,
        variant: run.variant,
        repeat: run.repeat,
        action,
        count,
        percent: round((count / run.trace.episodes.length) * 100),
      }));
  });
}

function tickSeriesRows(runs: RunRecord[]) {
  return runs.flatMap((run) => {
    const ticks = new Map<number, DuelEpisode[]>();
    for (const episode of run.trace.episodes) {
      ticks.set(episode.tick, [...(ticks.get(episode.tick) ?? []), episode]);
    }

    return [...ticks.entries()].map(([tick, episodes]) => {
      const last = episodes[episodes.length - 1];
      return {
        runId: run.id,
        scenario: run.label,
        variant: run.variant,
        repeat: run.repeat,
        tick,
        distance: round(last.distance),
        alphaHealth: healthFor(last, 'Alpha'),
        bravoHealth: healthFor(last, 'Bravo'),
        attacksThisTick: episodes.filter((episode) => episode.attack).length,
        lastAction: last.action,
      };
    });
  });
}

function healthChart(run: RunRecord) {
  const rows = tickSeriesRows([run]);
  const width = 920;
  const height = 520;
  const plot = { x: 70, y: 50, width: 790, height: 390 };
  const maxTick = Math.max(...rows.map((row) => Number(row.tick)));
  const x = (tick: number) => plot.x + (tick / maxTick) * plot.width;
  const y = (health: number) => plot.y + plot.height - (health / 22) * plot.height;
  const alpha = polyline(rows.map((row) => [x(Number(row.tick)), y(Number(row.alphaHealth))]));
  const bravo = polyline(rows.map((row) => [x(Number(row.tick)), y(Number(row.bravoHealth))]));

  return svgFrame(width, height, 'Health over time', `
    ${axis(plot, 'Tick', 'Health')}
    <path d="${alpha}" fill="none" stroke="#2563eb" stroke-width="4"/>
    <path d="${bravo}" fill="none" stroke="#dc2626" stroke-width="4"/>
    ${legend(665, 70, [['Alpha health', '#2563eb'], ['Bravo health', '#dc2626']])}
  `);
}

function distanceChart(run: RunRecord) {
  const rows = tickSeriesRows([run]);
  const width = 920;
  const height = 520;
  const plot = { x: 70, y: 50, width: 790, height: 390 };
  const maxTick = Math.max(...rows.map((row) => Number(row.tick)));
  const maxDistance = Math.max(...rows.map((row) => Number(row.distance)));
  const x = (tick: number) => plot.x + (tick / maxTick) * plot.width;
  const y = (distance: number) => plot.y + plot.height - (distance / maxDistance) * plot.height;
  const line = polyline(rows.map((row) => [x(Number(row.tick)), y(Number(row.distance))]));
  const reachY = y(3.05);

  return svgFrame(width, height, 'Distance over time', `
    ${axis(plot, 'Tick', 'Blocks apart')}
    <line x1="${plot.x}" y1="${reachY}" x2="${plot.x + plot.width}" y2="${reachY}" stroke="#16a34a" stroke-width="2" stroke-dasharray="8 8"/>
    <path d="${line}" fill="none" stroke="#7c3aed" stroke-width="4"/>
    <text x="${plot.x + plot.width - 130}" y="${reachY - 10}" class="small">attack reach</text>
  `);
}

function actionDistributionChart(runs: RunRecord[]) {
  const counts = countBy(runs.flatMap((run) => run.trace.episodes), (episode) => episode.action);
  const entries = Object.entries(counts).sort((left, right) => right[1] - left[1]);
  const width = 980;
  const height = 560;
  const left = 220;
  const barHeight = 28;
  const gap = 12;
  const max = Math.max(...entries.map((entry) => entry[1]));
  const bars = entries.map(([action, count], index) => {
    const y = 75 + index * (barHeight + gap);
    const w = (count / max) * 650;
    return `
      <text x="${left - 14}" y="${y + 20}" text-anchor="end" class="label">${escapeXml(action)}</text>
      <rect x="${left}" y="${y}" width="${w}" height="${barHeight}" rx="4" fill="#0f766e"/>
      <text x="${left + w + 10}" y="${y + 20}" class="small">${count}</text>
    `;
  }).join('');

  return svgFrame(width, height, 'Action distribution across all scenarios', bars);
}

function winRateByVariantChart(runs: RunRecord[]) {
  const rows = winRateRows(runs.filter((run) => run.variant !== 'Environment stress test'));
  const width = 980;
  const height = 560;
  const plot = { x: 310, y: 80, width: 560, height: 360 };
  const barHeight = 42;
  const gap = 24;
  const bars = rows.map((row, index) => {
    const y = plot.y + index * (barHeight + gap);
    const rate = Number(row.alphaWinRate);
    const barWidth = rate * plot.width;
    return `
      <text x="${plot.x - 18}" y="${y + 27}" text-anchor="end" class="label">${escapeXml(String(row.variant))}</text>
      <rect x="${plot.x}" y="${y}" width="${plot.width}" height="${barHeight}" rx="4" fill="#e2e8f0"/>
      <rect x="${plot.x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4" fill="#2563eb"/>
      <text x="${plot.x + barWidth + 10}" y="${y + 27}" class="small">${Math.round(rate * 100)}%</text>
    `;
  }).join('');

  return svgFrame(width, height, 'Alpha win rate by strategy variant', `
    ${bars}
    <text x="${plot.x}" y="${plot.y + plot.height + 82}" class="small">0%</text>
    <text x="${plot.x + plot.width / 2}" y="${plot.y + plot.height + 82}" text-anchor="middle" class="small">50%</text>
    <text x="${plot.x + plot.width}" y="${plot.y + plot.height + 82}" text-anchor="end" class="small">100%</text>
  `);
}

function actionDistributionByVariantChart(runs: RunRecord[]) {
  const rows = actionDistributionByVariantRows(runs.filter((run) => run.variant !== 'Environment stress test'));
  const variants = [...new Set(rows.map((row) => String(row.variant)))];
  const actions = ['sprint-advance', 'advance', 'close-attack', 'jump-sprint', 'jump-advance', 'hold-attack', 'other'];
  const colors: Record<string, string> = {
    'sprint-advance': '#2563eb',
    advance: '#16a34a',
    'close-attack': '#dc2626',
    'jump-sprint': '#f59e0b',
    'jump-advance': '#7c3aed',
    'hold-attack': '#64748b',
    other: '#94a3b8',
  };
  const width = 1100;
  const height = 620;
  const plot = { x: 300, y: 90, width: 680, height: 360 };
  const barHeight = 42;
  const gap = 24;
  const bars = variants.map((variant, index) => {
    const y = plot.y + index * (barHeight + gap);
    let x = plot.x;
    const segments = actions.map((action) => {
      const row = rows.find((candidate) => candidate.variant === variant && candidate.action === action);
      const percent = Number(row?.percent ?? 0);
      const width = (percent / 100) * plot.width;
      const segment = `<rect x="${x}" y="${y}" width="${width}" height="${barHeight}" fill="${colors[action]}"><title>${escapeXml(action)}: ${percent}%</title></rect>`;
      x += width;
      return segment;
    }).join('');

    return `
      <text x="${plot.x - 18}" y="${y + 27}" text-anchor="end" class="label">${escapeXml(variant)}</text>
      <rect x="${plot.x}" y="${y}" width="${plot.width}" height="${barHeight}" fill="#e2e8f0"/>
      ${segments}
    `;
  }).join('');

  return svgFrame(width, height, 'Action distribution by strategy variant', `
    ${bars}
    ${legend(70, 480, actions.map((action) => [action, colors[action]]))}
  `);
}

function outcomeChart(runs: RunRecord[]) {
  const width = 980;
  const height = 560;
  const plot = { x: 80, y: 70, width: 820, height: 380 };
  const groupWidth = plot.width / runs.length;
  const barWidth = 28;
  const bars = runs.map((run, index) => {
    const x0 = plot.x + index * groupWidth + groupWidth / 2;
    const alphaH = run.trace.left.health;
    const bravoH = run.trace.right.health;
    const alphaHeight = (alphaH / 22) * plot.height;
    const bravoHeight = (bravoH / 22) * plot.height;
    return `
      <rect x="${x0 - barWidth - 3}" y="${plot.y + plot.height - alphaHeight}" width="${barWidth}" height="${alphaHeight}" fill="#2563eb"/>
      <rect x="${x0 + 3}" y="${plot.y + plot.height - bravoHeight}" width="${barWidth}" height="${bravoHeight}" fill="#dc2626"/>
      <text x="${x0}" y="${plot.y + plot.height + 26}" text-anchor="middle" class="tiny">${escapeXml(run.id)}</text>
    `;
  }).join('');

  return svgFrame(width, height, 'Final health by scenario', `
    ${axis(plot, 'Scenario', 'Final health')}
    ${bars}
    ${legend(730, 80, [['Alpha', '#2563eb'], ['Bravo', '#dc2626']])}
  `);
}

function arenaPathChart(run: RunRecord) {
  const width = 760;
  const height = 640;
  const plot = { x: 70, y: 60, width: 620, height: 480 };
  const alphaPoints = pathPoints(run.trace.episodes, 'Alpha');
  const bravoPoints = pathPoints(run.trace.episodes, 'Bravo');
  const all = [...alphaPoints, ...bravoPoints];
  const minX = Math.min(...all.map((point) => point[0]));
  const maxX = Math.max(...all.map((point) => point[0]));
  const minZ = Math.min(...all.map((point) => point[1]));
  const maxZ = Math.max(...all.map((point) => point[1]));
  const scaleX = (x: number) => plot.x + ((x - minX) / Math.max(0.001, maxX - minX)) * plot.width;
  const scaleZ = (z: number) => plot.y + plot.height - ((z - minZ) / Math.max(0.001, maxZ - minZ)) * plot.height;
  const alphaLine = polyline(alphaPoints.map(([x, z]) => [scaleX(x), scaleZ(z)]));
  const bravoLine = polyline(bravoPoints.map(([x, z]) => [scaleX(x), scaleZ(z)]));

  return svgFrame(width, height, 'Arena movement path', `
    <rect x="${plot.x}" y="${plot.y}" width="${plot.width}" height="${plot.height}" fill="#f8fafc" stroke="#cbd5e1"/>
    <path d="${alphaLine}" fill="none" stroke="#2563eb" stroke-width="4"/>
    <path d="${bravoLine}" fill="none" stroke="#dc2626" stroke-width="4"/>
    ${legend(520, 80, [['Alpha path', '#2563eb'], ['Bravo path', '#dc2626']])}
    <text x="${plot.x + plot.width / 2}" y="${plot.y + plot.height + 44}" text-anchor="middle" class="small">X position</text>
    <text x="26" y="${plot.y + plot.height / 2}" transform="rotate(-90 26 ${plot.y + plot.height / 2})" text-anchor="middle" class="small">Z position</text>
  `);
}

function reportGuide(runs: RunRecord[]) {
  const totalEpisodes = runs.reduce((total, run) => total + run.trace.episodes.length, 0);
  const totalAttacks = runs.reduce((total, run) => total + run.trace.episodes.filter((episode) => episode.attack).length, 0);
  return `# Report Materials

Generated from the local Minecraft PvP physics simulation.

## Files

- \`summary.csv\` - one row per scenario with winner, final health, attack count, distance statistics, and MCTS visits.
- \`win-rate-by-variant.csv\` - Alpha win rate grouped by strategy variant.
- \`action-distribution-by-variant.csv\` - action counts and percentages grouped by strategy variant.
- \`episodes.csv\` - full decision log for every agent action.
- \`action-counts.csv\` - action frequency table for comparing strategy choices.
- \`tick-series.csv\` - per-tick health, distance, and attack timing for charts.
- \`duel-runs.json\` - complete raw data for all scenarios.
- \`health-over-time.svg\` - health chart for the baseline duel.
- \`distance-over-time.svg\` - spacing chart with attack reach marked.
- \`win-rate-by-variant.svg\` - bar chart of Alpha win rate for each strategy variant.
- \`action-distribution-by-variant.svg\` - stacked action distribution chart for each strategy variant.
- \`action-distribution.svg\` - action frequency visual across every scenario.
- \`outcome-summary.svg\` - final health comparison across scenarios.
- \`arena-path.svg\` - top-down movement path for the baseline duel.
- \`visual-index.html\` - one-page preview containing every generated visual.

## Dataset Size

- Scenarios: ${runs.length}
- Logged decisions: ${totalEpisodes}
- Logged attacks: ${totalAttacks}

## Suggested Report Points

- MCTS searches several possible combat actions each decision and chooses the action with the best simulated rollout score.
- The distance chart shows the approach phase before attacks become available.
- The health chart shows that damage occurs in bursts because sword attacks have cooldown.
- The action distribution shows that movement dominates early decisions, while attack actions appear only after entering melee range.
`;
}

function visualIndex() {
  const visuals = [
    ['Win rate by variant', 'win-rate-by-variant.svg'],
    ['Action distribution by variant', 'action-distribution-by-variant.svg'],
    ['Health over time', 'health-over-time.svg'],
    ['Distance over time', 'distance-over-time.svg'],
    ['Action distribution', 'action-distribution.svg'],
    ['Outcome summary', 'outcome-summary.svg'],
    ['Arena path', 'arena-path.svg'],
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Minecraft PvP MCTS Report Visuals</title>
  <style>
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #0f172a; background: #f8fafc; }
    main { max-width: 1080px; margin: 0 auto; padding: 32px; }
    h1 { font-size: 28px; margin: 0 0 24px; }
    section { margin: 0 0 28px; padding: 18px; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 8px; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    img { width: 100%; height: auto; display: block; }
  </style>
</head>
<body>
  <main>
    <h1>Minecraft PvP MCTS Report Visuals</h1>
    ${visuals.map(([title, file]) => `<section><h2>${title}</h2><img src="${file}" alt="${title}"></section>`).join('\n    ')}
  </main>
</body>
</html>
`;
}

function pathPoints(episodes: DuelEpisode[], fighter: string) {
  const points: Array<[number, number]> = [];
  for (const episode of episodes) {
    if (episode.actor === fighter) {
      points.push([episode.actorPosition.x, episode.actorPosition.z]);
    } else if (episode.opponent === fighter) {
      points.push([episode.opponentPosition.x, episode.opponentPosition.z]);
    }
  }
  return points;
}

function healthFor(episode: DuelEpisode, fighter: string) {
  if (episode.actor === fighter) {
    return episode.actorHealth;
  }

  return episode.opponentHealth;
}

function countBy<T>(items: T[], keyFor: (item: T) => string) {
  return items.reduce<Record<string, number>>((counts, item) => {
    const key = keyFor(item);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function seededRandom(seedText: string) {
  let seed = 2166136261;
  for (const char of seedText) {
    seed ^= char.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }

  return () => {
    seed += 0x6D2B79F5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values: number[]) {
  if (values.length <= 1) {
    return 0;
  }

  const mean = average(values);
  return average(values.map((value) => (value - mean) ** 2));
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) {
    return '';
  }

  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) {
    return text;
  }

  return `"${text.replaceAll('"', '""')}"`;
}

function svgFrame(width: number, height: number, title: string, body: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <style>
    text { font-family: Arial, Helvetica, sans-serif; fill: #0f172a; }
    .title { font-size: 26px; font-weight: 700; }
    .label { font-size: 15px; }
    .small { font-size: 14px; fill: #334155; }
    .tiny { font-size: 10px; fill: #334155; }
  </style>
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="40" y="34" class="title">${escapeXml(title)}</text>
  ${body}
</svg>
`;
}

function axis(plot: { x: number; y: number; width: number; height: number }, xLabel: string, yLabel: string) {
  return `
    <line x1="${plot.x}" y1="${plot.y + plot.height}" x2="${plot.x + plot.width}" y2="${plot.y + plot.height}" stroke="#64748b" stroke-width="2"/>
    <line x1="${plot.x}" y1="${plot.y}" x2="${plot.x}" y2="${plot.y + plot.height}" stroke="#64748b" stroke-width="2"/>
    <text x="${plot.x + plot.width / 2}" y="${plot.y + plot.height + 48}" text-anchor="middle" class="small">${escapeXml(xLabel)}</text>
    <text x="28" y="${plot.y + plot.height / 2}" transform="rotate(-90 28 ${plot.y + plot.height / 2})" text-anchor="middle" class="small">${escapeXml(yLabel)}</text>
  `;
}

function legend(x: number, y: number, items: Array<[string, string]>) {
  return items.map(([label, color], index) => {
    const yy = y + index * 26;
    return `<rect x="${x}" y="${yy - 13}" width="16" height="16" fill="${color}"/><text x="${x + 24}" y="${yy}" class="small">${escapeXml(label)}</text>`;
  }).join('');
}

function polyline(points: Array<[number, number]>) {
  return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${round(x)} ${round(y)}`).join(' ');
}

function escapeXml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
