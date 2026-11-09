import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSalesCSV, analyzeSales, comparePrice } from '../src/analytics.mjs';

const header = 'date,product,quantity,unit_price';
const row = (date, quantity = 1, unitPrice = 1, product = 'Bread', unitCost = null) => ({ date, product, quantity, unitPrice, unitCost, category: 'Bakery' });

test('CSV handles BOM, case-insensitive headers, CRLF, escaped quotes, commas, and multiline fields', () => {
  const input = '\uFEFF Date,PRODUCT,quantity,unit_price,category,note\r\n2026-10-01,"Bread, \"\"country\"\"",2,3.50,Bakery,ok\r\n2026-10-02,"Tea\r\nloaf",1,.75,,ok\r\n\r\n';
  const { rows, warnings } = parseSalesCSV(input);
  assert.deepEqual(rows, [
    { date: '2026-10-01', product: 'Bread, "country"', category: 'Bakery', quantity: 2, unitPrice: 3.5, unitCost: null },
    { date: '2026-10-02', product: 'Tea\nloaf', category: 'Uncategorized', quantity: 1, unitPrice: 0.75, unitCost: null },
  ]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /note/);
});

test('CSV rejects missing, duplicate, and empty headers, and files without records', () => {
  assert.throws(() => parseSalesCSV('date,product,quantity\n2026-01-01,Bread,1'), /missing required columns: unit_price/);
  assert.throws(() => parseSalesCSV('date,product,quantity,unit_price,DATE\n2026-01-01,Bread,1,1,x'), /appears more than once/);
  assert.throws(() => parseSalesCSV(`${header},\n2026-01-01,Bread,1,1,x`), /empty column/);
  assert.throws(() => parseSalesCSV(''), /empty/);
  assert.throws(() => parseSalesCSV(header), /no sales records/);
});

test('CSV errors identify malformed row and quote problems', () => {
  assert.throws(() => parseSalesCSV(`${header}\n2026-01-01,Bread,1`), /line 2: expected 4 columns but found 3/);
  assert.throws(() => parseSalesCSV(`${header}\n,,,`), /line 2, date/);
  assert.throws(() => parseSalesCSV(`${header}\n2026-01-01,"Bread,1,1`), /opening quote has no closing quote/);
  assert.throws(() => parseSalesCSV(`${header}\n2026-01-01,Br"ead,1,1`), /inside an unquoted field/);
  assert.throws(() => parseSalesCSV(`${header}\n2026-01-01,"Bread"x,1,1`), /after a closing quote/);
});

test('CSV enforces real dates, positive integer quantities, products, and decimal prices', () => {
  for (const date of ['2026-02-29', '2026-04-31', '10/01/2026', '2026-1-01', '2026-01-01T00:00:00Z']) {
    assert.throws(() => parseSalesCSV(`${header}\n${date},Bread,1,1`), /date|calendar/);
  }
  assert.equal(parseSalesCSV(`${header}\n2024-02-29,Bread,1,0`).rows[0].unitPrice, 0);
  for (const quantity of ['0', '-1', '1.5', 'NaN', '1e2', '9007199254740992']) {
    assert.throws(() => parseSalesCSV(`${header}\n2026-01-01,Bread,${quantity},1`), /quantity/);
  }
  for (const price of ['-1', 'NaN', 'Infinity', '1.001', '$1', '1e2', '']) {
    assert.throws(() => parseSalesCSV(`${header}\n2026-01-01,Bread,1,${price}`), /unit_price/);
  }
  assert.throws(() => parseSalesCSV(`${header}\n2026-01-01,  ,1,1`), /product must not be blank/);
  assert.throws(() => parseSalesCSV(`${header}\n2026-01-01,Bread,9007199254740991,2`), /too large/);
});

test('CSV protects byte and record limits', () => {
  assert.throws(() => parseSalesCSV('a'.repeat(2 * 1024 * 1024 + 1)), /2 MiB/);
  assert.throws(() => parseSalesCSV(`${header}\n${'2026-01-01,Bread,1,1\n'.repeat(50_001)}`), /50,000 sales records/);
});

test('known totals, weighted averages, ranking, shares, and missing dates', () => {
  const result = analyzeSales([
    row('2026-10-01', 3, 0.1, 'Bun'),
    row('2026-10-01', 1, 0.2, 'Bread'),
    row('2026-10-03', 2, 0.29, 'Bun'),
  ]);
  assert.deepEqual(result.totals, { revenue: 1.08, units: 6, records: 3, avgUnitPrice: 0.18, cost: null, grossProfit: null, grossMarginPct: null, costedRecords: 0, missingCostRecords: 3, costedUnits: 0 });
  assert.equal(result.products[0].product, 'Bun');
  assert.equal(result.products[0].revenue, 0.88);
  assert.ok(Math.abs(result.products[0].avgPrice - 0.176) < 1e-12);
  assert.equal(result.products[0].share, 0.88 / 1.08);
  assert.deepEqual(result.series, [
    { date: '2026-10-01', revenue: 0.5, quantity: 4 },
    { date: '2026-10-02', revenue: 0, quantity: 0 },
    { date: '2026-10-03', revenue: 0.58, quantity: 2 },
  ]);
  assert.deepEqual(result.range, { start: '2026-10-01', end: '2026-10-03', days: 3, previousStart: '2026-09-28', previousEnd: '2026-09-30' });
  assert.equal(result.comparisonAvailable, false);
  assert.equal(result.changePct, null);
  assert.equal(result.recommendations.length, 3);
});

