'use strict';
const assert = require('assert');
const state = require('../docs/ai/strategic-state.json');
const { evaluateStrategicAlignment, evaluateConvergence, validateStrategicState } = require('../poc/strategic-alignment');
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log(`PASS ${name}`); } catch (error) { console.error(`FAIL ${name}: ${error.message}`); process.exitCode = 1; } }
const valid = { roadmap_id: state.roadmap_id, current_phase: state.current_phase, requirement_id: 'phase-0-contract-reconciliation', classification: 'A', expected_advancement: 'reconciled contract', convergence_criterion: 'independent verification of both acceptance criteria' };
function status(proposal) { return evaluateStrategicAlignment(state, proposal).status; }
test('allows only authoritative required work pending Director authorization', () => assert.equal(status(valid), 'ALIGNED_PENDING_AUTHORIZATION'));
test('rejects technically valid off-roadmap optimization', () => assert.equal(status({ ...valid, requirement_id: 'cache', classification: 'C' }), 'BLOCKED'));
test('rejects future-phase work while Phase 0 is unresolved', () => assert.equal(status({ ...valid, requirement_id: 'phase-3-loop', classification: 'D' }), 'BLOCKED'));
test('rejects a self-attested but stale phase', () => assert.equal(status({ ...valid, current_phase: 'phase-3-autonomous-loop' }), 'BLOCKED'));
test('rejects a claim against completed work', () => assert.equal(status({ ...valid, requirement_id: 'phase-1-observation' }), 'BLOCKED'));
test('rejects repeated 4.10-style observation recommendations after 4.1–4.9', () => assert.equal(status({ ...valid, requirement_id: 'increment-4.10-summary', classification: 'C' }), 'BLOCKED'));
test('fails closed for incomplete authoritative state', () => assert.equal(validateStrategicState({ ...state, required_next_work: [] }).status, 'BLOCKED'));
test('fails closed when authoritative roadmap sources conflict', () => assert.equal(validateStrategicState({ ...state, authoritative_sources_agree: false }).status, 'BLOCKED'));
test('fails closed when current phase completion is unavailable', () => assert.equal(validateStrategicState({ ...state, phase_status: '' }).status, 'BLOCKED'));
test('separates recommendation from authorization and execution', () => { const result = evaluateStrategicAlignment(state, valid); assert.equal(result.authorization, 'NOT_GRANTED'); assert.equal(result.execution, 'NOT_STARTED'); });
test('technical completion alone does not establish convergence', () => assert.equal(evaluateConvergence(state, { requirement_id: valid.requirement_id, phase_acceptance_criteria_met: true }).status, 'BLOCKED'));
test('convergence escalates phase transition rather than creating another increment', () => assert.equal(evaluateConvergence(state, { requirement_id: valid.requirement_id, phase_acceptance_criteria_met: true, independent_verification: true }).status, 'CONVERGED_ESCALATE_TRANSITION'));
console.log(`\n${passed} strategic alignment tests passed`);
