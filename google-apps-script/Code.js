function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const configuredSecret = PropertiesService.getScriptProperties().getProperty('APPS_SCRIPT_AUTH_SECRET');

    if (!configuredSecret || data.authSecret !== configuredSecret) {
      return jsonResponse({ status: 'error', message: 'Unauthorized' });
    }

    delete data.authSecret;

    const action = data.action;
    let result = {};

    if (action === 'upsert_client') {
      result = upsertClient(data);
    } else if (action === 'get_client') {
      const clientData = getClientByEmailOrLine(data.email, data.lineId);
      result = { 
        status: clientData ? 'success' : 'error', 
        data: clientData, 
        message: clientData ? 'Client found' : 'Client not found' 
      };
    } else if (action === 'get_pending') {
      const pendingRows = getPendingBookings();
      result = { status: 'success', data: pendingRows };
    } else if (action === 'get_template') {
      const templateData = getEmailTemplate(data.templateKey);
      result = { status: 'success', data: templateData };
    } else if (action === 'send_email') {
      sendClientEmail(data);
      result = { status: 'success', message: 'Email sent' };
    } else if (action === 'claim_operation') {
      result = handleClaimOperation(data);
    } else {
      result = { status: 'error', message: 'Unknown action: ' + action };
    }

    return jsonResponse(result);
  } catch (err) {
    return jsonResponse({ status: 'error', message: err.message });
  }
}

function sendClientEmail(data) {
  if (!data.email || !data.subject || !data.htmlBody) return;
  GmailApp.sendEmail(data.email, data.subject, '', { htmlBody: data.htmlBody });
}

var CLAIMS_SHEET_NAME = 'ExecutionClaims';
var CLAIM_STALE_MS = 15 * 60 * 1000;

function getClaimsSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CLAIMS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CLAIMS_SHEET_NAME);
    sheet.appendRow(['request_id', 'execution_claim_id', 'carrier_identity', 'carrier_type', 'claimed_at', 'claim_epoch', 'status', 'updated_at']);
  }
  return sheet;
}

function findClaimRow(requestId) {
  var sheet = getClaimsSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0] && rows[i][0].toString() === requestId.toString()) {
      return { rowIndex: i + 1, row: rows[i] };
    }
  }
  return null;
}

function isClaimRowStale(row) {
  if (!row) return true;
  var claimEpoch = row[5];
  if (!claimEpoch) return true;
  return (Date.now() - Number(claimEpoch)) > CLAIM_STALE_MS;
}

function handleClaimOperation(data) {
  var op = data.operation;
  var requestId = data.request_id;

  if (!op || !requestId) {
    return { status: 'error', message: 'operation and request_id are required' };
  }

  var lock = LockService.getDocumentLock();

  switch (op) {
    case 'acquire_claim':
      return acquireClaim(data, lock);
    case 'get_claim':
      return getClaim(requestId);
    case 'release_claim':
      return releaseClaim(data, lock);
    case 'check_claim':
      return checkClaim(data);
    default:
      return { status: 'error', message: 'Unknown operation: ' + op };
  }
}

function acquireClaim(data, lock) {
  var requestId = data.request_id;
  var carrierIdentity = data.carrier_identity;
  var carrierType = data.carrier_type || 'github_workflow';

  if (!carrierIdentity) {
    return { status: 'error', message: 'carrier_identity is required for acquire_claim' };
  }

  var now = new Date().toISOString();
  var claimEpoch = Date.now();
  var executionClaimId = 'claim-' + claimEpoch + '-' + Math.random().toString(36).slice(2, 10);

  try {
    lock.waitLock(30000);
  } catch (e) {
    return { status: 'error', message: 'Could not acquire LockService within timeout' };
  }

  try {
    var existing = findClaimRow(requestId);

    if (existing) {
      if (existing.row[6] === 'RELEASED') {
        return claimAlreadyClaimed(claimEpoch, executionClaimId, now, requestId, carrierIdentity, carrierType, existing.rowIndex, lock);
      }

      var existingEpoch = Number(existing.row[5]) || 0;
      var age = claimEpoch - existingEpoch;
      if (age < CLAIM_STALE_MS) {
        return {
          status: 'ALREADY_CLAIMED',
          error_code: 'ALREADY_CLAIMED',
          error: 'Task already has an active execution claim',
          existing_claim: {
            request_id: requestId,
            execution_claim_id: existing.row[1],
            carrier_identity: existing.row[2],
            carrier_type: existing.row[3],
            claimed_at: existing.row[4],
            claim_epoch: existing.row[5],
            status: existing.row[6]
          }
        };
      }

      return claimStaleRecovery(requestId, carrierIdentity, carrierType, executionClaimId, now, claimEpoch, existing.rowIndex, existing, lock);
    }

    return createNewClaim(requestId, executionClaimId, carrierIdentity, carrierType, now, claimEpoch, lock);
  } finally {
    lock.releaseLock();
  }
}

function claimAlreadyClaimed(claimEpoch, executionClaimId, now, requestId, carrierIdentity, carrierType, rowIndex, lock) {
  return {
    status: 'ALREADY_CLAIMED',
    error_code: 'ALREADY_CLAIMED',
    error: 'Task was released and cannot be re-claimed',
    existing_claim: {
      request_id: requestId,
      execution_claim_id: null,
      carrier_identity: null,
      status: 'RELEASED'
    }
  };
}

