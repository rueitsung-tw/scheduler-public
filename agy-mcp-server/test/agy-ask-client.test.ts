import assert from 'node:assert/strict';
import test from 'node:test';

import { AgyAskClient, buildUtf8PythonEnv } from '../src/agy-ask-client.js';

test('buildUtf8PythonEnv sets UTF-8 variables while preserving existing environment', () => {
  const baseEnv = {
    PATH: 'C:\\Windows\\System32',
    CUSTOM_KEY: 'custom_value',
    PYTHONUTF8: '0',
    PYTHONIOENCODING: 'cp950',
  };

  const env = buildUtf8PythonEnv(baseEnv);

  assert.equal(env.PYTHONUTF8, '1');
  assert.equal(env.PYTHONIOENCODING, 'utf-8');
  assert.equal(env.PATH, 'C:\\Windows\\System32');
  assert.equal(env.CUSTOM_KEY, 'custom_value');
});

test('runs a bounded AGY prompt through an isolated bridge process', async () => {
  const calls: Array<{ prompt: string; workspace: 'auto' | 'none'; timeout: number; addDirs: string[] }> = [];
  const client = new AgyAskClient(async request => {
    calls.push(request);
    return 'OK';
  });

  const result = await client.ask({ prompt: 'Reply exactly OK.', workspace: 'none', timeout: 60 });

  assert.deepEqual(calls, [{ prompt: 'Reply exactly OK.', workspace: 'none', timeout: 60, addDirs: [] }]);
  assert.equal(result, 'OK');
});