test('seven-day window uses latest date and disjoint equal-length previous UTC window over DST', () => {
  const result = analyzeSales([
    row('2026-10-23', 1, 5),
    row('2026-10-24', 1, 10),
    row('2026-10-30', 1, 20),
    row('2026-10-31', 1, 40),
    row('2026-11-06', 1, 50),
  ], 7);
  assert.deepEqual(result.range, { start: '2026-10-31', end: '2026-11-06', days: 7, previousStart: '2026-10-24', previousEnd: '2026-10-30' });
  assert.equal(result.totals.revenue, 90);
  assert.equal(result.previous.revenue, 30);
  assert.equal(result.comparisonAvailable, true);
  assert.equal(result.changePct, 200);
  assert.equal(result.series.length, 7);
  assert.equal(result.series[2].date, '2026-11-02');
});

test('incomplete prior coverage never yields a percent; complete zero baseline also yields null', () => {
  const partial = analyzeSales([row('2026-10-03', 1, 5), row('2026-10-14', 1, 10)], 7);
  assert.equal(partial.previous.revenue, 5);
  assert.equal(partial.comparisonAvailable, false);
  assert.equal(partial.changePct, null);
  const zero = analyzeSales([row('2026-10-01', 1, 0), row('2026-10-14', 1, 10)], 7);
  assert.equal(zero.comparisonAvailable, true);
  assert.equal(zero.previous.revenue, 0);
  assert.equal(zero.changePct, null);
});

test('zero, empty, and tiny datasets stay finite and return three useful suggestions', () => {
  const empty = analyzeSales([]);
  assert.equal(empty.range.days, 0);
  assert.equal(empty.totals.revenue, 0);
  assert.equal(empty.series.length, 0);
  assert.equal(empty.recommendations.length, 3);
  const zero = analyzeSales([row('2026-10-25', 5, 0)], 28);
  assert.equal(zero.series.length, 28);
  assert.equal(zero.products[0].share, 0);
  assert.equal(zero.totals.avgUnitPrice, 0);
  assert.equal(zero.changePct, null);
  assert.equal(zero.recommendations.length, 3);
  assert.doesNotMatch(JSON.stringify(zero), /NaN|Infinity/);
});

test('analysis rejects invalid records, unsafe totals, and unsupported periods', () => {
  assert.throws(() => analyzeSales([row('2026-10-01')], 14), /7, 28, or 56/);
  assert.throws(() => analyzeSales([row('2026-02-29')]), /valid calendar/);
  assert.throws(() => analyzeSales([row('2026-10-01', 0)]), /positive whole/);
  assert.throws(() => analyzeSales([row('2026-10-01', 1, 0.001)]), /2 decimal/);
  assert.throws(() => analyzeSales([row('2026-10-01', 9_007_199_254_740_991, 1)]), /too large/);
});

test('competitor comparison preserves direction and handles zero baseline', () => {
  assert.deepEqual(comparePrice({ avgPrice: 3 }, 2), { difference: 1, percent: 50 });
  assert.deepEqual(comparePrice({ avgPrice: 0.2 }, 0.3), { difference: -0.1, percent: (-0.1 / 0.3) * 100 });
  assert.deepEqual(comparePrice({ avgPrice: 3 }, 0), { difference: 3, percent: null });
  assert.throws(() => comparePrice({ avgPrice: 3 }, -1), /nonnegative/);
  assert.throws(() => comparePrice({ avgPrice: 3 }, '2'), /nonnegative/);
});

test('sample is a complete 56-day synthetic bakery dataset ending 2026-10-25', async () => {
  const text = await readFile(new URL('../data/sample-sales.csv', import.meta.url), 'utf8');
  const { rows } = parseSalesCSV(text);
  const result = analyzeSales(rows);
  assert.equal(result.range.days, 56);
  assert.equal(result.range.start, '2026-08-31');
  assert.equal(result.range.end, '2026-10-25');
  assert.equal(result.products.length, 5);
  assert.equal(result.series.length, 56);
  assert.ok(rows.every((sale) => sale.quantity > 0));
  assert.ok(rows.every((sale) => sale.unitCost !== null));
  assert.equal(result.totals.revenue, 27_471.25);
  assert.equal(result.totals.units, 5993);
  assert.equal(result.totals.cost, 9638.45);
  assert.equal(result.totals.grossProfit, 17_832.80);
  assert.ok(Math.abs(result.totals.grossMarginPct - 64.91441052008918) < 1e-10);
  assert.equal(result.totals.costedRecords, 280);
  assert.equal(result.totals.missingCostRecords, 0);
  assert.equal(result.totals.costedUnits, 5993);
  const fourWeeks = analyzeSales(rows, 28);
  assert.equal(fourWeeks.comparisonAvailable, true);
  assert.equal(fourWeeks.recommendations.length, 3);
  assert.equal(fourWeeks.totals.revenue, 14_147);
  assert.equal(fourWeeks.totals.cost, 5004.60);
  assert.equal(fourWeeks.totals.grossProfit, 9142.40);
  assert.ok(Math.abs(fourWeeks.totals.grossMarginPct - 64.62430197214957) < 1e-10);
  assert.equal(fourWeeks.previous.cost, 4633.85);
  assert.equal(fourWeeks.previous.grossProfit, 8690.40);
  assert.ok(Math.abs(fourWeeks.previous.grossMarginPct - 65.22243278233296) < 1e-10);
  assert.doesNotMatch(JSON.stringify(fourWeeks.recommendations), /no cost information/);
});


