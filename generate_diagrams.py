"""
generate_diagrams.py
--------------------

This module provides a small command‑line application for turning an
Avigilon Access Control Manager "Door Configuration Report" (exported
as a CSV) into a set of simple wiring diagrams.  Each diagram shows
the main 1502 panel, its MR52 subpanels and the doors wired into
each subpanel.  Hardware details such as reader, door position
contact (DPOS), strike and REX inputs are annotated on each door
box.

The input CSV is expected to have two columns, ``Name`` and ``Value``,
with repeating sections describing each door.  This matches the
format produced by Avigilon's built‑in reporting tools.  The script
automatically groups doors by panel and subpanel by inspecting the
"Hardware" section within each door definition.

Usage::

    python generate_diagrams.py --input Door_Config_Report.csv --output diagrams

The script will produce one PNG file per panel in the specified
output directory.  By default the diagrams are drawn without any
connecting lines between boxes; you can include vertical lines
instead by passing ``--show-lines``.

This file can be reused or modified as needed.  It depends only on
Pandas and Matplotlib, both of which can be installed via pip
(`pip install pandas matplotlib`).
"""

import argparse
import sys
import os
import re
from typing import Dict, Any

import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np

# Optional imports for GUI mode.  These are only loaded when
# ``--gui`` is requested; they are otherwise unused.
try:
    import tkinter as tk
    from tkinter import filedialog, messagebox
except ImportError:
    # Tkinter may not be available in all environments; GUI mode will not work.
    tk = None
    filedialog = None
    messagebox = None


def parse_door_config(csv_path: str) -> Dict[str, Dict[int, Dict[str, Any]]]:
    """Parse a Door Configuration Report CSV into a nested data structure.

    The returned dictionary is keyed by panel name.  Each panel maps
    to another dictionary keyed by subpanel number.  Each subpanel
    maps to a dictionary where keys are door names and values hold
    door index and hardware details.

    Parameters
    ----------
    csv_path : str
        Path to the exported CSV report.

    Returns
    -------
    Dict[str, Dict[int, Dict[str, Any]]]
        The parsed structure.  Example::

            {
                'Upper School': {
                    0: {
                        '109.1 Data Room': {
                            'door_index': 1,
                            'hardware': { ... }
                        },
                        ...
                    },
                    3: { ... },
                    ...
                },
                ...
            }
    """
    df = pd.read_csv(csv_path)
    # locate boundaries between door definitions
    cfg_indices = df.index[df['Name'] == 'Configuration and Communication Settings'].tolist()
    cfg_indices.append(len(df))  # sentinel for last door

    panels_structure: Dict[str, Dict[int, Dict[str, Any]]] = {}

    for idx in range(len(cfg_indices) - 1):
        start_cfg = cfg_indices[idx]
        end_cfg = cfg_indices[idx + 1]
        header_index = start_cfg - 1  # the row above "Configuration and Communication Settings" holds the door name
        if header_index < 0:
            continue
        door_name = str(df.loc[header_index, 'Name'])
        # Extract rows for this door
        block = df.loc[header_index:end_cfg - 1].reset_index(drop=True)
        # Determine panel name
        panel_rows = block[block['Name'] == 'Panel']
        if panel_rows.empty:
            continue
        panel_name = str(panel_rows['Value'].iloc[0]).strip()

        # Extract hardware info
        hardware_data: Dict[str, Dict[str, Any]] = {}
        hardware_start_rows = block[block['Name'] == 'Hardware'].index.tolist()
        if hardware_start_rows:
            # Iterate over hardware lines immediately following the "Hardware" row
            for _, row in block.loc[hardware_start_rows[0] + 1:].iterrows():
                name = row['Name']
                # Only consider specific hardware fields
                if name in ['Reader', 'Alternate Reader', 'Door Position', 'Strike', 'Rex #1', 'Rex #2']:
                    raw_value = str(row['Value']) if pd.notna(row['Value']) else ''
                    # Extract subpanel and address numbers from the raw value
                    subpanel = None
                    address = None
                    # Pattern: "Reader on subpanel X Address Y"
                    m = re.search(r'subpanel\s+(\d+)\s+Address\s+(\d+)', raw_value, re.IGNORECASE)
                    # Pattern: "... (Subpanel:X Input:Y)" or similar
                    if not m:
                        m = re.search(r'Subpanel:(\d+)\s+\w+:?(\d+)', raw_value, re.IGNORECASE)
                    if m:
                        try:
                            subpanel = int(m.group(1))
                        except (ValueError, TypeError):
                            subpanel = None
                        try:
                            address = int(m.group(2))
                        except (ValueError, TypeError):
                            address = None
                    hardware_data[name] = {
                        'subpanel': subpanel,
                        'address': address,
                        'raw': raw_value,
                    }

        # Determine which subpanel and door index this door belongs to
        subpanel_num = -1
        door_index = -1
        for key in ['Reader', 'Door Position', 'Strike', 'Rex #1', 'Rex #2']:
            if key in hardware_data and hardware_data[key]['subpanel'] is not None:
                subpanel_num = hardware_data[key]['subpanel']
                door_index = hardware_data[key]['address'] if hardware_data[key]['address'] is not None else -1
                break

        # Insert into the structure
        panel_dict = panels_structure.setdefault(panel_name, {})
        subpanel_dict = panel_dict.setdefault(subpanel_num, {})
        subpanel_dict[door_name] = {
            'door_index': door_index,
            'hardware': hardware_data,
        }

    return panels_structure


