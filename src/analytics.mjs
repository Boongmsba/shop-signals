/**
 * Shop Signals' dependency-free sales analytics.
 * All dates are calendar dates in UTC. Revenue and cost use integer cents.
 * A CSV row is a sales record, not necessarily a unique order or transaction.
 */
const DAY_MS = 86_400_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_ROWS = 50_000;
const REQUIRED_HEADERS = ['date', 'product', 'quantity', 'unit_price'];
const KNOWN_HEADERS = new Set([...REQUIRED_HEADERS, 'category', 'unit_cost']);
const EMPTY_TOTALS = () => ({ revenue: 0, units: 0, records: 0, avgUnitPrice: 0, ...marginFields(0, 0, 0, 0, 0) });

function fail(message) {
  throw new Error(message);
}

function dateNumber(value, context = 'Date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${context}: use a date in YYYY-MM-DD format.`);
  }
  if (Number(value.slice(0, 4)) < 1900) fail(`${context}: use a sales date in year 1900 or later.`);
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    fail(`${context}: "${value}" is not a valid calendar date.`);
  }
  return time;
}

function isoDate(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function checkedAdd(a, b, context) {
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) fail(`${context} is too large to calculate safely. Use a smaller dataset or amount.`);
  return sum;
}

function centsToDollars(cents, context) {
  const dollars = cents / 100;
  const digits = String(Math.abs(cents)).padStart(3, '0');
  const expected = `${cents < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
  const [whole, fraction = ''] = dollars.toString().split('.');
  const serialized = `${whole}.${fraction.padEnd(2, '0')}`;
  if (!Number.isSafeInteger(cents) || Math.round(dollars * 100) !== cents || fraction.length > 2 || serialized !== expected) {
    fail(`${context} is too large to represent exactly in cents. Use a smaller dataset or amount.`);
  }
  return dollars;
}

function checkedLineCents(quantity, cents, context, field = 'unit_price') {
  const total = quantity * cents;
  if (!Number.isSafeInteger(total)) fail(`${context}: quantity × ${field} is too large to calculate safely.`);
  return total;
}

function decimalCents(value, context, field = 'unit_price') {
  // Decimal currency only: reject currency symbols, exponents, and fractional cents.
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value)) {
    fail(`${context}: ${field} must be a nonnegative number with at most 2 decimal places (for example, 3.50).`);
  }
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(`${whole || '0'}${fraction.padEnd(2, '0')}`);
  if (!Number.isSafeInteger(cents)) fail(`${context}: ${field} is too large to calculate safely.`);
  return cents;
}

function readCSV(text) {
  const records = [];
  let cells = [];
  let field = '';
  let state = 'start';
  let line = 1;
  let rowLine = 1;
  let rowHasSyntax = false;
  function finishField() {
    cells.push(field);
    field = '';
    state = 'start';
  }
  function finishRow() {
    finishField();
    // Empty physical rows are harmless, including an extra newline at the end.
    if (rowHasSyntax || cells.some((cell) => cell.trim() !== '')) {
      records.push({ cells, line: rowLine });
      if (records.length > MAX_ROWS + 1) fail(`CSV exceeds ${MAX_ROWS.toLocaleString('en-US')} sales records. Split it into smaller files.`);
    }
    cells = [];
    rowHasSyntax = false;
  }
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === ',' || char === '"') rowHasSyntax = true;
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; }
        else state = 'closed';
      } else if (char === '\n' || char === '\r') {
        field += '\n';
        if (char === '\r' && text[i + 1] === '\n') i += 1;
        line += 1;
      } else field += char;
      continue;
    }
    if (char === ',') { finishField(); continue; }
    if (char === '\n' || char === '\r') {
      finishRow();
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      line += 1;
      rowLine = line;
      continue;
    }
    if (state === 'closed') {
      if (char === ' ' || char === '\t') continue;
      fail(`CSV line ${line}: unexpected text after a closing quote. Separate fields with commas.`);
    }
    if (char === '"') {
      if (state !== 'start') fail(`CSV line ${line}: a quote appears inside an unquoted field. Quote the entire field and escape quotes as "".`);
      state = 'quoted';
    } else {
      state = 'unquoted';
      field += char;
    }
  }
  if (state === 'quoted') fail(`CSV line ${rowLine}: an opening quote has no closing quote.`);
  if (field !== '' || cells.length > 0 || state !== 'start') finishRow();
  return records;
}

/**
 * Parse a UTF-8 CSV up to 2 MiB and 50,000 records. Header names are trimmed and
 * case-insensitive; extra columns are ignored with a warning. Currency must have
 * at most two decimal places; dates must use years 1900–9999. Empty physical rows
 * are ignored. Optional unit_cost is normalized to unitCost: null when absent or
 * blank; explicit zero is a known cost. Errors identify the source line and reject
 * the whole import, rather than silently dropping data.
 */
export function parseSalesCSV(text) {
  if (typeof text !== 'string') fail('Provide CSV text to import.');
  if (new TextEncoder().encode(text).length > MAX_BYTES) fail('CSV exceeds the 2 MiB limit. Split it into smaller files.');
  const records = readCSV(text.replace(/^\uFEFF/, ''));
  if (records.length === 0) fail('CSV is empty. Add a header row and at least one sales record.');
  const headers = records[0].cells.map((value) => value.trim().toLowerCase());
  if (headers.some((header) => header === '')) fail('CSV header contains an empty column name. Name or remove that column.');
  const seen = new Set();
  for (const header of headers) {
    if (seen.has(header)) fail(`CSV header "${header}" appears more than once. Keep one column with that name.`);
    seen.add(header);
  }
  const missing = REQUIRED_HEADERS.filter((header) => !seen.has(header));
  if (missing.length) fail(`CSV is missing required columns: ${missing.join(', ')}. Required headers are ${REQUIRED_HEADERS.join(', ')}.`);
  if (records.length === 1) fail('CSV has headers but no sales records. Add at least one sales row.');
  const unknown = headers.filter((header) => !KNOWN_HEADERS.has(header));
  const warnings = unknown.length ? [`Ignored extra columns: ${unknown.join(', ')}.`] : [];
  const rows = records.slice(1).map(({ cells, line }) => {
    const context = `CSV line ${line}`;
    if (cells.length !== headers.length) fail(`${context}: expected ${headers.length} columns but found ${cells.length}. Put fields containing commas inside double quotes.`);
    const record = Object.fromEntries(headers.map((header, index) => [header, cells[index].trim()]));
    dateNumber(record.date, `${context}, date`);
    if (!record.product) fail(`${context}: product must not be blank.`);
    if (!/^\d+$/.test(record.quantity) || !Number.isSafeInteger(Number(record.quantity)) || Number(record.quantity) <= 0) {
      fail(`${context}: quantity must be a positive whole number (for example, 2).`);
    }
    const quantity = Number(record.quantity);
    const cents = decimalCents(record.unit_price, context);
    checkedLineCents(quantity, cents, context);
    const costCents = record.unit_cost == null || record.unit_cost === '' ? null : decimalCents(record.unit_cost, context, 'unit_cost');
    if (costCents !== null) checkedLineCents(quantity, costCents, context, 'unit_cost');
    return { date: record.date, product: record.product, category: record.category || 'Uncategorized', quantity, unitPrice: centsToDollars(cents, `${context}: unit_price`), unitCost: costCents === null ? null : centsToDollars(costCents, `${context}: unit_cost`) };
  });
  return { rows, warnings };
}

function validateRows(rows) {
  if (!Array.isArray(rows)) fail('Sales rows must be an array.');
  if (rows.length > MAX_ROWS) fail(`Sales data exceeds ${MAX_ROWS.toLocaleString('en-US')} records.`);
  return rows.map((row, index) => {
    const context = `Sales record ${index + 1}`;
    if (!row || typeof row !== 'object') fail(`${context} is invalid.`);
    const time = dateNumber(row.date, `${context}, date`);
    if (typeof row.product !== 'string' || !row.product.trim()) fail(`${context}: product must not be blank.`);
    if (!Number.isSafeInteger(row.quantity) || row.quantity <= 0) fail(`${context}: quantity must be a positive whole number.`);
    if (!Number.isFinite(row.unitPrice) || row.unitPrice < 0) fail(`${context}: unitPrice must be a nonnegative number.`);
    const cents = Math.round(row.unitPrice * 100);
    if (!Number.isSafeInteger(cents) || Math.abs(row.unitPrice * 100 - cents) > 0.000001) {
      fail(`${context}: unitPrice must have at most 2 decimal places and fit safely in cents.`);
    }
    let costCents = null;
    if (row.unitCost != null) {
      if (!Number.isFinite(row.unitCost) || row.unitCost < 0) fail(`${context}: unitCost must be a nonnegative number or null when unknown.`);
      costCents = Math.round(row.unitCost * 100);
      if (!Number.isSafeInteger(costCents) || Math.abs(row.unitCost * 100 - costCents) > 0.000001) {
        fail(`${context}: unitCost must have at most 2 decimal places and fit safely in cents.`);
      }
    }
    if (row.category != null && typeof row.category !== 'string') fail(`${context}: category must be text.`);
    return { ...row, product: row.product.trim(), category: row.category?.trim() || 'Uncategorized', unitPrice: centsToDollars(cents, `${context}: unitPrice`), unitCost: costCents === null ? null : centsToDollars(costCents, `${context}: unitCost`), time, cents, revenueCents: checkedLineCents(row.quantity, cents, context), costCents: costCents === null ? null : checkedLineCents(row.quantity, costCents, context, 'unitCost') };
  });
}

function marginFields(revenueCents, records, costCents, costedRecords, costedUnits, context = 'Total') {
  const complete = records > 0 && costedRecords === records;
  const profitCents = complete ? checkedAdd(revenueCents, -costCents, 'Gross profit') : null;
  return {
    cost: complete ? centsToDollars(costCents, `${context} cost`) : null,
    grossProfit: complete ? centsToDollars(profitCents, `${context} gross profit`) : null,
    grossMarginPct: complete && revenueCents > 0 ? (profitCents / revenueCents) * 100 : null,
    costedRecords,
    missingCostRecords: records - costedRecords,
    costedUnits,
  };
}

function summarize(rows) {
  let cents = 0;
  let units = 0;
  let costCents = 0;
  let costedRecords = 0;
  let costedUnits = 0;
  for (const row of rows) {
    cents = checkedAdd(cents, row.revenueCents, 'Total revenue');
    units = checkedAdd(units, row.quantity, 'Total quantity');
    if (row.costCents !== null) {
      costCents = checkedAdd(costCents, row.costCents, 'Total cost');
      costedRecords += 1;
      costedUnits = checkedAdd(costedUnits, row.quantity, 'Costed quantity');
    }
  }
  return { revenue: centsToDollars(cents, 'Total revenue'), units, records: rows.length, avgUnitPrice: units ? cents / units / 100 : 0, ...marginFields(cents, rows.length, costCents, costedRecords, costedUnits) };
}

const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);

function recommend({ products, totals, series, range }, coverageDays = 0) {
  if (!products.length) return [
    { title: 'Add your first sales records', detail: 'No sales records are available to analyze.', action: 'Upload the sample CSV or a file with date, product, quantity, and unit_price columns.' },
    { title: 'Keep product names consistent', detail: 'Consistent names make product comparisons meaningful.', action: 'Use the same product name for every sale of an item.' },
    { title: 'Collect a comparison period', detail: 'Changes need comparable time windows.', action: 'Record at least two full weeks before comparing seven-day results.' },
  ];
  const top = products[0];
  const output = [];
  if (totals.revenue === 0) {
    output.push({ title: 'Check your price inputs', detail: `${totals.units} units were recorded with $0.00 in sales revenue.`, action: 'Confirm that zero prices are intentional before making pricing decisions.' });
  } else {
    output.push({ title: `Test a spotlight for ${top.product}`, detail: `${top.product} generated ${money(top.revenue)}, or ${(top.share * 100).toFixed(1)}% of revenue in this window.`, action: 'Feature it for one week and compare units sold with a comparable week. Track discounts and costs separately.' });
  }
  if (products.length === 1) {
    output.push({ title: 'Build a broader product baseline', detail: `This window contains only one product: ${top.product}.`, action: 'Collect more product-level sales before deciding which items to promote together.' });
  } else if (top.share >= 0.5) {
    output.push({ title: 'Test demand beyond the top product', detail: `${top.product} accounts for ${(top.share * 100).toFixed(1)}% of revenue across ${products.length} products.`, action: `Try a small feature for ${products[1].product} and track whether its units rise without reducing total revenue.` });
  } else {
    output.push({ title: 'Try a two-product feature', detail: `${top.product} and ${products[1].product} together account for ${((top.share + products[1].share) * 100).toFixed(1)}% of revenue.`, action: 'Display these items together for a week. Compare units and revenue, and review complete unit costs before considering a discount.' });
  }
  if (coverageDays < 14 || totals.revenue === 0) {
    output.push({ title: 'Build a longer baseline', detail: `Imported dates cover ${coverageDays} calendar ${coverageDays === 1 ? 'day' : 'days'} within this ${range.days}-day view. Missing dates are treated as zero sales.`, action: 'Confirm that the export is complete and collect at least 14 days of sales coverage before testing a weekday promotion.' });
  } else {
    const weekdays = Array.from({ length: 7 }, () => ({ cents: 0, count: 0 }));
    for (const day of series) {
      const group = weekdays[new Date(`${day.date}T00:00:00Z`).getUTCDay()];
      group.cents += Math.round(day.revenue * 100);
      group.count += 1;
    }
    const best = weekdays.map((group, index) => ({ ...group, index, average: group.count ? group.cents / group.count / 100 : 0 })).sort((a, b) => b.average - a.average || a.index - b.index)[0];
    const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][best.index];
    output.push({ title: `Test a ${weekday} feature`, detail: `${weekday} had the highest average daily revenue (${money(best.average)}) across ${best.count} occurrences in this window, including zero-sale dates.`, action: 'Try a small feature on that weekday and compare with several similar days. Check holidays, opening hours, and missing records first.' });
  }
  return output;
}

function validateRange(value, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${context}: provide both start and end dates in YYYY-MM-DD format.`);
  }
  const start = dateNumber(value.start, `${context} start`);
  const end = dateNumber(value.end, `${context} end`);
  if (end < start) fail(`${context}: end must be on or after start.`);
  const days = Math.round((end - start) / DAY_MS) + 1;
  if (days > 36_600) fail(`${context} exceeds 36,600 days (about 100 years). Choose a shorter range.`);
  return { start, end, days };
}

