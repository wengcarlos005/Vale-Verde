# Renderiza uma prévia do mapa como o cliente desenha (grama base + terra com franja
# mascarada + rim do lago + cercas), para validar o visual sem abrir o jogo.
import os, subprocess, json
from PIL import Image

HERE = os.path.dirname(__file__)
A = os.path.join(HERE, "..", "client", "assets")
T = 16

def load(n): return Image.open(os.path.join(A, n)).convert("RGBA")
grass = load("grass.png")            # frame 0 = Grass_2
gt = load("grass_tiles.png")         # Grass_Tiles_2
fringe = load("dirt_fringe.png")     # 8 peças mascaradas
fence = load("fence.png")            # 16 frames
def gframe(idx): x, y = (idx % 16) * T, (idx // 16) * T; return gt.crop((x, y, x + T, y + T))
def fr(i): return fringe.crop((i * T, 0, i * T + T, T))
def fen(i): return fence.crop((i * T, 0, i * T + T, T))

# pega o mundo do servidor
out = subprocess.check_output(["node", "-e",
    "const W=require('./server/game/world.js');const w=W.generateWorld(999);"
    "console.log(JSON.stringify({ground:w.ground,objects:w.objects,W:W.WIDTH,H:W.HEIGHT}))"],
    cwd=os.path.join(HERE, ".."))
d = json.loads(out)
g, objs, WD, HT = d["ground"], d["objects"], d["W"], d["H"]

def at(x, y, v): return 0 <= x < WD and 0 <= y < HT and g[y][x] == v
img = Image.new("RGBA", (WD * T, HT * T))

# grama base
for y in range(HT):
    for x in range(WD):
        img.alpha_composite(grass.crop((0, 0, T, T)), (x * T, y * T))

# terra com franja
for y in range(HT):
    for x in range(WD):
        if g[y][x] != 2: continue
        X, Y = x * T, y * T
        img.alpha_composite(gframe(97), (X, Y))
        n = not at(x, y-1, 2) and not at(x, y-1, 1); s = not at(x, y+1, 2) and not at(x, y+1, 1)
        w = not at(x-1, y, 2) and not at(x-1, y, 1); e = not at(x+1, y, 2) and not at(x+1, y, 1)
        nw = not at(x-1, y-1, 2) and not at(x-1, y-1, 1); ne = not at(x+1, y-1, 2) and not at(x+1, y-1, 1)
        sw = not at(x-1, y+1, 2) and not at(x-1, y+1, 1); se = not at(x+1, y+1, 2) and not at(x+1, y+1, 1)
        if n: img.alpha_composite(fr(0), (X, Y))
        if s: img.alpha_composite(fr(1), (X, Y))
        if w: img.alpha_composite(fr(2), (X, Y))
        if e: img.alpha_composite(fr(3), (X, Y))
        if n and w: img.alpha_composite(fr(4), (X, Y))
        elif not n and not w and nw: img.alpha_composite(fr(8), (X, Y))
        if n and e: img.alpha_composite(fr(5), (X, Y))
        elif not n and not e and ne: img.alpha_composite(fr(9), (X, Y))
        if s and w: img.alpha_composite(fr(6), (X, Y))
        elif not s and not w and sw: img.alpha_composite(fr(10), (X, Y))
        if s and e: img.alpha_composite(fr(7), (X, Y))
        elif not s and not e and se: img.alpha_composite(fr(11), (X, Y))

# lago
water = load("water.png").crop((0, 0, T, T))
for y in range(HT):
    for x in range(WD):
        if g[y][x] == 1:
            img.alpha_composite(water, (x * T, y * T))
            n, s = at(x, y-1, 1), at(x, y+1, 1); w, e = at(x-1, y, 1), at(x+1, y, 1)
            f = 17
            if not n and not w: f = 0
            elif not n and not e: f = 2
            elif not s and not w: f = 32
            elif not s and not e: f = 34
            elif not n: f = 1
            elif not s: f = 33
            elif not w: f = 16
            elif not e: f = 18
            if f != 17: img.alpha_composite(gframe(f), (x * T, y * T))

# objetos simples (cerca, árvore como bloco verde, pedra)
tree = load("tree.png").crop((0, 0, 32, 48))
rock = load("rock.png").crop((0, 0, 32, 32))
FMAP = [12, 8, 1, 13, 0, 4, 5, 9, 3, 15, 2, 14, 7, 11, 6, 10]
def fobj(x, y): return objs.get(f"{x},{y}", {}).get("type") == "fence"
for key, o in objs.items():
    x, y = map(int, key.split(","))
    if o["type"] == "fence":
        m = fobj(x, y-1) | (fobj(x+1, y) << 1) | (fobj(x, y+1) << 2) | (fobj(x-1, y) << 3)
        img.alpha_composite(fen(FMAP[m]), (x * T, y * T))
    elif o["type"] == "tree":
        img.alpha_composite(tree, (x * T - 8, y * T - 32))
    elif o["type"] == "rock":
        img.alpha_composite(rock, (x * T - 8, y * T - 16))

crop = img.crop((4 * T, 6 * T, 48 * T, 34 * T))
crop = crop.resize((crop.width * 2, crop.height * 2), Image.NEAREST)
dst = os.path.join(os.environ.get("SCRATCH", HERE), "map_preview.png")
crop.convert("RGB").save(dst)
print(dst)