test('weekday experiments require actual observed date coverage, not the padded window length', () => {
  const oneDay = analyzeSales([row('2026-10-25', 5, 2)], 28);
  assert.equal(oneDay.range.days, 28);
  assert.equal(oneDay.recommendations[2].title, 'Build a longer baseline');
  assert.match(oneDay.recommendations[2].detail, /Imported dates cover 1 calendar day within this 28-day view/);
  const thirteenDays = analyzeSales([row('2026-10-13'), row('2026-10-25')], 28);
  assert.equal(thirteenDays.recommendations[2].title, 'Build a longer baseline');
  const fourteenDays = analyzeSales([row('2026-10-12'), row('2026-10-25')], 28);
  assert.match(fourteenDays.recommendations[2].title, /^Test a .* feature$/);
  const shortView = analyzeSales([row('2026-09-01'), row('2026-10-25')], 7);
  assert.equal(shortView.recommendations[2].title, 'Build a longer baseline');
  assert.match(shortView.recommendations[2].detail, /cover 7 calendar days/);
});

test('sales date lower bound avoids invalid ISO labels in prior windows', () => {
  for (const date of ['0000-01-01', '0099-12-31', '1899-12-31']) {
    assert.throws(() => parseSalesCSV(`${header}\n${date},Bread,1,1`), /year 1900 or later/);
    assert.throws(() => analyzeSales([row(date)], 56), /year 1900 or later/);
  }
  const earliest = analyzeSales([row('1900-01-01')], 56);
  assert.equal(earliest.range.end, '1900-01-01');
  assert.equal(earliest.range.start, '1899-11-07');
  assert.equal(earliest.range.previousStart, '1899-09-12');
  assert.equal(earliest.range.previousEnd, '1899-11-06');
  assert.ok(earliest.series.every(({ date }) => /^\d{4}-\d{2}-\d{2}$/.test(date)));
});

test('optional CSV costs distinguish old files and blanks from explicit zero costs', () => {
  const legacy = parseSalesCSV(`${header}\n2026-10-01,Bread,2,3.50`);
  assert.equal(legacy.rows[0].unitCost, null);
  assert.deepEqual(legacy.warnings, []);
  const { rows, warnings } = parseSalesCSV(`${header}, UNIT_COST\n2026-10-01,Bread,2,3.50,\n2026-10-02,Bread,1,3.50,"  "\n2026-10-03,Bread,1,3.50,0\n2026-10-04,Bread,1,3.50,.29`);
  assert.deepEqual(rows.map(({ unitCost }) => unitCost), [null, null, 0, 0.29]);
  assert.deepEqual(warnings, []);
  const legacyAnalysis = analyzeSales(legacy.rows);
  assert.equal(legacyAnalysis.totals.revenue, 7);
  assert.equal(legacyAnalysis.totals.cost, null);
  assert.equal(legacyAnalysis.totals.grossProfit, null);
  assert.equal(legacyAnalysis.totals.missingCostRecords, 1);
  const knownZero = analyzeSales([rows[2]]);
  assert.equal(knownZero.totals.cost, 0);
  assert.equal(knownZero.totals.grossProfit, 3.5);
  assert.equal(knownZero.totals.grossMarginPct, 100);
  assert.equal(knownZero.totals.costedRecords, 1);
});

test('invalid nonblank CSV costs reject the import and identify the line and field', () => {
  for (const value of ['-1', 'NaN', 'Infinity', '-Infinity', '1.001', '$1', '1e2', 'unknown', '90071992547409.92']) {
    assert.throws(() => parseSalesCSV(`${header},unit_cost\n2026-10-01,Bread,1,1,0.50\n2026-10-02,Bread,1,1,${value}`), /CSV line 3: unit_cost/);
  }
  assert.throws(() => parseSalesCSV(`${header},unit_cost\n2026-10-01,Bread,9007199254740991,0,2`), /CSV line 2: quantity × unit_cost is too large/);
});

