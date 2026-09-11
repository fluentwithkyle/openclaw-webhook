const { execSync } = require('child_process');
const path = require('path');

const ALLOWED_PATHS = ['poc/', 'index.js', 'ARCHITECTURE.md', 'AGENTS.md'];
const ALLOWED_CAPABILITIES = ['read_only'];

function validate(command) {
    // 1. Basic validation
    const requiredFields = [
        'protocol_version', 'request_id', 'source', 'target', 'task_type',
        'repository', 'base_branch', 'task', 'constraints', 'authorization',
        'verification', 'reporting'
    ];
    for (const field of requiredFields) {
        if (!command[field]) return { status: 'FAILED', error: `Missing field: ${field}` };
    }

    // 2. Authorization
    if (!command.authorization.capabilities || !Array.isArray(command.authorization.capabilities)) {
        return { status: 'FAILED', error: 'Missing authorization capabilities' };
    }
    for (const cap of command.authorization.capabilities) {
        if (!ALLOWED_CAPABILITIES.includes(cap)) {
            return { status: 'BLOCKED', error: `Unauthorized capability: ${cap}` };
        }
    }

    // 3. Constraints
    if (!command.constraints.permitted_paths || !Array.isArray(command.constraints.permitted_paths)) {
        return { status: 'FAILED', error: 'Missing permitted_paths' };
    }
    for (const p of command.constraints.permitted_paths) {
        if (!ALLOWED_PATHS.some(allowed => p.startsWith(allowed))) {
            return { status: 'BLOCKED', error: `Out of scope path: ${p}` };
        }
    }

    return { status: 'SUCCESS' };
}

function execute(command) {
    try {
        // Enforce capabilities mechanically: ONLY read_only is permitted.
        // Perform one explicitly selected read-only repository operation
        if (command.task === 'inspect-repo') {
            const output = execSync('git status --short --branch', { encoding: 'utf-8' });
            return {
                request_id: command.request_id,
                status: 'SUCCESS',
                task: command.task,
                execution: 'git status --short --branch',
                result: output
            };
        }
        return { request_id: command.request_id, status: 'FAILED', error: 'Unknown task' };
    } catch (err) {
        return { request_id: command.request_id, status: 'FAILED', error: err.message };
    }
}

module.exports = { validate, execute };
