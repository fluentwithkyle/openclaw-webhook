const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { verify, extractRequestId, getChangedFiles, isWithinScope, runGitDiffCheck } = require('../poc/kilo-verifier');

const TMP_DIR = path.join(os.tmpdir(), `kilo-verifier-test-${Date.now()}`);
let originalCwd;

function setup() {
    originalCwd = process.cwd();
    fs.mkdirSync(TMP_DIR, { recursive: true });
    process.chdir(TMP_DIR);
    execGit('init');
    execGit('config user.email "test@test.com"');
    execGit('config user.name "Test"');
    fs.writeFileSync(path.join(TMP_DIR, 'README.md'), '# Test\n');
    execGit('add README.md');
    execGit('commit -m "initial commit"');
}

function teardown() {
    process.chdir(originalCwd);
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch {}
}

function execGit(args) {
    const { execSync } = require('child_process');
    return execSync(`git ${args}`, { cwd: TMP_DIR, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function makeCommit(message, files) {
    for (const [filepath, content] of Object.entries(files)) {
        const fullPath = path.join(TMP_DIR, filepath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
    }
    execGit('add -A');
    execGit(`commit -m "${message}"`);
    return execGit('rev-parse HEAD');
}

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`PASS: ${name}`);
    } catch (err) {
        failed++;
        console.error(`FAIL: ${name} - ${err.message}`);
    }
}

setup();

// === Test: Valid successful delivery ===
test('valid delivery: successful verification with request_id in commit', () => {
    const commit = makeCommit('feat: add test file [request_id:task-001]', { 'poc/test.js': 'console.log("test");' });
    const result = verify({ commit });
    assert.strictEqual(result.status, 'passed');
    assert.strictEqual(result.request_id, 'task-001');
    assert.strictEqual(result.commit, commit);
    assert.ok(result.checks.length > 0);
    assert.ok(result.evidence.length > 0);
    assert.strictEqual(result.blockers.length, 0);
    const scopeCheck = result.checks.find(c => c.check === 'authorized_file_scope');
    assert.strictEqual(scopeCheck.status, 'not_applicable');
});

// === Test: Verification failure (git diff check) ===
test('verification failure: whitespace errors cause failed status', () => {
    execGit('rm -f poc/*') ;
    execGit('add -A');
    execGit('commit -m "feat: whitespace base"');
    const baseCommit = execGit('rev-parse HEAD');
    const badFile = path.join(TMP_DIR, 'poc/bad.js');
    fs.mkdirSync(path.dirname(badFile), { recursive: true });
    fs.writeFileSync(badFile, 'function a( ){\n} \t\n');
    execGit('add -A');
    execGit('commit -m "feat: whitespace test"');
    const headCommit = execGit('rev-parse HEAD');
    const result = verify({ commit: headCommit, baseRef: baseCommit });
    assert.strictEqual(result.status, 'failed');
    const diffCheck = result.checks.find(c => c.check === 'git_diff_check');
    assert.strictEqual(diffCheck.status, 'failed');
});

// === Test: Missing task metadata ===
test('missing metadata: blocked when no commit available', () => {
    const result = verify({ commit: '' });
    assert.strictEqual(result.status, 'blocked');
    assert.ok(result.blockers.length > 0);
    assert.ok(result.blockers.some(b => b.includes('commit')));
    const commitCheck = result.checks.find(c => c.check === 'commit_identification');
    assert.strictEqual(commitCheck.status, 'failed');
});

// === Test: Unauthorized file scope ===
test('scope violation: files outside permitted_paths cause failed status', () => {
    const commit = makeCommit('feat: add index', { 'index.js': 'express();' });
    const result = verify({ commit, permittedPaths: 'poc/' });
    assert.strictEqual(result.status, 'failed');
    const scopeCheck = result.checks.find(c => c.check === 'authorized_file_scope');
    assert.strictEqual(scopeCheck.status, 'failed');
    assert.ok(result.blockers.some(b => b.includes('index.js')));
});

// === Test: Authorized file scope passes ===
test('authorized scope: files within permitted_paths pass', () => {
    const commit = makeCommit('feat: add poc file', { 'poc/inside.js': 'console.log("ok");' });
    const result = verify({ commit, permittedPaths: 'poc/' });
    assert.strictEqual(result.status, 'passed');
    const scopeCheck = result.checks.find(c => c.check === 'authorized_file_scope');
    assert.strictEqual(scopeCheck.status, 'passed');
});

// === Test: Request ID correlation ===
test('request_id correlation: extracts from commit message', () => {
    const commit = makeCommit('feat: task [request_id:abc-123]', { 'poc/req-extracted.js': '' });
    const result = verify({ commit });
    assert.strictEqual(result.request_id, 'abc-123');
    const corrCheck = result.checks.find(c => c.check === 'request_id_correlation');
    assert.strictEqual(corrCheck.status, 'passed');
});

test('request_id correlation: preserves provided request_id', () => {
    const commit = makeCommit('feat: no id in message', { 'poc/req-provided.js': '' });
    const result = verify({ commit, requestId: 'provided-id' });
    assert.strictEqual(result.request_id, 'provided-id');
});

test('request_id correlation: no fabrication when absent', () => {
    const commit = makeCommit('feat: no request id anywhere', { 'poc/req-none.js': '' });
    const result = verify({ commit });
    assert.strictEqual(result.request_id, null);
    const corrCheck = result.checks.find(c => c.check === 'request_id_correlation');
    assert.strictEqual(corrCheck.status, 'missing');
});

// === Test: Idempotency ===
test('idempotency: same commit produces same result', () => {
    const commit = makeCommit('feat: idempotent test', { 'poc/y.js': '' });
    const result1 = verify({ commit });
    const result2 = verify({ commit });
    assert.strictEqual(JSON.stringify(result1), JSON.stringify(result2));
});

test('idempotency: verification key is the commit SHA', () => {
    const commit = makeCommit('feat: idemp key test', { 'poc/z.js': '' });
    const result = verify({ commit });
    const idempCheck = result.checks.find(c => c.check === 'idempotency');
    assert.strictEqual(idempCheck.status, 'passed');
    assert.strictEqual(idempCheck.note, `verification key: ${commit}`);
});

// === Test: extractRequestId function ===
test('extractRequestId: returns request_id from commit message', () => {
    const commit = makeCommit('msg [request_id:extracted-1]', { 'poc/a.js': '' });
    const id = extractRequestId(commit);
    assert.strictEqual(id, 'extracted-1');
});

test('extractRequestId: returns null when no request_id', () => {
    const commit = makeCommit('just a message', { 'poc/b.js': '' });
    const id = extractRequestId(commit);
    assert.strictEqual(id, null);
});

// === Test: isWithinScope function ===
test('isWithinScope: all files within scope', () => {
    const scope = isWithinScope(['poc/a.js', 'poc/b.js'], ['poc/']);
    assert.strictEqual(scope.within, true);
    assert.strictEqual(scope.violations.length, 0);
});

test('isWithinScope: some files outside scope', () => {
    const scope = isWithinScope(['poc/a.js', 'index.js'], ['poc/']);
    assert.strictEqual(scope.within, false);
    assert.deepStrictEqual(scope.violations, ['index.js']);
});

test('isWithinScope: empty permitted_paths means all within scope', () => {
    const scope = isWithinScope(['index.js', 'src/a.js'], []);
    assert.strictEqual(scope.within, true);
});

test('isWithinScope: exact path match', () => {
    const scope = isWithinScope(['poc/'], ['poc/']);
    assert.strictEqual(scope.within, true);
});

// === Test: runGitDiffCheck function ===
test('runGitDiffCheck: no changes returns pass', () => {
    const result = runGitDiffCheck();
    assert.strictEqual(result.pass, true);
});

// === Test: verification result structure ===
test('result structure: contains required fields', () => {
    const commit = makeCommit('feat: structure test', { 'poc/s.js': '' });
    const result = verify({ commit });
    assert.ok(result.request_id !== undefined);
    assert.ok(['passed', 'failed', 'blocked'].includes(result.status));
    assert.ok(result.commit);
    assert.ok(Array.isArray(result.checks));
    assert.ok(Array.isArray(result.evidence));
    assert.ok(Array.isArray(result.blockers));
});

teardown();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