def draw_panel_diagram(
    panel_name: str,
    subpanels: Dict[int, Dict[str, Any]],
    output_file: str,
    show_lines: bool = False,
) -> None:
    """Generate a wiring diagram for a single panel and save it as a PNG file.

    Parameters
    ----------
    panel_name : str
        Name of the panel (LP‑1502 controller).
    subpanels : Dict[int, Dict[str, Any]]
        Mapping of subpanel number to its doors and associated metadata.
    output_file : str
        Path where the PNG image will be written.
    show_lines : bool, optional
        If True, vertical lines will be drawn connecting the panel to
        subpanels and subpanels to doors.  If False, no lines are drawn
        and the hierarchy is implied solely by layout.  Defaults to
        False.
    """
    n = len(subpanels)
    if n == 0:
        return
    max_doors = max(len(doors) for doors in subpanels.values())
    # Scale figure size based on number of subpanels and maximum doors
    fig_width = max(12, 3 * n)
    fig_height = max(6, 2 + 1.5 * max_doors)
    fig, ax = plt.subplots(figsize=(fig_width, fig_height))
    ax.axis('off')

    # Draw the main panel at the top
    panel_x = 0.5
    panel_y = 0.95
    panel_width = 0.4
    panel_height = 0.08
    rect_panel = patches.FancyBboxPatch(
        (panel_x - panel_width / 2, panel_y - panel_height / 2),
        panel_width,
        panel_height,
        boxstyle="round,pad=0.02",
        edgecolor='black',
        facecolor='#f0f0f0',
    )
    ax.add_patch(rect_panel)
    ax.text(
        panel_x,
        panel_y,
        f"Panel\n{panel_name}",
        ha='center',
        va='center',
        fontsize=14,
        weight='bold',
    )

    # Sort subpanels for consistent ordering
    subpanel_numbers = sorted(subpanels.keys())
    for i, sp in enumerate(subpanel_numbers):
        # Determine horizontal span for this subpanel (relative coordinates [0,1])
        col_start = i / n
        col_end = (i + 1) / n
        sub_x_center = (col_start + col_end) / 2
        sub_width = (col_end - col_start) * 0.8
        sub_height = 0.1
        sub_y = 0.75

        # Optionally draw a vertical line from the panel to the subpanel
        if show_lines:
            ax.plot(
                [sub_x_center, sub_x_center],
                [panel_y - panel_height / 2, sub_y + sub_height / 2],
                color='black',
            )

        # Draw the subpanel box
        rect_sp = patches.FancyBboxPatch(
            (sub_x_center - sub_width / 2, sub_y - sub_height / 2),
            sub_width,
            sub_height,
            boxstyle="round,pad=0.02",
            edgecolor='blue',
            facecolor='#e6f0ff',
        )
        ax.add_patch(rect_sp)
        sp_label = f"Subpanel {sp}\n{'Internal SIO' if sp == 0 else 'MR52'}"
        ax.text(
            sub_x_center,
            sub_y,
            sp_label,
            ha='center',
            va='center',
            fontsize=10,
            color='blue',
        )

        # Draw the doors below this subpanel
        doors = subpanels[sp]
        m = len(doors)
        if m == 0:
            continue
        # Determine the vertical region for door boxes (between 0.6 and 0.1)
        door_region_top = 0.6
        door_region_bottom = 0.1
        door_region_height = door_region_top - door_region_bottom
        door_height = door_region_height / m * 0.8
        door_spacing = door_region_height / m * 0.2
        # Sort the doors by door index to keep a consistent order
        door_items = sorted(
            doors.items(),
            key=lambda kv: kv[1]['door_index'] if kv[1]['door_index'] >= 0 else 99,
        )
        y_cursor = door_region_top - door_height / 2
        for door_name, door_data in door_items:
            # Optionally draw a vertical line from subpanel to door
            if show_lines:
                ax.plot(
                    [sub_x_center, sub_x_center],
                    [sub_y - sub_height / 2, y_cursor + door_height / 2],
                    color='black',
                )
            # Determine door box width relative to the subpanel width
            d_width = sub_width * 0.9
            rect_d = patches.FancyBboxPatch(
                (sub_x_center - d_width / 2, y_cursor - door_height / 2),
                d_width,
                door_height,
                boxstyle="round,pad=0.02",
                edgecolor='green',
                facecolor='#eaffea',
            )
            ax.add_patch(rect_d)
            # Compose the label inside the door box
            lines = [door_name]
            if door_data['door_index'] > 0:
                lines.append(f"Addr: {door_data['door_index']}")
            for key in ['Reader', 'Door Position', 'Strike', 'Rex #1', 'Rex #2']:
                if key in door_data['hardware']:
                    info = door_data['hardware'][key]
                    addr = info['address']
                    if addr is not None and addr > 0:
                        short = (
                            key.replace('Door Position', 'DPOS')
                            .replace('Strike', 'LOCK Output')
                            .replace('Rex #1', 'REX1 Input')
                            .replace('Rex #2', 'REX2 Input')
                            .replace('Reader', 'RDR Output')
                        )
                        lines.append(f"{short}:{addr}")
            label = '\n'.join(lines)
            ax.text(
                sub_x_center,
                y_cursor,
                label,
                ha='center',
                va='center',
                fontsize=8,
            )
            y_cursor -= (door_height + door_spacing)

    # Finalize axes limits
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    fig.savefig(output_file, dpi=150, bbox_inches='tight')
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate wiring diagrams from an Avigilon door config CSV.")
    parser.add_argument(
        '--input',
        required=False,
        help='Path to the door configuration CSV exported from Avigilon',
    )
    parser.add_argument(
        '--output',
        required=False,
        help='Directory where diagram images should be written',
    )
    parser.add_argument(
        '--show-lines',
        action='store_true',
        help='Include vertical connector lines in the diagrams (default: no lines)',
    )

    parser.add_argument(
        '--gui',
        action='store_true',
        default=getattr(sys, "frozen", False),
        help='Launch a graphical user interface instead of using command-line arguments.',
    )
    args = parser.parse_args()

    # Require --input and --output unless --gui is used
    if not args.gui and (not args.input or not args.output):
        parser.error("--input and --output are required unless --gui is used.")

    # If GUI mode is requested, launch the graphical interface and exit.
    if args.gui:
        if tk is None:
            print("Tkinter is not available in this environment; GUI mode cannot be launched.")
            return
        launch_gui()
        return

    csv_path = args.input
    out_dir = args.output
    show_lines = args.show_lines

    panels = parse_door_config(csv_path)
    if not panels:
        print(f"No panels found in '{csv_path}'. Check that the file matches the expected format.")
        return

    os.makedirs(out_dir, exist_ok=True)
    for panel_name, subpanels in panels.items():
        # Construct a filename safe for filesystem
        safe_name = panel_name.replace(' ', '_')
        output_file = os.path.join(out_dir, f"{safe_name}.png")
        draw_panel_diagram(panel_name, subpanels, output_file, show_lines=show_lines)
        print(f"Wrote diagram for {panel_name} to {output_file}")


