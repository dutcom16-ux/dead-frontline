"""python3 package.py <name>: README + zip for a rendered building (after render_sheet.py)."""
import importlib, json, os, sys, zipfile
from PIL import Image
NAME = sys.argv[1]
T = importlib.import_module(NAME)
OUT = "out_" + NAME
meta = json.load(open(f"{OUT}/{NAME}_sheet.json"))["meta"]
F = meta["frame_size"]["w"]
DESC = (T.__doc__ or "").strip()
readme = f"""{DESC}

Sprite sheet: {NAME}_sheet.png  ({meta['size']['w']} x {meta['size']['h']}), frames {F} x {F} px.
Rows = states: intact, damaged, destroyed.  Columns = 8 views N, NE, E, SE, S, SW, W, NW:
the direction {T.FRONT} face on screen, clockwise from N (facing away from the viewer);
S = front toward the viewer. view = round(front_compass_deg / 45) % 8.
Pivot: {meta['pivot']}.
Scale: {meta['pixels_per_metre']} px per metre - the same as the soldier, the townhouse, the mid-rise, the trees
and the ground tiles, so everything fits together without rescaling.
Camera: orthographic, about 50 deg down (the game's IsoCamera pitch); light from the screen's top-left.
Shadows are baked in as semi-transparent black, so they darken whatever ground they fall on.
Footprint (m): {json.dumps(meta['footprint_m'])}   Height (m): {json.dumps(meta['height_m'])}

JSON = TexturePacker "JSON Hash"; frame names are {NAME}_<state>_<view>, e.g. {NAME}_damaged_SE.
Depth-sort the building by its pivot's screen y like units; for very large buildings, sort units
against the footprint (a unit is in front if it stands in front of the building's front line).
Swap the intact frame for damaged, then destroyed, as the building takes damage; the destroyed
frame is a rubble ruin units can take cover in.

Files: {NAME}_sheet.png / .json, {NAME}_preview.gif (the three states turning, half size),
{NAME}_contact.jpg (the whole sheet on a grey ground).
"""
open(f"{OUT}/README.txt", "w").write(readme)
z = f"{OUT}/toledo_{NAME}.zip"
with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
    for f in ("README.txt", f"{NAME}_sheet.png", f"{NAME}_sheet.json", f"{NAME}_preview.gif", f"{NAME}_contact.jpg"):
        zf.write(f"{OUT}/{f}", f)
print(z, os.path.getsize(z) // 1024, "KB")
