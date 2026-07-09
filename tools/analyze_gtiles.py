# Deriva tabelas de autotile do Grass_Tiles_1.png para as famílias "terra em grama"
# e "água em grama", detectando bordas de grama e notches por análise de pixels.
from PIL import Image
import os

PACK = r"C:\Users\wengc\OneDrive\Área de Trabalho\Sprites CuteRPG\Cute_Fantasy_Extracted\Cute_Fantasy"
im = Image.open(os.path.join(PACK, "Tiles", "Grass", "Grass_Tiles_1.png")).convert("RGBA")
COLS, ROWS = im.width // 16, im.height // 16
px = im.load()

def kind(p):
    r, g, b, a = p
    if a < 128: return "t"                       # transparente (água aparece por baixo)
    if b > r + 30 and b > 60: return "t"         # azul de pré-visualização, trata como água
    if g > 110 and g > r + 10 and b < 110: return "g"   # grama clara
    if r > 140 and g > 90 and b < 110: return "d"       # terra
    return "r"                                    # rim/contorno escuro

def zone(cx, cy, xs, ys):
    return [kind(px[cx * 16 + x, cy * 16 + y]) for x in xs for y in ys]

def frac(vals, k):
    return sum(1 for v in vals if v == k) / max(1, len(vals))

def analyze(family_center):  # 'd' terra | 't' água
    table = {}
    for cy in range(ROWS):
        for cx in range(COLS):
            center = zone(cx, cy, range(6, 10), range(6, 10))
            if frac(center, family_center) < 0.8: continue
            # borda = presença de grama na faixa lateral
            edges = {}
            edges["N"] = frac(zone(cx, cy, range(5, 11), range(0, 3)), "g") > 0.25
            edges["S"] = frac(zone(cx, cy, range(5, 11), range(13, 16)), "g") > 0.25
            edges["W"] = frac(zone(cx, cy, range(0, 3), range(5, 11)), "g") > 0.25
            edges["E"] = frac(zone(cx, cy, range(13, 16), range(5, 11)), "g") > 0.25
            corners = {}
            corners["NE"] = frac(zone(cx, cy, range(12, 16), range(0, 4)), "g") > 0.2
            corners["NW"] = frac(zone(cx, cy, range(0, 4), range(0, 4)), "g") > 0.2
            corners["SE"] = frac(zone(cx, cy, range(12, 16), range(12, 16)), "g") > 0.2
            corners["SW"] = frac(zone(cx, cy, range(0, 4), range(12, 16)), "g") > 0.2
            borders = (edges["N"] << 0) | (edges["E"] << 1) | (edges["S"] << 2) | (edges["W"] << 3)
            notches = 0
            if corners["NE"] and not (edges["N"] or edges["E"]): notches |= 1
            if corners["SE"] and not (edges["S"] or edges["E"]): notches |= 2
            if corners["SW"] and not (edges["S"] or edges["W"]): notches |= 4
            if corners["NW"] and not (edges["N"] or edges["W"]): notches |= 8
            key = borders | (notches << 4)
            idx = cy * COLS + cx
            if key not in table:
                table[key] = idx
    return table

for name, fam in [("DIRT", "d"), ("WATER", "t")]:
    t = analyze(fam)
    print(f"const {name}_TABLE = {{" + ", ".join(f"{k}:{v}" for k, v in sorted(t.items())) + "};", f"// {len(t)} configs")
