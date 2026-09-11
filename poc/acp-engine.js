const { execSync } = require('child_process');
const path = require('path');

const ALLOWED_CAPABILITIES = ['read_only'];
const ALLOWED_BASE_PATH = 'poc/';

function normalizePath(p) {
    // Normalize to: "poc/"
    let normalized = p.replace(/\\/g, '/');
    if (normalized.startsWith('./')) normalized = normalized.substring(2);
    if (!normalized.endsWith('/')) normalized += '/';
    if (normalized.startsWith('/')) normalized = normalized.substring(1);

    // Only allow "poc/"
    if (normalized === 'poc/') return 'poc/';
    return null;
}

function validate(command) {
    // 1. Validate envelope (12 fields)
    const requiredFields = [
        'protocol_version', 'request_id', 'source', 'target', 'task_type',
        'repository', 'base_branch', 'task', 'constraints', 'authorization',
        'verification', 'reporting'
    ];
    for (const field of requiredFields) {
        if (!command[field]) return { status: 'FAILED', error: `Missing field: ${field}` };
    }

    // 2. Authorization: exactly ["read_only"]
    if (!command.authorization.capabilities ||
        !Array.isArray(command.authorization.capabilities) ||
        command.authorization.capabilities.length !== 1 ||
        command.authorization.capabilities[0] !== 'read_only') {
        return { status: 'BLOCKED', error: 'Invalid or missing authorization. Only ["read_only"] allowed.' };
    }

    // 3. Constraints: permitted_paths only `poc/`
    if (!command.constraints.permitted_paths || !Array.isArray(command.constraints.permitted_paths)) {
        return { status: 'FAILED', error: 'Missing permitted_paths' };
    }

    for (const p of command.constraints.permitted_paths) {
        const normalized = normalizePath(p);
        if (normalized !== 'poc/') {
            return { status: 'BLOCKED', error: `Unauthorized path: ${p}` };
        }
    }

    return { status: 'SUCCESS' };
}

function execute(command) {
    // MUST validate again internally to fail closed
    const v = validate(command);
    if (v.status !== 'SUCCESS') {
        return {
            request_id: command.request_id,
            status: 'BLOCKED',
            error: `Execution blocked: ${v.error}`
        };
    }

    try {
        if (command.task === 'inspect-poc-files') {
            // Scoped operation
            const output = execSync('git ls-files poc/', { encoding: 'utf-8' });
            return {
                request_id: command.request_id,
                status: 'SUCCESS',
                task: command.task,
                execution: 'git ls-files poc/',
                result: output
            };
        }
        return { request_id: command.request_id, status: 'FAILED', error: 'Unknown task' };
    } catch (err) {
        return { request_id: command.request_id, status: 'FAILED', error: err.message };
    }
}

module.exports = { validate, execute, normalizePath };
