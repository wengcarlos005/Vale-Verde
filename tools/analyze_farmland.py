# Deriva a tabela de autotile 8-bit do FarmLand comparando cada tile com o tile "meio":
# uma borda/canto conta como "rim" se difere significativamente do equivalente no meio.
from PIL import Image
import os

PACK = r"C:\Users\wengc\OneDrive\Área de Trabalho\Sprites CuteRPG\Cute_Fantasy_Extracted\Cute_Fantasy"
im = Image.open(os.path.join(PACK, "Tiles", "FarmLand", "FarmLand_Tile.png")).convert("RGBA")
COLS, ROWS = im.width // 16, im.height // 16
MID = (2, 2)  # tile 16 = interior sem rim

def region(cx, cy, xs, ys):
    px = im.load()
    return [px[cx * 16 + x, cy * 16 + y] for x in xs for y in ys]

def diff(a, b):
    pairs = [(p, q) for p, q in zip(a, b) if p[3] > 128 and q[3] > 128]
    if not pairs: return 0
    return sum(abs(p[i] - q[i]) for p, q in pairs for i in range(3)) / (3 * len(pairs))

ZONES = {
    "N":  (range(5, 11), range(0, 3)),
    "S":  (range(5, 11), range(13, 16)),
    "W":  (range(0, 3), range(5, 11)),
    "E":  (range(13, 16), range(5, 11)),
    "NE": (range(12, 16), range(0, 4)),
    "NW": (range(0, 4), range(0, 4)),
    "SE": (range(12, 16), range(12, 16)),
    "SW": (range(0, 4), range(12, 16)),
}
mid_zones = {z: region(*MID, xs, ys) for z, (xs, ys) in ZONES.items()}

def tile_info(cx, cy):
    px = im.load()
    opaque = sum(1 for y in range(16) for x in range(16) if px[cx * 16 + x, cy * 16 + y][3] > 128)
    if opaque < 220: return None
    return {z: diff(region(cx, cy, xs, ys), mid_zones[z]) > 12 for z, (xs, ys) in ZONES.items()}

table = {}
detail = []
for cy in range(ROWS):
    for cx in range(COLS):
        info = tile_info(cx, cy)
        if info is None: continue
        borders = (info["N"] << 0) | (info["E"] << 1) | (info["S"] << 2) | (info["W"] << 3)
        notches = 0
        if info["NE"] and not (info["N"] or info["E"]): notches |= 1
        if info["SE"] and not (info["S"] or info["E"]): notches |= 2
        if info["SW"] and not (info["S"] or info["W"]): notches |= 4
        if info["NW"] and not (info["N"] or info["W"]): notches |= 8
        key = borders | (notches << 4)
        idx = cy * COLS + cx
        detail.append((idx, borders, notches))
        if key not in table:
            table[key] = idx
print("tiles:", len(detail), "| configs:", len(table))
for idx, b, n in detail:
    print(f"  idx {idx:2d} borders={b:04b} notches={n:04b}")
print("const TILLED_TABLE = {" + ", ".join(f"{k}:{v}" for k, v in sorted(table.items())) + "};")
