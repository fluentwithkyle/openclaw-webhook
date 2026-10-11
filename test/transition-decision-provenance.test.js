'use strict';
const assert = require('assert');
const crypto = require('crypto');
const {
    PROVENANCE_VERSION,
    PROVENANCE_SOURCE,
    issueDirectorTransitionDecision,
    verifyDirectorTransitionDecision
} = require('../poc/transition-decision-provenance');

const SECRET = 'phase-transition-test-secret';
const BAD_SECRET = 'wrong-secret';

const baseParams = {
    decision: 'Kyle — Director: Approved. Proceed to Phase 4.',
    currentPhase: 'phase-3-autonomous-coordination-loop',
    targetPhase: 'phase-4-autonomous-task-lineage',
    coordinatorTaskId: 'TASK-PHASE4-TRANSITION-BOOTSTRAP-001',
    priorPhaseConvergenceEvidence: 'authoritative-state:phase-3-autonomous-coordination-loop:CONVERGED',
    independentVerificationId: 'TASK-PHASE3-VERIFY-001'
};

let pass = 0;
let fail = 0;

function runTest(name, fn) {
    try {
        fn();
        pass++;
        console.log('PASS: ' + name);
    } catch (err) {
        fail++;
        console.error('FAIL: ' + name + ' - ' + err.message);
    }
}

function runAsync(name, fn) {
    return fn().then(() => {
        pass++;
        console.log('PASS: ' + name);
    }).catch(err => {
        fail++;
        console.error('FAIL: ' + name + ' - ' + err.message);
    });
}

const expectedFields = ['version', 'source', 'decision_id', 'transition_id',
    'transition_evidence_id', 'current_phase', 'target_phase', 'coordinator_task_id',
    'prior_phase_convergence_evidence', 'independent_verification_id', 'decision', 'signature'];