test('gross profit uses exact cents and quantities when unit costs change for the same product', () => {
  const result = analyzeSales([
    row('2026-10-01', 3, 0.29, 'Bun', 0.10),
    row('2026-10-02', 2, 0.45, 'Bun', 0.29),
  ]);
  // Revenue = 3 × .29 + 2 × .45 = 1.77; cost = 3 × .10 + 2 × .29 = .88.
  assert.equal(result.totals.revenue, 1.77);
  assert.equal(result.totals.cost, 0.88);
  assert.equal(result.totals.grossProfit, 0.89);
  assert.ok(Math.abs(result.totals.grossMarginPct - 50.282485875706215) < 1e-10);
  assert.equal(result.totals.costedRecords, 2);
  assert.equal(result.totals.missingCostRecords, 0);
  assert.equal(result.totals.costedUnits, 5);
  const product = result.products[0];
  assert.equal(product.records, 2);
  assert.equal(product.quantity, 5);
  assert.equal(product.cost, 0.88);
  assert.equal(product.grossProfit, 0.89);
  assert.equal(product.grossMarginPct, result.totals.grossMarginPct);
  assert.equal(product.costedRecords, 2);
  assert.equal(product.missingCostRecords, 0);
  assert.equal(product.costedUnits, 5);
});

test('one missing cost suppresses the entire product and total margin, while preserving coverage', () => {
  const result = analyzeSales([
    row('2026-10-01', 2, 3, 'Bread', 1),
    row('2026-10-02', 3, 4, 'Bread'),
  ]);
  for (const aggregate of [result.totals, result.products[0]]) {
    assert.equal(aggregate.revenue, 18);
    assert.equal(aggregate.records, 2);
    assert.equal(aggregate.cost, null);
    assert.equal(aggregate.grossProfit, null);
    assert.equal(aggregate.grossMarginPct, null);
    assert.equal(aggregate.costedRecords, 1);
    assert.equal(aggregate.missingCostRecords, 1);
    assert.equal(aggregate.costedUnits, 2);
  }
});

test('complete product margins remain available when a different product has unknown costs', () => {
  const result = analyzeSales([
    row('2026-10-01', 1, 5, 'Known', 1),
    row('2026-10-01', 2, 3, 'Unknown'),
  ]);
  assert.deepEqual(result.products.map(({ product }) => product), ['Unknown', 'Known']);
  assert.equal(result.totals.revenue, 11);
  assert.equal(result.totals.cost, null);
  assert.equal(result.totals.grossProfit, null);
  assert.equal(result.totals.grossMarginPct, null);
  assert.equal(result.totals.costedRecords, 1);
  assert.equal(result.totals.missingCostRecords, 1);
  assert.equal(result.products[0].grossProfit, null);
  assert.equal(result.products[1].cost, 1);
  assert.equal(result.products[1].grossProfit, 4);
  assert.equal(result.products[1].grossMarginPct, 80);
});

test('current and previous windows independently assess cost coverage', () => {
  const rows = [
    row('2026-09-01', 1, 100, 'Bread'), // Outside both windows: unknown cost has no effect.
    row('2026-10-01', 1, 4, 'Bread'),
    row('2026-10-08', 2, 3, 'Bread', 1),
    row('2026-10-14', 1, 4, 'Bread', 2),
  ];
  const result = analyzeSales(rows, 7);
  assert.equal(result.totals.cost, 4);
  assert.equal(result.totals.grossProfit, 6);
  assert.equal(result.totals.grossMarginPct, 60);
  assert.equal(result.totals.costedRecords, 2);
  assert.equal(result.previous.revenue, 4);
  assert.equal(result.previous.cost, null);
  assert.equal(result.previous.missingCostRecords, 1);
  assert.equal(result.comparisonAvailable, true);
  assert.equal(result.changePct, 150);
  const reversed = analyzeSales(rows.map((sale, i) => ({ ...sale, unitCost: i === 1 ? 2 : null })), 7);
  assert.equal(reversed.previous.cost, 2);
  assert.equal(reversed.previous.grossProfit, 2);
  assert.equal(reversed.previous.grossMarginPct, 50);
  assert.equal(reversed.previous.costedRecords, 1);
  assert.equal(reversed.totals.cost, null);
  assert.equal(reversed.totals.missingCostRecords, 2);
});

test('negative gross profit is preserved; zero revenue and empty windows have no margin percentage', () => {
  const loss = analyzeSales([row('2026-10-01', 3, 2, 'Bread', 3)]);
  assert.equal(loss.totals.revenue, 6);
  assert.equal(loss.totals.cost, 9);
  assert.equal(loss.totals.grossProfit, -3);
  assert.equal(loss.totals.grossMarginPct, -50);
  assert.equal(loss.products[0].grossMarginPct, -50);
  const free = analyzeSales([row('2026-10-01', 2, 0, 'Bread', 1.25)]);
  assert.equal(free.totals.cost, 2.5);
  assert.equal(free.totals.grossProfit, -2.5);
  assert.equal(free.totals.grossMarginPct, null);
  assert.equal(free.products[0].grossMarginPct, null);
  const freeZeroCost = analyzeSales([row('2026-10-01', 1, 0, 'Bread', 0)]);
  assert.equal(freeZeroCost.totals.cost, 0);
  assert.equal(freeZeroCost.totals.grossProfit, 0);
  assert.equal(freeZeroCost.totals.grossMarginPct, null);
  for (const empty of [analyzeSales([]).totals, free.previous]) {
    assert.equal(empty.cost, null);
    assert.equal(empty.grossProfit, null);
    assert.equal(empty.grossMarginPct, null);
    assert.equal(empty.costedRecords, 0);
    assert.equal(empty.missingCostRecords, 0);
    assert.equal(empty.costedUnits, 0);
  }
});

