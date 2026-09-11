function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const configuredSecret = PropertiesService.getScriptProperties().getProperty('APPS_SCRIPT_AUTH_SECRET');

    if (!configuredSecret || data.authSecret !== configuredSecret) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
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
    } else {
      result = { status: 'error', message: 'Unknown action' };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function sendClientEmail(data) {
  if (!data.email || !data.subject || !data.htmlBody) return;
  GmailApp.sendEmail(data.email, data.subject, '', { htmlBody: data.htmlBody });
}
