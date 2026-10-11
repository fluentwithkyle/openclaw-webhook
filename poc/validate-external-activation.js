const fs = require('fs');
const yaml = require('js-yaml');
const { execFileSync } = require('child_process');
const {
    validateExternalActivation,
    buildActivationPayloadForIssueComment,
    buildActivationPayloadForWorkflowDispatch,
    buildBuilderActivationPayload,
    buildKiloActivationPayload
} = require('./external-activation-validator');
const {
    preflightValidateOneClickActivation,
    repairAndRevalidateOneClickCarrier,
    serializeCanonicalTaskArtifact
} = require('./one-click-artifact-validator');

const DESCRIPTOR_OUTPUT_FILE = process.env.EXECUTION_DESCRIPTOR_FILE || 'execution-descriptor.json';

function writeOutput(name, value) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', `${name}=${value}\n`, 'utf8');
}

function fetchWorkflowFromOriginMain(workflowPath, baseBranch) {
    try {
        const output = execFileSync('git', ['show', 'origin/' + baseBranch + ':' + workflowPath], {
            encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe']
        });
        return { ok: true, content: output, source: 'origin/' + baseBranch, ref: 'origin/' + baseBranch };
    } catch (e) {
        return { ok: false, content: null, source: null, ref: null, error: e.message + ' (origin/' + baseBranch + ':' + workflowPath + ')' };
    }
}

function verifyZeroInputWorkflowDispatch(workflowRaw) {
    let parsedWorkflow;
    try {
        parsedWorkflow = yaml.load(workflowRaw);
    } catch (e) {
        return {
            valid: false,
            error: 'Workflow YAML parse failure: ' + e.message,
            error_code: 'YAML_PARSE_FAILED',
            has_workflow_dispatch: false,
            has_required_inputs: false
        };
    }

    if (!parsedWorkflow || typeof parsedWorkflow !== 'object' || !parsedWorkflow.on) {
        return {
            valid: false,
            error: 'Workflow does not declare top-level on: trigger',
            error_code: 'MISSING_TRIGGER',
            has_workflow_dispatch: false,
            has_required_inputs: false
        };
    }

    let triggers = parsedWorkflow.on;
    if (typeof triggers === 'string') {
        triggers = [triggers];
    }
    if (Array.isArray(triggers)) {
        triggers = triggers.filter(t => typeof t === 'string');
    }

    const hasWorkflowDispatch = (typeof triggers === 'object' && !Array.isArray(triggers) && Object.prototype.hasOwnProperty.call(triggers, 'workflow_dispatch')) ||
        (Array.isArray(triggers) && triggers.includes('workflow_dispatch'));

    if (!hasWorkflowDispatch) {
        return {
            valid: false,
            error: 'Workflow does not have workflow_dispatch trigger',
            error_code: 'MISSING_WORKFLOW_DISPATCH',
            has_workflow_dispatch: false,
            has_required_inputs: false
        };
    }

    let wfdConfig = {};
    if (typeof triggers === 'object' && !Array.isArray(triggers) && triggers.workflow_dispatch) {
        wfdConfig = triggers.workflow_dispatch || {};
    }

    let hasRequiredInputs = false;
    if (wfdConfig && typeof wfdConfig === 'object' && wfdConfig.inputs && typeof wfdConfig.inputs === 'object') {
        for (const [inputName, inputDef] of Object.entries(wfdConfig.inputs)) {
            if (inputDef && typeof inputDef === 'object' && inputDef.required === true) {
                hasRequiredInputs = true;
                break;
            }
        }
    }

    if (hasRequiredInputs) {
        return {
            valid: false,
            error: 'Workflow has required workflow_dispatch inputs (not zero-input)',
            error_code: 'HAS_REQUIRED_INPUTS',
            has_workflow_dispatch: true,
            has_required_inputs: true
        };
    }

    return {
        valid: true,
        error: null,
        error_code: null,
        has_workflow_dispatch: true,
        has_required_inputs: false
    };
}