test('direct row costs reject invalid values and unsafe line or aggregate cost totals', () => {
  for (const cost of [-1, NaN, Infinity, '1.00', '', 0.001, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => analyzeSales([row('2026-10-01', 1, 0, 'Bread', cost)]), /unitCost/);
  }
  assert.throws(() => analyzeSales([row('2026-10-01', Number.MAX_SAFE_INTEGER, 0, 'Bread', 2)]), /quantity × unitCost is too large/);
  // Each row cost fits; their combined cost does not. Revenue remains safe.
  const expensiveRows = [row('2026-10-01', 1, 0, 'Bread', 50_000_000_000_000), row('2026-10-02', 1, 0, 'Bread', 50_000_000_000_000)];
  assert.throws(() => analyzeSales(expensiveRows), /Total cost is too large/);
  assert.throws(() => analyzeSales([...expensiveRows, row('2026-10-03')]), /Total cost is too large/);
  const omitted = { date: '2026-10-01', product: 'Bread', quantity: 1, unitPrice: 2 };
  assert.equal(analyzeSales([omitted]).totals.missingCostRecords, 1);
});

test('extreme CSV prices and costs must round-trip from cents to dollar numbers', () => {
  assert.throws(() => parseSalesCSV(`${header}\n2026-10-01,Bread,1,90000000000000.01`), /CSV line 2: unit_price is too large to represent exactly in cents.*smaller dataset or amount/);
  assert.throws(() => parseSalesCSV(`${header},unit_cost\n2026-10-01,Bread,1,0,90000000000000.01`), /CSV line 2: unit_cost is too large to represent exactly in cents.*smaller dataset or amount/);
  const representable = parseSalesCSV(`${header},unit_cost\n2026-10-01,Bread,1,90000000000000.00,90000000000000.00`);
  assert.equal(representable.rows[0].unitPrice, 90_000_000_000_000);
  assert.equal(representable.rows[0].unitCost, 90_000_000_000_000);
});

test('safe integer cent aggregates that lose a cent as dollars are rejected', () => {
  const csv = `${header},unit_cost\n2026-10-01,Bread,1,0,90000000000000.00\n2026-10-02,Bread,1,0,0.01`;
  assert.throws(() => analyzeSales(parseSalesCSV(csv).rows), /Total cost is too large to represent exactly in cents/);
  assert.throws(() => analyzeSales([
    row('2026-10-01', 1, 90_000_000_000_000),
    row('2026-10-02', 1, 0.01),
  ]), /Total revenue is too large to represent exactly in cents/);
  // Individually representable revenue and cost can also yield unrepresentable profit.
  assert.throws(() => analyzeSales([row('2026-10-01', 1, 90_000_000_000_000, 'Bread', 0.01)]), /Total gross profit is too large to represent exactly in cents/);
  assert.throws(() => analyzeSales([row('2026-10-01', 1, 0.01, 'Bread', 90_000_000_000_000)]), /Total gross profit is too large to represent exactly in cents/);
});

test('representable totals still validate cents conversion for each product and calendar day', () => {
  // Total revenue ends in .02 and is representable; product A ends in .01 and is not.
  assert.throws(() => analyzeSales([
    row('2026-10-01', 1, 90_000_000_000_000, 'A'),
    row('2026-10-01', 1, 0.01, 'A'),
    row('2026-10-01', 1, 0.01, 'B'),
  ]), /Product revenue is too large to represent exactly in cents/);
  // The same product total is representable here, but the first day is not.
  assert.throws(() => analyzeSales([
    row('2026-10-01', 1, 90_000_000_000_000, 'A'),
    row('2026-10-01', 1, 0.01, 'A'),
    row('2026-10-02', 1, 0.01, 'A'),
  ]), /Daily revenue is too large to represent exactly in cents/);
  // Incomplete total cost is unavailable; a fully costed product must still be safe.
  assert.throws(() => analyzeSales([
    row('2026-10-01', 1, 0, 'A', 90_000_000_000_000),
    row('2026-10-01', 1, 0, 'A', 0.01),
    row('2026-10-01', 1, 0, 'B'),
  ]), /Product cost is too large to represent exactly in cents/);
});

test('extreme amounts must preserve exact cents in serialized dollar values as well as round-trip arithmetic', () => {
  // At this magnitude .09 becomes .1 as a dollar Number, even though ×100 rounds back.
  assert.throws(() => parseSalesCSV(`${header}\n2026-10-01,Bread,1,90000000000000.09`), /unit_price is too large to represent exactly in cents/);
  assert.throws(() => parseSalesCSV(`${header},unit_cost\n2026-10-01,Bread,1,0,90000000000000.09`), /unit_cost is too large to represent exactly in cents/);
  assert.throws(() => analyzeSales([
    row('2026-10-01', 1, 0, 'Bread', 90_000_000_000_000),
    row('2026-10-02', 1, 0, 'Bread', 0.09),
  ]), /Total cost is too large to represent exactly in cents/);
  assert.throws(() => analyzeSales([
    row('2026-10-01', 1, 90_000_000_000_000),
    row('2026-10-02', 1, 0.09),
  ]), /Total revenue is too large to represent exactly in cents/);
  // Both input amounts serialize exactly, but their negative difference does not.
  assert.throws(() => analyzeSales([row('2026-10-01', 1, 0.03, 'Bread', 90_000_000_000_000.12)]), /Total gross profit is too large to represent exactly in cents/);
});

