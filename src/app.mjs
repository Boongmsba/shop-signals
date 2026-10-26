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
let renderedPeriod = '28';
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

function renderProducts(products) {
  const tableRows = products.map((product) => {
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

function render() {
  const period = $('period').value;
  analysis = analyzeSales(rows, period === 'all' ? null : Number(period));
  const { totals, products, range } = analysis;
  $('revenue').textContent = money(totals.revenue);
  $('units').textContent = integer.format(totals.units);
  $('record-count').textContent = `Across ${integer.format(totals.records)} sales records`;
  $('average-price').textContent = money(totals.avgUnitPrice);
  const change = $('revenue-change');
  change.classList.remove('positive', 'negative');
  if (analysis.comparisonAvailable && analysis.changePct !== null) {
    const percent = analysis.changePct;
    change.textContent = `${percent >= 0 ? '↑' : '↓'} ${Math.abs(percent).toFixed(1)}% vs. previous ${range.days} days`;
    change.classList.add(percent >= 0 ? 'positive' : 'negative');
  } else {
    change.textContent = analysis.comparisonAvailable ? 'Previous period had $0 in revenue' : 'No complete previous period available';
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
  renderedPeriod = period;
}

function ingest(text, name, isDemo = false, period = $('period').value) {
  const parsed = parseSalesCSV(text);
  // Validate analysis before replacing the current dataset, preserving it on errors.
  analyzeSales(parsed.rows, period === 'all' ? null : Number(period));
  datasetRevision += 1;
  rows = parsed.rows;
  source = { name, isDemo: isDemo || text.includes('SYNTHETIC DEMO') };
  $('period').value = period;
  render();
  return parsed.warnings;
}

async function loadDemo(resetPeriod = false) {
  const requestedRevision = ++datasetRevision;
  try {
    const response = await fetch('./data/sample-sales.csv');
    if (!response.ok) throw new Error('The sample CSV could not be loaded. Try uploading a file or reloading the page.');
    const text = await response.text();
    // A successful import or newer demo request takes priority over this fetch.
    if (requestedRevision !== datasetRevision) return false;
    ingest(text, 'Sunday Bakery · sample sales', true, resetPeriod ? '28' : $('period').value);
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
    notice(`${integer.format(rows.length)} sales records loaded. Your data stays in this browser.${warnings.length ? ` ${warnings.join(' ')}` : ''}`);
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
$('period').addEventListener('change', () => {
  if (!rows.length) return;
  try { render(); notice(''); }
  catch (error) {
    $('period').value = renderedPeriod;
    notice(`${error.message} Your previous view has been kept.`, true);
  }
});
$('compare-product').addEventListener('change', updateOwnPrice);
$('reset-demo').addEventListener('click', async () => {
  try {
    if (await loadDemo(true)) notice('The synthetic bakery demo has been restored.');
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
  const report = { project: 'Shop Signals', generatedAt: new Date().toISOString(), currency: 'USD', source, assumptions: ['Dates without records are treated as zero sales.', 'Revenue is quantity × unit price, not profit.', 'Suggestions are rules, not forecasts.'], analysis, priceComparison: lastComparison };
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
