'use strict';

const MODES = Object.freeze({ YES_NO: 'YES_NO', DECISION: 'DECISION', RESEARCH: 'RESEARCH', STATUS: 'STATUS', TASK: 'TASK', VERIFICATION: 'VERIFICATION' });
const MAX_COMPACT_LINES = 8;
const MAX_COMPACT_BULLETS = 5;

function linesOf(text) { return String(text).replace(/\r\n/g, '\n').split('\n').map(function(line) { return line.trim(); }).filter(Boolean); }
function countBullets(lines) { return lines.filter(function(line) { return /^[-*]\s+/.test(line); }).length; }
function containsMachineDump(text) { return /```(?:json|yaml|xml)?\s*\n|\{\s*\"(?:task_name|request_id|capabilities|permitted_paths)\"\s*:/.test(text); }

function validateHumanOutput(input) {
    const mode = input && input.mode;
    const text = input && input.text;
    if (Object.values(MODES).indexOf(mode) === -1) return { valid: false, error: 'Invalid human output mode' };
    if (typeof text !== 'string' || !text.trim()) return { valid: false, error: 'Human output text is required' };
    const lines = linesOf(text);
    if (containsMachineDump(text) && mode !== MODES.TASK) return { valid: false, error: 'Machine-interface content cannot be emitted in compact human output' };
    if (mode === MODES.YES_NO) {
        if (!/^(Yes|No)\.$/.test(lines[0])) return { valid: false, error: 'YES_NO output must begin with exactly Yes. or No.' };
        if (lines.length > 3) return { valid: false, error: 'YES_NO output is limited to three non-empty lines' };
        return { valid: true, mode: mode, text: text };
    }
    if ([MODES.DECISION, MODES.RESEARCH, MODES.STATUS, MODES.VERIFICATION].indexOf(mode) !== -1) {
        if (lines.length > MAX_COMPACT_LINES) return { valid: false, error: 'Compact human output exceeds the eight-line limit' };
        if (countBullets(lines) > MAX_COMPACT_BULLETS) return { valid: false, error: 'Compact human output exceeds the five-bullet limit' };
    }
    return { valid: true, mode: mode, text: text };
}
module.exports = { MODES: MODES, validateHumanOutput: validateHumanOutput };
