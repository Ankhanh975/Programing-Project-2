import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { recordPhysicsDuelEpisodes } from './combat.js';

async function main() {
  const trace = recordPhysicsDuelEpisodes({
    version: '1.20.4',
    leftName: 'Alpha',
    rightName: 'Bravo',
    maxTicks: 80,
    episodeLimit: 160,
  });

  const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'debug', 'physics-episodes.json');
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(trace, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${trace.episodes.length} episodes to ${outputPath}`);
  console.log(`Winner: ${trace.winner}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
