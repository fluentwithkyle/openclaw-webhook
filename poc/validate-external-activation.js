const fs = require('fs');
const {
    validateExternalActivation,
    buildActivationPayloadForIssueComment,
    buildActivationPayloadForWorkflowDispatch,
    buildBuilderActivationPayload,
    buildKiloActivationPayload
} = require('./external-activation-validator');
const { preflightValidateOneClickActivation } = require('./one-click-artifact-validator');

const DESCRIPTOR_OUTPUT_FILE = process.env.EXECUTION_DESCRIPTOR_FILE || 'execution-descriptor.json';

function writeOutput(name, value) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT || '/dev/null', `${name}=${value}\n`, 'utf8');
}

async function main() {
    const command = process.argv[2];
    const params = JSON.parse(process.argv[3]);

    if (command === 'one-click-preflight') {
        const workflowDir = params.workflow_dir || '.github/workflows';
        const requestedTask = params.requested_task || null;
        const preflightResult = preflightValidateOneClickActivation(workflowDir, requestedTask);
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
        console.log('::notice::One-click preflight validation passed: all ' + preflightResult.summary.total + ' carriers have valid embedded ACP artifacts');
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