def launch_gui() -> None:
    """Launch a simple Tkinter interface for generating diagrams.

    This function builds a small form that allows the user to select
    the CSV file and output directory via file dialogs, choose
    whether to show connector lines, and then generate diagrams with
    the click of a button.  The GUI is only available if Tkinter is
    installed in the Python environment.
    """
    # Check again that Tkinter is available
    if tk is None or filedialog is None:
        raise RuntimeError("Tkinter is not available; cannot launch GUI mode.")

    root = tk.Tk()
    root.title("Door Diagram Generator")
    root.resizable(False, False)

    # Variables to hold user selections
    csv_var = tk.StringVar()
    outdir_var = tk.StringVar()
    show_lines_var = tk.BooleanVar(value=False)

    def choose_csv() -> None:
        path = filedialog.askopenfilename(
            title="Select CSV file", filetypes=[("CSV files", "*.csv"), ("All files", "*.*")]
        )
        if path:
            csv_var.set(path)

    def choose_output_dir() -> None:
        path = filedialog.askdirectory(title="Select output directory")
        if path:
            outdir_var.set(path)

    def run_generation() -> None:
        csv_path = csv_var.get()
        outdir = outdir_var.get()
        show_lines = show_lines_var.get()
        if not csv_path or not os.path.isfile(csv_path):
            messagebox.showerror("Error", "Please select a valid CSV file.")
            return
        if not outdir:
            messagebox.showerror("Error", "Please select an output directory.")
            return
        try:
            panels = parse_door_config(csv_path)
            if not panels:
                messagebox.showwarning(
                    "No Panels Found",
                    "No panels could be parsed from the selected CSV file.\n"
                    "Ensure the file matches the expected format.",
                )
                return
            os.makedirs(outdir, exist_ok=True)
            for panel_name, subpanels in panels.items():
                safe_name = panel_name.replace(' ', '_')
                output_file = os.path.join(outdir, f"{safe_name}.png")
                draw_panel_diagram(panel_name, subpanels, output_file, show_lines=show_lines)
            messagebox.showinfo("Done", f"Diagrams generated in {outdir}")
        except Exception as exc:
            messagebox.showerror("Error", f"An error occurred: {exc}")

    # Layout of the UI
    frame = tk.Frame(root, padx=10, pady=10)
    frame.grid(row=0, column=0, sticky="nsew")

    # CSV selection
    tk.Label(frame, text="Config CSV:").grid(row=0, column=0, sticky="w")
    tk.Entry(frame, textvariable=csv_var, width=40).grid(row=0, column=1, sticky="w")
    tk.Button(frame, text="Browse...", command=choose_csv).grid(row=0, column=2, padx=5)

    # Output directory selection
    tk.Label(frame, text="Output Dir:").grid(row=1, column=0, sticky="w", pady=(5, 0))
    tk.Entry(frame, textvariable=outdir_var, width=40).grid(row=1, column=1, sticky="w", pady=(5, 0))
    tk.Button(frame, text="Browse...", command=choose_output_dir).grid(row=1, column=2, padx=5, pady=(5, 0))

    # Checkbox for lines
    # tk.Checkbutton(frame, text="Show lines", variable=show_lines_var).grid(row=2, column=1, sticky="w", pady=(5, 0))

    # Run button
    tk.Button(frame, text="Generate Diagrams", command=run_generation).grid(row=3, column=0, columnspan=3, pady=(10, 0))

    root.mainloop()


if __name__ == '__main__':
    main()