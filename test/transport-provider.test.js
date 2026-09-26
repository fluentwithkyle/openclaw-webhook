const assert = require('assert');
const {
    getDispatcher,
    setDispatcher,
    dispatch,
    TARGET_KILO,
    TARGET_GEMINI_BUILDER
} = require('../services/transport-provider');
const { dispatch: kiloDispatch } = require('../poc/kilo-transport');
const geminiBuilderTrigger = require('../poc/gemini-builder-trigger');

let passCount = 0;
let failCount = 0;

function assertEqual(actual, expected, msg) {
    if (actual !== expected) {
        throw new Error(`${msg || 'Assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertDeepEqual(actual, expected, msg) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${msg || 'Deep assertion failed'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

async function runTest(name, fn) {
    try {
        await fn();
        console.log(`PASS: ${name}`);
        passCount++;
    } catch (err) {
        console.error(`FAIL: ${name} - ${err.message}`);
        failCount++;
    }
}

const kiloCommand = {
    protocol_version: '0.1',
    request_id: 'kilo-route-1',
    source: 'DeepSeek Coordinator',
    target: 'Kilo',
    task_type: 'implementation',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task: 'kilo-targeted-task',
    task_mode: 'REVIEW',
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only'] },
    verification: 'verify kilo dispatch',
    reporting: 'json',
    originator: 'Kyle',
    natural_language_intent: { source: 'Coordinator', model: 'gpt-4', messages: [] }
};

const builderCommand = {
    protocol_version: '0.1',
    request_id: 'builder-route-1',
    source: 'DeepSeek Coordinator',
    target: 'Gemini Builder',
    task_type: 'implementation',
    repository: 'fluentwithkyle/openclaw-webhook',
    base_branch: 'main',
    task: 'builder-targeted-task',
    task_mode: 'BUILDER',
    constraints: { permitted_paths: ['poc/'] },
    authorization: { capabilities: ['read_only', 'modify_files', 'run_tests', 'commit', 'push'] },
    verification: 'verify builder dispatch',
    reporting: 'json',
    originator: 'Kyle'
};

function restoreEnv() {
    delete process.env.ORCHESTRATOR_GH_TOKEN;
    delete process.env.GEMINI_BUILDER_API_KEY;
}

async function main() {
    restoreEnv();

    // Verification #1 & #2: Kilo target dispatches to existing Kilo transport, behavior preserved
    await runTest('Kilo target dispatches to the existing Kilo transport', async () => {
        let calledWith = null;
        setDispatcher((cmd) => { calledWith = cmd; return { request_id: cmd.request_id, status: 'SUCCESS' }; });
        try {
            const result = await dispatch(kiloCommand);
            assert(calledWith !== null, 'Kilo transport should be invoked for Kilo target');
            assertEqual(calledWith, kiloCommand);
            assertEqual(result.status, 'SUCCESS');
            assertEqual(result.request_id, kiloCommand.request_id);
        } finally {
            setDispatcher(kiloDispatch);
        }
    });

    await runTest('getDispatcher() routes Kilo target to Kilo transport', async () => {
        let calledWith = null;
        setDispatcher((cmd) => { calledWith = cmd; return { status: 'SUCCESS' }; });
        try {
            const result = await getDispatcher()(kiloCommand);
            assert(calledWith !== null, 'getDispatcher should be invoked');
            assertEqual(calledWith.target, TARGET_KILO);
            assertEqual(result.status, 'SUCCESS');
        } finally {
            setDispatcher(kiloDispatch);
        }
    });

    await runTest('setDispatcher overrides the Kilo sub-dispatcher (test seam)', async () => {
        let dispatchedByMock = null;
        const mock = (cmd) => { dispatchedByMock = cmd; return { status: 'SUCCESS' }; };
        setDispatcher(mock);
        try {
            const result = await dispatch(kiloCommand);
            assertEqual(dispatchedByMock, kiloCommand);
            assertEqual(result.status, 'SUCCESS');
        } finally {
            setDispatcher(kiloDispatch);
        }
    });

    // Verification #3 & #4: Gemini Builder target selects existing builder dispatch mechanism with required inputs
    await runTest('Gemini Builder target selects existing builder dispatch mechanism', async () => {
        process.env.ORCHESTRATOR_GH_TOKEN = 'test-gh-token';
        process.env.GEMINI_BUILDER_API_KEY = 'test-builder-key';
        const original = geminiBuilderTrigger.dispatchGeminiBuilder;
        let receivedArgs = null;
        geminiBuilderTrigger.dispatchGeminiBuilder = async function () {
            receivedArgs = Array.from(arguments);
            return { success: true, message: 'Builder workflow dispatch accepted', status_code: 204 };
        };
        try {
            const result = await dispatch(builderCommand);
            assert(receivedArgs !== null, 'builder dispatch should be invoked for Gemini Builder target');
            assertEqual(receivedArgs[0], builderCommand.request_id); // request_id
            assertEqual(receivedArgs[1], builderCommand.task); // task
            assertEqual(receivedArgs[2], builderCommand.repository); // repository
            assertEqual(receivedArgs[3], builderCommand.base_branch); // base_branch
            assertEqual(receivedArgs[4], 'test-gh-token'); // githubToken (env)
            assertEqual(receivedArgs[5], builderCommand.verification); // verification
            assertEqual(receivedArgs[6], 'BUILDER'); // task_mode
            assertDeepEqual(receivedArgs[7], builderCommand.authorization.capabilities); // capabilities
            assertDeepEqual(receivedArgs[8], builderCommand.constraints.permitted_paths); // permitted_paths
            assertEqual(receivedArgs[9], 'test-builder-key'); // builderApiKey (env)
            assertEqual(result.status, 'SUCCESS');
            assertEqual(result.request_id, builderCommand.request_id);
        } finally {
            geminiBuilderTrigger.dispatchGeminiBuilder = original;
            setDispatcher(kiloDispatch);
            restoreEnv();
        }
    });

    // Verification #4 (explicit): Builder dispatch receives all required execution inputs
    await runTest('Builder dispatch receives request_id, task, repository, base_branch, verification, task_mode, capabilities, permitted_paths', async () => {
        process.env.ORCHESTRATOR_GH_TOKEN = 'test-gh-token';
        const original = geminiBuilderTrigger.dispatchGeminiBuilder;
        let received = null;
        geminiBuilderTrigger.dispatchGeminiBuilder = async (requestId, task, repository, baseBranch, githubToken, verification, taskMode, capabilities, permittedPaths) => {
            received = { requestId, task, repository, baseBranch, verification, taskMode, capabilities, permittedPaths };
            return { success: true, message: 'ok', status_code: 204 };
        };
        try {
            await dispatch(builderCommand);
            assert(received, 'should have received builder dispatch args');
            assertEqual(received.requestId, builderCommand.request_id);
            assertEqual(received.task, builderCommand.task);
            assertEqual(received.repository, builderCommand.repository);
            assertEqual(received.baseBranch, builderCommand.base_branch);
            assertEqual(received.verification, builderCommand.verification);
            assertEqual(received.taskMode, 'BUILDER');
            assertDeepEqual(received.capabilities, builderCommand.authorization.capabilities);
            assertDeepEqual(received.permittedPaths, builderCommand.constraints.permitted_paths);
        } finally {
            geminiBuilderTrigger.dispatchGeminiBuilder = original;
            restoreEnv();
        }
    });

    // Verification #5: Unsupported / unrecognized targets fail closed
    await runTest('Unrecognized target fails closed without defaulting to Kilo or Builder', async () => {
        const command = { ...kiloCommand, request_id: 'unrecognized-1', target: 'Gemini' };
        let kiloCalled = false;
        let builderCalled = false;
        setDispatcher(() => { kiloCalled = true; return { status: 'SUCCESS' }; });
        const original = geminiBuilderTrigger.dispatchGeminiBuilder;
        geminiBuilderTrigger.dispatchGeminiBuilder = async () => { builderCalled = true; return { success: true }; };
        try {
            const result = await dispatch(command);
            assertEqual(result.status, 'BLOCKED');
            assert(!kiloCalled, 'Kilo transport must not be invoked for unrecognized target');
            assert(!builderCalled, 'Builder must not be invoked for unrecognized target');
            assert(result.error.includes('Gemini'), 'error should name the rejected target');
        } finally {
            setDispatcher(kiloDispatch);
            geminiBuilderTrigger.dispatchGeminiBuilder = original;
        }
    });

    await runTest('Missing target fails closed', async () => {
        const command = { ...kiloCommand, request_id: 'missing-target-1' };
        delete command.target;
        let kiloCalled = false;
        setDispatcher(() => { kiloCalled = true; return { status: 'SUCCESS' }; });
        try {
            const result = await dispatch(command);
            assertEqual(result.status, 'BLOCKED');
            assert(!kiloCalled, 'Kilo transport must not be invoked for missing target');
            assert(result.error.includes('missing'), 'error should indicate missing target');
        } finally {
            setDispatcher(kiloDispatch);
        }
    });

    // Verification #6: ACP validation remains the authorization boundary
    await runTest('Builder dispatch blocked when ACP validation rejects the command', async () => {
        const invalidCommand = {
            ...builderCommand,
            request_id: 'invalid-auth-1',
            authorization: { capabilities: ['read_only'] } // BUILDER mode requires full capability set
        };
        let builderCalled = false;
        const original = geminiBuilderTrigger.dispatchGeminiBuilder;
        geminiBuilderTrigger.dispatchGeminiBuilder = async () => { builderCalled = true; return { success: true }; };
        try {
            const result = await dispatch(invalidCommand);
            assertEqual(result.status, 'BLOCKED');
            assert(!builderCalled, 'Builder must not be invoked when ACP validation fails');
            assert(result.error.includes('blocked') || result.error.includes('capability'));
        } finally {
            geminiBuilderTrigger.dispatchGeminiBuilder = original;
        }
    });

    // Builder dispatch fails when GitHub token absent (no secrets exposed)
    await runTest('Builder dispatch fails when GitHub token is missing', async () => {
        delete process.env.ORCHESTRATOR_GH_TOKEN;
        const cmd = { ...builderCommand, request_id: 'no-token-1' };
        try {
            const result = await dispatch(cmd);
            assertEqual(result.status, 'FAILED');
            assert(result.error.includes('Missing GitHub token'), 'error should indicate missing token');
            assertEqual(result.diagnostics.stage, 'authentication');
            assertEqual(result.diagnostics.category, 'missing_github_token');
            assert(!result.error.includes('test-gh-token'), 'no token value should be exposed');
        } finally {
            restoreEnv();
        }
    });

    // Builder dispatch failure normalizes to FAILED
    await runTest('Builder dispatchGeminiBuilder failure normalizes to FAILED', async () => {
        process.env.ORCHESTRATOR_GH_TOKEN = 'test-gh-token';
        const original = geminiBuilderTrigger.dispatchGeminiBuilder;
        geminiBuilderTrigger.dispatchGeminiBuilder = async () => ({ success: false, error: 'GitHub API error: 500', status_code: 500 });
        try {
            const result = await dispatch({ ...builderCommand, request_id: 'builder-fail-1' });
            assertEqual(result.status, 'FAILED');
            assert(result.error.includes('GitHub API error'));
            assertEqual(result.diagnostics.status_code, 500);
            assertEqual(result.diagnostics.category, 'dispatch_failed');
            assertEqual(result.request_id, 'builder-fail-1');
        } finally {
            geminiBuilderTrigger.dispatchGeminiBuilder = original;
            restoreEnv();
        }
    });

    console.log(`\n=== Transport Provider Tests: ${passCount} passed, ${failCount} failed ===`);
    if (failCount > 0) process.exit(1);
}

main().catch(console.error);
