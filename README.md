# LiveOps Calendar

A dependency-free GitHub Pages dashboard for the `LiveOps Data` Google Sheet tab.

## Publish

1. Put this folder in a GitHub repository.
2. In **Settings → Pages**, choose **Deploy from a branch** and select the branch/folder.
3. Set the source spreadsheet to **Anyone with the link can view** for live values.

## Live cell colors

The public CSV feed does not include cell backgrounds. To load values and colors live without a snapshot:

1. Open [Google Apps Script](https://script.google.com/) and create a project.
2. Paste `apps-script/Code.gs` into the project.
3. Choose **Deploy → New deployment → Web app**.
4. Execute as yourself and allow access to anyone who should see the calendar.
5. Paste the deployed `/exec` URL into `LIVEOPS_DATA_ENDPOINT` in `config.js`.

The endpoint reads the sheet at request time; no spreadsheet data is bundled into the site.

The planning cycle is configured as August 2026 through July 2027 in `app.js`.