const comparisonFixture = () => [
  row('2026-11-04', 1, 10, 'Bread', 4),
  row('2026-11-05', 1, 10, 'Bread', 5),
  row('2026-11-06', 1, 10, 'Bread', 5),
  row('2026-11-07', 1, 20, 'Bread', 8),
  row('2026-11-08', 1, 20, 'Bread', 8),
  row('2026-11-09', 1, 20, 'Bread', 9),
];
const customCurrent = { start: '2026-11-07', end: '2026-11-09' };
const customPrevious = { start: '2026-11-04', end: '2026-11-06' };

test('explicit equal-length ranges compare revenue, units, gross profit, and margin with known answers', () => {
  const result = analyzeSales(comparisonFixture(), customCurrent, customPrevious);
  assert.deepEqual(result.range, { start: '2026-11-07', end: '2026-11-09', days: 3, previousStart: '2026-11-04', previousEnd: '2026-11-06' });
  assert.deepEqual(result.dataRange, { start: '2026-11-04', end: '2026-11-09' });
  assert.equal(result.currentCoverageComplete, true);
  assert.equal(result.totals.revenue, 60);
  assert.equal(result.totals.cost, 25);
  assert.equal(result.totals.grossProfit, 35);
  assert.equal(result.previous.revenue, 30);
  assert.equal(result.previous.cost, 14);
  assert.equal(result.previous.grossProfit, 16);
  assert.equal(result.comparisonAvailable, true);
  assert.equal(result.changePct, 100);
  assert.deepEqual(result.comparison, {
    mode: 'custom', start: '2026-11-04', end: '2026-11-06', days: 3, equalLength: true, available: true, reason: null,
    revenue: { delta: 30, changePct: 100 },
    units: { delta: 0, changePct: 0 },
    grossProfit: { delta: 19, changePct: 118.75 },
    grossMargin: { deltaPp: 5 },
  });
  const automatic = analyzeSales(comparisonFixture(), customCurrent);
  assert.deepEqual(automatic.range, result.range);
  assert.deepEqual(automatic.previous, result.previous);
  assert.deepEqual(automatic.comparison, { ...result.comparison, mode: 'previous' });
});

test('single-day, leap-day, DST, and cross-year ranges use inclusive UTC calendar dates', () => {
  const cases = [
    { start: '2026-11-09', end: '2026-11-09', days: 1, previousStart: '2026-11-08', previousEnd: '2026-11-08' },
    { start: '2024-02-28', end: '2024-03-01', days: 3, previousStart: '2024-02-25', previousEnd: '2024-02-27' },
    { start: '2026-10-31', end: '2026-11-02', days: 3, previousStart: '2026-10-28', previousEnd: '2026-10-30' },
    { start: '2026-12-31', end: '2027-01-02', days: 3, previousStart: '2026-12-28', previousEnd: '2026-12-30' },
  ];
  for (const expected of cases) {
    const result = analyzeSales([row(expected.previousStart), row(expected.end)], { start: expected.start, end: expected.end });
    assert.deepEqual(result.range, expected);
    assert.equal(result.series.length, expected.days);
    assert.equal(result.series[0].date, expected.start);
    assert.equal(result.series.at(-1).date, expected.end);
    assert.equal(result.comparison.available, true);
  }
  const earliest = analyzeSales([row('1900-01-01')], { start: '1900-01-01', end: '1900-01-01' });
  assert.equal(earliest.range.previousStart, '1899-12-31');
  assert.equal(earliest.range.previousEnd, '1899-12-31');
  assert.equal(earliest.comparison.available, false);
});

test('comparison off clears previous dates and totals without changing selected analytics', () => {
  const result = analyzeSales(comparisonFixture(), customCurrent, 'none');
  assert.equal(result.totals.revenue, 60);
  assert.equal(result.currentCoverageComplete, true);
  assert.equal(result.range.previousStart, null);
  assert.equal(result.range.previousEnd, null);
  assert.deepEqual(result.previous, analyzeSales([]).totals);
  assert.equal(result.comparisonAvailable, false);
  assert.equal(result.changePct, null);
  assert.deepEqual(result.comparison, {
    mode: 'none', start: null, end: null, days: 0, equalLength: false, available: false, reason: 'Comparison is turned off.',
    revenue: { delta: null, changePct: null }, units: { delta: null, changePct: null },
    grossProfit: { delta: null, changePct: null }, grossMargin: { deltaPp: null },
  });
});

