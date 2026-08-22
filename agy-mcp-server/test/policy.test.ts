import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyDelegationFailure,
  findDisallowedWrites,
  type DelegationClassificationInput,
  type DelegationFailureReason,
} from '../src/policy.js';

test('findDisallowedWrites: exact match and descendant paths are allowed', () => {
  const writePaths = ['src/policy.ts', 'docs'];
  const changedFiles = [
    'src/policy.ts',
    'docs/readme.md',
    'docs/nested/deep/guide.md',
  ];

  const disallowed = findDisallowedWrites(changedFiles, writePaths);
  assert.deepEqual(disallowed, []);
});

test('findDisallowedWrites: sibling prefix is not allowed', () => {
  const writePaths = ['src/policy', 'src/app'];
  const changedFiles = [
    'src/policy.ts',
    'src/policy-extended.ts',
    'src/app-server/index.ts',
  ];

  const disallowed = findDisallowedWrites(changedFiles, writePaths);
  assert.deepEqual(disallowed, [
    'src/policy.ts',
    'src/policy-extended.ts',
    'src/app-server/index.ts',
  ]);
});

test('findDisallowedWrites: normalizes backslashes and deduplicates illegal changes', () => {
  const writePaths = ['src\\allowed\\dir'];
  const changedFiles = [
    'src\\allowed\\dir\\file.ts',
    'src/disallowed/one.ts',
    'src\\disallowed\\one.ts',
    'src/disallowed/two.ts',
    'src\\disallowed\\two.ts',
  ];

  const disallowed = findDisallowedWrites(changedFiles, writePaths);
  assert.deepEqual(disallowed, [
    'src/disallowed/one.ts',
    'src/disallowed/two.ts',
  ]);
});

test('findDisallowedWrites: handles empty writePaths and empty changedFiles', () => {
  assert.deepEqual(findDisallowedWrites([], ['src/a.ts']), []);
  assert.deepEqual(findDisallowedWrites(['src/a.ts'], []), ['src/a.ts']);
  assert.deepEqual(findDisallowedWrites([], []), []);
});

test('classifyDelegationFailure: precedence 1 - timeout takes highest precedence', () => {
  const input: DelegationClassificationInput = {
    exitCode: 1,
    timedOut: true,
    cancelled: true,
    changedFiles: ['forbidden.ts'],
    writePaths: ['allowed.ts'],
    acceptancePassed: false,
  };

  const result: DelegationFailureReason = classifyDelegationFailure(input);
  assert.equal(result, 'timeout');
});

test('classifyDelegationFailure: precedence 2 - cancelled takes precedence over exitCode, write violation, no changes, and acceptance', () => {
  const input: DelegationClassificationInput = {
    exitCode: 1,
    timedOut: false,
    cancelled: true,
    changedFiles: ['forbidden.ts'],
    writePaths: ['allowed.ts'],
    acceptancePassed: false,
  };

  assert.equal(classifyDelegationFailure(input), 'cancelled');
});

test('classifyDelegationFailure: precedence 3 - nonzero exitCode (provider_failure) takes precedence over write violation, no changes, and acceptance', () => {
  const nonzeroExitInput: DelegationClassificationInput = {
    exitCode: 1,
    timedOut: false,
    cancelled: false,
    changedFiles: ['forbidden.ts'],
    writePaths: ['allowed.ts'],
    acceptancePassed: false,
  };
  assert.equal(classifyDelegationFailure(nonzeroExitInput), 'provider_failure');

  const nullExitInput: DelegationClassificationInput = {
    exitCode: null,
    timedOut: false,
    cancelled: false,
    changedFiles: [],
    writePaths: ['allowed.ts'],
    acceptancePassed: false,
  };
  assert.equal(classifyDelegationFailure(nullExitInput), 'provider_failure');
});

test('classifyDelegationFailure: precedence 4 - write_allowlist_violation takes precedence over no changes and acceptance failure', () => {
  const input: DelegationClassificationInput = {
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    changedFiles: ['forbidden.ts'],
    writePaths: ['allowed.ts'],
    acceptancePassed: false,
  };

  assert.equal(classifyDelegationFailure(input), 'write_allowlist_violation');
});

test('classifyDelegationFailure: precedence 5 - no_changes when writePaths is nonempty takes precedence over acceptance failure', () => {
  const input: DelegationClassificationInput = {
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    changedFiles: [],
    writePaths: ['allowed.ts'],
    acceptancePassed: false,
  };

  assert.equal(classifyDelegationFailure(input), 'no_changes');
});

test('classifyDelegationFailure: precedence 6 - acceptance_failure when all prior checks pass', () => {
  const input: DelegationClassificationInput = {
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    changedFiles: ['allowed.ts'],
    writePaths: ['allowed.ts'],
    acceptancePassed: false,
  };

  assert.equal(classifyDelegationFailure(input), 'acceptance_failure');
});

test('classifyDelegationFailure: precedence 7 - succeeded when all checks pass', () => {
  const withChanges: DelegationClassificationInput = {
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    changedFiles: ['allowed.ts', 'allowed/child.ts'],
    writePaths: ['allowed.ts', 'allowed/child.ts'],
    acceptancePassed: true,
  };
  assert.equal(classifyDelegationFailure(withChanges), 'succeeded');

  const withoutRequiredWrites: DelegationClassificationInput = {
    exitCode: 0,
    timedOut: false,
    cancelled: false,
    changedFiles: [],
    writePaths: [],
    acceptancePassed: true,
  };
  assert.equal(classifyDelegationFailure(withoutRequiredWrites), 'succeeded');
});
