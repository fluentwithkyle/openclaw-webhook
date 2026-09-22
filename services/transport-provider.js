const { dispatch: kiloDispatch } = require('../poc/kilo-transport');
const { validate } = require('../poc/acp-engine');
const geminiBuilderTrigger = require('../poc/gemini-builder-trigger');

const TARGET_KILO = 'Kilo';
const TARGET_GEMINI_BUILDER = 'Gemini Builder';

// Dispatcher for Kilo-targeted commands. Defaults to the existing Kilo
// transport and is overridable (e.g. for tests) via setDispatcher.
let kiloDispatcher = kiloDispatch;

function dispatchKilo(command) {
    return kiloDispatcher(command);
}

async function dispatchBuilder(command) {
    // ACP validation remains the authorization boundary (same gate as Kilo transport).
    const v = validate(command);
    if (v.status !== 'SUCCESS') {
        return {
            request_id: command.request_id,
            status: 'BLOCKED',
            error: `Execution blocked: ${v.error}`
        };
    }

    // Credentials are supplied via environment, never from task content.
    const githubToken = process.env.ORCHESTRATOR_GH_TOKEN;
    const builderApiKey = process.env.GEMINI_BUILDER_API_KEY;

    // Map the existing ACP task identity and required execution inputs onto the
    // existing Gemini Builder workflow-dispatch mechanism.
    const taskMode = command.task_mode || 'BUILDER';
    const verification = typeof command.verification === 'string'
        ? command.verification
        : JSON.stringify(command.verification || '');
    const capabilities = (command.authorization && command.authorization.capabilities) || [];
    const permittedPaths = (command.constraints && command.constraints.permitted_paths) || [];

    let result;
    try {
        result = await geminiBuilderTrigger.dispatchGeminiBuilder(
            command.request_id,
            command.task,
            command.repository,
            command.base_branch,
            githubToken,
            verification,
            taskMode,
            capabilities,
            permittedPaths,
            builderApiKey
        );
    } catch (err) {
        return {
            request_id: command.request_id,
            status: 'FAILED',
            error: `Transport error: ${err.message}`
        };
    }

    if (result.success) {
        return {
            request_id: command.request_id,
            status: 'SUCCESS',
            message: result.message,
            invocation_details: { statusCode: result.status_code }
        };
    }

    return {
        request_id: command.request_id,
        status: 'FAILED',
        error: result.error
    };
}

// Target-aware dispatcher. Routes an already-validated ACP command to the
// transport selected by its `target` field:
//   - "Kilo"          -> existing Kilo transport (behavior preserved)
//   - "Gemini Builder"-> existing Gemini Builder workflow-dispatch mechanism
//   - any other/absent -> fail closed (BLOCKED)
function dispatch(command) {
    const target = command && command.target;
    if (target === TARGET_KILO) {
        return dispatchKilo(command);
    }
    if (target === TARGET_GEMINI_BUILDER) {
        return dispatchBuilder(command);
    }
    return Promise.resolve({
        request_id: command && command.request_id,
        status: 'BLOCKED',
        error: `Unsupported or unrecognized target: ${target === undefined ? '(missing)' : String(target)}`
    });
}

function getDispatcher() {
    return dispatch;
}

function setDispatcher(newDispatcher) {
    kiloDispatcher = newDispatcher;
}

module.exports = {
    getDispatcher,
    setDispatcher,
    dispatch,
    TARGET_KILO,
    TARGET_GEMINI_BUILDER
};
