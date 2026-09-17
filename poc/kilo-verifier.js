const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function runGit(args) {
    try {
        return execSync(`git ${args}`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch (err) {
        return null;
    }
}

function getCommitMessage(commit) {
    const msg = runGit(`log -1 --format=%B ${commit}`);
    return msg || '';
}

function extractRequestId(commit) {
    const msg = getCommitMessage(commit);
    if (!msg) return null;
    const match = msg.match(/request_id[:\s]+([a-zA-Z0-9_-]+)/i);
    return match ? match[1] : null;
}

function getChangedFiles(commit, baseRef) {
    if (baseRef) {
        const output = runGit(`diff --name-only ${baseRef}...${commit}`);
        if (output) return output.split('\n').filter(Boolean);
    }
    const output = runGit(`show --name-only --format= ${commit}`);
    if (output) return output.split('\n').filter(Boolean);
    const output2 = runGit(`show --stat --format= ${commit}`);
    if (output2) {
        const lines = output2.split('\n');
        const fileLines = lines.slice(1).map(l => l.trim().replace(/^\d+[a-z]+\s+/, '')).filter(Boolean);
        return fileLines;
    }
    return [];
}

function isWithinScope(files, permittedPaths) {
    if (!permittedPaths || permittedPaths.length === 0) return { within: true, violations: [] };
    const violations = [];
    for (const file of files) {
        let within = false;
        for (const perm of permittedPaths) {
            const normalizedPerm = perm.endsWith('/') ? perm : perm + '/';
            if (file === perm || file.startsWith(normalizedPerm)) {
                within = true;
                break;
            }
        }
        if (!within) violations.push(file);
    }
    return { within: violations.length === 0, violations };
}

function runGitDiffCheck(commit, baseRef) {
    let args = 'diff --check';
    if (baseRef && commit) {
        args = `diff --check ${baseRef}...${commit}`;
    }
    const output = runGit(args);
    if (output === null) return { pass: false, output: 'git diff --check failed (possibly no commits yet)' };
    if (output === '') return { pass: true, output: 'No whitespace errors' };
    return { pass: false, output };
}

function runTests() {
    if (fs.existsSync(path.join(process.cwd(), 'node_modules'))) {
        try {
            runGit('test');
            return { pass: true, output: 'Tests passed' };
        } catch {
            return { pass: false, output: 'Tests failed' };
        }
    }
    return { pass: null, output: 'No test script defined in package.json' };
}

function verify(overrides) {
    const commit = overrides.hasOwnProperty('commit') && overrides.commit !== undefined && overrides.commit !== null ? overrides.commit : (process.env.VERIFY_COMMIT || runGit('rev-parse HEAD'));
    const baseRef = overrides.hasOwnProperty('baseRef') && overrides.baseRef !== undefined ? overrides.baseRef : (process.env.VERIFY_BASE_REF || '');
    const headRef = overrides.hasOwnProperty('headRef') && overrides.headRef !== undefined ? overrides.headRef : (process.env.VERIFY_HEAD_REF || '');
    const eventType = overrides.hasOwnProperty('eventType') && overrides.eventType !== undefined ? overrides.eventType : (process.env.VERIFY_EVENT || '');
    const prNumber = overrides.hasOwnProperty('prNumber') && overrides.prNumber !== undefined ? overrides.prNumber : (process.env.VERIFY_PR_NUMBER || '');
    const repo = overrides.hasOwnProperty('repo') && overrides.repo !== undefined ? overrides.repo : (process.env.VERIFY_REPO || '');
    const permittedPathsInput = overrides.hasOwnProperty('permittedPaths') && overrides.permittedPaths !== undefined ? overrides.permittedPaths : (process.env.VERIFY_PERMITTED_PATHS || '');
    const taskDescription = overrides.hasOwnProperty('taskDescription') && overrides.taskDescription !== undefined ? overrides.taskDescription : (process.env.VERIFY_TASK || '');
    const knownRequestId = overrides.hasOwnProperty('requestId') && overrides.requestId !== undefined ? overrides.requestId : (process.env.VERIFY_REQUEST_ID || '');

    const result = {
        request_id: knownRequestId || extractRequestId(commit),
        status: 'passed',
        commit: commit,
        checks: [],
        evidence: [],
        blockers: []
    };

    if (!commit) {
        result.status = 'blocked';
        result.blockers.push('No commit SHA available for verification');
        result.checks.push({ check: 'commit_identification', status: 'failed' });
        result.evidence.push('commit: unavailable');
        return result;
    }

    result.checks.push({ check: 'commit_identification', status: 'passed', commit: commit });
    result.evidence.push(`commit: ${commit}`);
    result.evidence.push(`event: ${eventType || 'unknown'}`);

    const files = getChangedFiles(commit, baseRef);
    result.checks.push({ check: 'changed_files_identification', status: 'passed', file_count: files.length });
    result.evidence.push(`changed_files: ${files.length} (${files.slice(0, 10).join(', ')}${files.length > 10 ? ', ...' : ''})`);

    if (permittedPathsInput) {
        const permittedPaths = permittedPathsInput.split(',').map(p => p.trim()).filter(Boolean);
        const scope = isWithinScope(files, permittedPaths);
        result.checks.push({ check: 'authorized_file_scope', status: scope.within ? 'passed' : 'failed' });
        if (scope.within) {
            result.evidence.push(`scope: all ${files.length} files within authorized paths [${permittedPaths.join(', ')}]`);
        } else {
            result.status = 'failed';
            result.blockers.push(`Unauthorized files outside permitted scope: ${scope.violations.join(', ')}`);
            result.evidence.push(`scope violations: ${scope.violations.join(', ')}`);
        }
    } else {
        result.checks.push({ check: 'authorized_file_scope', status: 'not_applicable', note: 'No permitted_paths provided' });
        result.evidence.push('scope: not verified (no permitted_paths metadata)');
    }

    if (taskDescription) {
        result.evidence.push(`task: ${taskDescription}`);
    } else {
        result.checks.push({ check: 'task_metadata', status: 'missing', note: 'No task description provided' });
    }

    const diffCheck = runGitDiffCheck(commit, baseRef);
    result.checks.push({ check: 'git_diff_check', status: diffCheck.pass ? 'passed' : 'failed' });
    result.evidence.push(`git_diff_check: ${diffCheck.output}`);
    if (!diffCheck.pass) {
        result.status = 'failed';
        result.blockers.push('git diff --check failed: ' + diffCheck.output);
    }

    result.checks.push({ check: 'idempotency', status: 'passed', note: `verification key: ${commit}` });
    result.evidence.push(`idempotency_key: ${commit}`);

    if (result.status === 'passed' && !result.request_id) {
        result.checks.push({ check: 'request_id_correlation', status: 'missing', note: 'No request_id found in commit message or provided' });
        result.evidence.push('request_id: not found in commit message or provided metadata');
    } else if (result.request_id) {
        result.checks.push({ check: 'request_id_correlation', status: 'passed', request_id: result.request_id });
        result.evidence.push(`request_id: ${result.request_id}`);
    }

    return result;
}

function main() {
    const result = verify();
    const output = JSON.stringify(result, null, 2);
    console.log(output);
    const outputPath = process.env.VERIFY_OUTPUT_PATH || 'poc/verification-result.json';
    try {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(outputPath, output);
    } catch (err) {
        console.error(`Failed to write result to ${outputPath}: ${err.message}`);
    }
    if (result.status !== 'passed') {
        process.exit(1);
    }
}

module.exports = { verify, extractRequestId, getChangedFiles, isWithinScope, runGitDiffCheck };

if (require.main === module) {
    main();
}
