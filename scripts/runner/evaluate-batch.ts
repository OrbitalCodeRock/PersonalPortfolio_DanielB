// A long-running evaluator for the Python level model (ml/runner/). Reads one JSON request per line on
// stdin and writes one JSON result per line on stdout, in the same order:
//
//   in:  {"id": 7, "recipe": {"tier": 2, "features": [...]}, "trials": 8}
//   out: {"id": 7, "score": {valid, rate, used, usedRatio, distinct, lengthFit, length, fitness, ...}}
//
// With "strict": true it instead runs the full-band check (see strictClears) and returns {strict}.
//
// Run: node scripts/runner/evaluate-batch.ts
import { createInterface } from 'node:readline';
import type { Recipe } from '../../src/secrets/runner/levelgen.ts';
import { scoreRecipe, strictClears } from './score.ts';

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
	if (!line.trim()) return;
	let req: { id?: unknown; recipe: Recipe; trials?: number; strict?: boolean };
	try {
		req = JSON.parse(line);
		if (req.strict) {
			process.stdout.write(`${JSON.stringify({ id: req.id ?? null, score: { strict: strictClears(req.recipe) } })}\n`);
			return;
		}
		const score = scoreRecipe(req.recipe, req.trials ?? 8);
		process.stdout.write(`${JSON.stringify({ id: req.id ?? null, score })}\n`);
	} catch (err) {
		process.stdout.write(`${JSON.stringify({ id: null, error: String(err) })}\n`);
	}
});
