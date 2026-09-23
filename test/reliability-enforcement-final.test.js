const assert = require('assert');
const {
  createTask,
  resetRegistry,
  recordConfigVerification,
  getConfigVerificationState,
  requireConfigVerified
} = require('../poc/task-registry');

describe('Reliability Enforcement Final Corrections - Configuration Provenance', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('should not allow VERIFIED state from unauthorized caller assertion', () => {
    const command = {
      request_id: 'task-1',
      task: 'test',
      target: 'Kilo',
      repository: 'repo',
      base_branch: 'main',
      constraints: { permitted_paths: ['test/'] },
      authorization: { capabilities: ['read_only'] },
      verification: 'none',
      reporting: 'json'
    };
    createTask(command);

    // Attempt to set VERIFIED via unauthorized source
    const result = recordConfigVerification('task-1', 'repository', {
      state: 'VERIFIED',
      verified: true,
      source: 'caller_assertion' // Unauthorized source
    });

    assert.strictEqual(result.success, true); // Still sets it, but maybe we need to validate in recordConfigVerification instead of just setting it.

    // If I change recordConfigVerification, this should fail to set VERIFIED, or set it to UNVERIFIED.
    const state = getConfigVerificationState('task-1', 'repository');
    assert.notStrictEqual(state, 'VERIFIED', 'Caller assertion should not result in VERIFIED state');
  });

  it('should accept VERIFIED state from authoritative source', () => {
    const command = {
      request_id: 'task-1',
      task: 'test',
      target: 'Kilo',
      repository: 'repo',
      base_branch: 'main',
      constraints: { permitted_paths: ['test/'] },
      authorization: { capabilities: ['read_only'] },
      verification: 'none',
      reporting: 'json'
    };
    createTask(command);

    recordConfigVerification('task-1', 'repository', {
      state: 'VERIFIED',
      verified: true,
      source: 'task_registry' // Authorized source
    });

    const state = getConfigVerificationState('task-1', 'repository');
    assert.strictEqual(state, 'VERIFIED');
  });
});

describe('Reliability Enforcement Final Corrections - Lineage Protection', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('should prevent creating a child task while parent is still active', () => {
    const parent = {
      request_id: 'parent',
      task: 'parent-task',
      target: 'Kilo',
      repository: 'repo',
      base_branch: 'main',
      constraints: { permitted_paths: ['test/'] },
      authorization: { capabilities: ['read_only'] },
      verification: 'none',
      reporting: 'json'
    };
    createTask(parent);

    const child = {
      request_id: 'child',
      parent_request_id: 'parent',
      task: 'child-task',
      target: 'Kilo',
      repository: 'repo',
      base_branch: 'main',
      constraints: { permitted_paths: ['test/'] },
      authorization: { capabilities: ['read_only'] },
      verification: 'none',
      reporting: 'json'
    };
    const result = createTask(child);

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Cannot create child while parent task is still active'));
  });

  it('should prevent conflicting active lineage (multiple active children)', () => {
    const parent = {
      request_id: 'parent',
      task: 'parent-task',
      target: 'Kilo',
      repository: 'repo',
      base_branch: 'main',
      constraints: { permitted_paths: ['test/'] },
      authorization: { capabilities: ['read_only'] },
      verification: 'none',
      reporting: 'json'
    };
    createTask(parent);

    // Create child 1 (active)
    createTask({
      request_id: 'child1',
      parent_request_id: 'parent',
      task: 'child-task-1',
      target: 'Kilo',
      repository: 'repo',
      base_branch: 'main',
      constraints: { permitted_paths: ['test/'] },
      authorization: { capabilities: ['read_only'] },
      verification: 'none',
      reporting: 'json'
    });

    // Try to create child 2 (conflicting active)
    const result = createTask({
      request_id: 'child2',
      parent_request_id: 'parent',
      task: 'child-task-2',
      target: 'Kilo',
      repository: 'repo',
      base_branch: 'main',
      constraints: { permitted_paths: ['test/'] },
      authorization: { capabilities: ['read_only'] },
      verification: 'none',
      reporting: 'json'
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Conflicting active lineage'));
  });
});
