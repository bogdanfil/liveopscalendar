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

The planning cycle runs from August through July and is inferred from the current year in `app.js`. Use the From and To date pickers to select an inclusive display range; this does not change the planning year inferred for yearless sheet dates.

Sheet date ranges accept `01.02 - 20.02`, `01.02.27 - 20.02.27`, and `01.02.2027 - 20.02.2027`. Two-digit years mean 2000–2099. Explicit years take precedence over the inferred planning cycle. A year on just one end of the range is also supported, including December–January ranges. Invalid dates are treated as missing dates. Green development cells mark work as done, including historical development dates; any missing production date remains flagged separately.

Schedule shows production windows, with yellow bars for features currently in development. Entries without production dates appear as dashed placeholders in their feature rows, using the planned month where available. Red exclamation icons flag missing development or production dates. Feature details include a link to the feature's cell in column C of the source sheet.
