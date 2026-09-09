function checkAbandonedBookings() {
  var spreadsheetId = '1--ScrsFamPAbBDaa6MThpKdl5RkzUTY5anq2K9OEAvo';
  var ss = SpreadsheetApp.openById(spreadsheetId);
  var sheet = ss.getSheetByName('Clients') || ss.getActiveSheet();
  var rows = sheet.getDataRange().getValues();

  var now = new Date();
  var thresholdHours = 0.5;

  for (var i = 1; i < rows.length; i++) {
    var timestampStr = rows[i][0];
    var clientName = rows[i][1];
    var clientEmail = rows[i][2];
    var lineId = rows[i][3];
    var packageSelected = rows[i][4];
    var scheduleStatus = rows[i][7];

    if (scheduleStatus === 'Pending Booking' && timestampStr) {
      var submissionTime = new Date(timestampStr);
      var hoursElapsed = (now - submissionTime) / (1000 * 60 * 60);

      if (hoursElapsed >= thresholdHours) {
        sheet.getRange(i + 1, 8).setValue('Follow-up Needed');

        sendAbandonedAlertToRender(
          clientName,
          clientEmail,
          lineId,
          packageSelected,
          timestampStr,
          hoursElapsed
        );
      }
    }
  }
}


function sendAbandonedAlertToRender(
  name,
  email,
  lineId,
  packageSelected,
  timestamp,
  hours
) {
  var renderUrl = 'https://openclaw-webhook-iz6s.onrender.com/abandoned-alert';

  var payload = {
    name: name,
    email: email,
    lineId: lineId,
    packageSelected: packageSelected,
    timestamp: timestamp,
    hoursElapsed: Math.round(hours * 10) / 10
  };

  UrlFetchApp.fetch(renderUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload)
  });
}