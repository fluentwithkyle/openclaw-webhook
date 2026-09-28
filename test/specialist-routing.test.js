const assert = require('assert');
const {
    CONTROL_PLANE_TOOL,
    MAX_TOOL_ITERATIONS,
    buildControlPlaneCommand,
    routeSpecialistIntent
} = require('../services/deepseek-runtime');

function request(objective, extra = {}) {
    return buildControlPlaneCommand({ operation: 'request_task', objective, ...extra });
}

const review = routeSpecialistIntent('Research the current coordinator behavior');
assert.deepEqual({ lane: review.lane, target: review.target, task_mode: review.task_mode, capabilities: review.capabilities }, {
    lane: 'Gemini Reviewer', target: 'Gemini', task_mode: 'REVIEW', capabilities: ['read_only']
});
assert.equal(request('Review coordinator contract').target, 'Gemini');

const security = routeSpecialistIntent('Audit authentication and credential handling');
assert.equal(security.lane, 'Security Specialist');
assert.equal(security.target, 'Security Specialist');
assert.equal(security.task_mode, 'REVIEW');
assert.deepEqual(security.capabilities, ['read_only']);
assert.throws(() => request('Audit authentication and credential handling'), error => error.code === 'STRATEGIC_ALIGNMENT_BLOCKED');

const utility = routeSpecialistIntent('Format the README documentation');
assert.equal(utility.lane, 'Utility Specialist');
assert.equal(utility.target, 'Utility Specialist');
assert.equal(utility.task_mode, 'REVIEW');
assert.deepEqual(utility.capabilities, ['read_only']);
assert.throws(() => request('Format the README documentation'), error => error.code === 'STRATEGIC_ALIGNMENT_BLOCKED');

const builder = routeSpecialistIntent('Implement a code change');
assert.equal(builder.lane, 'Gemini Builder');
assert.equal(builder.authorization_required, true);
const builderCommand = request('Implement coordinator contract');
assert.equal(builderCommand.target, 'Gemini Builder');
assert.equal(builderCommand.task_mode, 'BUILDER');
assert.deepEqual(builderCommand.authorization.capabilities, ['read_only', 'modify_files', 'run_tests', 'commit', 'push']);
assert.deepEqual(builderCommand.constraints.permitted_paths, ['poc/']);
assert.equal(builderCommand.activation_syntax, '@gemini-cli');
assert.equal(builderCommand.activation_surface, 'workflow_dispatch');

const kilo = routeSpecialistIntent('Implement a code change', { explicit_kilo_failover: true });
assert.equal(kilo.lane, 'Gemini Builder');
const explicitKilo = routeSpecialistIntent('Review a failed execution', { explicit_kilo_failover: true });
assert.equal(explicitKilo.lane, 'Kilo');
assert.equal(explicitKilo.authorization_required, true);

assert.throws(() => request('Do something'), error => error.code === 'STRATEGIC_ALIGNMENT_BLOCKED');
assert.throws(() => request('Review coordinator contract', { parent_request_id: 'deepseek-runtime-parent', target: 'Kilo' }), /not permitted/);
for (const forbidden of ['target', 'capabilities', 'task_mode', 'permitted_paths', 'repository', 'base_branch', 'authorization']) {
    assert.equal(CONTROL_PLANE_TOOL.function.parameters.properties[forbidden], undefined);
}
assert.equal(MAX_TOOL_ITERATIONS, 3);
console.log('PASS: deterministic specialist routing preserves server-derived authority and fails closed');
