# Shop Signals

A browser-based sales dashboard that turns a small shop’s CSV into revenue trends, gross profit, product rankings, and practical questions to investigate.

[Open the demo](https://boongmsba.github.io/shop-signals/) · [Read the build guide](docs/BUILD_GUIDE.md) · [View automated checks](https://github.com/Boongmsba/shop-signals/actions/workflows/test.yml)

Shop Signals is an original portfolio project with its own code and Git history. It was built with AI assistance; it does not reuse the `crumbs` source code or claim its contributors’ work.

![Shop Signals dashboard with synthetic bakery data](docs/dashboard.jpg)

## What it does

- Starts with 56 days of synthetic bakery sales so you can explore immediately.
- Accepts an uploaded or pasted sales CSV and validates dates, quantities, prices, and required columns.
- Shows revenue, units sold, top products, and a daily revenue trend.
- Adds product cost, gross profit, and gross margin when optional unit costs are complete for the selected data.
- Shows cost coverage and lets you rank products by revenue, gross profit, or gross margin.
- Filters to all available dates or the latest 7, 28, or 56 calendar days in the dataset.
- Compares revenue with the previous equal-length period when the file reaches the start of that period.
- Offers rule-based action cards backed by the selected sales data.
- Compares a product’s selling price with a competitor price you enter manually.
- Exports the analysis as a JSON file, including revenue and the new cost, gross profit, margin, and coverage fields.

All calculations run in your browser. Uploaded sales and manually entered prices stay in memory for the current page session and reset on refresh. There is no database, account system, analytics service, or external AI API.

## Run locally

You need Python 3 and a modern browser. From this project’s folder, run:

```bash
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000) in your browser. Keep the terminal open while using the app; press `Ctrl+C` to stop the server. Use the local server rather than opening `index.html` directly because the app uses JavaScript modules.

No package installation, API key, or build step is required.

## Bring your own CSV

Use these column names. `category` and `unit_cost` are optional; existing sales CSVs without a cost column still work:

```csv
date,product,quantity,unit_price,category,unit_cost
2026-10-01,Sourdough Loaf,12,8.50,Bread,3.20
2026-10-01,Butter Croissant,20,4.25,Pastry,1.50
2026-10-02,Sourdough Loaf,9,8.50,Bread,3.40
```

| Column | Expected value |
| --- | --- |
| `date` | A valid date in `YYYY-MM-DD` format, year 1900 or later |
| `product` | A nonempty product name |
| `quantity` | A positive whole number of units sold |
| `unit_price` | A nonnegative USD price per unit, with up to two decimal places and no currency symbol |
| `category` | Optional category name |
| `unit_cost` | Optional nonnegative USD cost per unit, with up to two decimal places and no currency symbol. Blank or absent means unknown; `0` is a known zero cost. |

The upload limit is 2 MiB and 50,000 data rows. Each row is a sales record, which may summarize multiple units. Revenue is `quantity × unit_price`; a row is not necessarily a customer order. For a ready-to-use example, see [data/sample-sales.csv](data/sample-sales.csv).

## Understand gross profit

Each row uses its own unit cost, so a product can have different costs on different dates. For the selected records:

- **Product cost** = sum of `quantity × unit_cost`.
- **Gross profit** = revenue − product cost.
- **Gross margin** = total gross profit ÷ total revenue × 100.

For example, selling 2 Country Loaves at $7.50 with a $3.00 unit cost and 3 Banana Breads at $5.00 with a $2.00 unit cost produces $30.00 revenue, $12.00 cost, $18.00 gross profit, and a 60% gross margin. Totals use the quantities sold, not a simple average of unit costs or product margins.

Cost, gross profit, and margin are shown for an aggregate only when **every selected sales row in that aggregate has a known cost**. If Banana Bread’s cost in the example is blank, the total revenue remains $30.00, but total cost and gross profit show **Cost needed**. Country Loaf can still show its own results. The coverage label shows how much of the selected data has costs.

Products with unavailable gross profit or margin sort after products with known values. A negative gross profit is valid when supplied costs exceed revenue. Gross margin is undefined when revenue is zero, even if costs are complete. Gross profit reflects only the product costs you supply; operating expenses, tax, and fees are not automatically modeled.

## Check the calculations

With Node.js 22 or newer installed, run:

```bash
npm test
```

Or run the built-in Node test runner directly:

```bash
node --test
```

The 26-test suite checks CSV validation, revenue and cost arithmetic, missing-cost coverage, gross margins, date windows, and numeric limits. It does not require npm dependencies. GitHub Actions also runs it on pushes to `main` and pull requests. When changing the interface, also check the browser flow: load the demo, switch date windows and product rankings, upload CSVs with complete, partial, and absent costs, enter a competitor price, and inspect an exported analysis.

## Project structure

```text
index.html               Page structure and accessible controls
styles.css               Layout, colors, and responsive styles
src/app.mjs              Browser events and dashboard rendering
src/analytics.mjs        CSV parsing, calculations, and action rules
data/sample-sales.csv    Synthetic example data
tests/analytics.test.mjs Calculation and input-validation tests
docs/BUILD_GUIDE.md      Step-by-step explanation and GitHub workflow
```

## What the numbers mean

- Revenue is sales value. Gross profit subtracts the supplied product costs; it is not net profit. Discounts, returns, shipping, operating expenses, tax, and fees are not automatically calculated.
- Prices and costs are interpreted as USD. This version does not convert currencies or support fractional quantities or negative return rows.
- Missing costs stay unknown rather than being treated as zero. Cost coverage and gross profit are recalculated for the selected date window.
- A date without records counts as zero revenue. Missing data and a genuinely quiet day are indistinguishable.
- The all-dates view supports spans up to 100 years. A shorter date filter can be used for wider source files.
- Date windows end on the latest date in the file, not today. This makes historical files useful without changing their dates.
- Action cards use explicit rules. They are prompts for investigation, not forecasts or proof that a change will improve sales.
- Competitor information is entered manually. There is no live scraping or automatic price feed, and product comparability is up to the user.
- The included data is synthetic. Its results do not demonstrate real customer outcomes or business impact.

## Build on it

Read the [step-by-step build guide](docs/BUILD_GUIDE.md) for how the project fits together, how gross profit was added in version 2, how to publish an independent GitHub repository, and how to make your first change. Useful extensions include custom date comparisons, additional CSV formats, and a separate operating-expense view.