function currencyDelta(current, previous, context) {
  const cents = checkedAdd(Math.round(current * 100), -Math.round(previous * 100), context);
  return centsToDollars(cents, context);
}

function compareTotals(totals, previous, selected, compared, mode, currentCovered, comparedCovered, hasData) {
  const available = mode !== 'none' && currentCovered && comparedCovered;
  const equalLength = Boolean(selected && compared && selected.days === compared.days);
  let reason = null;
  if (mode === 'none') reason = 'Comparison is turned off.';
  else if (!hasData) reason = 'No imported sales dates are available to establish coverage.';
  else if (!currentCovered && !comparedCovered) reason = 'Imported dates do not cover the full selected and comparison ranges.';
  else if (!currentCovered) reason = 'Imported dates do not cover the full selected range.';
  else if (!comparedCovered) reason = 'Imported dates do not cover the full comparison range.';
  function metric(current, prior, context, currency = true) {
    if (!available || current === null || prior === null) return { delta: null, changePct: null };
    return {
      delta: currency ? currencyDelta(current, prior, context) : checkedAdd(current, -prior, context),
      changePct: equalLength && prior > 0 ? ((current - prior) / prior) * 100 : null,
    };
  }
  return {
    mode,
    start: compared ? isoDate(compared.start) : null,
    end: compared ? isoDate(compared.end) : null,
    days: compared?.days || 0,
    equalLength,
    available,
    reason,
    revenue: metric(totals.revenue, previous.revenue, 'Revenue difference'),
    units: metric(totals.units, previous.units, 'Unit difference', false),
    grossProfit: metric(totals.grossProfit, previous.grossProfit, 'Gross profit difference'),
    grossMargin: { deltaPp: available && totals.grossMarginPct !== null && previous.grossMarginPct !== null ? totals.grossMarginPct - previous.grossMarginPct : null },
  };
}

