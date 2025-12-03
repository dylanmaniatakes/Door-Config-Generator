# Door Config Generator

The **Door Config Generator** is a Python-based tool that parses an Avigilon ACM "Door Configuration Report" CSV and automatically generates clean wiring diagrams for each panel. It supports both command-line operation and a full graphical user interface (GUI).

The app identifies:
- Panels (1502 / LP1502)
- Subpanels (MR52 / MR1501 internal SIO)
- Doors assigned to each subpanel
- Hardware mappings (Reader, Door Position, Strike, REX inputs)

It then outputs clear PNG diagrams showing the layout.

---

## Features

### ✔ Automatic CSV Parsing  
Reads a standard Avigilon door configuration CSV and extracts all panel, subpanel, and door wiring details automatically.

### ✔ Diagram Generation  
Creates organized wiring diagrams using matplotlib:
- 1502 panel at top  
- MR52 subpanels beneath  
- Door hardware boxes under each subpanel  
- Optional connecting lines

### ✔ Graphical UI  
A Tkinter GUI allows:
- Selecting the CSV file
- Choosing an output folder
- Toggling whether diagram connection lines are drawn
- One‑click diagram generation

### ✔ CLI Mode  
Full command-line support for automation or scripting.

### ✔ PyInstaller Ready  
The script includes builtin `sys.frozen` detection so GUI mode is the default when compiled into a standalone executable.

---

## Installation

1. Clone or download the repository.
2. Install dependencies:

```
pip install pandas matplotlib
```

Tkinter is included by default on most macOS & Windows installations.

---

## Usage

### **GUI Mode (default for compiled app)**

To launch the GUI:

```
python generate_diagrams.py --gui
```

Or simply double-click the compiled executable.

---

### **CLI Mode**

```
python generate_diagrams.py --input "Door Config Report.csv" --output diagrams/
```

Optional:

```
--show-lines
```

Enables connecting lines in diagrams.

Example:

```
python generate_diagrams.py \
  --input "Door Config Report.csv" \
  --output output_diagrams \
  --show-lines
```

---

## Building a Standalone Executable (PyInstaller)

You can build a single-file executable on macOS like this:

```
pyinstaller --onefile --windowed --name DoorConfigGenerator generate_diagrams.py
```

The resulting app requires no Python installation and opens the GUI immediately.

---

## Output

The app produces PNG files such as:

```
Lower_School.png
Upper_School.png
Shakespeare.png
Mezz.png
Kindergarten.png
```

Each diagram contains:
- One panel  
- Its MR52 subpanels  
- All wired doors under each  
- Hardware boxes showing Reader, DPOS, Strike, REX inputs

---

## Project Structure

```
Door-Config-Generator/
├── generate_diagrams.py   # Main application code (CLI + GUI)
├── README.md              # Documentation (this file)
└── sample_reports/        # (optional) place sample CSV reports here
```

---

## Known Limitations

- Requires CSV exports in Avigilon's standard Door Configuration format.
- Diagram layout is intentionally simple for clarity.

---

## License

MIT License — free to use, modify, or embed into your workflows.

---