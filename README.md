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

The endpoint reads every used column at request time; no spreadsheet data is bundled into the site. Older deployments that only read A:G are supported: the calendar supplements descriptions from the public CSV feed, matching shared values while preserving physical sheet rows and colors. Redeploy the updated `apps-script/Code.gs` to retrieve all columns in a single request.

The planning cycle runs from August through July and is inferred from the current year in `app.js`. The date menu includes last 7/30/60/90 days, upcoming windows, calendar months, and the planning year. Choose Custom range for From and To calendar pickers. Display ranges are inclusive; they do not change the planning year inferred for yearless sheet dates.

The Planning windows group includes Planning year and 6, 8, or 10 full months starting two months before the current month. The remaining 4, 6, or 8 months include the current month. The 8-month planning window is selected by default. Only Current dev and Production are enabled on page opening; Late dev, Planned dev, and Estimated dev start unchecked. For example, in September the 6-month view runs July–December, the 8-month view July–February, and the 10-month view July–April.

Sheet date ranges accept `01.02 - 20.02`, `01.02.27 - 20.02.27`, and `01.02.2027 - 20.02.2027`. Two-digit years mean 2000–2099. Explicit years take precedence over the inferred planning cycle. A year on just one end of the range is also supported, including December–January ranges. Invalid dates are treated as missing dates. Green development cells mark work as done, including historical development dates; any missing production date remains flagged separately.

Columns are matched by their headers: Month, Event, Feature, Development Team, Track, Prod Dates, Dev Dates, and comment. Features sharing a Track share one Schedule row; overlapping bars use separate lanes within that row. Features with no Track get their own row.

The calendar has a single Schedule view. It shows production windows, with yellow bars for features currently in development. Current dev toggles transparent development windows active today. Late dev shows unfinished development whose end date has passed or whose sheet cell is marked red; completed features are excluded. Planned dev toggles future planned development dates entered in the sheet. Estimated dev separately toggles inferred windows, including future work. Only Current dev is enabled initially; all four development layers can be switched independently. When development dates are missing, the estimate starts 30 calendar days before the first production date and lasts 14 days, counting the start day. If production dates are also missing, the first day of the planned month remains the fallback anchor. Estimates remain clearly flagged and never write dates back to the sheet.

Status icons show planned (clock), in progress (gear), done (check), and late or missing dates (exclamation). Missing production dates appear as dashed placeholders in their planned month. Red warnings also identify estimated dates, active development without a sheet status color, and overlapping team assignments. Hover or focus a bar for its status, description, and warnings; click for full details and a link to its exact source cell.

Visible development boxes connect to their matching production boxes with lines in the development status color. Unobstructed boxes on the same lane connect with straight lines. Other lines have rounded bends and route through the gaps between boxes, attaching to the nearest top or bottom edge. Rows fit their bars and routes without unnecessary bottom space, with a small dot at the matching production box. Wider routing gaps provide channels eight pixels apart, with darker strokes and white outlines to distinguish crossings. Routing avoids running within six units of parallel connections where possible. Hovering a feature highlights its two boxes and connection. Estimated development uses dashed connectors; very short connections stay solid for clarity. Connections also work with missing-production placeholders and disappear when either timeline layer or date range hides an endpoint.

Team alerts cover only overlapping development dates between different features assigned to the same team, including estimated development. Production dates do not trigger conflicts. Unassigned features and features marked done (green development or production cells) are excluded from both sides of every overlap. Alerts follow the selected date range. Late features also appear in the alerts dropdown, with the delayed phase and its dates. Development delays are labeled Late dev, including on production bars. Date selection, layer visibility, and status keys share one wrapping control strip that stays pinned while scrolling; all teams and features are included and sorted by team.

Loading retries temporary connection failures up to three times, with a 10-second limit per attempt and 1- and 2-second pauses (up to about 33 seconds for the main request). Optional description loading has a separate 5-second limit. Loading progress, connection failures, access errors, and an empty date range have distinct messages. A failed load provides a Try again button.

## Local preview and checks

Run `node preview.cjs` and open `http://127.0.0.1:4174/`. Run `node --test tests/date-range.test.cjs tests/calendar.test.cjs tests/loading.test.cjs` to check parsing, column mapping, grouping, overlays, estimates, presets, and conflict detection.
