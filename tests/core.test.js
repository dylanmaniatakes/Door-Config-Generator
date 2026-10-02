'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCSV, parseReport, renderDiagram, safeFilename, createZip, makeSample } = require('../door-config.js');

function reportCSV(doors) {
  const rows = [['Name', 'Value']];
  for (const door of doors) rows.push([door.name, ''], ['Configuration and Communication Settings', ''], ['Panel', door.panel ?? 'Test panel'], ['Hardware', ''], ...Object.entries(door.hardware || {}));
  return rows.map(row => row.map(value => `"${value.replace(/"/g, '""')}"`).join(',')).join('\r\n');
}

test('CSV preserves escaped quotes, comma fields, BOM, and multiline values', () => {
  assert.deepEqual(parseCSV('\uFEFFName,Value\r\n"A, B","He said ""Hi""\nnext line"\r\n\r\n'), [['Name', 'Value'], ['A, B', 'He said "Hi"\nnext line']]);
});

test('example groups six doors across two panels and three subpanels', () => {
  const report = parseReport(makeSample());
  assert.equal(report.panels.length, 2);
  assert.deepEqual(report.panels.map(panel => panel.subpanels.map(sp => [sp.number, sp.doors.length])), [[[0, 2], [1, 2]], [[2, 2]]]);
  assert.equal(report.warnings.length, 0);
  const hardware = report.panels[0].subpanels[0].doors[0].hardware;
  assert.equal(hardware.Reader.address, 1); assert.equal(hardware['Rex #1'].address, 3);
});

test('retains address zero and parses flexible subpanel spacing', () => {
  const report = parseReport(reportCSV([{ name: 'Zero address', hardware: { Reader: 'Reader on subpanel 0 Address 0', Strike: 'Strike (Subpanel: 0 Output: 0)' } }]));
  const sp = report.panels[0].subpanels[0];
  assert.equal(sp.number, 0); assert.equal(sp.doors[0].doorIndex, 0);
  assert.equal(sp.doors[0].hardware.Strike.address, 0);
  assert.match(renderDiagram(report.panels[0]).svg, /LOCK output: 0/);
});

test('retains duplicate entries and unknown hardware with review warnings', () => {
  const report = parseReport(reportCSV([
    { name: 'Same door', hardware: { Reader: 'Reader on subpanel 1 Address 1' } },
    { name: 'Same door', hardware: { Reader: 'Reader on subpanel 1 Address 2' } },
    { name: 'Unknown', hardware: { Reader: 'Unusual device mapping' } }
  ]));
  assert.equal(report.panels[0].subpanels[0].doors.length, 2);
  assert.equal(report.panels[0].subpanels[1].number, -1);
  assert.ok(report.warnings.some(value => value.includes('duplicate')));
  assert.ok(report.warnings.some(value => value.includes('Unassigned')));
  const svg = renderDiagram(report.panels[0]).svg;
  assert.match(svg, /Unusual device mapping/); assert.match(svg, /Unassigned/);
  assert.doesNotMatch(svg, /Subpanel -1/);
});

test('cross-subpanel mappings remain visible and alternate reader can establish group', () => {
  const report = parseReport(reportCSV([
    { name: 'Cross mapping', hardware: { Reader: 'Reader on subpanel 1 Address 2', Strike: '(Subpanel:3 Output:4)' } },
    { name: 'Alt only', hardware: { 'Alternate Reader': 'Reader on subpanel 2 Address 1' } }
  ]));
  assert.deepEqual(report.panels[0].subpanels.map(sp => sp.number), [1, 2]);
  assert.ok(report.warnings.some(value => value.includes('multiple subpanels')));
  assert.match(renderDiagram(report.panels[0]).svg, /LOCK output: 4 \(SP 3\)/);
});

test('missing panel section is skipped without contaminating the next door', () => {
  const report = parseReport(reportCSV([{ name: 'Skipped', panel: '', hardware: { Reader: 'Reader on subpanel 9 Address 1' } }, { name: 'Included', hardware: { Reader: 'Reader on subpanel 0 Address 1' } }]));
  assert.equal(report.panels[0].subpanels[0].doors[0].name, 'Included');
  assert.equal(report.warnings.length, 1);
});

test('rejects malformed quotes, missing columns, uneven rows, and reports with no doors', () => {
  for (const input of ['', 'Wrong,Headers\nA,B', 'Name,Value\nList,Only', 'Name,Value\n"unclosed,', 'Name,Value\nBad,unquoted,comma', 'Name,Value\n"bad"tail,']) assert.throws(() => parseReport(input));
});

test('renders escaped SVG labels and switchable connectors and themes', () => {
  const report = parseReport(reportCSV([{ name: '<script>alert("test")</script> & Door', panel: 'Panel <A>', hardware: { Reader: 'Reader on subpanel 0 Address 1' } }]));
  const light = renderDiagram(report.panels[0]);
  assert.match(light.svg, /Panel &lt;A&gt;/); assert.doesNotMatch(light.svg, /<script>/);
  assert.match(light.svg, /fill="#fcfdfb"/);
  assert.doesNotMatch(light.svg, /stroke="#a3b59c"/);
  assert.match(renderDiagram(report.panels[0], true).svg, /stroke="#a3b59c"/);
  assert.match(renderDiagram(report.panels[0], false, true).svg, /fill="#101113"/);
});

test('large diagrams expand to preserve all hardware lines', () => {
  const doors = Array.from({ length: 20 }, (_, i) => ({ name: `Door ${i}`, hardware: { Reader: `Reader on subpanel 1 Address ${i}`, 'Rex #1': 'Very long unrecognized mapping with plenty of words that should wrap across multiple lines without losing the original information' } }));
  const rendered = renderDiagram(parseReport(reportCSV(doors)).panels[0]);
  assert.ok(rendered.height > 3000); assert.match(rendered.svg, /Door 19/);
});

test('download names cannot become paths or reserved Windows names', () => {
  assert.equal(safeFilename('../Bad/Panel:*?'), '_Bad_Panel___');
  assert.equal(safeFilename('CON'), 'Panel_CON');
  assert.equal(safeFilename('   '), '_');
  assert.equal(safeFilename('Main Building'), 'Main_Building');
});

test('ZIP records include CRC32, UTF-8 filenames, and matching offsets', async () => {
  const data = new TextEncoder().encode('123456789');
  const zip = new Uint8Array(await createZip([{ name: 'Pañel.png', data }, { name: 'Second.png', data: new Uint8Array([1, 2, 3]) }]).arrayBuffer());
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(14, true), 0xcbf43926);
  assert.equal(view.getUint16(6, true), 0x800);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 8, true), 2);
  const centralOffset = view.getUint32(end + 16, true);
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50);
  assert.equal(view.getUint32(centralOffset + 42, true), 0);
  assert.equal(view.getUint32(end + 12, true), end - centralOffset);
});
