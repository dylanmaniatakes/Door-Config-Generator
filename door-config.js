/* Shared, dependency-free report parser, diagram renderer, and ZIP writer. */
(function (root) {
  'use strict';
  const FIELDS = ['Reader', 'Alternate Reader', 'Door Position', 'Strike', 'Rex #1', 'Rex #2'];
  const LABELS = { Reader: 'Reader', 'Alternate Reader': 'Alt. reader', 'Door Position': 'DPOS input', Strike: 'LOCK output', 'Rex #1': 'REX 1 input', 'Rex #2': 'REX 2 input' };

  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], field = '', quoted = false, closedQuote = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else { quoted = false; closedQuote = true; }
        } else { field += ch; }
      } else if (ch === '"') {
        if (field.trim() || closedQuote) throw new Error('The CSV contains a misplaced quote. Export the report as CSV again.');
        field = ''; quoted = true;
      } else if (ch === ',') {
        row.push(field); field = ''; closedQuote = false;
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        if (row.some(value => value.trim())) rows.push(row);
        row = []; field = ''; closedQuote = false;
      } else {
        if (closedQuote && !/\s/.test(ch)) throw new Error('The CSV contains text after a closing quote. Export the report as CSV again.');
        if (!closedQuote) field += ch;
      }
    }
    if (quoted) throw new Error('The CSV has an unclosed quoted field. Export the report as CSV again.');
    row.push(field);
    if (row.some(value => value.trim())) rows.push(row);
    return rows;
  }

  function parseReport(text) {
    const rows = parseCSV(text);
    if (!rows.length) throw new Error('This file is empty. Choose an Avigilon Door Configuration CSV.');
    const headers = rows.shift().map(value => value.trim().toLowerCase());
    const nameColumn = headers.indexOf('name'), valueColumn = headers.indexOf('value');
    if (nameColumn < 0 || valueColumn < 0) throw new Error('Expected CSV columns named Name and Value. Choose the Avigilon ACM Door Configuration Report CSV, rather than a PDF or door list.');
    const data = rows.map((row, i) => {
      if (row.length !== headers.length) throw new Error(`CSV row ${i + 2} has ${row.length} columns; expected ${headers.length}. Fields containing commas must be quoted.`);
      return { name: row[nameColumn].trim(), value: row[valueColumn].trim() };
    });
    const starts = data.flatMap((row, i) => row.name === 'Configuration and Communication Settings' ? [i] : []);
    if (!starts.length) throw new Error('No door configuration sections were found. Export a Door Configuration Report with Name and Value columns.');
    const panels = new Map(), warnings = [];
    const seenDoors = new Set();
    for (let section = 0; section < starts.length; section++) {
      const start = starts[section];
      const end = section + 1 < starts.length ? starts[section + 1] - 1 : data.length;
      if (start === 0 || !data[start - 1].name) {
        warnings.push(`Section ${section + 1}: no door name before the configuration heading; skipped.`);
        continue;
      }
      const doorName = data[start - 1].name;
      const block = data.slice(start, end);
      const panelName = block.find(row => row.name === 'Panel')?.value;
      if (!panelName) { warnings.push(`${doorName}: missing panel assignment; skipped.`); continue; }
      const hardware = {};
      const hardwareStart = block.findIndex(row => row.name === 'Hardware');
      if (hardwareStart >= 0) {
        for (const row of block.slice(hardwareStart + 1)) {
          if (!FIELDS.includes(row.name)) continue;
          const match = row.value.match(/subpanel\s+(\d+)\s+address\s+(\d+)/i) || row.value.match(/subpanel\s*:\s*(\d+)\s+\w+\s*:?\s*(\d+)/i);
          hardware[row.name] = { raw: row.value, subpanel: match ? Number(match[1]) : null, address: match ? Number(match[2]) : null };
          if (row.value && !match && !/^(none|not configured|not assigned|n\/a|disabled)$/i.test(row.value)) warnings.push(`${doorName} / ${row.name}: could not read an address from “${row.value}”.`);
        }
      }
      const primary = ['Reader', 'Door Position', 'Strike', 'Rex #1', 'Rex #2', 'Alternate Reader'].map(key => hardware[key]).find(value => value?.subpanel !== null && value?.subpanel !== undefined);
      const subpanel = primary ? primary.subpanel : -1;
      const doorIndex = primary ? primary.address : -1;
      if (!primary) warnings.push(`${doorName}: no recognized subpanel address. Shown in the Unassigned group.`);
      if (Object.values(hardware).some(info => info.subpanel !== null && info.subpanel !== subpanel)) warnings.push(`${doorName}: hardware spans multiple subpanels. Grouped by its primary mapping; individual subpanels are shown on each hardware line.`);
      const identity = JSON.stringify([panelName, doorName]);
      if (seenDoors.has(identity)) warnings.push(`${doorName}: duplicate door name on ${panelName}. Both entries are included.`);
      seenDoors.add(identity);
      if (!panels.has(panelName)) panels.set(panelName, { name: panelName, subpanels: new Map() });
      const panel = panels.get(panelName);
      if (!panel.subpanels.has(subpanel)) panel.subpanels.set(subpanel, { number: subpanel, doors: [] });
      panel.subpanels.get(subpanel).doors.push({ name: doorName, doorIndex, hardware });
    }
    if (!panels.size) throw new Error('No doors with panel assignments were found. Check the report’s Panel values.');
    const result = [...panels.values()].map(panel => ({
      name: panel.name,
      subpanels: [...panel.subpanels.values()].sort((a, b) => (a.number < 0 ? Infinity : a.number) - (b.number < 0 ? Infinity : b.number)).map(subpanel => ({
        ...subpanel, doors: subpanel.doors.sort((a, b) => (a.doorIndex < 0 ? Infinity : a.doorIndex) - (b.doorIndex < 0 ? Infinity : b.doorIndex))
      }))
    }));
    return { panels: result, warnings };
  }

  function escapeXML(value) {
    return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
  }

  function wrap(text, max = 35) {
    const lines = [];
    for (const paragraph of String(text).split(/\r?\n/)) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (line && line.length + word.length + 1 > max) { lines.push(line); line = ''; }
        let remainder = word;
        while (remainder.length > max) {
          if (line) { lines.push(line); line = ''; }
          lines.push(remainder.slice(0, max)); remainder = remainder.slice(max);
        }
        line += (line && remainder ? ' ' : '') + remainder;
      }
      lines.push(line);
    }
    return lines.length ? lines : [''];
  }

  function hardwareLines(door, subpanelNumber) {
    const lines = [];
    for (const field of FIELDS) {
      const info = door.hardware[field];
      if (!info) continue;
      if (info.address !== null) {
        lines.push(`${LABELS[field]}: ${info.address}${info.subpanel !== subpanelNumber ? ` (SP ${info.subpanel})` : ''}`);
      } else if (info.raw) {
        lines.push(...wrap(`${LABELS[field]}: ${info.raw}`));
      }
    }
    return lines.length ? lines : ['No hardware mappings in report'];
  }

  function renderDiagram(panel, showLines = false, dark = false) {
    const columnWidth = 310, gap = 24, margin = 32;
    const width = Math.max(720, margin * 2 + panel.subpanels.length * columnWidth + (panel.subpanels.length - 1) * gap);
    const titleLines = wrap(panel.name, 42);
    const controllerHeight = 58 + titleLines.length * 22;
    const controllerY = 72, branchY = controllerY + controllerHeight + 25, subpanelY = branchY + 28, doorsY = subpanelY + 100;
    const columns = panel.subpanels.map(sp => {
      let y = doorsY;
      const doors = sp.doors.map(door => {
        const names = wrap(door.name), hardware = hardwareLines(door, sp.number);
        const height = 61 + names.length * 18 + hardware.length * 18;
        const layout = { door, names, hardware, y, height };
        y += height + 22;
        return layout;
      });
      return { sp, doors, end: y };
    });
    const height = Math.max(430, ...columns.map(column => column.end)) + 42;
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="diagram-title diagram-desc">`,
      `<title id="diagram-title">${escapeXML(panel.name)} wiring diagram</title>`,
      '<desc id="diagram-desc">Controller, subpanel groups, and door hardware assignments from an Avigilon Door Configuration Report.</desc>',
      `<rect width="${width}" height="${height}" fill="#fcfdfb"/>`,
      '<g font-family="Arial, Helvetica, sans-serif">'];
    function text(x, y, content, size = 12, color = '#334b3e', weight = 400, anchor = 'start') {
      parts.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}">${escapeXML(content)}</text>`);
    }
    text(32, 30, 'DOOR CONFIG / PANEL WIRING MAP', 10, '#7c8b7b', 600);
    const controllerWidth = Math.min(width - 64, 480);
    const centerOffset = (width - (panel.subpanels.length * columnWidth + (panel.subpanels.length - 1) * gap)) / 2;
    const centers = columns.map((_, i) => centerOffset + i * (columnWidth + gap) + columnWidth / 2);
    if (showLines) {
      parts.push('<g fill="none" stroke="#a3b59c" stroke-width="1.5">');
      parts.push(`<path d="M${width / 2} ${controllerY + controllerHeight} V${branchY} M${centers[0]} ${branchY} H${centers.at(-1)}"/>`);
      columns.forEach((column, i) => {
        const x = centerOffset + i * (columnWidth + gap), cx = centers[i];
        parts.push(`<path d="M${cx} ${branchY} V${subpanelY} M${cx} ${subpanelY + 70} V${subpanelY + 86} H${x - 12} V${column.doors.at(-1).y + 26}"/>`);
        column.doors.forEach(layout => parts.push(`<path d="M${x - 12} ${layout.y + 26} H${x}"/>`));
      });
      parts.push('</g>');
    }
    parts.push(`<rect x="${(width - controllerWidth) / 2}" y="${controllerY}" width="${controllerWidth}" height="${controllerHeight}" rx="10" fill="#235b4a"/>`);
    text(width / 2, controllerY + 25, 'CONTROLLER', 10, '#bbd2bc', 600, 'middle');
    titleLines.forEach((line, i) => text(width / 2, controllerY + 51 + i * 22, line, 19, '#fff', 600, 'middle'));
    columns.forEach((column, i) => {
      const x = centerOffset + i * (columnWidth + gap), { sp } = column;
      parts.push(`<rect x="${x}" y="${subpanelY}" width="${columnWidth}" height="70" rx="8" fill="#edf2e8" stroke="#bbcdb1"/>`);
      text(centers[i], subpanelY + 28, sp.number < 0 ? 'Unassigned' : `Subpanel ${sp.number}`, 15, '#3f6145', 600, 'middle');
      text(centers[i], subpanelY + 49, sp.number < 0 ? 'No recognized subpanel mapping' : sp.number === 0 ? 'Internal SIO' : 'MR52', 11, '#7b8e70', 400, 'middle');
      column.doors.forEach(layout => {
        const { door, names, hardware, y, height: boxHeight } = layout;
        parts.push(`<rect x="${x}" y="${y}" width="${columnWidth}" height="${boxHeight}" rx="8" fill="#fff" stroke="#d5dfcd"/>`);
        parts.push(`<rect x="${x}" y="${y + 16}" width="3" height="24" rx="1.5" fill="#97b582"/>`);
        text(x + 18, y + 23, door.doorIndex < 0 ? 'DOOR / ADDRESS UNKNOWN' : `DOOR / ADDRESS ${door.doorIndex}`, 9, '#879579', 600);
        names.forEach((line, lineIndex) => text(x + 18, y + 46 + lineIndex * 18, line, 13, '#2f4c3c', 600));
        const ruleY = y + 40 + names.length * 18;
        parts.push(`<path d="M${x + 18} ${ruleY} H${x + columnWidth - 18}" stroke="#edf0e8"/>`);
        hardware.forEach((line, lineIndex) => text(x + 18, ruleY + 22 + lineIndex * 18, line, 11, '#63785a'));
      });
    });
    text(32, height - 17, 'Generated from report data. Verify assignments and hardware on site.', 10, '#879480');
    parts.push('</g></svg>');
    let svg = parts.join('');
    if (dark) {
      const colors = { '#fcfdfb': '#101113', '#7c8b7b': '#999794', '#a3b59c': '#6e492f', '#235b4a': '#402515', '#bbd2bc': '#ffb780', '#edf2e8': '#201a16', '#bbcdb1': '#674127', '#3f6145': '#ffb780', '#7b8e70': '#b6a79b', '#fff': '#f4f1ed', '#d5dfcd': '#3a3632', '#97b582': '#ff8a3d', '#879579': '#cb9b78', '#2f4c3c': '#eee9e3', '#edf0e8': '#302b26', '#63785a': '#bdb8b1', '#879480': '#96928d' };
      svg = svg.replace(/(fill|stroke)="(#[a-f0-9]+)"/g, (match, attribute, color) => `${attribute}="${colors[color] || color}"`);
      // Door cards use a dark fill; controller text remains light.
      svg = svg.replace(/(<rect[^>]+)fill="#f4f1ed"/g, '$1fill="#18181b"');
    }
    return { svg, width, height };
  }

  function safeFilename(name) {
    const safe = name.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/\s+/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 100) || 'Panel';
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safe) ? `Panel_${safe}` : safe;
  }

  const crcTable = Array.from({ length: 256 }, (_, value) => {
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    return value >>> 0;
  });
  function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  // ZIP's STORE method keeps the app offline; PNGs are already compressed.
  function createZip(files) {
    const locals = [], central = [];
    const encoder = new TextEncoder();
    let offset = 0;
    for (const file of files) {
      const name = encoder.encode(file.name), data = file.data;
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
      view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true);
      view.setUint16(6, 0x800, true); view.setUint16(12, 33, true);
      view.setUint32(14, crc, true); view.setUint32(18, data.length, true); view.setUint32(22, data.length, true);
      view.setUint16(26, name.length, true); local.set(name, 30);
      locals.push(local, data);
      const entry = new Uint8Array(46 + name.length), entryView = new DataView(entry.buffer);
      entryView.setUint32(0, 0x02014b50, true); entryView.setUint16(4, 20, true); entryView.setUint16(6, 20, true);
      entryView.setUint16(8, 0x800, true); entryView.setUint16(14, 33, true);
      entryView.setUint32(16, crc, true); entryView.setUint32(20, data.length, true); entryView.setUint32(24, data.length, true);
      entryView.setUint16(28, name.length, true); entryView.setUint32(42, offset, true); entry.set(name, 46);
      central.push(entry); offset += local.length + data.length;
    }
    const centralSize = central.reduce((sum, bytes) => sum + bytes.length, 0);
    const end = new Uint8Array(22), endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, files.length, true); endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true); endView.setUint32(16, offset, true);
    return new Blob([...locals, ...central, end], { type: 'application/zip' });
  }

  function makeSample() {
    const doors = [
      ['Main Building', 0, 1, '101 · Main entrance'], ['Main Building', 0, 2, '102 · Reception'],
      ['Main Building', 1, 1, '103 · Staff room'], ['Main Building', 1, 2, '104 · West exit'],
      ['East Building', 2, 1, '201 · Lobby'], ['East Building', 2, 2, '202 · Storage']
    ];
    const rows = [['Name', 'Value']];
    for (const [panel, sp, address, name] of doors) {
      rows.push([name, ''], ['Configuration and Communication Settings', ''], ['Panel', panel], ['Hardware', ''],
        ['Reader', `Reader on subpanel ${sp} Address ${address}`],
        ['Door Position', `Contact (Subpanel:${sp} Input:${address})`],
        ['Strike', `Strike (Subpanel:${sp} Output:${address})`],
        ['Rex #1', `REX (Subpanel:${sp} Input:${address + 2})`], ['Rex #2', 'Not configured']);
    }
    return rows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';
  }

  const api = { parseCSV, parseReport, renderDiagram, safeFilename, createZip, makeSample };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DoorConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
