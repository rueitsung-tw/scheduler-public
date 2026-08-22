import assert from 'node:assert/strict';
import test from 'node:test';

import { ClineClient, ClineTimeoutError } from '../src/cline-client.js';

test('runs one bounded Cline session in the requested working directory', async () => {
  const calls: Array<{ prompt: string; cwd: string; timeout: number }> = [];
  const client = new ClineClient(async request => {
    calls.push(request);
    return { text: 'OK', changedFiles: [] };
  });

  const result = await client.submit({
    prompt: 'Reply exactly OK.',
    cwd: 'F:\\scheduler-frontend',
    timeout: 60,
  });

  assert.deepEqual(calls, [{
    prompt: 'Reply exactly OK.',
    cwd: 'F:\\scheduler-frontend',
    timeout: 60,
  }]);
  assert.deepEqual(result, { status: 'SUCCEEDED', summary: 'OK', changedFiles: [] });
});

test('returns only the final text from Cline NDJSON output', async () => {
  const client = new ClineClient(async () => ({
    text: [
      '{"type":"agent_event","event":{"type":"content_start","contentType":"reasoning","reasoning":"long internal trace"}}',
      '{"type":"run_result","text":"Concise final answer"}',
    ].join('\n'),
    changedFiles: [],
  }));

  const result = await client.submit({
    prompt: 'Reply concisely.',
    cwd: 'F:\\scheduler-frontend',
    timeout: 60,
  });

  assert.equal(result.summary, 'Concise final answer');
});

test('classifies an outer timeout without retrying', async () => {
  let calls = 0;
  const client = new ClineClient(async () => {
    calls += 1;
    throw new ClineTimeoutError('OUTER_TIMEOUT', 'Cline outer timeout after 2700s');
  });

  const result = await client.submit({
    prompt: 'Run the focused tests.',
    cwd: 'F:\\scheduler-frontend',
    timeout: 2700,
  });

  assert.equal(calls, 1);
  assert.deepEqual(result, {
    status: 'TIMED_OUT',
    timeoutType: 'OUTER_TIMEOUT',
    summary: 'Cline outer timeout after 2700s',
    changedFiles: [],
  });
});
