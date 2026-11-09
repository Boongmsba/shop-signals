import { parseSalesCSV, analyzeSales, comparePrice } from './analytics.mjs';

const $ = (id) => document.getElementById(id);
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const dateLabel = (date) => shortDate.format(new Date(`${date}T12:00:00Z`));
const money = (value) => usd.format(value);
let rows = [];
let analysis;
let source = { name: 'Sunday Bakery · sample sales', isDemo: true };
let lastComparison = null;
const defaultView = () => ({ period: '28', start: '', end: '', compare: 'previous', comparisonStart: '', comparisonEnd: '' });
let appliedView = defaultView();
let datasetRevision = 0;

function element(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

function notice(message, isError = false) {
  $('notice').textContent = message;
  $('notice').classList.toggle('error', isError);
  $('notice').hidden = !message;
}

function readView() {
  return { period: $('period').value, start: $('range-start').value, end: $('range-end').value, compare: $('comparison-mode').value, comparisonStart: $('comparison-start').value, comparisonEnd: $('comparison-end').value };
}

function analyzeView(data, view) {
  const selected = view.period === 'custom' ? { start: view.start, end: view.end } : view.period === 'all' ? null : Number(view.period);
  const comparison = view.compare === 'custom' ? { start: view.comparisonStart, end: view.comparisonEnd } : view.compare;
  return analyzeSales(data, selected, comparison);
}

function updateDateControls() {
  const view = readView();
  for (const [group, ids, enabled] of [
    ['custom-range-fields', ['range-start', 'range-end'], view.period === 'custom'],
    ['custom-comparison-fields', ['comparison-start', 'comparison-end'], view.compare === 'custom'],
  ]) {
    $(group).hidden = !enabled;
    for (const id of ids) { $(id).disabled = !enabled; $(id).required = enabled; }
  }
  const dirty = Object.keys(appliedView).some((key) => view[key] !== appliedView[key]);
  $('date-draft-status').textContent = 'Date changes are not applied yet. Select Apply dates to update the dashboard.';
  $('date-draft-status').hidden = !dirty;
}

function syncViewControls(view, result) {
  appliedView = { ...view, start: result.range.start || '', end: result.range.end || '', comparisonStart: result.comparison.start || '', comparisonEnd: result.comparison.end || '' };
  for (const [id, key] of [['period', 'period'], ['range-start', 'start'], ['range-end', 'end'], ['comparison-mode', 'compare'], ['comparison-start', 'comparisonStart'], ['comparison-end', 'comparisonEnd']]) $(id).value = appliedView[key];
  $('date-error').hidden = true;
  $('apply-dates').disabled = false;
  updateDateControls();
}

function periodLabel(start, end, days) {
  if (!start || !end) return 'No period selected';
  return `${start} – ${end} · ${days} day${days === 1 ? '' : 's'}`;
}

function comparisonValue(totals, field) {
  if (field === 'revenue') return money(totals.revenue);
  if (field === 'units') return integer.format(totals.units);
  if (totals.records === 0) return 'No sales';
  if (totals.cost === null) return 'Cost needed';
  if (field === 'grossMarginPct') return totals.grossMarginPct === null ? 'N/A' : `${totals.grossMarginPct.toFixed(1)}%`;
  return money(totals.grossProfit);
}

function renderComparison(result) {
  const { range, comparison, totals, previous, dataRange } = result;
  const selectedLabel = periodLabel(range.start, range.end, range.days);
  $('date-applied').textContent = `Showing ${selectedLabel}${comparison.mode === 'none' ? ' · Comparison off' : ''}`;
  $('available-dates').textContent = `Imported dates: ${dataRange.start} – ${dataRange.end}. Both endpoints are included. Dates without records count as zero sales.`;
  $('coverage-notice').hidden = result.currentCoverageComplete;
  $('coverage-notice').textContent = 'The selected period extends beyond your imported dates. Totals include only the records available, and comparison changes are unavailable.';
  $('empty-period').hidden = totals.records !== 0;
  $('period-comparison').hidden = comparison.mode === 'none';
  if (comparison.mode === 'none') { $('comparison-table').replaceChildren(); return; }
  $('selected-period-label').textContent = selectedLabel;
  $('comparison-period-label').textContent = periodLabel(comparison.start, comparison.end, comparison.days);
  $('comparison-length').textContent = comparison.equalLength ? `${range.days} days vs. ${comparison.days} days` : 'Different period lengths';
  const notes = [];
  if (!comparison.available) notes.push(comparison.reason || 'The imported dates do not fully cover both periods.');
  if (!comparison.equalLength) notes.push(`These periods have ${range.days} and ${comparison.days} days. Values are totals, not daily averages; growth percentages are withheld.`);
  if (!notes.length) notes.push('Changes are selected period minus comparison period. Gross margin changes use percentage points (pp).');
  $('comparison-note').textContent = notes.join(' ');
  const metrics = [['Revenue', 'revenue', comparison.revenue], ['Items sold', 'units', comparison.units], ['Gross profit', 'grossProfit', comparison.grossProfit], ['Gross margin', 'grossMarginPct', comparison.grossMargin]];
  const previousCovered = comparison.start >= dataRange.start && comparison.end <= dataRange.end;
  $('comparison-table').replaceChildren(...metrics.map(([label, field, metric]) => {
    const tr = element('tr');
    const heading = element('th', '', label);
    heading.scope = 'row';
    const currentCell = element('td', '', comparisonValue(totals, field));
    if (!result.currentCoverageComplete) currentCell.append(element('small', 'comparison-unavailable', 'Partial data'));
    const previousCell = element('td', '', previousCovered ? comparisonValue(previous, field) : 'Incomplete data');
    const deltaCell = element('td', 'comparison-change');
    const delta = field === 'grossMarginPct' ? metric.deltaPp : metric.delta;
    if (delta === null) {
      deltaCell.append(element('span', 'comparison-unavailable', !comparison.available ? 'Unavailable' : 'N/A'));
      if (comparison.available) deltaCell.append(element('small', '', field === 'grossMarginPct' ? 'Both periods need a defined margin' : 'Both periods need complete costs'));
    } else {
      const prefix = delta > 0 ? '+' : '';
      const value = field === 'grossMarginPct' ? `${prefix}${delta.toFixed(1)} pp` : field === 'units' ? `${prefix}${integer.format(delta)}` : `${prefix}${money(delta)}`;
      deltaCell.append(element('strong', delta < 0 ? 'cell-negative' : '', value));
      if (field !== 'grossMarginPct') {
        const percentage = metric.changePct;
        deltaCell.append(element('small', '', percentage !== null ? `${percentage > 0 ? '+' : ''}${percentage.toFixed(1)}%` : !comparison.equalLength ? 'Different period lengths' : 'No positive comparison baseline'));
      }
    }
    tr.append(heading, currentCell, previousCell, deltaCell);
    return tr;
  }));
}

function renderChart(series) {
  const ns = 'http://www.w3.org/2000/svg';
  const width = 700, height = 240;
  const left = 58, right = 20, top = 16, bottom = 38;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const max = Math.max(1, ...series.map((day) => day.revenue));
  const roughStep = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = Math.ceil(roughStep / magnitude) * magnitude;
  const ceiling = step * 4;
  const x = (index) => left + (series.length > 1 ? index / (series.length - 1) : .5) * plotWidth;
  const y = (value) => top + plotHeight * (1 - value / ceiling);
  const svg = document.createElementNS(ns, 'svg');
  svg.classList.add('chart-svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Daily sales revenue from ${analysis.range.start} through ${analysis.range.end}. Total ${money(analysis.totals.revenue)}. A data table follows this chart.`);
  function part(tag, attrs, text, parent = svg) {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    parent.append(node);
    return node;
  }
  const defs = part('defs', {});
  const gradient = part('linearGradient', { id: 'revenue-fill', x1: '0', y1: '0', x2: '0', y2: '1' }, undefined, defs);
  part('stop', { offset: '0%', 'stop-color': '#e6b655', 'stop-opacity': '.26' }, undefined, gradient);
  part('stop', { offset: '100%', 'stop-color': '#e6b655', 'stop-opacity': '.015' }, undefined, gradient);
  for (let tick = 0; tick <= 4; tick++) {
    const value = step * tick;
    part('line', { x1: left, y1: y(value), x2: width - right, y2: y(value), class: 'chart-grid' });
    part('text', { x: left - 10, y: y(value) + 4, 'text-anchor': 'end' }, new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value));
  }
  if (series.length) {
    const path = series.map((day, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(day.revenue).toFixed(2)}`).join(' ');
    part('path', { d: `${path} L${x(series.length - 1)},${y(0)} L${x(0)},${y(0)} Z`, fill: 'url(#revenue-fill)' });
    part('path', { d: path, class: 'chart-path' });
    const peakIndex = series.reduce((best, day, index) => day.revenue > series[best].revenue ? index : best, 0);
    part('circle', { cx: x(peakIndex), cy: y(series[peakIndex].revenue), r: 4.5, class: 'chart-dot' });
    const tickIndices = [...new Set(Array.from({ length: Math.min(5, series.length) }, (_, index) => Math.round(index * (series.length - 1) / Math.max(1, Math.min(5, series.length) - 1))))];
    for (const index of tickIndices) part('text', { x: x(index), y: height - 13, 'text-anchor': 'middle' }, dateLabel(series[index].date));
    for (const [index, day] of series.entries()) {
      const dot = part('circle', { cx: x(index), cy: y(day.revenue), r: 5, class: 'chart-hit' });
      part('title', {}, `${day.date}: ${money(day.revenue)}, ${integer.format(day.quantity)} items`, dot);
    }
  }
  $('chart').replaceChildren(svg);
  const dataRows = series.map((day) => {
    const tr = element('tr');
    for (const value of [day.date, money(day.revenue), integer.format(day.quantity)]) tr.append(element('td', '', value));
    return tr;
  });
  $('daily-table').replaceChildren(...dataRows);
}

function renderCosts(totals) {
  const missing = totals.missingCostRecords;
  const complete = totals.cost !== null;
  const noRecords = totals.records === 0;
  const unavailable = noRecords ? 'No sales' : 'Cost needed';
  $('cost-total').textContent = complete ? money(totals.cost) : unavailable;
  $('gross-profit').textContent = complete ? money(totals.grossProfit) : unavailable;
  $('gross-margin').textContent = totals.grossMarginPct !== null ? `${totals.grossMarginPct.toFixed(1)}%` : complete ? 'N/A' : unavailable;
  $('gross-margin-detail').textContent = complete && totals.revenue === 0 ? 'Undefined when revenue is $0' : 'Gross profit ÷ revenue × 100';
  for (const id of ['cost-total', 'gross-profit', 'gross-margin']) $(id).classList.toggle('cost-unavailable', !complete);
  $('gross-profit').classList.toggle('is-loss', complete && totals.grossProfit < 0);
  $('gross-margin').classList.toggle('is-loss', totals.grossMarginPct !== null && totals.grossMarginPct < 0);
  $('cost-coverage').textContent = `${integer.format(totals.costedRecords)} of ${integer.format(totals.records)} records have costs`;
  $('cost-coverage').classList.toggle('coverage-incomplete', !complete);
  $('cost-help').textContent = complete
    ? 'All selected sales records include costs. Gross profit subtracts the product costs you provide; operating expenses are excluded.'
    : noRecords ? 'No sales records are available in this period.'
    : `Add unit_cost to ${integer.format(missing)} ${totals.costedRecords ? 'remaining ' : ''}sales record${missing === 1 ? '' : 's'} to see complete totals. Products with complete costs still show their own results. Unknown costs are never assumed to be $0.`;
}

function costCell(product, field) {
  const value = product[field];
  const cell = element('td', value !== null && value < 0 ? 'cell-negative' : field === 'grossProfit' ? 'revenue-cell' : '');
  if (value === null) {
    const undefinedMargin = field === 'grossMarginPct' && product.cost !== null;
    const label = element('span', 'cost-needed', undefinedMargin ? 'N/A' : 'Cost needed');
    label.title = undefinedMargin
      ? 'Gross margin is undefined when revenue is $0.'
      : `${product.missingCostRecords} of ${product.records} sales records are missing unit_cost. No partial cost or profit is shown.`;
    cell.append(label);
  } else {
    cell.textContent = field === 'grossMarginPct' ? `${value.toFixed(1)}%` : money(value);
  }
  return cell;
}

function renderProducts(products, refreshPriceOptions = true) {
  const sortKey = $('product-sort').value;
  const sortName = { revenue: 'revenue', grossProfit: 'gross profit', grossMarginPct: 'gross margin' }[sortKey];
  const ranked = [...products].sort((a, b) => {
    if (a[sortKey] === null && b[sortKey] !== null) return 1;
    if (b[sortKey] === null && a[sortKey] !== null) return -1;
    return (b[sortKey] ?? 0) - (a[sortKey] ?? 0) || b.revenue - a.revenue || a.product.localeCompare(b.product);
  });
  $('product-caption').textContent = `Products ranked by ${sortName}, highest first, in the selected period`;
  $('product-ranking-note').textContent = `Products ranked by ${sortName}, highest first.${sortKey === 'revenue' ? '' : ' Unavailable values appear last.'} Scroll across the table to see all columns.`;
  const tableRows = ranked.map((product) => {
    const tr = element('tr');
    const nameCell = element('td');
    const nameContent = element('div', 'product-cell');
    const monogram = element('span', 'product-monogram', product.product.slice(0, 1).toUpperCase());
    monogram.setAttribute('aria-hidden', 'true');
    const names = element('div');
    names.append(element('strong', '', product.product), element('small', '', product.category || 'Uncategorized'));
    nameContent.append(monogram, names);
    nameCell.append(nameContent);
    tr.append(nameCell, element('td', '', integer.format(product.quantity)), element('td', '', money(product.avgPrice)), element('td', 'revenue-cell', money(product.revenue)));
    tr.append(costCell(product, 'cost'), costCell(product, 'grossProfit'), costCell(product, 'grossMarginPct'));
    const mixCell = element('td');
    const share = element('div', 'share-cell');
    const track = element('div', 'share-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = element('div', 'share-fill');
    fill.style.width = `${Math.max(0, Math.min(100, product.share * 100))}%`;
    track.append(fill);
    share.append(track, element('span', '', `${(product.share * 100).toFixed(1)}%`));
    mixCell.append(share);
    tr.append(mixCell);
    return tr;
  });
  $('product-table').replaceChildren(...tableRows);
  $('product-count').textContent = `${products.length} product${products.length === 1 ? '' : 's'}`;
  if (!refreshPriceOptions) return;
  const selected = $('compare-product').value;
  $('compare-product').replaceChildren(...products.map((product) => {
    const option = element('option', '', product.product);
    option.value = product.product;
    return option;
  }));
  if (products.some((product) => product.product === selected)) $('compare-product').value = selected;
  updateOwnPrice();
}

function updateOwnPrice() {
  const selected = analysis.products.find((product) => product.product === $('compare-product').value);
  $('own-price').textContent = selected ? money(selected.avgPrice) : '—';
  $('comparison-result').hidden = true;
  lastComparison = null;
}

function render(nextAnalysis) {
  analysis = nextAnalysis;
  const { totals, products, range } = analysis;
  $('revenue').textContent = money(totals.revenue);
  $('units').textContent = integer.format(totals.units);
  $('record-count').textContent = `Across ${integer.format(totals.records)} sales records`;
  $('average-price').textContent = money(totals.avgUnitPrice);
  renderCosts(totals);
  renderComparison(analysis);
  const change = $('revenue-change');
  change.classList.remove('positive', 'negative');
  if (analysis.comparisonAvailable && analysis.changePct !== null) {
    const percent = analysis.changePct;
    change.textContent = `${percent >= 0 ? '↑' : '↓'} ${Math.abs(percent).toFixed(1)}% vs. comparison period`;
    change.classList.add(percent >= 0 ? 'positive' : 'negative');
  } else {
    change.textContent = analysis.comparison.mode === 'none' ? 'Comparison turned off' : !analysis.comparisonAvailable ? 'Full-period comparison unavailable' : !analysis.comparison.equalLength ? 'Growth % withheld for unequal periods' : 'Comparison period had $0 in revenue';
  }
  const best = products[0];
  $('bestseller').textContent = best?.product || 'No sales';
  $('bestseller').title = best?.product || '';
  $('bestseller-detail').textContent = best ? `${money(best.revenue)} · ${(best.share * 100).toFixed(1)}% of revenue` : 'No products in this period';
  $('top-share').replaceChildren(document.createTextNode(best ? (best.share * 100).toFixed(1) : '0'), element('span', '', '%'));
  $('spotlight-product').textContent = best?.product || 'Start with your sales';
  $('spotlight-detail').textContent = best ? `${integer.format(best.quantity)} items sold in this period. Keep an eye on availability before trying a promotion.` : 'Upload a CSV to find your top product.';
  const startLabel = dateLabel(range.start) + (range.start.slice(0, 4) === range.end.slice(0, 4) ? '' : `, ${range.start.slice(0, 4)}`);
  $('date-range').textContent = `${startLabel} – ${dateLabel(range.end)}, ${range.end.slice(0, 4)}`;
  $('dataset-name').textContent = source.name;
  $('dataset-description').textContent = `${integer.format(rows.length)} records · ${source.isDemo ? 'Synthetic example' : 'Browser only'} · Period ends ${dateLabel(range.end)}`;
  $('shop-name').textContent = source.isDemo ? 'Sunday Bakery' : 'Your shop';
  $('workspace-description').textContent = source.isDemo ? 'Your sample workspace' : 'Your CSV workspace';
  const badge = $('source-badge');
  badge.replaceChildren(element('span'), document.createTextNode(source.isDemo ? ' SYNTHETIC DEMO' : ' YOUR CSV'));
  badge.classList.toggle('user-data', !source.isDemo);
  $('footer-source').textContent = `${source.isDemo ? 'Demo numbers are synthetic.' : 'Your data stays in this browser.'} Revenue is not profit.`;
  renderChart(analysis.series);
  renderProducts(products);
  $('recommendations').replaceChildren(...analysis.recommendations.map((recommendation, index) => {
    const card = element('article', 'recommendation');
    const content = element('div');
    content.append(element('h3', '', recommendation.title), element('p', '', recommendation.detail), element('p', 'action', recommendation.action));
    card.append(element('span', 'recommendation-number', String(index + 1).padStart(2, '0')), content);
    return card;
  }));
  $('export-report').disabled = false;
  $('dashboard').setAttribute('aria-busy', 'false');
}

function ingest(text, name, isDemo = false) {
  const parsed = parseSalesCSV(text);
  // Validate analysis before replacing the current dataset, preserving it on errors.
  const nextView = defaultView();
  const nextAnalysis = analyzeView(parsed.rows, nextView);
  datasetRevision += 1;
  rows = parsed.rows;
  source = { name, isDemo: isDemo || text.includes('SYNTHETIC DEMO') };
  render(nextAnalysis);
  syncViewControls(nextView, nextAnalysis);
  return parsed.warnings;
}

async function loadDemo() {
  const requestedRevision = ++datasetRevision;
  try {
    const response = await fetch('./data/sample-sales.csv');
    if (!response.ok) throw new Error('The sample CSV could not be loaded. Try uploading a file or reloading the page.');
    const text = await response.text();
    // A successful import or newer demo request takes priority over this fetch.
    if (requestedRevision !== datasetRevision) return false;
    ingest(text, 'Sunday Bakery · sample sales', true);
    return true;
  } catch (error) {
    if (requestedRevision !== datasetRevision) return false;
    throw error;
  }
}

function importCSV(text, name) {
  try {
    const warnings = ingest(text, name);
    $('upload-error').hidden = true;
    $('upload-dialog').close();
    $('csv-text').value = '';
    $('csv-file').value = '';
    notice(`${integer.format(rows.length)} sales records loaded. Dates reset to the last 28 days and previous-period comparison. Your data stays in this browser.${warnings.length ? ` ${warnings.join(' ')}` : ''}`);
  } catch (error) {
    $('upload-error').textContent = error.message;
    $('upload-error').hidden = false;
  }
}

$('open-upload').addEventListener('click', () => {
  $('upload-error').hidden = true;
  $('upload-dialog').showModal();
});
$('close-upload').addEventListener('click', () => $('upload-dialog').close());
$('upload-dialog').addEventListener('click', (event) => {
  if (event.target === $('upload-dialog')) {
    const rect = $('upload-dialog').getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('upload-dialog').close();
  }
});
$('csv-file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    $('upload-error').textContent = 'This file is too large. Choose a CSV smaller than 2 MiB.';
    $('upload-error').hidden = false;
    event.target.value = '';
    return;
  }
  try {
    importCSV(await file.text(), file.name);
  } catch {
    $('upload-error').textContent = 'The file could not be read. Please choose it again.';
    $('upload-error').hidden = false;
  }
});
$('analyze-paste').addEventListener('click', () => importCSV($('csv-text').value, 'Pasted sales'));
$('date-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!rows.length) return;
  try {
    const nextView = readView();
    const nextAnalysis = analyzeView(rows, nextView);
    render(nextAnalysis);
    syncViewControls(nextView, nextAnalysis);
    notice('');
  }
  catch (error) {
    $('date-error').textContent = `${error.message} The dashboard and exports still use your last applied dates.`;
    $('date-error').hidden = false;
  }
});
for (const id of ['period', 'range-start', 'range-end', 'comparison-mode', 'comparison-start', 'comparison-end']) $(id).addEventListener('input', () => { updateDateControls(); $('date-error').hidden = true; });
$('compare-product').addEventListener('change', updateOwnPrice);
$('product-sort').addEventListener('change', () => { if (analysis) renderProducts(analysis.products, false); });
$('reset-demo').addEventListener('click', async () => {
  try {
    if (await loadDemo()) notice('The synthetic bakery demo has been restored with the last 28 days and previous-period comparison.');
  } catch (error) { notice(error.message, true); }
});
$('price-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const product = analysis?.products.find((item) => item.product === $('compare-product').value);
  if (!product) return;
  const competitorPrice = Number($('competitor-price').value);
  try {
    const result = comparePrice(product, competitorPrice);
    lastComparison = { product: product.product, ownAveragePrice: product.avgPrice, competitorPrice, ...result };
    const relation = result.difference > 0 ? 'higher' : 'lower';
    const text = Math.abs(result.difference) < .005
      ? `${product.product}: your average price matches the observed price of ${money(competitorPrice)}.`
      : `${product.product}: your average price is ${money(Math.abs(result.difference))} ${relation}${result.percent === null ? '' : ` (${Math.abs(result.percent).toFixed(1)}%)`} than the observed price of ${money(competitorPrice)}.`;
    $('comparison-result').textContent = text + (competitorPrice === 0 ? ' A percentage comparison is unavailable against a zero price.' : ' Check portion size, quality, and costs before drawing conclusions.');
    $('comparison-result').hidden = false;
  } catch (error) {
    $('comparison-result').textContent = error.message;
    $('comparison-result').hidden = false;
  }
});
$('export-report').addEventListener('click', () => {
  if (!analysis) return;
  const report = { project: 'Shop Signals', schemaVersion: 3, generatedAt: new Date().toISOString(), currency: 'USD', source, view: { ...appliedView }, assumptions: ['Dates include both endpoints and use UTC calendar days. Dates without records are treated as zero sales.', 'Comparison changes require both full periods within the imported date span.', 'Unequal periods show total differences, but growth percentages are withheld.', 'Gross-margin changes are percentage points. Gross-profit growth percentages require a positive comparison baseline.', 'Revenue is quantity × unit price.', 'Product cost is quantity × unit_cost; gross profit is revenue minus product cost.', 'Aggregate cost and gross profit are null unless every record in that aggregate has a known cost.', 'Gross margin is gross profit divided by revenue × 100; it is null for zero revenue or missing costs.', 'Gross profit excludes operating expenses. Suggestions are rules, not forecasts.'], analysis, priceComparison: lastComparison };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = `shop-signals-${analysis.range.end}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice('Your report was exported as JSON. It includes the selected period, calculations, and suggestions.');
});
document.querySelectorAll('.nav-item').forEach((link) => link.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.remove('active'));
  link.classList.add('active');
}));

loadDemo().catch((error) => {
  $('dashboard').setAttribute('aria-busy', 'false');
  notice(error.message, true);
});