async function main() {
    const command = process.argv[2];
    const params = JSON.parse(process.argv[3]);

    if (command === 'one-click-preflight') {
        const workflowDir = params.workflow_dir || '.github/workflows';
        const requestedTask = params.requested_task || null;
        const persistRepairs = params.persist_repairs === true;
        const targetWorkflow = params.target_workflow || null;
        const preflightResult = preflightValidateOneClickActivation(workflowDir, requestedTask, persistRepairs, targetWorkflow);
        if (!preflightResult.all_valid) {
            console.error('::error::One-click preflight validation failed: not all carriers have valid embedded ACP artifacts');
            for (const [wf, r] of Object.entries(preflightResult.results)) {
                if (!r.valid) {
                    console.error('::error::' + wf + ': ' + (r.error || 'validation failed'));
                }
                if (requestedTask && r.bound === false) {
                    console.error('::error::' + wf + ': task-to-carrier binding failed');
                }
            }
            process.exit(1);
        }
        console.log('::notice::One-click preflight validation passed: all ' + preflightResult.summary.total + ' carriers have valid embedded ACP artifacts' + (preflightResult.summary.repaired > 0 ? ' (' + preflightResult.summary.repaired + ' repaired)' : '') + (preflightResult.summary.persisted > 0 ? ' (' + preflightResult.summary.persisted + ' persisted to disk)' : ''));
        if (process.env.GITHUB_OUTPUT) {
            writeOutput('preflight_passed', 'true');
            writeOutput('preflight_repaired', String(preflightResult.summary.repaired > 0));
            writeOutput('preflight_persisted', String(preflightResult.summary.persisted > 0));
        }
        process.exit(0);
    }

    if (command === 'coordinator-verify') {
        const workflowName = params.workflow_name;
        const requestedTask = params.requested_task;
        const workflowDir = params.workflow_dir || '.github/workflows';
        const baseBranch = params.base_branch || 'main';

        if (!workflowName) {
            console.error('::error::BLOCKED: coordinator-verify requires workflow_name');
            writeOutput('coordinator_status', 'BLOCKED');
            writeOutput('coordinator_ready', 'false');
            process.exit(1);
        }

        if (!requestedTask || !requestedTask.task_name) {
            console.error('::error::BLOCKED: coordinator-verify requires requested_task with task_name');
            writeOutput('coordinator_status', 'BLOCKED');
            writeOutput('coordinator_ready', 'false');
            process.exit(1);
        }

        const workflowPath = workflowDir + '/' + workflowName;

        let workflowRaw;
        let verificationSource = null;
        let verifiedOnMain = false;

        const remoteFetch = fetchWorkflowFromOriginMain(workflowPath, baseBranch);
        if (remoteFetch.ok) {
            workflowRaw = remoteFetch.content;
            verificationSource = remoteFetch.source;
            verifiedOnMain = true;
        } else {
            console.error('::error::BLOCKED: Workflow file not found on origin/' + baseBranch + ': ' + workflowPath + ' (' + remoteFetch.error + ')');
            writeOutput('coordinator_status', 'BLOCKED');
            writeOutput('coordinator_ready', 'false');
            writeOutput('coordinator_reason', 'Workflow file not found on origin/' + baseBranch);
            writeOutput('verification_source', null);
            writeOutput('verified_on_main', 'false');
            process.exit(1);
        }

        const dispatchCheck = verifyZeroInputWorkflowDispatch(workflowRaw);
        if (!dispatchCheck.valid) {
            console.error('::error::BLOCKED: ' + dispatchCheck.error);
            writeOutput('coordinator_status', 'BLOCKED');
            writeOutput('coordinator_ready', 'false');
            writeOutput('coordinator_reason', dispatchCheck.error_code || 'REGISTRATION_GATE_FAILED');
            process.exit(1);
        }

        const repairResult = repairAndRevalidateOneClickCarrier(workflowRaw, requestedTask);

        if (!repairResult.valid && !repairResult.repaired) {
            console.error('::error::BLOCKED: Embedded carrier artifact is invalid and cannot be automatically repaired: ' + (repairResult.error || 'validation failed'));
            writeOutput('coordinator_status', 'BLOCKED');
            writeOutput('coordinator_ready', 'false');
            writeOutput('coordinator_reason', repairResult.error_code || 'CARRIER_ARTIFACT_INVALID');
            process.exit(1);
        }

        const binding = repairResult.binding;
        if (!binding || !binding.bound) {
            const reason = binding ? binding.reason : 'No binding information available';
            console.error('::error::BLOCKED: Task-to-workflow binding failed: ' + reason);
            writeOutput('coordinator_status', 'BLOCKED');
            writeOutput('coordinator_ready', 'false');
            writeOutput('coordinator_reason', 'Task-to-workflow binding mismatch');
            if (binding && binding.mismatches) {
                writeOutput('binding_mismatches', binding.mismatches.join(','));
            }
            process.exit(1);
        }

        const routesViaCanonicalActivation = /validate-external-activation\.js/i.test(workflowRaw) ||
            /actions\/workflows\/main\.yml\/dispatches/i.test(workflowRaw);

        if (!routesViaCanonicalActivation) {
            console.error('::error::BLOCKED: Workflow does not route through canonical external-activation ingress');
            writeOutput('coordinator_status', 'BLOCKED');
            writeOutput('coordinator_ready', 'false');
            writeOutput('coordinator_reason', 'Non-canonical activation path');
            process.exit(1);
        }

        console.log('::notice::Coordinator verification passed: workflow ' + workflowName + ' contains exact task ' + requestedTask.task_name + ' with zero-input workflow_dispatch and canonical activation (verified ' + verificationSource + ')');
        writeOutput('coordinator_status', 'VERIFIED');
        writeOutput('coordinator_ready', 'true');
        writeOutput('coordinator_reason', 'Exact task binding verified on ' + verificationSource);
        writeOutput('verification_source', verificationSource);
        writeOutput('verified_on_main', String(verifiedOnMain));
        if (repairResult.repaired) {
            writeOutput('carrier_repaired', 'true');
        }
        process.exit(0);
    }

    if (command === 'serialize-carrier') {
        if (!params.task || typeof params.task !== 'object') {
            console.error('::error::serialize-carrier requires params.task object');
            process.exit(1);
        }
        const serialized = serializeCanonicalTaskArtifact(params.task);
        console.log(serialized);
        process.exit(0);
    }

    const callbackUrl = process.env.CALLBACK_BASE_URL;
    const callbackSecret = process.env.ACP_POC_TRIGGER_SECRET;
    const directorOriginSecret = process.env.DIRECTOR_ORIGIN_SECRET;
    const directorOriginAssertion = process.env.DIRECTOR_ORIGIN_ASSERTION;

    if (!callbackUrl) {
        console.error('::error::Callback URL not configured (CALLBACK_BASE_URL)');
        process.exit(2);
    }

    let payload;
    let targetAgent;

    if (command === 'gemini-issue-comment') {
        payload = buildActivationPayloadForIssueComment(
            params.comment_id,
            params.comment_body,
            params.repository,
            params.base_branch,
            params.approval_id,
            directorOriginSecret,
            directorOriginAssertion
        );
        targetAgent = 'Gemini';
    } else if (command === 'gemini-workflow-dispatch') {
        payload = buildActivationPayloadForWorkflowDispatch(params);
        targetAgent = 'Gemini';
    } else if (command === 'builder-workflow-dispatch') {
        payload = buildBuilderActivationPayload(params);
        targetAgent = 'Gemini Builder';
    } else if (command === 'kilo-workflow-dispatch') {
        payload = buildKiloActivationPayload(params);
        targetAgent = 'Kilo';
    } else {
        console.error(`::error::Unknown activation command: ${command}`);
        process.exit(2);
    }

    if (payload && payload.error) {
        console.error(`::error::BLOCKED: ${payload.error} (${payload.error_code || 'UNKNOWN'})`);
        process.exit(1);
    }

    console.log(`::notice::Validating ${targetAgent} activation through canonical ingress...`);

    const result = await validateExternalActivation(payload, callbackUrl, callbackSecret, directorOriginSecret, directorOriginAssertion);

    if (!result.success) {
        console.error(`::error::BLOCKED: Activation rejected by canonical ingress: ${result.error} (${result.error_code || 'UNKNOWN'})`);
        process.exit(1);
    }

    if (result.activation.replay && result.activation.replay === true) {
        console.log(`::notice::Activation matched existing task (replay/idempotent). Request ID: ${result.request_id}`);
        fs.writeFileSync(DESCRIPTOR_OUTPUT_FILE, JSON.stringify(result.activation, null, 2), 'utf8');
        console.log(`::notice::Replay response written to ${DESCRIPTOR_OUTPUT_FILE}`);
        if (process.env.GITHUB_OUTPUT) {
            writeOutput('replay', 'true');
            writeOutput('request_id', result.request_id);
            writeOutput('execution_claim_id', result.activation.execution_claim_id || '');
            writeOutput('carrier_identity', result.activation.carrier_identity || '');
        }
        process.exit(0);
    }

    if (result.activation.director_approval_required) {
        console.error(`::error::BLOCKED: Consequential activation requires Director approval`);
        process.exit(1);
    }

    console.log(`::notice::Activation accepted by canonical ingress. Request ID: ${result.request_id}`);
    console.log(`::notice::Task status: ${result.activation.task_status}`);

    const descriptor = result.activation.execution_descriptor;
    if (descriptor) {
        fs.writeFileSync(DESCRIPTOR_OUTPUT_FILE, JSON.stringify(descriptor, null, 2), 'utf8');
        console.log(`::notice::Execution descriptor written to ${DESCRIPTOR_OUTPUT_FILE}`);
        if (process.env.GITHUB_OUTPUT) {
            writeOutput('request_id', descriptor.request_id);
            writeOutput('execution_claim_id', descriptor.execution_claim_id || '');
            writeOutput('carrier_identity', result.activation.carrier_identity || '');
            writeOutput('target_agent', descriptor.target_agent || '');
            writeOutput('task_mode', descriptor.task_mode || '');
            writeOutput('task_name', descriptor.task_name || '');
            writeOutput('repository', descriptor.repository || '');
            writeOutput('base_branch', descriptor.base_branch || '');
        }
    } else {
        if (process.env.GITHUB_OUTPUT) {
            writeOutput('request_id', result.activation.request_id || result.request_id || '');
        }
    }
    process.exit(0);
}

main().catch(err => {
    console.error(`::error::Activation validation failed: ${err.message}`);
    process.exit(2);
});
