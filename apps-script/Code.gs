const SPREADSHEET_ID = "1wWJXhI2wvO_BQlzvSZRov1deL7FLMMFPlqAV9dDHeqA";
const SHEET_NAME = "LiveOps Data";

function doGet() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  const lastRow = sheet.getLastRow();
  const range = sheet.getRange(1, 1, lastRow, 7);
  return ContentService
    .createTextOutput(JSON.stringify({
      rows: range.getDisplayValues(),
      backgrounds: range.getBackgrounds()
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
