import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runOptionalDiagnosticStats,
  runOptionalRepairAgent,
} from '../src/services/publicSchedulerFallback.js';

test('runOptionalDiagnosticStats skips cleanly when the private script is missing', async () => {
  let spawnCalled = false;
  const warnings = [];

  const result = await runOptionalDiagnosticStats({
    inputPath: 'input.json',
    resultPath: 'output.json',
    scriptExists: () => false,
    spawnPython: () => {
      spawnCalled = true;
      throw new Error('should not spawn');
    },
    logger: {
      warn(message) {
        warnings.push(message);
      },
      error() {},
    },
  });

  assert.equal(result, null);
  assert.equal(spawnCalled, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /diagnostic_stats\.py/i);
});

test('runOptionalRepairAgent falls back to the original solver result when the private script is missing', async () => {
  let spawnCalled = false;
  const warnings = [];

  const result = await runOptionalRepairAgent({
    inputPath: 'input.json',
    outputPath: 'output.json',
    repairOutputPath: 'output_repaired.json',
    scriptExists: () => false,
    fileExists: () => false,
    spawnPython: () => {
      spawnCalled = true;
      throw new Error('should not spawn');
    },
    logger: {
      warn(message) {
        warnings.push(message);
      },
      error() {},
      log() {},
    },
  });

  assert.equal(result, 'original');
  assert.equal(spawnCalled, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /repair_agent\.py/i);
});
