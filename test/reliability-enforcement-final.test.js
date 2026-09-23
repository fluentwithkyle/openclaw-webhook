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
      repository: 'wrong-repo',
      base_branch: 'main',
      constraints: { permitted_paths: ['test/'] },
      authorization: { capabilities: ['read_only'] },
      verification: 'none',
      reporting: 'json'
    };
    createTask(command);

    // Attempt to set VERIFIED via unauthorized source
    recordConfigVerification('task-1', 'repository', {
      state: 'VERIFIED',
      verified: true,
      source: 'caller_assertion' 
    }, 'repo', {});

    // Authoritative check should return UNKNOWN because of repository mismatch
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
    }, 'repo', {});

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

  it('should block creation of an execution task without a parent if an active task exists', () => {
    const parent = {
      request_id: 'parent',
      task: 'parent-task',
      target: 'Kilo',
      repository: 'repo',
      base_branch: 'main',
      constraints: { permitted_paths: ['test/'] },
      authorization: { capabilities: ['read_only'] },
      verification: 'none',
      reporting: 'json',
      task_mode: 'FAILOVER_EXECUTE'
    };
    createTask(parent);

    // Try to create a new execution task without a parent
    const result = createTask({
      request_id: 'new-task',
      task: 'new-task',
      target: 'Kilo',
      repository: 'repo',
      base_branch: 'main',
      constraints: { permitted_paths: ['test/'] },
      authorization: { capabilities: ['read_only'] },
      verification: 'none',
      reporting: 'json',
      task_mode: 'FAILOVER_EXECUTE'
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('require a valid parent_request_id when an active task exists'));
  });
});