test('unequal custom ranges keep absolute deltas and margin points but suppress all percentage changes', () => {
  const result = analyzeSales(comparisonFixture(), customCurrent, { start: '2026-11-04', end: '2026-11-05' });
  assert.equal(result.comparison.available, true);
  assert.equal(result.comparison.equalLength, false);
  assert.equal(result.comparison.days, 2);
  assert.equal(result.comparison.reason, null);
  assert.deepEqual(result.comparison.revenue, { delta: 40, changePct: null });
  assert.deepEqual(result.comparison.units, { delta: 1, changePct: null });
  assert.deepEqual(result.comparison.grossProfit, { delta: 24, changePct: null });
  assert.ok(Math.abs(result.comparison.grossMargin.deltaPp - (10 / 3)) < 1e-10);
  assert.equal(result.changePct, null);
});

test('custom comparison can follow the selection, but cannot overlap even at one shared endpoint', () => {
  const after = analyzeSales(comparisonFixture(), customPrevious, customCurrent);
  assert.equal(after.comparison.available, true);
  assert.equal(after.comparison.revenue.delta, -30);
  assert.equal(after.comparison.revenue.changePct, -50);
  for (const comparison of [customCurrent, { start: '2026-11-06', end: '2026-11-07' }, { start: '2026-11-09', end: '2026-11-10' }, { start: '2026-11-01', end: '2026-11-20' }]) {
    assert.throws(() => analyzeSales(comparisonFixture(), customCurrent, comparison), /overlaps the selected range/);
  }
});

test('coverage requires both complete range bounds and never clamps requested dates to imported sales', () => {
  const outsideCurrent = analyzeSales(comparisonFixture(), { start: '2026-11-08', end: '2026-11-11' }, customPrevious);
  assert.equal(outsideCurrent.range.end, '2026-11-11');
  assert.equal(outsideCurrent.range.days, 4);
  assert.equal(outsideCurrent.totals.revenue, 40);
  assert.equal(outsideCurrent.totals.grossProfit, 23); // Cost coverage is independent of date coverage.
  assert.equal(outsideCurrent.currentCoverageComplete, false);
  assert.equal(outsideCurrent.comparison.available, false);
  assert.match(outsideCurrent.comparison.reason, /full selected range/);
  assert.deepEqual(outsideCurrent.series.slice(-2), [
    { date: '2026-11-10', revenue: 0, quantity: 0 },
    { date: '2026-11-11', revenue: 0, quantity: 0 },
  ]);
  assert.match(outsideCurrent.recommendations[2].detail, /cover 2 calendar days within this 4-day view/);
  const outsideComparison = analyzeSales(comparisonFixture(), customCurrent, { start: '2026-11-01', end: '2026-11-03' });
  assert.equal(outsideComparison.currentCoverageComplete, true);
  assert.equal(outsideComparison.comparison.available, false);
  assert.match(outsideComparison.comparison.reason, /full comparison range/);
  const bothOutside = analyzeSales(comparisonFixture(), { start: '2026-11-10', end: '2026-11-12' }, { start: '2026-11-01', end: '2026-11-03' });
  assert.equal(bothOutside.products.length, 0);
  assert.equal(bothOutside.totals.cost, null);
  assert.equal(bothOutside.totals.grossProfit, null);
  assert.equal(bothOutside.series.length, 3);
  assert.equal(bothOutside.recommendations[0].title, 'Add your first sales records');
  assert.match(bothOutside.comparison.reason, /full selected and comparison ranges/);
  for (const result of [outsideCurrent, outsideComparison, bothOutside]) {
    assert.equal(result.comparisonAvailable, false);
    assert.equal(result.changePct, null);
    assert.deepEqual(result.comparison.revenue, { delta: null, changePct: null });
    assert.deepEqual(result.comparison.units, { delta: null, changePct: null });
    assert.deepEqual(result.comparison.grossProfit, { delta: null, changePct: null });
    assert.deepEqual(result.comparison.grossMargin, { deltaPp: null });
  }
  assert.equal(analyzeSales([row('2026-11-09')], 28).currentCoverageComplete, false);
});

test('a covered zero-sales interval has zero revenue and units but does not invent known gross profit', () => {
  const result = analyzeSales([
    row('2026-11-04', 1, 10, 'Bread', 4), row('2026-11-09', 1, 20, 'Bread', 9),
  ], { start: '2026-11-07', end: '2026-11-08' }, { start: '2026-11-04', end: '2026-11-05' });
  assert.equal(result.currentCoverageComplete, true);
  assert.equal(result.comparison.available, true);
  assert.equal(result.totals.records, 0);
  assert.deepEqual(result.comparison.revenue, { delta: -10, changePct: -100 });
  assert.deepEqual(result.comparison.units, { delta: -1, changePct: -100 });
  assert.equal(result.totals.grossProfit, null);
  assert.deepEqual(result.comparison.grossProfit, { delta: null, changePct: null });
  assert.deepEqual(result.comparison.grossMargin, { deltaPp: null });
});