/**
 * selection is null (all imported dates), 7/28/56 days ending on the latest date,
 * or an explicit inclusive UTC {start, end}. Explicit ranges are never clamped.
 * compare is 'previous' (the immediately preceding equal-length interval),
 * 'none', or a non-overlapping {start, end}; custom lengths may differ.
 * Both whole ranges must fall within imported min/max dates for comparison
 * deltas. Percent changes also require equal lengths and a positive baseline.
 * Missing dates are zero-filled, assuming the export is complete. Weekday
 * experiments require 14 calendar days in the selected/imported intersection.
 * Cost and gross profit require known costs on every record in a nonempty
 * aggregate. Gross margin is null for zero revenue or incomplete costs.
 * Empty old calls retain an empty range; explicit empty ranges retain dates.
 */
export function analyzeSales(rows, selection = null, compare = 'previous') {
  const explicitSelection = selection !== null && typeof selection === 'object';
  if (!explicitSelection && selection !== null && ![7, 28, 56].includes(selection)) {
    fail('Choose all dates (null), 7, 28, or 56 days, or provide start and end dates.');
  }
  let selected = explicitSelection ? validateRange(selection, 'Selected range') : null;
  const mode = compare === 'previous' || compare === 'none' ? compare : 'custom';
  let compared = mode === 'custom' ? validateRange(compare, 'Comparison range') : null;
  const data = validateRows(rows);
  let min = Infinity;
  let max = -Infinity;
  for (const row of data) { min = Math.min(min, row.time); max = Math.max(max, row.time); }
  if (!selected && data.length) {
    const days = selection ?? Math.round((max - min) / DAY_MS) + 1;
    if (days > 36_600) fail('The date span exceeds 100 years. Check your date values or choose a shorter date window.');
    selected = { start: max - (days - 1) * DAY_MS, end: max, days };
  }
  if (mode === 'previous' && selected) {
    compared = { start: selected.start - selected.days * DAY_MS, end: selected.start - DAY_MS, days: selected.days };
  }
  if (mode === 'custom' && selected && compared.start <= selected.end && compared.end >= selected.start) {
    fail('Comparison range overlaps the selected range. Choose dates entirely before or after the selected range.');
  }
  const current = selected ? data.filter((row) => row.time >= selected.start && row.time <= selected.end) : [];
  const prior = compared ? data.filter((row) => row.time >= compared.start && row.time <= compared.end) : [];
  const totals = current.length ? summarize(current) : EMPTY_TOTALS();
  const previous = prior.length ? summarize(prior) : EMPTY_TOTALS();
  const currentCoverageComplete = Boolean(data.length && selected && min <= selected.start && max >= selected.end);
  const comparedCovered = Boolean(data.length && compared && min <= compared.start && max >= compared.end);
  const comparison = compareTotals(totals, previous, selected, compared, mode, currentCoverageComplete, comparedCovered, data.length > 0);
  const productMap = new Map();
  const dayMap = new Map();
  for (const row of current) {
    let product = productMap.get(row.product);
    if (!product) { product = { product: row.product, categories: new Set(), quantity: 0, cents: 0, records: 0, costCents: 0, costedRecords: 0, costedUnits: 0 }; productMap.set(row.product, product); }
    product.categories.add(row.category);
    product.records += 1;
    product.quantity = checkedAdd(product.quantity, row.quantity, 'Product quantity');
    product.cents = checkedAdd(product.cents, row.revenueCents, 'Product revenue');
    if (row.costCents !== null) {
      product.costCents = checkedAdd(product.costCents, row.costCents, 'Product cost');
      product.costedRecords += 1;
      product.costedUnits = checkedAdd(product.costedUnits, row.quantity, 'Product costed quantity');
    }
    const daily = dayMap.get(row.date) || { cents: 0, quantity: 0 };
    daily.cents = checkedAdd(daily.cents, row.revenueCents, 'Daily revenue');
    daily.quantity = checkedAdd(daily.quantity, row.quantity, 'Daily quantity');
    dayMap.set(row.date, daily);
  }
  const products = [...productMap.values()].sort((a, b) => b.cents - a.cents || a.product.localeCompare(b.product)).map((product) => {
    const revenue = centsToDollars(product.cents, 'Product revenue');
    return {
      product: product.product,
      category: product.categories.size === 1 ? [...product.categories][0] : 'Multiple categories',
      quantity: product.quantity,
      records: product.records,
      revenue,
      avgPrice: product.cents / product.quantity / 100,
      share: totals.revenue ? revenue / totals.revenue : 0,
      ...marginFields(product.cents, product.records, product.costCents, product.costedRecords, product.costedUnits, 'Product'),
    };
  });
  const series = Array.from({ length: selected?.days || 0 }, (_, index) => {
    const date = isoDate(selected.start + index * DAY_MS);
    const daily = dayMap.get(date);
    return { date, revenue: daily ? centsToDollars(daily.cents, 'Daily revenue') : 0, quantity: daily?.quantity || 0 };
  });
  const result = {
    range: {
      start: selected ? isoDate(selected.start) : null,
      end: selected ? isoDate(selected.end) : null,
      days: selected?.days || 0,
      previousStart: compared ? isoDate(compared.start) : null,
      previousEnd: compared ? isoDate(compared.end) : null,
    },
    totals, previous,
    comparisonAvailable: comparison.available,
    changePct: comparison.revenue.changePct,
    products, series, comparison,
    dataRange: { start: data.length ? isoDate(min) : null, end: data.length ? isoDate(max) : null },
    currentCoverageComplete,
  };
  const coverageDays = data.length && selected ? Math.max(0, Math.round((Math.min(max, selected.end) - Math.max(min, selected.start)) / DAY_MS) + 1) : 0;
  return { ...result, recommendations: recommend(result, coverageDays) };
}

/** Compare the observed, quantity-weighted average price against a manual quote. */
export function comparePrice(productSummary, competitorPrice) {
  if (!productSummary || !Number.isFinite(productSummary.avgPrice) || productSummary.avgPrice < 0) fail('Select a product with a valid average price.');
  if (!Number.isFinite(competitorPrice) || competitorPrice < 0) fail('Competitor price must be a nonnegative number.');
  const difference = Number((productSummary.avgPrice - competitorPrice).toFixed(10));
  return { difference, percent: competitorPrice === 0 ? null : (difference / competitorPrice) * 100 };
}
