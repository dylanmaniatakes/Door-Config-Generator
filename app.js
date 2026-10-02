(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const { parseReport, renderDiagram, safeFilename, createZip, makeSample } = DoorConfig;
  let report = null, diagram = null, importToken = 0, exporting = false;

  function notify(text = '', error = false) {
    $('message').textContent = text;
    $('message').classList.toggle('error', error);
    $('message').hidden = !text;
  }
  function currentPanel() { return report.panels[Number($('panel-select').value)]; }
  function applyZoom() {
    const svg = $('diagram').querySelector('svg');
    if (!svg || !diagram) return;
    const available = Math.max(280, $('diagram').clientWidth - 36);
    const baseline = Math.min(diagram.width, Math.max(available, 640));
    const width = baseline * Number($('zoom').value) / 100;
    svg.style.width = `${width}px`;
    svg.style.height = `${width * diagram.height / diagram.width}px`;
    $('zoom-value').value = `${$('zoom').value}%`;
  }
  function showPanel() {
    if (!report) return;
    const panel = currentPanel();
    diagram = renderDiagram(panel, $('connectors').checked, document.documentElement.dataset.theme === 'dark');
    $('diagram').innerHTML = diagram.svg;
    const count = panel.subpanels.reduce((total, sp) => total + sp.doors.length, 0);
    $('panel-detail').textContent = `${panel.subpanels.length} subpanel groups · ${count} doors`;
    applyZoom();
  }
  function installReport(text, filename, demo = false) {
    // Parse before replacing the report, so an invalid import keeps the last useful result.
    const parsed = parseReport(text);
    report = parsed;
    $('panel-select').replaceChildren(...report.panels.map((panel, index) => new Option(panel.name, index)));
    $('panel-count').textContent = report.panels.length;
    $('subpanel-count').textContent = report.panels.reduce((sum, panel) => sum + panel.subpanels.length, 0);
    $('door-count').textContent = report.panels.reduce((sum, panel) => sum + panel.subpanels.reduce((count, sp) => count + sp.doors.length, 0), 0);
    $('file-name').textContent = filename; $('file-name').title = filename;
    $('file-info').hidden = false; $('empty-state').hidden = true; $('results').hidden = false;
    $('download-all').disabled = exporting;
    $('warnings').hidden = !report.warnings.length;
    $('warnings').open = false;
    $('warning-title').textContent = `${report.warnings.length} report ${report.warnings.length === 1 ? 'note' : 'notes'} to review`;
    $('warning-list').replaceChildren(...report.warnings.map(warning => {
      const item = document.createElement('li'); item.textContent = warning; return item;
    }));
    $('zoom').value = 100;
    showPanel();
    notify(demo ? 'Example report loaded. These are fictional panels and doors; import your CSV to generate your diagrams.' : `Loaded ${filename}. Your panel diagrams are ready.`);
  }
  async function readFile(file) {
    if (!file) return;
    const token = ++importToken;
    try {
      if (!/\.csv$/i.test(file.name)) throw new Error('Choose a .csv report. PDF reports are not supported.');
      if (file.size > 20 * 1024 * 1024) throw new Error('This report exceeds 20 MB. Export a smaller report and try again.');
      notify(`Reading ${file.name}…`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (token !== importToken) return;
      let encoding = 'utf-8';
      if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
      if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
      let text;
      try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
      catch { text = new TextDecoder('windows-1252').decode(bytes); }
      installReport(text, file.name);
    } catch (error) {
      if (token === importToken) notify(`${error.message}${report ? ' Your previous report is still available.' : ''}`, true);
    } finally { $('file-input').value = ''; }
  }
  function save(blob, filename) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function pngBlob(rendered) {
    // Cap the raster size to keep large panels within browser canvas limits.
    // SVG exports always preserve the complete vector diagram at full size.
    const scale = Math.min(2, 8192 / rendered.width, 8192 / rendered.height, Math.sqrt(24000000 / (rendered.width * rendered.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(rendered.width * scale)); canvas.height = Math.max(1, Math.floor(rendered.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('PNG export is unavailable in this browser. Download the SVG instead.');
    const url = URL.createObjectURL(new Blob([rendered.svg], { type: 'image/svg+xml;charset=utf-8' }));
    const img = new Image();
    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve; img.onerror = () => reject(new Error('Could not render the PNG. Download the SVG instead.')); img.src = url;
      });
      context.fillStyle = '#fcfdfb'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed. Download the SVG instead.')), 'image/png'));
    } finally { URL.revokeObjectURL(url); canvas.width = 1; canvas.height = 1; }
  }
  async function exportPNGs(all) {
    if (!report || exporting) return;
    exporting = true;
    const panels = all ? [...report.panels] : [currentPanel()];
    const showLines = $('connectors').checked;
    $('download-png').disabled = true; $('download-all').disabled = true;
    try {
      const files = [], usedNames = new Set();
      for (let i = 0; i < panels.length; i++) {
        const panel = panels[i];
        notify(`Preparing diagram ${i + 1} of ${panels.length}…`);
        const png = await pngBlob(renderDiagram(panel, showLines));
        if (!all) { save(png, `${safeFilename(panel.name)}.png`); break; }
        const base = safeFilename(panel.name);
        let name = `${base}.png`, suffix = 2;
        while (usedNames.has(name.toLowerCase())) name = `${base}_${suffix++}.png`;
        usedNames.add(name.toLowerCase());
        files.push({ name, data: new Uint8Array(await png.arrayBuffer()) });
      }
      if (all) save(createZip(files), 'Door_Config_Diagrams.zip');
      notify(all ? `Downloaded ${panels.length} panel diagrams in a ZIP file.` : 'Downloaded the panel diagram as PNG.');
    } catch (error) { notify(error.message, true); }
    finally { exporting = false; $('download-png').disabled = false; $('download-all').disabled = !report; }
  }
  $('file-input').addEventListener('change', event => readFile(event.target.files[0]));
  $('dropzone').addEventListener('dragover', event => { event.preventDefault(); $('dropzone').classList.add('dragging'); });
  $('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('dragging'));
  $('dropzone').addEventListener('drop', event => {
    event.preventDefault(); $('dropzone').classList.remove('dragging');
    if (event.dataTransfer.files.length !== 1) { notify('Drop one CSV report at a time.', true); return; }
    readFile(event.dataTransfer.files[0]);
  });
  // Prevent accidental navigation when a report is dropped outside the import box.
  document.addEventListener('dragover', event => event.preventDefault());
  document.addEventListener('drop', event => event.preventDefault());
  $('demo').addEventListener('click', () => { ++importToken; installReport(makeSample(), 'Example report · fictional data', true); });
  $('sample').addEventListener('click', () => save(new Blob([makeSample()], { type: 'text/csv;charset=utf-8' }), 'Example_Door_Config.csv'));
  $('reset').addEventListener('click', () => {
    ++importToken; report = null; diagram = null; $('file-input').value = '';
    $('file-info').hidden = true; $('empty-state').hidden = false; $('results').hidden = true;
    $('panel-select').replaceChildren(); $('diagram').replaceChildren(); $('download-all').disabled = true; notify();
  });
  $('panel-select').addEventListener('change', showPanel);
  $('connectors').addEventListener('change', showPanel);
  $('zoom').addEventListener('input', applyZoom);
  window.addEventListener('resize', applyZoom);
  $('download-svg').addEventListener('click', () => {
    if (!report || !diagram) return;
    const rendered = renderDiagram(currentPanel(), $('connectors').checked);
    save(new Blob([rendered.svg], { type: 'image/svg+xml;charset=utf-8' }), `${safeFilename(currentPanel().name)}.svg`);
    notify('Downloaded the panel diagram as SVG.');
  });
  $('download-png').addEventListener('click', () => exportPNGs(false));
  $('download-all').addEventListener('click', () => exportPNGs(true));
  function updateThemeToggle() {
    const dark = document.documentElement.dataset.theme === 'dark';
    $('theme-toggle').textContent = dark ? 'Light mode ☀' : 'Dark mode ◐';
    $('theme-toggle').setAttribute('aria-label', `Switch to ${dark ? 'light' : 'dark'} mode`);
    document.querySelector('meta[name="color-scheme"]').content = dark ? 'dark' : 'light';
  }
  $('theme-toggle').addEventListener('click', () => {
    document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('door-config-theme', document.documentElement.dataset.theme); } catch { /* Storage may be disabled. */ }
    updateThemeToggle(); showPanel();
  });
  updateThemeToggle();
})();
