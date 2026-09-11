'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const acp = require('./acp');
const {
  validateEnvelope,
  authorize,
  checkPermittedPaths,
  buildReport,
  executeAcpCommand,
  REPORT_STATUS,
} = acp;

const repoRoot = path.resolve(__dirname, '..');

const DEFAULT_COMMAND = {
  protocol_version: '0.1',
  request_id: 'req-test-001',
  source: 'test-router',
  target: 'Kilo Cloud Agent',
  task_type: 'implementation',
  repository: 'fluentwithkyle/openclaw-webhook',
  base_branch: 'main',
  task: 'Inspect repository status as a read-only operation.',
  constraints: {
    permitted_paths: ['poc/'],
    rules: ['smallest-change', 'read-only-only'],
  },
  authorization: {
    capabilities: ['read_only'],
  },
  verification: 'git diff --check and targeted review',
  reporting: 'structured execution report',
  timestamp: '2026-09-11T08:40:27+00:00',
};

function baseCommand(overrides) {
  return Object.assign({}, DEFAULT_COMMAND, overrides);
}

describe('ACP read-only POC', () => {
  test('valid read-only command returns SUCCESS report', () => {
    const report = executeAcpCommand(baseCommand(), repoRoot);
    assert.equal(report.status, REPORT_STATUS.SUCCESS);
    assert.equal(report.request_id, 'req-test-001');
    assert.ok(report.execution_performed);
    assert.ok(report.result);
    assert.equal(report.blockers, null);
  });

  test('valid read-only command result contains git status output', () => {
    const report = executeAcpCommand(baseCommand(), repoRoot);
    assert.equal(report.status, REPORT_STATUS.SUCCESS);
    assert.ok(typeof report.result.output === 'string');
  });

  test('malformed envelope (missing required fields) is FAILED', () => {
    const env = validateEnvelope({ request_id: 'bad' });
    assert.equal(env.valid, false);
    assert.ok(env.errors.length > 0);
    const report = executeAcpCommand({ request_id: 'bad' }, repoRoot);
    assert.equal(report.status, REPORT_STATUS.FAILED);
    assert.ok(report.blockers && report.blockers.length > 0);
  });

  test('malformed envelope (non-object) is FAILED', () => {
    const env = validateEnvelope('not-an-object');
    assert.equal(env.valid, false);
  });

  test('command requesting read_only + modify_files is BLOCKED', () => {
    const report = executeAcpCommand(
      baseCommand({ authorization: { capabilities: ['read_only', 'modify_files'] } }),
      repoRoot
    );
    assert.equal(report.status, REPORT_STATUS.BLOCKED);
    assert.ok(report.blockers[0].includes('modify_files'));
  });

  test('command requesting only commit capability is BLOCKED', () => {
    const report = executeAcpCommand(
      baseCommand({ authorization: { capabilities: ['commit'] } }),
      repoRoot
    );
    assert.equal(report.status, REPORT_STATUS.BLOCKED);
    assert.ok(report.blockers[0].includes('commit'));
  });

  test('command requesting push capability is BLOCKED', () => {
    const report = executeAcpCommand(
      baseCommand({ authorization: { capabilities: ['push'] } }),
      repoRoot
    );
    assert.equal(report.status, REPORT_STATUS.BLOCKED);
    assert.ok(report.blockers[0].includes('push'));
  });

  test('command requesting run_tests capability is BLOCKED', () => {
    const report = executeAcpCommand(
      baseCommand({ authorization: { capabilities: ['read_only', 'run_tests'] } }),
      repoRoot
    );
    assert.equal(report.status, REPORT_STATUS.BLOCKED);
    assert.ok(report.blockers[0].includes('run_tests'));
  });

  test('command requesting unknown capability is BLOCKED', () => {
    const report = executeAcpCommand(
      baseCommand({ authorization: { capabilities: ['read_only', 'superuser'] } }),
      repoRoot
    );
    assert.equal(report.status, REPORT_STATUS.BLOCKED);
    assert.ok(report.blockers[0].includes('superuser'));
  });

  test('missing authorization.capabilities is FAILED', () => {
    const report = executeAcpCommand(baseCommand({ authorization: {} }), repoRoot);
    assert.equal(report.status, REPORT_STATUS.FAILED);
    assert.ok(report.blockers[0].includes('capabilities'));
  });

  test('missing permitted_paths is BLOCKED', () => {
    const report = executeAcpCommand(
      baseCommand({ constraints: { rules: [] } }),
      repoRoot
    );
    assert.equal(report.status, REPORT_STATUS.BLOCKED);
    assert.ok(report.blockers[0].includes('permitted_paths'));
  });

  test('empty permitted_paths is BLOCKED', () => {
    const report = executeAcpCommand(
      baseCommand({ constraints: { permitted_paths: [] } }),
      repoRoot
    );
    assert.equal(report.status, REPORT_STATUS.BLOCKED);
  });

  test('out-of-scope relative path (index.js) is BLOCKED', () => {
    const report = executeAcpCommand(
      baseCommand({ constraints: { permitted_paths: ['index.js'] } }),
      repoRoot
    );
    assert.equal(report.status, REPORT_STATUS.BLOCKED);
    assert.ok(report.blockers[0].includes('outside'));
  });

  test('repo-root scope "." is BLOCKED', () => {
    const report = executeAcpCommand(
      baseCommand({ constraints: { permitted_paths: ['.'] } }),
      repoRoot
    );
    assert.equal(report.status, REPORT_STATUS.BLOCKED);
  });

  test('absolute path is BLOCKED', () => {
    const report = executeAcpCommand(
      baseCommand({ constraints: { permitted_paths: ['/etc'] } }),
      repoRoot
    );
    assert.equal(report.status, REPORT_STATUS.BLOCKED);
  });

  test('parent-traversal path is BLOCKED', () => {
    const report = executeAcpCommand(
      baseCommand({ constraints: { permitted_paths: ['poc/../../etc'] } }),
      repoRoot
    );
    assert.equal(report.status, REPORT_STATUS.BLOCKED);
  });

  test('structured success report contains all required fields', () => {
    const cmd = baseCommand();
    const report = executeAcpCommand(cmd, repoRoot);
    assert.equal(report.status, REPORT_STATUS.SUCCESS);
    assert.equal(report.request_id, cmd.request_id);
    assert.equal(report.requested_task, cmd.task);
    assert.equal(report.verification, cmd.verification);
    assert.equal(report.execution_performed, 'git status --short --branch (read-only, scoped to permitted_paths)');
    assert.ok(report.result && typeof report.result.output === 'string');
    assert.equal(report.blockers, null);
    assert.ok(report.timestamp);
  });

  test('structured blocked report reports BLOCKED with blockers', () => {
    const cmd = baseCommand({ authorization: { capabilities: ['push'] } });
    const report = executeAcpCommand(cmd, repoRoot);
    assert.equal(report.status, REPORT_STATUS.BLOCKED);
    assert.equal(report.request_id, cmd.request_id);
    assert.ok(Array.isArray(report.blockers));
    assert.ok(report.blockers.length > 0);
    assert.equal(report.result, null);
    assert.equal(report.execution_performed, null);
  });

  test('authorize unit: only read_only is permitted', () => {
    assert.equal(authorize({ authorization: { capabilities: ['read_only'] } }).authorized, true);
    assert.equal(authorize({ authorization: { capabilities: ['modify_files'] } }).authorized, false);
    assert.equal(authorize({ authorization: { capabilities: [] } }).authorized, false);
  });

  test('checkPermittedPaths unit: valid path passes', () => {
    const r = checkPermittedPaths(baseCommand());
    assert.equal(r.ok, true);
    assert.deepEqual(r.validatedPaths, ['poc']);
  });

  test('checkPermittedPaths unit: missing permitted_paths fails', () => {
    const r = checkPermittedPaths(baseCommand({ constraints: {} }));
    assert.equal(r.ok, false);
  });

  test('isPathWithinAllowList: rejects leading-dash option injection', () => {
    assert.equal(acp.isPathWithinAllowList('-f'), false);
  });

  test('buildReport produces a well-formed report object', () => {
    const report = buildReport(
      { request_id: 'r1', task: 'do something', verification: 'check' },
      REPORT_STATUS.SUCCESS,
      'ran op',
      'check',
      { output: 'ok' },
      null
    );
    assert.equal(report.request_id, 'r1');
    assert.equal(report.status, REPORT_STATUS.SUCCESS);
    assert.equal(report.requested_task, 'do something');
    assert.equal(report.verification, 'check');
    assert.deepEqual(report.result, { output: 'ok' });
    assert.equal(report.blockers, null);
  });
});
