"""Splits the NINU logo into animation layers (scene, base, waves, leaves, ring mask).
Usage: py -P split-logo.py <ninu-logo.png> <output-dir>
Layers share one canvas, so they stack exactly. Prints geometry (percent) for the CSS."""
import json, math, os, sys
from collections import deque
from PIL import Image, ImageFilter

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
im = Image.open(src).convert('RGBA'); W, H = im.size; px = im.load()

def is_gold(r, g, b, a): return a > 120 and r > 150 and g > 95 and b < 140 and r - b > 55
def is_green(r, g, b, a): return a > 60 and g > r + 22 and g > b + 4
def is_blue(r, g, b, a): return a > 60 and b > r + 40 and b > g - 15

# 1) scene = flood fill from inside the ring until gold
seed = None
for y in range(150, 210):
    for x in range(230, 300):
        r, g, b, a = px[x, y]
        if a > 200 and b > r + 30: seed = (x, y); break
    if seed: break
scene = set([seed]); q = deque([seed])
while q:
    x, y = q.popleft()
    for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
        if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in scene:
            p = px[nx, ny]
            if p[3] > 0 and not is_gold(*p):
                scene.add((nx, ny)); q.append((nx, ny))
area = len(scene)
cx = sum(p[0] for p in scene) / area; cy = sum(p[1] for p in scene) / area
r_in = math.sqrt(area / math.pi)
assert area < 0.2 * W * H, f'flood leaked: {area}'

# 2) masks for leaves and waves (outside the scene)
leavesL, leavesR, waves = set(), set(), set()
for y in range(H):
    for x in range(W):
        if (x, y) in scene: continue
        p = px[x, y]
        d = math.hypot(x - cx, y - cy)
        if is_green(*p) and y < 0.855 * H:
            (leavesL if x < cx else leavesR).add((x, y))
        elif is_blue(*p) and d > r_in + 8 and y < 0.80 * H and y > cy:
            waves.add((x, y))

def grow(mask, n=1, allow=lambda p: True):
    m = set(mask)
    for _ in range(n):
        add = set()
        for x, y in m:
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in m and (nx, ny) not in scene and allow(px[nx, ny]):
                    add.add((nx, ny))
        m |= add
    return m
soft = lambda p: p[3] > 0 and not is_gold(*p) and not (p[0] < 80 and p[1] < 80 and p[2] < 80)
leavesL = grow(leavesL, 2, soft); leavesR = grow(leavesR, 2, soft)
waves = grow(waves, 2, lambda p: p[3] > 0 and not is_gold(*p) and not is_green(*p))

def layer(mask):
    L = Image.new('RGBA', (W, H)); lp = L.load()
    for x, y in mask: lp[x, y] = px[x, y]
    return L
taken = scene | leavesL | leavesR | waves
base = im.copy(); bp = base.load()
for x, y in taken: bp[x, y] = (0, 0, 0, 0)
for y in range(H):
    for x in range(W):
        if math.hypot(x - cx, y - cy) < r_in - 1: bp[x, y] = (0, 0, 0, 0)  # nothing of the base may cover the scene

# 3) ring mask: gold pixels in the annulus around the scene
ring = Image.new('L', (W, H)); rp = ring.load()
for y in range(H):
    for x in range(W):
        d = math.hypot(x - cx, y - cy)
        if r_in - 3 < d < r_in + 34 and is_gold(*px[x, y]): rp[x, y] = 255
ring = ring.filter(ImageFilter.GaussianBlur(0.6))
ringRGBA = Image.new('RGBA', (W, H), (255, 255, 255, 0)); ringRGBA.putalpha(ring)

SIZE = 384
def save(img, name):
    img.resize((SIZE, SIZE), Image.LANCZOS).save(os.path.join(out, name), 'WEBP', quality=90, method=6)
save(layer(scene), 'scene.webp'); save(base, 'base.webp'); save(layer(waves), 'waves.webp')
save(layer(leavesL), 'leaves-left.webp'); save(layer(leavesR), 'leaves-right.webp'); save(ringRGBA, 'ring-mask.webp')

def bbox(m): xs = [p[0] for p in m]; ys = [p[1] for p in m]; return min(xs), min(ys), max(xs), max(ys)
pct = lambda v, n: round(100 * v / n, 2)
lb, rb, wb = bbox(leavesL), bbox(leavesR), bbox(waves)
geo = {
    'scene': {'cx': pct(cx, W), 'cy': pct(cy, H), 'r': pct(r_in, W)},
    'leftPivot': {'x': pct(lb[2], W), 'y': pct(lb[3], H)},
    'rightPivot': {'x': pct(rb[0], W), 'y': pct(rb[3], H)},
    'waves': {'x0': pct(wb[0], W), 'y0': pct(wb[1], H), 'x1': pct(wb[2], W), 'y1': pct(wb[3], H)},
    'pixels': {'scene': area, 'leavesL': len(leavesL), 'leavesR': len(leavesR), 'waves': len(waves)},
}
print(json.dumps(geo))
for f in sorted(os.listdir(out)): print(f, os.path.getsize(os.path.join(out, f)))
