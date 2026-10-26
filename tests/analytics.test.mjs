import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseSalesCSV, analyzeSales, comparePrice } from '../src/analytics.mjs';

const header = 'date,product,quantity,unit_price';
const row = (date, quantity = 1, unitPrice = 1, product = 'Bread') => ({ date, product, quantity, unitPrice, category: 'Bakery' });

test('CSV handles BOM, case-insensitive headers, CRLF, escaped quotes, commas, and multiline fields', () => {
  const input = '\uFEFF Date,PRODUCT,quantity,unit_price,category,note\r\n2026-10-01,"Bread, \"\"country\"\"",2,3.50,Bakery,ok\r\n2026-10-02,"Tea\r\nloaf",1,.75,,ok\r\n\r\n';
  const { rows, warnings } = parseSalesCSV(input);
  assert.deepEqual(rows, [
    { date: '2026-10-01', product: 'Bread, "country"', category: 'Bakery', quantity: 2, unitPrice: 3.5 },
    { date: '2026-10-02', product: 'Tea\nloaf', category: 'Uncategorized', quantity: 1, unitPrice: 0.75 },
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
  assert.deepEqual(result.totals, { revenue: 1.08, units: 6, records: 3, avgUnitPrice: 0.18 });
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
  const fourWeeks = analyzeSales(rows, 28);
  assert.equal(fourWeeks.comparisonAvailable, true);
  assert.equal(fourWeeks.recommendations.length, 3);
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
