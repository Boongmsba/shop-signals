# How Shop Signals was built

This guide explains how Shop Signals was built and published to [Boongmsba/shop-signals](https://github.com/Boongmsba/shop-signals). It is a public, independent repository. The steps below also show how to repeat the workflow for a future project.

Version 2 adds optional product costs, gross profit, and gross margin to that original project. The version 2 changes and their verification are explained below.

Version 3 adds custom date ranges and comparison periods. Its implementation and a worked example are also documented below; verify its current checks and deployment separately from earlier releases.

## 1. Define a small problem

The starting question was: “Can a small shop understand its sales CSV without setting up a complicated system?”

The first version focuses on a short path:

1. Open the demo or upload sales.
2. Review revenue, units, products, and trends.
3. Read an action card and its supporting evidence.
4. Enter a competitor price if useful.
5. Export the analysis.

Keeping this scope small makes the project easier to run, test, and explain. A database, sign-in, live price collection, and AI-generated advice would each require additional work and were outside this version’s scope.

Version 2 extends the second step: when cost data is available, compare revenue with gross profit and rank products by their gross profit or gross margin. Older CSVs still support the original revenue analysis.

Version 3 lets you choose exactly which dates to investigate and what to compare them with. The browser-only architecture, synthetic demo, and original project scope remain the same.

## 2. Start an independent project

Shop Signals uses newly written source code in its own folder and Git repository. It does not copy `crumbs` or inherit that project’s commit history.

A **fork** is a GitHub repository linked to an existing upstream repository. A **new repository** begins an independent project. Copying another project into a new repository would still be copying its work; removing the fork label would not change its authorship or license obligations.

For this project, the original work is the implementation of the sales dashboard described here. The implementation was AI-assisted. Understand the code and document your own changes before presenting specific technical decisions as your own.

## 3. Choose a simple architecture

The app uses HTML, CSS, and JavaScript modules:

| File | Job | Beginner-friendly way to think about it |
| --- | --- | --- |
| `index.html` | Defines page content and controls | What is on the page |
| `styles.css` | Controls appearance and layout | How the page looks |
| `src/app.mjs` | Handles interaction and renders results | What happens when you click |
| `src/analytics.mjs` | Parses CSV and calculates results | How the numbers are produced |
| `tests/analytics.test.mjs` | Checks calculation and validation behavior | Examples that catch mistakes |
| `data/sample-sales.csv` | Provides synthetic sales | Safe data for trying the app |

The analytics module is separate from the interface so calculations can be tested without opening a browser. The app needs no installed JavaScript libraries or remote API.

## 4. Define and validate the data

The CSV contract requires `date`, `product`, `quantity`, and `unit_price`. `category` and the version 2 `unit_cost` column are optional. Dates must be real calendar dates in 1900 or later; prices and costs are nonnegative USD values with up to two decimal places.

For example:

```csv
date,product,quantity,unit_price,category,unit_cost
2026-10-01,Sourdough Loaf,12,8.50,Bread,3.20
```

That record contributes 12 units, $102.00 in revenue, and $38.40 in supplied product costs. A missing `unit_cost` column or blank cost cell means the cost is unknown. An explicit `0` means the cost is known and is zero. This distinction preserves older CSVs without silently treating their costs as free.

Input checks reject invalid records instead of quietly turning bad values into misleading totals. The supported scope is positive whole-unit sales in USD, with no returns. Files are limited to 2 MiB and 50,000 data rows.

The demo covers 56 days of fictional bakery sales. Synthetic data lets anyone explore the project without publishing a real business’s records.

## 5. Calculate before presenting

The calculation layer groups sales by date and product, adds units and revenue, and ranks products. Revenue is the sum of each row’s `quantity × unit_price`.

Preset date filters use the latest date in the uploaded dataset as their endpoint. For example, a seven-day window ending October 26 includes October 20 through October 26. Version 3 also accepts custom start and end dates; both endpoints are included. Days without records count as zero revenue, so the chart does not silently skip quiet or missing dates.

Action cards connect a rule to evidence from the data. They suggest what to investigate; they do not establish causation or predict a business result. The competitor comparison uses a manually supplied reference price, so it needs no scraping service or secret API key.

Revenue is accumulated in integer cents to avoid floating-point money errors. Average item prices are weighted by quantity. Comparison differences require both windows to fall fully within the imported minimum and maximum dates. Growth percentages also require equal day counts and a positive comparison baseline. Weekday suggestions require at least 14 days of imported date coverage.

Version 2 adds cost calculations to those same selected records. A row contributes `quantity × unit_cost` in product costs, using the cost supplied on that row. If the same product’s cost changes next week, its later sales use the later cost. Aggregation therefore reflects the quantities sold at each cost rather than using one current cost for all historical sales.

Cost and gross profit are reported only when all rows in the relevant aggregate have costs. This rule is checked independently for the selected total and each product. Complete products can show results even when another product’s missing costs prevent a total from being calculated. The coverage label makes missing costs visible.

## 6. Connect the interface

The browser module responds to file uploads, the date form, product ranking choices, price inputs, and export actions. It calls the analytics functions and updates the page. Date edits remain drafts until **Apply dates** succeeds, so the dashboard and export continue to describe the same applied view.

Uploaded data stays in browser memory. Refreshing resets the session. Export downloads a JSON snapshot so you can keep the analysis yourself. This design makes the first version easy to host as static files.

### Version 2: add gross profit step by step

1. **Extend the input format.** Accept optional `unit_cost`, validate it as a nonnegative USD amount with at most two decimal places, and preserve blank or absent costs as unknown. Do not require users to change an older CSV.
2. **Calculate row costs.** Multiply each known unit cost by that row’s quantity. Keep the cost attached to the original row so historical cost changes are respected.
3. **Check coverage before showing totals.** For each product and the selected dataset, check whether every included row has a cost. Show **Cost needed** for incomplete cost and gross-profit aggregates instead of displaying a misleading partial total.
4. **Calculate gross profit and margin.** Subtract total product costs from total revenue. Divide total gross profit by total revenue to get gross margin. Do not average individual product margins; preserve negative gross profit and leave margin undefined when revenue is zero.
5. **Present the result.** Add cost, gross-profit, gross-margin, and coverage information to the summary and product table. Offer revenue, gross-profit, and margin rankings. Put products with unavailable values after products with known values, and recalculate when the date window changes.
6. **Extend the export.** Include the new cost, gross-profit, margin, and coverage values in the JSON analysis totals and products. Keep the existing revenue fields so a revenue-only analysis remains useful.

Here is a small example you can paste into the upload dialog:

```csv
date,product,quantity,unit_price,unit_cost
2026-10-01,Country Loaf,2,7.50,3.00
2026-10-01,Banana Bread,3,5.00,2.00
```

| Calculation | Country Loaf | Banana Bread | Total |
| --- | ---: | ---: | ---: |
| Revenue: quantity × unit price | $15.00 | $15.00 | $30.00 |
| Cost: quantity × unit cost | $6.00 | $6.00 | $12.00 |
| Gross profit: revenue − cost | $9.00 | $9.00 | $18.00 |
| Gross margin: gross profit ÷ revenue | 60% | 60% | 60% |

The total gross margin is `$18 ÷ $30 × 100 = 60%`. This formula also works when the products have different margins and sales volumes; a simple average of their percentages would not.

Now delete the final `2.00` so the Banana Bread row ends with a comma:

```csv
date,product,quantity,unit_price,unit_cost
2026-10-01,Country Loaf,2,7.50,3.00
2026-10-01,Banana Bread,3,5.00,
```

Revenue still totals $30.00. Total cost, gross profit, and margin are withheld because Banana Bread’s cost is unknown. Country Loaf still has complete costs and can show its $6.00 cost, $9.00 gross profit, and 60% margin. Entering `0` for Banana Bread would instead declare a known zero cost and allow complete totals; it must not be used as a substitute for an unknown cost.

Gross profit includes only the product costs you supply. Operating expenses, tax, and fees are not automatically modeled, so the result is not net profit. The demo remains synthetic, and every calculation still runs in the browser.

### Version 3: add custom comparisons step by step

1. **Describe the selected view.** Keep the 7-, 28-, and 56-day presets and all-dates option. Add a custom inclusive start and end date, plus a comparison choice: previous period, custom period, or none.
2. **Resolve the windows.** The previous-period option takes the same number of calendar days immediately before the selected start. A custom comparison uses its own endpoints. Reject reversed dates, invalid dates, and overlapping custom windows; permit unequal lengths.
3. **Check imported coverage.** Compare each window’s endpoints with the file’s earliest and latest dates. A current window outside that span gets an explicit partial-coverage notice. Withhold comparison differences unless both windows fit completely inside the imported span.
4. **Analyze both windows consistently.** Apply the existing revenue and per-aggregate cost rules to each window. Fill dates without records with zero revenue, but leave gross profit unknown when an entire window has no sales records. The date span alone cannot prove that an export contains every sale.
5. **Calculate meaningful differences.** Subtract comparison revenue and gross profit from current values. Gross-profit dollar differences work with known zero or negative baselines. Growth percentages require equal day counts and a positive comparison baseline. Gross-margin change is current margin minus comparison margin, expressed in percentage points, and requires both margins to be known.
6. **Make changes explicit.** Add an **Apply dates** action. Validate before replacing the active view, keep the last valid view after errors, and label each period’s dates and day count. For unequal periods, show a notice and raw totals or dollar differences without growth percentages. Importing a CSV or resetting the demo restores 28 days with previous-period comparison.
7. **Export the applied analysis.** Schema 3 JSON includes the selected view configuration, comparison metadata and results, and the existing revenue, cost, and product analysis. Pending form edits are not exported.
8. **Explain local file opening.** A page opened directly with `file://` shows a help banner with the hosted-app link and local-server guidance. This explains the existing JavaScript-module requirement before a user mistakes an uninitialized page for a broken dashboard.

#### Try a comparison with known answers

Paste this fictional CSV into the upload dialog:

```csv
date,product,quantity,unit_price,unit_cost
2026-11-04,A,2,10.00,6.00
2026-11-06,B,1,10.00,2.00
2026-11-07,A,1,20.00,15.00
2026-11-09,B,2,20.00,5.00
```

Choose a **custom** selected range of **November 7–9, 2026**, choose **previous period**, and click **Apply dates**. The app compares those three days with **November 4–6, 2026**. Both windows fit within the file’s November 4–9 span; November 5 and 8 contribute zero revenue because they have no records.

| Measure | Comparison: Nov 4–6, 3 days | Selected: Nov 7–9, 3 days | Difference |
| --- | ---: | ---: | ---: |
| Revenue | $30.00 | $60.00 | +$30.00 |
| Supplied product costs | $14.00 | $25.00 | +$11.00 |
| Gross profit | $16.00 | $35.00 | +$19.00 |
| Gross margin | 53.3% | 58.3% | +5.0 percentage points |

For the comparison period, costs are `2 × $6 + 1 × $2 = $14`, so gross profit is `$30 − $14 = $16`. For the selected period, costs are `1 × $15 + 2 × $5 = $25`, so gross profit is `$60 − $25 = $35`. The margin difference uses the unrounded ratios: `(35 ÷ 60 − 16 ÷ 30) × 100 = 5` percentage points.

To see unequal periods, keep November 7–9 selected, change the comparison to **custom**, enter November 4–5, and apply. The app labels three days versus two days, shows the unequal-length notice, and withholds growth percentages. These raw totals cover different amounts of time; they are not a daily-rate comparison.

Choose **none** and apply to remove the comparison. To see an empty gap, select November 5–5 and apply: there are no sales records on that date, so revenue is zero and gross profit is unknown. To see partial coverage, switch comparison back to **previous period**, select November 3–6, and apply. The start precedes the file’s first date, so the app flags the coverage and withholds comparison differences.

Finally, change a date without applying it and export. The JSON should still contain the last applied range and its results. If you enter an end before the start or overlapping custom periods, applying should report an error while preserving that same valid view.

## 7. Run and check it locally

Open a terminal inside the `shop-signals` folder:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then visit [http://127.0.0.1:8000](http://127.0.0.1:8000). If port 8000 is already occupied, use another port such as 8001 in both the command and URL. Press `Ctrl+C` in the terminal when finished.

Opening `index.html` directly with `file://` does not run the module-based app. Use the help banner’s hosted-app link or start the local server above.

Run the calculation tests with Node.js 22 or newer:

```bash
node --test
```

Or use `npm test`, which runs the same test command. No `npm install` is needed.

For the browser check, load the demo, switch between date windows, upload `data/sample-sales.csv`, try a malformed file, enter a competitor price, and export the analysis. Confirm that the layout also works in a narrow browser window. For version 2, use the worked examples above, try an older CSV without `unit_cost`, change product rankings, and inspect the exported cost and gross-profit values. Also check explicit zero costs, costs above selling prices, zero-revenue products, and a product with different costs across dates.

For version 3, follow the comparison example above. Check all three comparison modes, equal and unequal periods, overlap and reversed-date rejection, empty gaps, partial coverage, import/reset defaults, and exports while date edits are pending. A negative or zero comparison gross profit should still permit a dollar difference when both windows are fully covered and costs are complete, but not a gross-profit growth percentage.

Version 2 passed automated tests locally. Its browser checks covered historical row costs, weighted margins, partial costs within one product, older CSVs without costs, explicit zero costs, zero-revenue margins, losses, all three product rankings, date-filter coverage changes, invalid cost rejection, sample-file upload, JSON download contents, and desktop/phone layouts. Changing product ranking also preserves an existing competitor-price comparison. An independent review identified an extreme-amount precision case; the engine now rejects monetary values that cannot preserve cents in exported numbers, with regression tests for that boundary.

Version 3 passed all 38 automated tests locally on November 9, 2026. Browser checks covered draft versus applied dates, previous/custom/no comparison, equal and unequal periods, overlap and reversed-date rejection, empty gaps, partial date coverage, missing costs, negative gross-profit baselines, import/reset defaults, and downloaded JSON contents. Phone-width controls fit without page overflow, and the hosted-style preview reported no console warnings or errors. An independent review caught a baseline label that incorrectly blamed the comparison period when only the selected period was incomplete; the corrected display was checked in the browser.

The initial build also covered invalid dates, all four date filters, unsupported date-span recovery, and stale demo requests. For each future change, run the current tests and inspect [GitHub checks and deployments](https://github.com/Boongmsba/shop-signals/actions). These checks cover the tested cases, not every possible input.

## 8. Save the project in Git

Git records local snapshots called commits. GitHub hosts a remote copy of that history.

For a fresh folder that has not yet been initialized, run these commands from the project folder only:

```bash
git init -b main
git status
```

Review the listed files before staging. Include this project’s source, tests, documentation, and synthetic sample data. Exclude personal files, credentials, and real customer data.

```bash
git add .
git commit -m "Build Shop Signals sales dashboard"
```

If this project already has a `.git` directory and commits, skip initialization and the first commit. Use `git status` and `git log --oneline` to see the current state.

## 9. Create a new GitHub repository and push

In GitHub, choose **New repository**, select your account as owner, and name the repository `shop-signals`. Create it empty: leave GitHub’s README, `.gitignore`, and license initialization options unselected because the local project already supplies its files.

For the `Boongmsba` account, connect and push with:

```bash
git remote add origin https://github.com/Boongmsba/shop-signals.git
git push -u origin main
```

Authenticate through your configured GitHub sign-in method if prompted. Do not put a personal access token in a source file or commit it.

If `origin` already exists, inspect it with `git remote -v` rather than adding it again. After pushing, open the repository and check that the files and commit appear. GitHub should show it as an independent repository with no “forked from” relationship.

The equivalent shortcut, used with an already authenticated GitHub CLI, creates the public repository, connects `origin`, and pushes the existing local commit:

```bash
gh repo create Boongmsba/shop-signals --public --source=. --remote=origin --push
```

Run this creation command only when that repository does not already exist. For later changes, commit and push normally.

## 10. Make it viewable and keep improving it

Because the app is static, GitHub Pages can serve the project files. In the repository’s **Settings → Pages**, configure the publishing source for this project. With branch-based publishing, select `main` and the repository root, then save. If a Pages workflow has already been configured, use that workflow instead of creating a second publishing path.

The project address is [https://boongmsba.github.io/shop-signals/](https://boongmsba.github.io/shop-signals/). For this build, GitHub Pages was configured to serve `main` from the repository root; the empty `.nojekyll` file tells Pages to serve the static files directly. In future projects, verify a successful deployment before sharing the live link.

For your next change, create a branch:

```bash
git switch -c codex/my-first-improvement
```

Make one focused improvement, run the tests, and check the browser behavior. Then save and share it:

```bash
git add .
git commit -m "Describe the improvement"
git push -u origin codex/my-first-improvement
```

Open a pull request to `main` in GitHub. Explain what changed, why, and how you checked it. Reviewing a small change is a useful way to practice working on a project you understand.

## Explain it honestly in a portfolio

An accurate starting description is:

> I developed an original, AI-assisted sales dashboard that validates CSV data, calculates revenue and gross profit in the browser, and compares custom date windows. It distinguishes missing costs from known zero costs, checks date coverage, and separates dollar differences from growth percentages and margin changes. The demonstration uses synthetic sales data.

Only add claims about your own decisions, independent implementation, users, or measured impact when you can support them. Before an interview, be ready to walk through one CSV record, explain how the totals are calculated, identify a test that catches a real mistake, and discuss a limitation you would address next.

Good next steps include making the CSV importer support another documented format, adding saved local preferences, or interviewing a shop owner to learn whether the dashboard answers a useful question. Record the work you actually do in commits and the README.