function claimStaleRecovery(requestId, carrierIdentity, carrierType, executionClaimId, now, claimEpoch, rowIndex, existing, lock) {
  var sheet = getClaimsSheet();
  sheet.getRange(rowIndex, 2).setValue(executionClaimId);
  sheet.getRange(rowIndex, 3).setValue(carrierIdentity);
  sheet.getRange(rowIndex, 4).setValue(carrierType);
  sheet.getRange(rowIndex, 5).setValue(now);
  sheet.getRange(rowIndex, 6).setValue(claimEpoch);
  sheet.getRange(rowIndex, 7).setValue('CLAIMED');
  sheet.getRange(rowIndex, 8).setValue(now);

  return {
    status: 'CLAIMED',
    error_code: 'CLAIMED',
    request_id: requestId,
    execution_claim_id: executionClaimId,
    carrier_identity: carrierIdentity,
    carrier_type: carrierType,
    claimed_at: now,
    claim_epoch: claimEpoch,
    recovered_from_stale: true
  };
}

function createNewClaim(requestId, executionClaimId, carrierIdentity, carrierType, now, claimEpoch, lock) {
  var sheet = getClaimsSheet();
  sheet.appendRow([requestId, executionClaimId, carrierIdentity, carrierType, now, claimEpoch, 'CLAIMED', now]);
  return {
    status: 'CLAIMED',
    error_code: 'CLAIMED',
    request_id: requestId,
    execution_claim_id: executionClaimId,
    carrier_identity: carrierIdentity,
    carrier_type: carrierType,
    claimed_at: now,
    claim_epoch: claimEpoch,
    recovered_from_stale: false
  };
}

function getClaim(requestId) {
  var existing = findClaimRow(requestId);
  if (!existing) {
    return { status: 'NOT_FOUND', error_code: 'NOT_FOUND', error: 'No claim found for request_id: ' + requestId };
  }

  if (existing.row[6] === 'RELEASED') {
    return { status: 'RELEASED', error_code: 'NOT_FOUND', error: 'Claim was released for request_id: ' + requestId };
  }

  if (isClaimRowStale(existing.row)) {
    return { status: 'STALE', error_code: 'STALE', error: 'Claim is stale for request_id: ' + requestId,
      claim: {
        request_id: requestId,
        execution_claim_id: existing.row[1],
        carrier_identity: existing.row[2],
        carrier_type: existing.row[3],
        claimed_at: existing.row[4],
        claim_epoch: existing.row[5],
        status: existing.row[6]
      }
    };
  }

  return {
    status: 'CLAIMED',
    error_code: 'CLAIMED',
    claim: {
      request_id: requestId,
      execution_claim_id: existing.row[1],
      carrier_identity: existing.row[2],
      carrier_type: existing.row[3],
      claimed_at: existing.row[4],
      claim_epoch: existing.row[5],
      status: existing.row[6]
    }
  };
}

function releaseClaim(data, lock) {
  var requestId = data.request_id;
  var executionClaimId = data.execution_claim_id;

  try {
    lock.waitLock(30000);
  } catch (e) {
    return { status: 'error', message: 'Could not acquire LockService within timeout' };
  }

  try {
    var existing = findClaimRow(requestId);

    if (!existing) {
      return { status: 'NOT_FOUND', error_code: 'NOT_FOUND', error: 'No claim found for request_id: ' + requestId };
    }

    if (executionClaimId && existing.row[1] && existing.row[1].toString() !== executionClaimId.toString()) {
      return { status: 'error', error_code: 'CLAIM_MISMATCH', message: 'Execution claim ID does not match current claim' };
    }

    var sheet = getClaimsSheet();
    sheet.getRange(existing.rowIndex, 7).setValue('RELEASED');
    sheet.getRange(existing.rowIndex, 8).setValue(new Date().toISOString());

    return { status: 'RELEASED', error_code: 'RELEASED', request_id: requestId };
  } finally {
    lock.releaseLock();
  }
}

function checkClaim(data) {
  var requestId = data.request_id;
  var expectedClaimId = data.execution_claim_id;
  var expectedCarrierIdentity = data.carrier_identity;

  var result = getClaim(requestId);
  if (result.error_code === 'NOT_FOUND' || result.error_code === 'RELEASED') {
    return { status: 'no_claim', has_claim: false };
  }

  if (result.error_code === 'STALE') {
    return { status: 'stale_claim', has_claim: false, claim: result.claim };
  }

  if (result.status !== 'CLAIMED') {
    return { status: 'unknown', has_claim: false };
  }

  var claim = result.claim;
  var valid = true;
  var error_code = 'OK';
  var error = null;

  if (expectedClaimId && claim.execution_claim_id !== expectedClaimId) {
    valid = false;
    error_code = 'EXECUTION_CLAIM_MISMATCH';
    error = 'Expected ' + claim.execution_claim_id + ', got ' + expectedClaimId;
  }

  if (valid && expectedCarrierIdentity && claim.carrier_identity !== expectedCarrierIdentity) {
    valid = false;
    error_code = 'CARRIER_IDENTITY_MISMATCH';
    error = 'Expected ' + claim.carrier_identity + ', got ' + expectedCarrierIdentity;
  }

  return {
    status: valid ? 'valid' : 'conflict',
    has_claim: true,
    valid: valid,
    error_code: error_code,
    error: error,
    claim: {
      request_id: claim.request_id,
      execution_claim_id: claim.execution_claim_id,
      carrier_identity: claim.carrier_identity,
      carrier_type: claim.carrier_type,
      claimed_at: claim.claimed_at,
      claim_epoch: claim.claim_epoch
    }
  };
}
