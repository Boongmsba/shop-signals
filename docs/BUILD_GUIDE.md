# How Shop Signals was built

This guide explains how Shop Signals was built and published to [Boongmsba/shop-signals](https://github.com/Boongmsba/shop-signals). It is a public, independent repository. The steps below also show how to repeat the workflow for a future project.

Version 2 adds optional product costs, gross profit, and gross margin to that original project. The version 2 changes and their verification are explained below.

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

Date filters use the latest date in the uploaded dataset as their endpoint. For example, a seven-day window ending October 26 includes October 20 through October 26. Days without records count as zero, so the chart does not silently skip quiet or missing dates.

Action cards connect a rule to evidence from the data. They suggest what to investigate; they do not establish causation or predict a business result. The competitor comparison uses a manually supplied reference price, so it needs no scraping service or secret API key.

Revenue is accumulated in integer cents to avoid floating-point money errors. Average item prices are weighted by quantity. Previous-period percentages are shown only when the data reaches the start of the prior window and its revenue is positive. Weekday suggestions require at least 14 days of imported date coverage.

Version 2 adds cost calculations to those same selected records. A row contributes `quantity × unit_cost` in product costs, using the cost supplied on that row. If the same product’s cost changes next week, its later sales use the later cost. Aggregation therefore reflects the quantities sold at each cost rather than using one current cost for all historical sales.

Cost and gross profit are reported only when all rows in the relevant aggregate have costs. This rule is checked independently for the selected total and each product. Complete products can show results even when another product’s missing costs prevent a total from being calculated. The coverage label makes missing costs visible.

## 6. Connect the interface

The browser module responds to file uploads, date filters, product ranking choices, price inputs, and export actions. It calls the analytics functions and updates the page.

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

## 7. Run and check it locally

Open a terminal inside the `shop-signals` folder:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Then visit [http://127.0.0.1:8000](http://127.0.0.1:8000). If port 8000 is already occupied, use another port such as 8001 in both the command and URL. Press `Ctrl+C` in the terminal when finished.

Run the calculation tests with Node.js 22 or newer:

```bash
node --test
```

Or use `npm test`, which runs the same test command. No `npm install` is needed.

For the browser check, load the demo, switch between date windows, upload `data/sample-sales.csv`, try a malformed file, enter a competitor price, and export the analysis. Confirm that the layout also works in a narrow browser window. For version 2, use the worked examples above, try an older CSV without `unit_cost`, change product rankings, and inspect the exported cost and gross-profit values. Also check explicit zero costs, costs above selling prices, zero-revenue products, and a product with different costs across dates.

Version 2 passed 26 automated tests locally. Browser checks covered historical row costs, weighted margins, partial costs within one product, older CSVs without costs, explicit zero costs, zero-revenue margins, losses, all three product rankings, date-filter coverage changes, invalid cost rejection, sample-file upload, JSON download contents, and desktop/phone layouts. Changing product ranking also preserves an existing competitor-price comparison. An independent review identified an extreme-amount precision case; the engine now rejects monetary values that cannot preserve cents in exported numbers, with regression tests for that boundary.

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

> I developed an original, AI-assisted sales dashboard that validates CSV data, calculates revenue and gross profit in the browser, and presents rule-based suggestions with supporting evidence. It distinguishes missing costs from known zero costs and reports gross margin only when the relevant costs are complete. The demonstration uses synthetic sales data.

Only add claims about your own decisions, independent implementation, users, or measured impact when you can support them. Before an interview, be ready to walk through one CSV record, explain how the totals are calculated, identify a test that catches a real mistake, and discuss a limitation you would address next.

Good next steps include adding custom date comparisons, making the CSV importer support another documented format, or interviewing a shop owner to learn whether the dashboard answers a useful question. Record the work you actually do in commits and the README.
