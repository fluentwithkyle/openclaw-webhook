const axios = require('axios');
const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;
const APPS_SCRIPT_AUTH_SECRET = process.env.APPS_SCRIPT_AUTH_SECRET;

var CLAIMS_BACKOFF_MS = 100;

async function triggerAppsScript(payload) {
   if (!APPS_SCRIPT_URL) {
     console.error('[Apps Script ERROR] APPS_SCRIPT_URL is not configured');
     return;
   }

    if (!APPS_SCRIPT_AUTH_SECRET) {
      console.error('[Apps Script ERROR] APPS_SCRIPT_AUTH_SECRET is not configured');
      return;
    }

    const authenticatedPayload = { ...payload, authSecret: APPS_SCRIPT_AUTH_SECRET };

    console.log(`[Apps Script OUTBOUND] Action: ${payload.action}`);
    try {
      const response = await axios.post(APPS_SCRIPT_URL, authenticatedPayload, {
        headers: { 'Content-Type': 'application/json' }
      });
      console.log(`[Apps Script INBOUND] Action: ${payload.action} Status: ${response.status}`);
      return response.data;
    } catch (error) {
      console.error(`[Apps Script ERROR] Action: ${payload.action} Failed:`, error.message);
    }
}

function cleanTaipeiTimestamp(dateInput) {
    if (!dateInput) return '';
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';
    const taipeiDate = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
    const mm = String(taipeiDate.getMonth() + 1).padStart(2, '0');
    const dd = String(taipeiDate.getDate()).padStart(2, '0');
    const yy = String(taipeiDate.getFullYear()).slice(-2);
    const hh = String(taipeiDate.getHours()).padStart(2, '0');
    const min = String(taipeiDate.getMinutes()).padStart(2, '0');
    return `${mm}_${dd}_${yy} ${hh}:${min}`;
}

function cleanEventTitle(title) {
    if (!title) return 'Meeting';
    return title.split('|')[0].trim();
}

async function submitClaimOperation(operation, data) {
    var payload = Object.assign({}, data || {}, {
        action: 'claim_operation',
        operation: operation
    });
    return triggerAppsScript(payload);
}

function normalizeClaimResponse(response) {
    if (!response || typeof response !== 'object') {
        return { status: 'error', error_code: 'STORAGE_ERROR', error: 'No response from Apps Script' };
    }
    if (response.status === 'error' && response.error_code === undefined) {
        return { status: 'error', error_code: 'STORAGE_ERROR', error: response.message || 'Apps Script error' };
    }
    return response;
}


async function acquireClaimViaAppsScript(requestId, claimIdentity) {
    var maxAttempts = 3;
    var lastResult = null;

    for (var attempt = 0; attempt < maxAttempts; attempt++) {
        var carrierId = claimIdentity && claimIdentity.carrier_id ? claimIdentity.carrier_id : null;
        var carrierType = claimIdentity && claimIdentity.carrier_type ? claimIdentity.carrier_type : 'github_workflow';

        var result = normalizeClaimResponse(
            await submitClaimOperation('acquire_claim', {
                request_id: requestId,
                carrier_identity: carrierId,
                carrier_type: carrierType
            })
        );

        if (!result) {
            lastResult = { status: 'error', error_code: 'STORAGE_ERROR', error: 'Apps Script unavailable' };
            if (attempt < maxAttempts - 1) {
                await new Promise(function(resolve) { setTimeout(resolve, CLAIMS_BACKOFF_MS * (attempt + 1)); });
            }
            continue;
        }

        lastResult = result;

        if (result.error_code === 'STORAGE_ERROR' && attempt < maxAttempts - 1) {
            await new Promise(function(resolve) { setTimeout(resolve, CLAIMS_BACKOFF_MS * (attempt + 1)); });
            continue;
        }

        if (result.error_code === 'CLAIMED') {
            return {
                success: true,
                status: 'CLAIMED',
                error_code: 'CLAIMED',
                execution_claim_id: result.execution_claim_id,
                carrier_identity: result.carrier_identity,
                carrier_type: result.carrier_type,
                claimed_at: result.claimed_at,
                claim_epoch: result.claim_epoch,
                recovered_from_stale: result.recovered_from_stale || false,
                backend: 'google_apps_script'
            };
        }

        if (result.error_code === 'ALREADY_CLAIMED') {
            return {
                success: false,
                status: 'ALREADY_CLAIMED',
                error_code: 'ALREADY_CLAIMED',
                error: result.error || 'Task already has an active execution claim',
                existing_claim: result.existing_claim
            };
        }

        return {
            success: false,
            status: result.status || 'FAILED',
            error_code: result.error_code || 'CLAIM_FAILED',
            error: result.error || result.message || 'Claim acquisition failed'
        };
    }

    return lastResult || { status: 'error', error_code: 'STORAGE_ERROR', error: 'Apps Script unavailable after retries' };
}

async function getClaimFromAppsScript(requestId) {
    var result = normalizeClaimResponse(
        await submitClaimOperation('get_claim', { request_id: requestId })
    );

    if (!result) {
        return null;
    }

    if (result.error_code === 'STORAGE_ERROR') {
        return { status: 'error', error_code: 'STORAGE_ERROR', error: result.error };
    }

    if (result.error_code === 'NOT_FOUND' || result.error_code === 'RELEASED') {
        return null;
    }

    if (result.error_code === 'STALE') {
        return result.claim ? Object.assign({}, result.claim, { stale: true }) : null;
    }

    if (result.error_code === 'CLAIMED') {
        return result.claim || null;
    }

    return result.claim || null;
}

async function releaseClaimFromAppsScript(requestId, executionClaimId) {
    var payload = { request_id: requestId };
    if (executionClaimId) {
        payload.execution_claim_id = executionClaimId;
    }

    var result = normalizeClaimResponse(
        await submitClaimOperation('release_claim', payload)
    );

    if (!result) {
        return { success: false, error_code: 'STORAGE_ERROR', error: 'Apps Script unavailable' };
    }

    if (result.error_code === 'RELEASED') {
        return { success: true, status: 'RELEASED', error_code: 'RELEASED' };
    }

    if (result.error_code === 'CLAIM_MISMATCH') {
        return { success: false, error_code: 'CLAIM_MISMATCH', error: result.message };
    }

    return { success: false, error_code: result.error_code || 'RELEASE_FAILED', error: result.error || result.message };
}

function isAppsScriptConfigured() {
    return Boolean(APPS_SCRIPT_URL) && Boolean(APPS_SCRIPT_AUTH_SECRET);
}

function isClaimStale(claimRecord) {
    if (!claimRecord || !claimRecord.claim_epoch) return true;
    var age = Date.now() - Number(claimRecord.claim_epoch);
    return age > (15 * 60 * 1000);
}

module.exports = {
    triggerAppsScript,
    cleanTaipeiTimestamp,
    cleanEventTitle,
    submitClaimOperation,
    normalizeClaimResponse,
    acquireClaimViaAppsScript,
    getClaimFromAppsScript,
    releaseClaimFromAppsScript,
    isAppsScriptConfigured,
    isClaimStale
};
