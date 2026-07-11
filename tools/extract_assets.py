# Extrai e recompõe os assets do pack Cute Fantasy para client/assets.
# Os arquivos crus do pack não são redistribuídos; só os recortes usados pelo jogo.
import os
from PIL import Image, ImageDraw

PACK = r"C:\Users\wengc\OneDrive\Área de Trabalho\Sprites CuteRPG\Cute_Fantasy_Extracted\Cute_Fantasy"
OUT = os.path.join(os.path.dirname(__file__), "..", "client", "assets")

def p(*parts): return os.path.join(PACK, *parts)
def o(name):
    path = os.path.join(OUT, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path

def load(path): return Image.open(path).convert("RGBA")

# ---------- player: linhas 0-8 (idle, walk, ação) de cada camada ----------
ROWS = 9          # 0-2 idle, 3-5 walk, 6-8 ação (down/right/up)
FRAME = 64
def extract_layer(src, dst):
    im = load(src)
    im.crop((0, 0, 576, ROWS * FRAME)).save(o(dst))

extract_layer(p("Player", "Player_Base", "Player_Base_animations.png"), "player/base.png")

HAIR_COLORS = ["Black", "Blonde", "Brown", "Ginger", "Grey"]
for style in range(1, 7):
    for color in HAIR_COLORS:
        src = p("Player", "Head", f"Hair_{style}", f"Hair_{style}_{color}.png")
        if os.path.exists(src):
            extract_layer(src, f"player/hair_{style}_{color.lower()}.png")

SHIRT_COLORS = ["Black", "Blue", "Green", "Orange", "Pink", "Purple", "Red", "White_and_Brown"]
for color in SHIRT_COLORS:
    src = p("Player", "Chest", "Farmer_Shirt", f"Farmer_Shirt_1_{color}.png")
    if os.path.exists(src):
        extract_layer(src, f"player/shirt_{color.lower()}.png")
    src = p("Player", "Legs", "Farmer_Pants", f"Farmer_Pants_1_{color}.png")
    if os.path.exists(src):
        extract_layer(src, f"player/pants_{color.lower()}.png")

# ---------- cultivos ----------
# Crops.png: bandas de 2 linhas (16px). Cols: 0 placa, 1 sementes, 2-5 estágios (16x32), 6 produto.
CROP_BANDS = {
    "turnip": 6, "potato": 16, "carrot": 2, "strawberry": 17, "tomato": 1,
    "corn": 4, "pepper": 10, "onion": 19, "cabbage": 7, "beet": 18,
}
CROP_ORDER = list(CROP_BANDS.keys())
crops_img = load(p("Crops", "Crops.png"))

stages = Image.new("RGBA", (4 * 16, len(CROP_ORDER) * 32), (0, 0, 0, 0))
products = Image.new("RGBA", (16, len(CROP_ORDER) * 16), (0, 0, 0, 0))
seeds = Image.new("RGBA", (16, len(CROP_ORDER) * 16), (0, 0, 0, 0))
for i, crop in enumerate(CROP_ORDER):
    band = CROP_BANDS[crop]
    y = band * 32
    for s in range(4):
        stages.alpha_composite(crops_img.crop((32 + s * 16, y, 48 + s * 16, y + 32)), (s * 16, i * 32))
    # produto (col 6) e semente (col 1): recorta a banda inteira e centraliza no conteúdo
    def centered_icon(col_x):
        band_img = crops_img.crop((col_x, y, col_x + 16, y + 32))
        bbox = band_img.getbbox()
        if not bbox:
            return band_img.crop((0, 8, 16, 24))
        cy = (bbox[1] + bbox[3]) // 2
        top = max(0, min(16, cy - 8))
        return band_img.crop((0, top, 16, top + 16))
    products.alpha_composite(centered_icon(96), (0, i * 16))
    seeds.alpha_composite(centered_icon(16), (0, i * 16))
stages.save(o("crops_stages.png"))
products.save(o("crops_products.png"))
seeds.save(o("crops_seeds.png"))

# cultivo morto (gerado): planta murcha marrom 16x32
dead = Image.new("RGBA", (16, 32), (0, 0, 0, 0))
d = ImageDraw.Draw(dead)
d.line([(8, 30), (8, 20)], fill=(107, 76, 50, 255), width=2)
d.line([(8, 24), (4, 20)], fill=(107, 76, 50, 255), width=1)
d.line([(8, 22), (12, 19)], fill=(107, 76, 50, 255), width=1)
d.point([(4, 19), (12, 18), (7, 17)], fill=(133, 98, 66, 255))
dead.save(o("crop_dead.png"))

# ---------- tiles ----------
# Frame 0 = Grass_2_Middle: mesma cor (51,152,75) da franja do Grass_Tiles_2,
# para a transição grama→terra não ter emenda de tom.
GRASS_ORDER = [2, 1, 3, 4]
grass = Image.new("RGBA", (64, 16), (0, 0, 0, 0))
for i, gi in enumerate(GRASS_ORDER):
    grass.alpha_composite(load(p("Tiles", "Grass", f"Grass_{gi}_Middle.png")), (i * 16, 0))
grass.save(o("grass.png"))

load(p("Tiles", "Water", "Water_Middle_Anim_1.png")).save(o("water.png"))   # 8 frames 16x16
load(p("Tiles", "Grass", "Path_Middle.png")).save(o("path.png"))
# blob autotile completo (7 cols x 8 rows de 16px); o client mapeia os índices
load(p("Tiles", "FarmLand", "FarmLand_Tile.png")).save(o("tilled.png"))
load(p("Tiles", "FarmLand", "FarmLand_Wet_Tile.png")).save(o("tilled_wet.png"))

# ---------- objetos ----------
# As sheets de árvore são [toco, árvore-com-sombra, árvore-sem-sombra]; usamos só
# o frame 1 (árvore com sombra, estática) — os outros faziam a sombra piscar e o
# tronco "cortar" quando animados.
oak = load(p("Trees", "Medium_Oak_Tree.png"))
oak.crop((32, 0, 64, 48)).save(o("tree.png"))                               # frame 1, 32x48
oak.crop((0, 16, 32, 48)).save(o("stump.png"))                             # toco (col 0)
rock = load(p("Outdoor decoration", "Outdoor_Decor_Animations", "Rock_Animations", "Rock_11_Anim.png"))
rock.save(o("rock.png"))                                                    # 8 frames 32x32
chest = load(p("Buildings", "House_Decor", "Chest_Anim.png"))
chest.crop((0, 0, 16, 16)).save(o("bin.png"))

# ---------- animais e galinheiro ----------
load(p("Animals", "Chicken", "Chicken_01.png")).save(o("chicken.png"))       # 8x16 frames 32x32
_coop = load(p("Buildings", "Buildings", "Unique_Buildings", "Coop", "Coop_Base_Red.png")).crop((80, 0, 160, 128))
_coop.save(o("coop.png"))                                                    # variante do meio, 80x128
_coop.resize((32, 32), Image.LANCZOS).save(o("coop_icon.png"))               # miniatura para a loja

# ovo (mundo) e ícone de ovo gerados
egg = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
ed = ImageDraw.Draw(egg)
ed.ellipse([5, 6, 11, 13], fill=(255, 250, 235, 255), outline=(210, 195, 170, 255))
ed.ellipse([6, 7, 8, 9], fill=(255, 255, 250, 255))
egg.save(o("egg.png"))
egg.resize((32, 32), Image.NEAREST).save(o("icons/item_egg.png"))

# ---------- forrageio (comida e coletáveis) ----------
# Sprites de MUNDO de verdade (com sombra própria na base), não ícones de UI —
# senão ficam parecendo adesivos colados no chão em vez de plantados nele.
berry_bush = load(p("Crops", "Berries.png")).crop((0, 0, 16, 16))            # touceira c/ frutas vermelhas
mushroom_world = load(p("Outdoor decoration", "Outdoor_Decor_Animations",
                         "Muschroom_Animations", "muschroom_1_Anim.png")).crop((0, 0, 16, 16))
FORAGE_WORLD = {"berry": berry_bush, "mushroom": mushroom_world}
for name, img in FORAGE_WORLD.items():
    img.save(o(f"forage_{name}.png"))                              # sprite do mundo 16x16
    img.resize((32, 32), Image.NEAREST).save(o(f"icons/item_{name}.png"))  # ícone reaproveitado p/ inventário
# tronco pequeno coletável (metade do tronco caído)
load(p("Outdoor decoration", "Outdoor_Decor.png")).crop((0, 7 * 16, 16, 8 * 16)).save(o("forage_log.png"))

# ---------- bancada de fabricação (fabricação simples) ----------
load(p("Buildings", "House_Decor", "Anvil_Anim.png")).crop((0, 0, 16, 16)).save(o("anvil.png"))  # frame estático 16x16
fence_sheet = load(p("Outdoor decoration", "Fences.png"))
fence_sheet.crop((0, 48, 16, 64)).resize((32, 32), Image.NEAREST).save(o("icons/item_fence.png"))  # poste isolado (frame 12, mask=0)

# ---------- prédios e NPC ----------
load(p("Buildings", "Buildings", "Houses", "Wood", "House_2_Wood_Base_Red.png")).save(o("house.png"))   # 144x128
load(p("Buildings", "Buildings", "Houses", "Wood", "House_1_Wood_Base_Blue.png")).save(o("shop.png"))   # 96x128
bob = load(p("NPCs (Premade)", "Farmer_Bob.png"))
bob.crop((0, 0, 384, 64)).save(o("bob.png"))                                 # 6 frames idle 64x64

# ---------- ícones (DOM: hotbar, loja) ----------
tools_sheet = load(p("Icons", "Outline", "Tool_Icons_Outline.png"))
TOOL_IDX = {"hoe": 5, "can": 6, "axe": 3, "pickaxe": 2}
for name, idx in TOOL_IDX.items():
    tools_sheet.crop((idx * 16, 0, idx * 16 + 16, 16)).resize((32, 32), Image.NEAREST).save(o(f"icons/tool_{name}.png"))

res_sheet = load(p("Icons", "Outline", "Resources_Icons_Outline.png"))
res_sheet.crop((0, 64, 16, 80)).resize((32, 32), Image.NEAREST).save(o("icons/item_wood.png"))
res_sheet.crop((0, 0, 16, 16)).resize((32, 32), Image.NEAREST).save(o("icons/item_stone.png"))

for i, crop in enumerate(CROP_ORDER):
    products.crop((0, i * 16, 16, i * 16 + 16)).resize((32, 32), Image.NEAREST).save(o(f"icons/item_{crop}.png"))
    seeds.crop((0, i * 16, 16, i * 16 + 16)).resize((32, 32), Image.NEAREST).save(o(f"icons/seed_{crop}.png"))

# ---------- cercas, bétula, poço, arbustos ----------
load(p("Outdoor decoration", "Fences.png")).save(o("fence.png"))            # 16 frames 16x16
birch = load(p("Trees", "Medium_Birch_Tree.png"))
birch.crop((32, 0, 64, 48)).save(o("tree_birch.png"))                       # frame 1, 32x48
load(p("Outdoor decoration", "Well.png")).save(o("well.png"))               # 32x48
load(p("Outdoor decoration", "Benches.png")).crop((32, 0, 64, 32)).save(o("bench.png"))  # banco de madeira 32x32
load(p("Outdoor decoration", "Hay_Bales.png")).crop((0, 0, 16, 16)).save(o("hay.png"))   # fardo de feno 16x16
load(p("Outdoor decoration", "Outdoor_Decor.png")).crop((0, 7 * 16, 32, 8 * 16)).save(o("log_fallen.png"))  # tronco caído 32x16
od = load(p("Outdoor decoration", "Outdoor_Decor.png"))
bush_sheet = Image.new("RGBA", (5 * 16, 16), (0, 0, 0, 0))
for i, (cx, cy) in enumerate([(5, 5), (2, 9), (4, 9), (5, 9), (6, 9)]):
    bush_sheet.alpha_composite(od.crop((cx * 16, cy * 16, cx * 16 + 16, cy * 16 + 16)), (i * 16, 0))
bush_sheet.save(o("bushes.png"))

# ---------- tileset geral (bordas de lago, caminho de areia com franja texturizada) ----------
load(p("Tiles", "Grass", "Grass_Tiles_2.png")).save(o("grass_tiles.png"))  # 16x10 tiles

# ---------- decoração animada (compõe variantes: 1 linha por variante, 8 frames) ----------
import glob
def compose_anim(folder_parts, pattern, dst):
    files = sorted(glob.glob(os.path.join(p(*folder_parts), pattern)))
    sheet_img = Image.new("RGBA", (8 * 16, len(files) * 16), (0, 0, 0, 0))
    for i, f in enumerate(files):
        src = load(f)
        n = src.width // 16
        for fr in range(8):
            j = min(fr, n - 1)
            sheet_img.alpha_composite(src.crop((j * 16, 0, j * 16 + 16, 16)), (fr * 16, i * 16))
    sheet_img.save(o(dst))
    return len(files)

n_grass = compose_anim(("Outdoor decoration", "Outdoor_Decor_Animations", "Grass_Animations"), "*.png", "decor_grass.png")
n_mush = compose_anim(("Outdoor decoration", "Outdoor_Decor_Animations", "Muschroom_Animations"), "*.png", "decor_mushroom.png")
n_cattail = compose_anim(("Outdoor decoration", "Outdoor_Decor_Animations", "Water_Decor_Animations", "Water_Plants"), "Cattail*.png", "decor_cattail.png")
n_lily = compose_anim(("Outdoor decoration", "Outdoor_Decor_Animations", "Water_Decor_Animations", "Water_Plants"), "Lillypad_Green*.png", "decor_lily.png")
print("decor rows:", n_grass, n_mush, n_cattail, n_lily)

load(p("Animals", "Butterfly", "Butterfly.png")).save(o("butterfly.png"))   # 4 frames 16x16 vertical

# ---------- fundo do menu (cena composta) ----------
rng_seq = [(i * 73 + 41) % 97 for i in range(600)]
bg = Image.new("RGBA", (480, 320), (0, 0, 0, 255))
grass_mid = load(p("Tiles", "Grass", "Grass_1_Middle.png"))
for ty in range(0, 320, 16):
    for tx in range(0, 480, 16):
        bg.alpha_composite(grass_mid, (tx, ty))
tufts = load(p("Outdoor decoration", "Outdoor_Decor_Animations", "Grass_Animations", "Flower_Grass_1_Anim.png"))
flower = load(p("Outdoor decoration", "Outdoor_Decor_Animations", "Grass_Animations", "Flower_Grass_7_Anim.png"))
k = 0
for ty in range(0, 320, 16):
    for tx in range(0, 480, 16):
        r = rng_seq[k % len(rng_seq)]; k += 1
        if r < 12: bg.alpha_composite(tufts.crop((0, 0, 16, 16)), (tx, ty))
        elif r < 18: bg.alpha_composite(flower.crop((0, 0, 16, 16)), (tx, ty))
tree_img = oak.crop((32, 0, 64, 48))
for (tx, ty) in [(30, 40), (400, 60), (120, 220), (330, 250), (440, 200)]:
    bg.alpha_composite(tree_img, (tx, ty))
bg.convert("RGB").save(o("menu_bg.png"))

# ---------- franja da transição grama→terra (peças mascaradas) ----------
# Recorta os tiles de borda da família de areia do Grass_Tiles_2 e torna transparente
# tudo que é idêntico ao tile de interior (97): sobra só a banda de transição.
gt2 = load(p("Tiles", "Grass", "Grass_Tiles_2.png"))
def gtile(idx):
    x, y = (idx % 16) * 16, (idx // 16) * 16
    return gt2.crop((x, y, x + 16, y + 16))
mid_px = gtile(97).load()
def masked(idx):
    t = gtile(idx).copy()
    tp = t.load()
    for yy in range(16):
        for xx in range(16):
            a, b = tp[xx, yy], mid_px[xx, yy]
            if a[3] > 0 and sum(abs(a[i] - b[i]) for i in range(3)) < 40:
                tp[xx, yy] = (0, 0, 0, 0)
    return t
# 0-7: bordas + cantos EXTERNOS (convexos). 8-11: cantos INTERNOS (côncavos, o
# cachinho de grama que entra na terra) — frames 145/144/129/128 do Grass_Tiles_2.
FRINGE_ORDER = [81, 113, 96, 98, 80, 82, 112, 114, 145, 144, 129, 128]
fringe = Image.new("RGBA", (len(FRINGE_ORDER) * 16, 16), (0, 0, 0, 0))
for i, idx in enumerate(FRINGE_ORDER):
    fringe.alpha_composite(masked(idx), (i * 16, 0))
fringe.save(o("dirt_fringe.png"))

# ---------- gerados: cursor de tile ----------
cur = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
d = ImageDraw.Draw(cur)
d.rectangle([0, 0, 15, 15], outline=(255, 235, 120, 230), width=1)
d.rectangle([1, 1, 14, 14], outline=(120, 90, 20, 160), width=1)
cur.save(o("cursor.png"))

print("assets ok:", len([f for r, _, fs in os.walk(OUT) for f in fs]))
