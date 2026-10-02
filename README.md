# Door Config Generator

Turn an Avigilon Access Control Manager **Door Configuration Report CSV** into panel wiring diagrams. The web app runs entirely in your browser and works offline. Reports are never uploaded, and no accounts, dependencies, or installation are needed.

## Web app

1. Open **`index.html`** in a modern browser such as Chrome, Edge, Firefox, or Safari.
2. Choose or drag in your Door Configuration Report `.csv` file.
3. Select a panel to review its subpanels, doors, and hardware assignments.
4. Optionally enable **Show connection lines** or adjust the preview zoom.
5. Download the selected panel as **PNG** or **SVG**, or choose **Download all PNGs** for a ZIP containing every panel.

Use **Try an example report** to explore the app with fictional data. **Download example CSV** provides an example of the accepted report structure.

The app starts in dark mode. The header toggle switches between light and dark and remembers your choice when browser storage is available. Diagram previews follow the selected theme. Downloads always use a light background for printing. Reports are held in memory and cleared when you close or reload the page.

You can also serve the files with any static web server. For example:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open `http://localhost:8000`. A server is optional; opening `index.html` directly works too.

## Report format

The app accepts comma-separated reports with **Name** and **Value** columns and repeated door sections. A door name must appear immediately before `Configuration and Communication Settings`; the section must include a `Panel` assignment and can include a `Hardware` section.

Example:

```csv
Name,Value
Main entrance,
Configuration and Communication Settings,
Panel,Main Building
Hardware,
Reader,Reader on subpanel 0 Address 1
Door Position,Contact (Subpanel:0 Input:1)
Strike,Strike (Subpanel:0 Output:1)
Rex #1,REX (Subpanel:0 Input:3)
```

Recognized hardware fields are Reader, Alternate Reader, Door Position, Strike, Rex #1, and Rex #2. Both `subpanel X Address Y` and `(Subpanel:X Input:Y)` / `(Subpanel:X Output:Y)` address forms are supported, including address zero. Quoted fields, commas inside quoted fields, multiline values, and UTF-8/UTF-16 reports are supported. Legacy Windows-1252 text is used as a fallback when UTF-8 decoding fails.

Doors are grouped by the first recognized Reader, Door Position, Strike, REX, or Alternate Reader assignment. The app reports missing mappings, duplicate door names, and hardware assigned to multiple subpanels. Unknown mappings remain visible, and duplicate door entries are retained. Sections without a door name or panel assignment are skipped with a warning. Invalid imports leave the previous report available.

## Limits

- Input must be the Name/Value CSV export. PDF reports, spreadsheets, and other CSV layouts are not supported.
- Upload size is limited to 20 MB. Large diagrams can be scrolled horizontally and vertically.
- Subpanel 0 is labeled **Internal SIO** and positive subpanel numbers **MR52**, following the original generator’s convention. These labels are not hardware model detection.
- Diagram connections show the report hierarchy, not an electrical wiring schematic. Verify hardware models, assignments, and wiring on site.
- PNG exports are capped at 8,192 pixels per side and 24 megapixels. Use SVG for large diagrams with scalable text.
- Downloaded files go to your browser’s configured download location.

## Python CLI and desktop GUI

The original Python generator remains available:

```sh
python3 -m pip install -r requirements.txt
python3 generate_diagrams.py --input "Door Config Report.csv" --output diagrams/
python3 generate_diagrams.py --input "Door Config Report.csv" --output diagrams/ --show-lines
python3 generate_diagrams.py --gui
```

The GUI requires Tkinter. Python dependencies are needed only for the original generator, not the web app.

To package the desktop GUI with PyInstaller:

```sh
pyinstaller --onefile --windowed --name DoorConfigGenerator generate_diagrams.py
```

## Development

The web app uses plain HTML, CSS, and JavaScript with no build step or external services:

- `index.html` — page and controls
- `styles.css` — responsive light and dark themes
- `door-config.js` — CSV parser, SVG renderer, example data, and ZIP writer
- `app.js` — file import, preview, theme preference, and browser downloads
- `generate_diagrams.py` — original Python CLI and GUI

Run the parser, diagram, and ZIP checks with Node.js:

```sh
node --test tests/core.test.js
```