test('empty data preserves the old empty range and explicit requested ranges', () => {
  const empty = analyzeSales([]);
  assert.deepEqual(empty.range, { start: null, end: null, days: 0, previousStart: null, previousEnd: null });
  assert.deepEqual(empty.dataRange, { start: null, end: null });
  assert.equal(empty.currentCoverageComplete, false);
  assert.equal(empty.comparison.available, false);
  assert.match(empty.comparison.reason, /No imported sales dates/);
  const explicit = analyzeSales([], customCurrent);
  assert.deepEqual(explicit.range, { start: '2026-11-07', end: '2026-11-09', days: 3, previousStart: '2026-11-04', previousEnd: '2026-11-06' });
  assert.equal(explicit.series.length, 3);
  assert.ok(explicit.series.every((day) => day.revenue === 0 && day.quantity === 0));
  assert.equal(explicit.totals.grossProfit, null);
  assert.equal(explicit.previous.grossProfit, null);
  const off = analyzeSales([], customCurrent, 'none');
  assert.equal(off.range.start, customCurrent.start);
  assert.equal(off.range.previousStart, null);
  assert.equal(off.comparison.reason, 'Comparison is turned off.');
});

test('comparison rejects incomplete, reversed, invalid, excessively long, and untyped ranges', () => {
  const invalid = [
    {}, { start: '2026-11-01' }, { end: '2026-11-01' },
    { start: null, end: '2026-11-01' }, { start: new Date('2026-11-01'), end: '2026-11-01' },
    { start: '2026-11-02', end: '2026-11-01' },
    { start: '2026-02-29', end: '2026-03-01' },
    { start: '1899-12-31', end: '1900-01-01' },
    { start: '2026-1-01', end: '2026-01-02' },
    { start: '1900-01-01', end: '2100-01-01' }, [],
  ];
  for (const range of invalid) {
    assert.throws(() => analyzeSales(comparisonFixture(), range), /Selected range/);
    assert.throws(() => analyzeSales(comparisonFixture(), customCurrent, range), /Comparison range/);
  }
  for (const selection of ['2026-11-01', '7', false, 0, 14, NaN]) {
    assert.throws(() => analyzeSales(comparisonFixture(), selection), /Choose all dates/);
  }
  for (const compare of [null, 'off', false, 7]) {
    assert.throws(() => analyzeSales(comparisonFixture(), customCurrent, compare), /Comparison range/);
  }
});

test('zero and negative gross-profit baselines keep absolute differences but suppress percentage changes', () => {
  for (const priorCost of [2, 3]) {
    const result = analyzeSales([
      row('2026-11-08', 1, 2, 'Bread', priorCost), row('2026-11-09', 1, 3, 'Bread', 1),
    ], { start: '2026-11-09', end: '2026-11-09' });
    assert.deepEqual(result.comparison.grossProfit, { delta: priorCost, changePct: null });
    assert.deepEqual(result.comparison.revenue, { delta: 1, changePct: 50 });
    assert.ok(result.comparison.grossMargin.deltaPp > 0);
  }
  const loss = analyzeSales([
    row('2026-11-08', 1, 2, 'Bread', 1), row('2026-11-09', 1, 1, 'Bread', 2),
  ], { start: '2026-11-09', end: '2026-11-09' });
  assert.deepEqual(loss.comparison.grossProfit, { delta: -2, changePct: -200 });
  const zeroRevenue = analyzeSales([
    row('2026-11-08', 1, 0, 'Bread', 1), row('2026-11-09', 1, 3, 'Bread', 1),
  ], { start: '2026-11-09', end: '2026-11-09' });
  assert.deepEqual(zeroRevenue.comparison.revenue, { delta: 3, changePct: null });
  assert.deepEqual(zeroRevenue.comparison.grossProfit, { delta: 3, changePct: null });
  assert.equal(zeroRevenue.comparison.grossMargin.deltaPp, null);
});

test('missing costs in either range suppress only gross-profit and margin comparisons', () => {
  for (const costs of [[null, 1], [1, null]]) {
    const result = analyzeSales([
      row('2026-11-08', 1, 1, 'Bread', costs[0]), row('2026-11-09', 1, 2, 'Bread', costs[1]),
    ], { start: '2026-11-09', end: '2026-11-09' });
    assert.equal(result.comparison.available, true);
    assert.equal(result.comparison.reason, null);
    assert.deepEqual(result.comparison.revenue, { delta: 1, changePct: 100 });
    assert.deepEqual(result.comparison.units, { delta: 0, changePct: 0 });
    assert.deepEqual(result.comparison.grossProfit, { delta: null, changePct: null });
    assert.deepEqual(result.comparison.grossMargin, { deltaPp: null });
  }
});

test('comparison currency deltas use checked exact cents and reject unsafe subtraction', () => {
  const selected = { start: '2026-11-09', end: '2026-11-09' };
  const ordinary = analyzeSales([row('2026-11-08', 1, 0.1), row('2026-11-09', 1, 0.3)], selected);
  assert.equal(ordinary.comparison.revenue.delta, 0.2);
  assert.throws(() => analyzeSales([
    row('2026-11-08', 1, 0.03), row('2026-11-09', 1, 90_000_000_000_000.12),
  ], selected), /Revenue difference is too large to represent exactly in cents/);
  assert.throws(() => analyzeSales([
    row('2026-11-08', 1, 0, 'Bread', 90_000_000_000_000),
    row('2026-11-09', 1, 90_000_000_000_000, 'Bread', 0),
  ], selected), /Gross profit difference is too large/);
});