(async () => {

    // =========================================================
    // Issuance tests
    // =========================================================

    runTest('issueDirectorTransitionDecision - returns valid record with all required fields', () => {
        const result = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        assert.equal(result.valid, true);
        assert.ok(result.record, 'Should return a record');
        for (const field of expectedFields) {
            assert.ok(result.record[field] !== undefined, 'Record must have field: ' + field);
        }
    });

    runTest('issueDirectorTransitionDecision - record has correct version and source', () => {
        const result = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        assert.equal(result.record.version, PROVENANCE_VERSION);
        assert.equal(result.record.source, PROVENANCE_SOURCE);
    });

    runTest('issueDirectorTransitionDecision - record has unique decision_id and transition_id', () => {
        const r1 = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const r2 = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        assert.notEqual(r1.record.decision_id, r2.record.decision_id);
        assert.notEqual(r1.record.transition_id, r2.record.transition_id);
    });

    runTest('issueDirectorTransitionDecision - signature is a 64-char hex string (SHA-256 HMAC)', () => {
        const result = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        assert.equal(result.record.signature.length, 64);
        assert.ok(/^[0-9a-f]{64}$/.test(result.record.signature), 'Signature must be hex');
    });

    // =========================================================
    // Fail-closed issuance tests
    // =========================================================

    runTest('issueDirectorTransitionDecision - missing secret throws', () => {
        assert.throws(() => {
            issueDirectorTransitionDecision({ ...baseParams, secret: undefined });
        }, /not configured/);
    });

    runTest('issueDirectorTransitionDecision - empty string secret throws', () => {
        assert.throws(() => {
            issueDirectorTransitionDecision({ ...baseParams, secret: '' });
        }, /not configured/);
    });

    runTest('issueDirectorTransitionDecision - empty decision fails', () => {
        const result = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET, decision: '' });
        assert.equal(result.valid, false);
        assert.equal(result.error, 'Director decision is required');
    });

    runTest('issueDirectorTransitionDecision - missing currentPhase fails', () => {
        const result = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET, currentPhase: undefined });
        assert.equal(result.valid, false);
        assert.equal(result.error, 'Transition decision provenance fields are incomplete');
    });

    runTest('issueDirectorTransitionDecision - missing targetPhase fails', () => {
        const result = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET, targetPhase: undefined });
        assert.equal(result.valid, false);
    });

    runTest('issueDirectorTransitionDecision - missing coordinatorTaskId fails', () => {
        const result = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET, coordinatorTaskId: undefined });
        assert.equal(result.valid, false);
    });

    runTest('issueDirectorTransitionDecision - missing priorPhaseConvergenceEvidence fails', () => {
        const result = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET, priorPhaseConvergenceEvidence: undefined });
        assert.equal(result.valid, false);
    });

    runTest('issueDirectorTransitionDecision - missing independentVerificationId fails', () => {
        const result = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET, independentVerificationId: undefined });
        assert.equal(result.valid, false);
    });

    runTest('issueDirectorTransitionDecision - whitespace-only fields fail', () => {
        const result = issueDirectorTransitionDecision({
            ...baseParams, secret: SECRET,
            currentPhase: '   ',
            targetPhase: 'phase-4',
            coordinatorTaskId: 'TASK-001',
            priorPhaseConvergenceEvidence: 'evidence',
            independentVerificationId: 'VERIFY-001'
        });
        assert.equal(result.valid, false);
        assert.equal(result.error, 'Transition decision provenance fields are incomplete');
    });

    // =========================================================
    // Verification tests
    // =========================================================

    runTest('verifyDirectorTransitionDecision - valid record verifies successfully', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId
        };
        const result = verifyDirectorTransitionDecision(issued.record, expected, SECRET);
        assert.equal(result.valid, true);
    });

    runTest('verifyDirectorTransitionDecision - wrong secret fails (signature mismatch)', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId
        };
        const result = verifyDirectorTransitionDecision(issued.record, expected, BAD_SECRET);
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('signature'), 'Error should mention signature');
    });

    runTest('verifyDirectorTransitionDecision - missing record fails closed', () => {
        const result = verifyDirectorTransitionDecision(null, {}, SECRET);
        assert.equal(result.valid, false);
        assert.equal(result.error, 'Transition decision provenance is missing');
    });

    runTest('verifyDirectorTransitionDecision - undefined record fails closed', () => {
        const result = verifyDirectorTransitionDecision(undefined, {}, SECRET);
        assert.equal(result.valid, false);
    });

    runTest('verifyDirectorTransitionDecision - non-object record fails closed', () => {
        const result = verifyDirectorTransitionDecision('not-an-object', {}, SECRET);
        assert.equal(result.valid, false);
        assert.equal(result.error, 'Transition decision provenance is missing');
    });

    // =========================================================
    // Evidence integrity tests
    // =========================================================

    runTest('verifyDirectorTransitionDecision - missing required field fails closed', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const tampered = { ...issued.record, signature: undefined };
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId
        };
        const result = verifyDirectorTransitionDecision(tampered, expected, SECRET);
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('signature'), 'Should fail on missing signature field');
    });

    runTest('verifyDirectorTransitionDecision - empty required field fails closed', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const tampered = { ...issued.record, decision_id: '' };
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId
        };
        const result = verifyDirectorTransitionDecision(tampered, expected, SECRET);
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('decision_id'), 'Should fail on empty decision_id field');
    });

    runTest('verifyDirectorTransitionDecision - tampered current_phase fails closed', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const tampered = { ...issued.record, current_phase: 'phase-1-observation' };
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId
        };
        const result = verifyDirectorTransitionDecision(tampered, expected, SECRET);
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('does not match'), 'Should fail on current_phase mismatch');
    });

    runTest('verifyDirectorTransitionDecision - tampered decision text fails closed', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, decision: 'Original decision', secret: SECRET });
        const tampered = { ...issued.record, decision: 'Forged decision' };
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId,
            decision: 'Forged decision'
        };
        const result = verifyDirectorTransitionDecision(tampered, expected, SECRET);
        assert.equal(result.valid, false);
    });

    runTest('verifyDirectorTransitionDecision - forged signature fails closed', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const tampered = { ...issued.record, signature: 'a'.repeat(64) };
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId
        };
        const result = verifyDirectorTransitionDecision(tampered, expected, SECRET);
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('signature'), 'Should fail on forged signature');
    });

    runTest('verifyDirectorTransitionDecision - wrong version fails closed', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const tampered = { ...issued.record, version: '2' };
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId
        };
        const result = verifyDirectorTransitionDecision(tampered, expected, SECRET);
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('source/version'), 'Should fail on wrong version');
    });

    runTest('verifyDirectorTransitionDecision - wrong source fails closed', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const tampered = { ...issued.record, source: 'unauthorized_source' };
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId
        };
        const result = verifyDirectorTransitionDecision(tampered, expected, SECRET);
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('source/version'), 'Should fail on wrong source');
    });

    // =========================================================
    // Cross-field consistency tests
    // =========================================================

    runTest('verifyDirectorTransitionDecision - mismatched target_phase fails closed', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: 'phase-9-fake',
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId
        };
        const result = verifyDirectorTransitionDecision(issued.record, expected, SECRET);
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('target_phase'), 'Should fail on target_phase mismatch');
    });

    runTest('verifyDirectorTransitionDecision - mismatched coordinator_task_id fails closed', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: 'TASK-FAKE-999',
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId
        };
        const result = verifyDirectorTransitionDecision(issued.record, expected, SECRET);
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('coordinator_task_id'), 'Should fail on coordinator_task_id mismatch');
    });

    runTest('verifyDirectorTransitionDecision - mismatched transition_id fails closed', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: 'FAKE-TRANSITION-ID',
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId
        };
        const result = verifyDirectorTransitionDecision(issued.record, expected, SECRET);
        assert.equal(result.valid, false);
    });

    runTest('verifyDirectorTransitionDecision - mismatched independent_verification_id fails closed', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: 'FAKE-VERIFICATION-ID'
        };
        const result = verifyDirectorTransitionDecision(issued.record, expected, SECRET);
        assert.equal(result.valid, false);
        assert.ok(result.error.includes('independent_verification_id'), 'Should fail on verification ID mismatch');
    });

    // =========================================================
    // Round-trip and uniqueness tests
    // =========================================================

    runTest('verifyDirectorTransitionDecision - round-trip issue then verify succeeds', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId
        };
        const result = verifyDirectorTransitionDecision(issued.record, expected, SECRET);
        assert.equal(result.valid, true);
        assert.equal(result.record.decision, baseParams.decision);
    });

    runTest('two different decisions with same secret produce different signatures', () => {
        const r1 = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET, decision: 'Decision A' });
        const r2 = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET, decision: 'Decision B' });
        assert.notEqual(r1.record.signature, r2.record.signature);
    });

    runTest('two decisions with different secrets produce different signatures', () => {
        const r1 = issueDirectorTransitionDecision({ ...baseParams, secret: 'secret-A' });
        const r2 = issueDirectorTransitionDecision({ ...baseParams, secret: 'secret-B' });
        assert.notEqual(r1.record.signature, r2.record.signature);
    });

    runTest('signature is deterministic for same record', () => {
        const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
        const expected = {
            current_phase: baseParams.currentPhase,
            target_phase: baseParams.targetPhase,
            coordinator_task_id: baseParams.coordinatorTaskId,
            transition_id: issued.record.transition_id,
            transition_evidence_id: issued.record.transition_evidence_id,
            prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
            independent_verification_id: baseParams.independentVerificationId
        };
        const r1 = verifyDirectorTransitionDecision(issued.record, expected, SECRET);
        const r2 = verifyDirectorTransitionDecision(issued.record, expected, SECRET);
        assert.equal(r1.valid, true);
        assert.equal(r2.valid, true);
    });

    // =========================================================
    // Module exports tests
    // =========================================================

    runTest('PROVENANCE_VERSION is exported and is a string', () => {
        assert.equal(typeof PROVENANCE_VERSION, 'string');
        assert.ok(PROVENANCE_VERSION.length > 0);
    });

    runTest('PROVENANCE_SOURCE is exported and is a string', () => {
        assert.equal(typeof PROVENANCE_SOURCE, 'string');
        assert.ok(PROVENANCE_SOURCE.length > 0);
    });

    await Promise.all([
        runAsync('verifyDirectorTransitionDecision - valid record is idempotent', async () => {
            const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
            const expected = {
                current_phase: baseParams.currentPhase,
                target_phase: baseParams.targetPhase,
                coordinator_task_id: baseParams.coordinatorTaskId,
                transition_id: issued.record.transition_id,
                transition_evidence_id: issued.record.transition_evidence_id,
                prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
                independent_verification_id: baseParams.independentVerificationId
            };
            const r1 = verifyDirectorTransitionDecision(issued.record, expected, SECRET);
            const r2 = verifyDirectorTransitionDecision(issued.record, expected, SECRET);
            assert.equal(r1.valid, true);
            assert.equal(r2.valid, true);
        }),

        runAsync('verifyDirectorTransitionDecision - empty secret fails gracefully', async () => {
            const issued = issueDirectorTransitionDecision({ ...baseParams, secret: SECRET });
            const expected = {
                current_phase: baseParams.currentPhase,
                target_phase: baseParams.targetPhase,
                coordinator_task_id: baseParams.coordinatorTaskId,
                transition_id: issued.record.transition_id,
                transition_evidence_id: issued.record.transition_evidence_id,
                prior_phase_convergence_evidence: baseParams.priorPhaseConvergenceEvidence,
                independent_verification_id: baseParams.independentVerificationId
            };
            const result = verifyDirectorTransitionDecision(issued.record, expected, '');
            assert.equal(result.valid, false);
            assert.ok(result.error, 'Should have an error message');
        })
    ]);

    await new Promise(r => setImmediate(r));

    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    if (fail > 0) process.exitCode = 1;

})();
