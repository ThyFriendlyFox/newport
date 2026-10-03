"""Hand-laid quad retopology of the T-pose cat-kid sculpt, run headless in Blender.

Every part is authored as explicit edge loops: for each ring we cast rays from the limb's axis
outward and place the vertex where the ray leaves the sculpt, so the loop sits exactly on the
sculpted surface while the topology stays clean (rings at knees/elbows/wrists, split shells for
tee / trousers / crocs / hair / ears / tail). Then: UVs, textures, armature from the measured
joints, bone-heat weights, GLB export.

Coordinates: Blender Z-up as in the STL; +X = character's left, -Y = forward.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector

ROOT = '/home/user/newport'
OUT = ROOT + '/public/models/catkid.glb'
SP = '/tmp/claude-0/-home-user-newport/1dd5c45b-9760-5e49-be89-8893902b832d/scratchpad'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.stl_import(filepath=ROOT + '/public/models/catkid-tpose.stl')
SCULPT = bpy.context.selected_objects[0]
SCULPT.name = 'sculpt'

rig = json.load(open(ROOT + '/public/models/catkid-tpose-rig.json'))
def J(name):  # three (x, up, fwd) -> blender (x, -fwd, up)
    x, y, z = rig[name]['pos']
    return Vector((x, -z, y))

# ------------------------------------------------------------------------------------------
# ray helpers
def hit(origin, direction, max_r, fallback=None):
    ok, loc, nrm, idx = SCULPT.ray_cast(Vector(origin), Vector(direction).normalized(), distance=max_r)
    if ok:
        return Vector(loc)
    return Vector(origin) + Vector(direction).normalized() * (fallback if fallback is not None else max_r)

def ring(center, u, v, n, max_r, fallback=None, phase=0.0, clamp=(0.7, 1.35)):
    """Ring of n points around `center` in the plane spanned by u, v. Radii are clamped around
    the ring's median so fur/cloth noise doesn't pleat the loop."""
    pts = []
    for i in range(n):
        a = phase + i / n * math.tau
        d = u * math.cos(a) + v * math.sin(a)
        pts.append(hit(center, d, max_r, fallback))
    if clamp:
        c = Vector(center)
        rs = sorted((p - c).length for p in pts)
        med = rs[len(rs) // 2]
        out = []
        for p in pts:
            d = p - c; r = d.length
            r2 = min(max(r, med * clamp[0]), med * clamp[1])
            out.append(c + d.normalized() * r2 if r > 1e-6 else p)
        pts = out
    return pts

def frame(axis):
    """Two unit vectors perpendicular to axis; v points as 'up-ish' / 'front-ish' consistently."""
    a = Vector(axis).normalized()
    ref = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((0, -1, 0))
    u = ref.cross(a).normalized()
    v = a.cross(u).normalized()
    return u, v

# ------------------------------------------------------------------------------------------
# mesh assembly
class Part:
    def __init__(self, name, mat):
        self.name = name; self.mat = mat
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new('uv')
        self.rings = []
        self.centers = []
    def add_ring(self, pts, v_coord):
        verts = [self.bm.verts.new(p) for p in pts]
        self.rings.append((verts, v_coord))
        return verts
    def tube(self, rings, close_start=False, close_end=False, u_scale=1.0, centers=None):
        if centers: self.centers += [Vector(c) for c in centers]
        """rings: list of (points, vcoord). Connect consecutive rings with quads."""
        rv = [self.add_ring(p, v) for p, v in rings]
        n = len(rv[0])
        for (a, va), (b, vb) in zip(zip(rv, [r[1] for r in rings]), zip(rv[1:], [r[1] for r in rings[1:]])):
            for i in range(n):
                f = self.bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
                uvs = [(i / n * u_scale, va), ((i + 1) / n * u_scale, va), ((i + 1) / n * u_scale, vb), (i / n * u_scale, vb)]
                for l, t in zip(f.loops, uvs):
                    l[self.uv].uv = t
        if close_start:
            f = self.bm.faces.new(list(reversed(rv[0])))
            for l in f.loops: l[self.uv].uv = (0.5, rings[0][1])
        if close_end:
            f = self.bm.faces.new(rv[-1])
            for l in f.loops: l[self.uv].uv = (0.5, rings[-1][1])
        return rv
    def finish(self, smooth_iters=0, centers=None):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        # open shells can come out inside-out: flip faces whose normal points at the shell axis
        if centers:
            mean = sum(centers, Vector()) / len(centers)
            for f in self.bm.faces:
                c = f.calc_center_median()
                near = mean if len(f.verts) > 4 else min(centers, key=lambda q: (q - c).length_squared)
                f.normal_update()
                if f.normal.dot(c - near) < 0: f.normal_flip()
        if smooth_iters:
            bmesh.ops.smooth_vert(self.bm, verts=self.bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me); self.bm.free()
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        me.materials.append(self.mat)
        for p in me.polygons: p.use_smooth = True
        return ob

def lin(h):
    r, g, b = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b))

def material(name, rgb, tex=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1); bsdf.inputs['Roughness'].default_value = 0.8
    if tex:
        img = bpy.data.images.load(tex)
        n = m.node_tree.nodes.new('ShaderNodeTexImage'); n.image = img
        m.node_tree.links.new(n.outputs['Color'], bsdf.inputs['Base Color'])
    return m

def paint_face(path):
    from PIL import Image, ImageDraw
    S = 1024
    img = Image.new('RGB', (S, S), (246, 220, 203))
    d = ImageDraw.Draw(img)
    # UV: u = 0.5 at the front, v = 1 at the top; eye line at latitude ~0.52 → v ≈ 0.48
    def uv(u, v): return (u * S, (1 - v) * S)
    for sx in (-1, 1):
        ex, ey = uv(0.5 + sx * 0.056, 0.415)
        w, h = 46, 40
        # blush
        for rad, a in ((70, 28), (50, 45)):
            d.ellipse((ex + sx * 30 - rad, ey + 55 - rad * 0.6, ex + sx * 30 + rad, ey + 55 + rad * 0.6), fill=(238, 180, 175))
        d.ellipse((ex - w, ey - h, ex + w, ey + h), fill=(251, 248, 244))
        d.ellipse((ex - 32, ey - 34, ex + 32, ey + 36), fill=(201, 139, 46))
        d.ellipse((ex - 32, ey + 4, ex + 32, ey + 36), fill=(240, 191, 92))
        d.ellipse((ex - 13, ey - 24, ex + 13, ey + 26), fill=(43, 22, 6))
        d.ellipse((ex - 22, ey - 24, ex - 6, ey - 8), fill=(255, 255, 255))
        d.ellipse((ex + 10, ey + 10, ex + 18, ey + 18), fill=(255, 255, 255))
        # upper lid / lashes
        d.arc((ex - w - 6, ey - h - 8, ex + w + 6, ey + h + 10), 190, 350, fill=(42, 26, 20), width=9)
        d.line((ex + sx * (w + 2), ey - 14, ex + sx * (w + 18), ey - 30), fill=(42, 26, 20), width=6)
        # brow
        bx0, by0 = uv(0.5 + sx * 0.03, 0.48); bx1, by1 = uv(0.5 + sx * 0.085, 0.49)
        d.line((bx0, by0, bx1, by1 - 6), fill=(110, 150, 130), width=7)
    # nose + mouth
    nx, ny = uv(0.5, 0.355); d.line((nx + 2, ny - 10, nx - 2, ny + 4), fill=(190, 120, 100), width=3)
    mx, my = uv(0.5, 0.305); d.arc((mx - 26, my - 12, mx + 26, my + 10), 15, 165, fill=(140, 65, 60), width=4)
    img.save(path)
FACE_TEX = SP + '/face.png'
paint_face(FACE_TEX)

MAT = {
    'skin': material('skin', lin('f6dccb')),
    'faceskin': material('faceskin', (1, 1, 1), tex=FACE_TEX),
    'tee': material('tee', lin('f7ee98')),
    'pants': material('pants', lin('4b6a92')),
    'croc': material('croc', lin('7f8c3e')),
    'hair': material('hair', lin('b6dcc6')),
    'tail': material('tail', lin('3a3a40')),
    'ear': material('ear', lin('b6dcc6')),
}
PARTS = []

# ------------------------------------------------------------------------------------------
# torso + sleeves (tee)
tee = Part('tee', MAT['tee'])
hips, spine, chest, neck = J('hips'), J('spine'), J('chest'), J('neck')
def spine_at(z):
    pts = [(hips.z - 0.08, hips), (hips.z, hips), (spine.z, spine), (chest.z, chest), (neck.z, neck), (neck.z + 0.1, neck)]
    for (z0, p0), (z1, p1) in zip(pts, pts[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / max(1e-6, z1 - z0)
            c = p0.lerp(p1, t); return Vector((c.x, c.y, z))
    return Vector((hips.x, hips.y, z))
Zs = [0.92, 0.96, 1.00, 1.05, 1.10, 1.16, 1.22, 1.28, 1.33, 1.37, 1.40, 1.43, 1.46, 1.49]
rings = []
for k, z in enumerate(Zs):
    c = spine_at(z)
    max_r = 0.23 if z < 1.36 else {1.37: 0.21, 1.40: 0.21, 1.43: 0.205, 1.46: 0.19, 1.49: 0.16}.get(z, 0.2)   # shoulder slope; rays would otherwise run down the fused arm
    rings.append((ring(c, Vector((1, 0, 0)), Vector((0, 1, 0)), 24, max_r, 0.12), k / (len(Zs) - 1)))
tee.tube(rings, close_end=True, centers=[spine_at(z) for z in Zs])
for side in (1, -1):
    sh = J('shoulderL') if side > 0 else J('shoulderR')
    ax = Vector((side, 0, 0)); u, v = frame(ax)
    xs = [0.19, 0.22, 0.25, 0.29, 0.32, 0.335]
    rings = []
    for k, x in enumerate(xs):
        c = Vector((side * x, sh.y, sh.z - 0.01))
        rings.append((ring(c, u, v, 14, 0.095, 0.07), k / (len(xs) - 1)))
    tee.tube(rings, close_start=True, close_end=True, centers=[Vector((side * x, sh.y, sh.z)) for x in xs])
PARTS.append(tee.finish(centers=tee.centers))

# ------------------------------------------------------------------------------------------
# arms + hands (skin)
arms = Part('arms', MAT['skin'])
for side in (1, -1):
    sh = J('shoulderL') if side > 0 else J('shoulderR'); wr = J('wristL') if side > 0 else J('wristR'); hd = J('handL') if side > 0 else J('handR')
    el = J('elbowL') if side > 0 else J('elbowR')
    u, v = frame(Vector((side, 0, 0)))
    def arm_c(x):
        t = (x - sh.x * side) / (hd.x * side - sh.x * side)
        a = sh.lerp(el, min(1, t / ((el.x * side - sh.x * side) / (hd.x * side - sh.x * side)))) if t < (el.x * side - sh.x * side) / (hd.x * side - sh.x * side) else el.lerp(hd, (t - (el.x * side - sh.x * side) / (hd.x * side - sh.x * side)) / (1 - (el.x * side - sh.x * side) / (hd.x * side - sh.x * side)))
        return Vector((side * x, a.y, a.z))
    xs = [0.335, 0.355, 0.37, 0.385, 0.40, 0.44, 0.48, 0.52, 0.545, 0.56, 0.59, 0.63, 0.67, 0.71, 0.745, 0.77]
    rings = []
    for k, x in enumerate(xs):
        max_r = 0.065 if x < 0.57 else 0.07
        rings.append((ring(arm_c(x), u, v, 12, max_r, 0.03), k / (len(xs) - 1)))
    arms.tube(rings, close_start=True, close_end=True, centers=[arm_c(x) for x in xs])
PARTS.append(arms.finish(centers=arms.centers))

# ------------------------------------------------------------------------------------------
# neck (skin)
neckp = Part('neck', MAT['skin'])
rings = []
zs = [1.48, 1.51, 1.54, 1.57, 1.60]
for k, z in enumerate(zs):
    c = Vector((neck.x, neck.y + 0.01, z))
    rings.append((ring(c, Vector((1, 0, 0)), Vector((0, 1, 0)), 14, 0.085, 0.05), k / (len(zs) - 1)))
neckp.tube(rings, centers=[Vector((neck.x, neck.y + 0.01, z)) for z in zs])
PARTS.append(neckp.finish(centers=neckp.centers))

# ------------------------------------------------------------------------------------------
# trousers: waistband + two legs
pants = Part('pants', MAT['pants'])
zs = [0.80, 0.85, 0.90, 0.94]
rings = []
for k, z in enumerate(zs):
    c = spine_at(z)
    rings.append((ring(c, Vector((1, 0, 0)), Vector((0, 1, 0)), 24, 0.24, 0.15), k / (len(zs) - 1)))
pants.tube(rings, centers=[spine_at(z) for z in zs])
for side in (1, -1):
    hp = J('hipL') if side > 0 else J('hipR'); kn = J('kneeL') if side > 0 else J('kneeR'); an = J('ankleL') if side > 0 else J('ankleR')
    def leg_c(z):
        if z >= kn.z:
            t = (hp.z - z) / max(1e-6, hp.z - kn.z); c = hp.lerp(kn, min(1, max(0, t)))
        else:
            t = (kn.z - z) / max(1e-6, kn.z - an.z); c = kn.lerp(an, min(1, max(0, t)))
        return Vector((c.x, c.y, z))
    zs = [0.84, 0.78, 0.72, 0.66, 0.60, 0.54, 0.48, 0.43, 0.39, 0.36, 0.33, 0.29, 0.24, 0.19, 0.15, 0.12]
    rings = []
    for k, z in enumerate(zs):
        rings.append((ring(leg_c(z), Vector((1, 0, 0)), Vector((0, 1, 0)), 16, 0.17, 0.09), k / (len(zs) - 1)))
    pants.tube(rings, close_end=True, centers=[leg_c(z) for z in zs])
PARTS.append(pants.finish(centers=pants.centers))

# ------------------------------------------------------------------------------------------
# crocs
crocs = Part('crocs', MAT['croc'])
for side in (1, -1):
    an = J('ankleL') if side > 0 else J('ankleR'); toe = J('toeL') if side > 0 else J('toeR')
    ys = [0.09, 0.05, 0.0, -0.05, -0.10, -0.15, -0.19, -0.22]
    rings = []
    u, v = Vector((1, 0, 0)), Vector((0, 0, 1))
    for k, y in enumerate(ys):
        c = Vector((an.x, an.y + y - 0.0, 0.05))
        rings.append((ring(c, u, v, 14, 0.09, 0.04), k / (len(ys) - 1)))
    crocs.tube(rings, close_start=True, close_end=True, centers=[Vector((an.x, an.y + y, 0.05)) for y in ys])
PARTS.append(crocs.finish(centers=crocs.centers))

# ------------------------------------------------------------------------------------------
# tail
tail = Part('tail', MAT['tail'])
tp = []
i = 0
while f'tail{i}' in rig:
    tp.append(J(f'tail{i}')); i += 1
for _ in range(2):
    tp = [tp[0]] + [(tp[k - 1] + tp[k] * 2 + tp[k + 1]) / 4 for k in range(1, len(tp) - 1)] + [tp[-1]]
# resample to 10 evenly spaced rings along the smoothed curve
def resample(pts, n):
    L = [0.0]
    for a, b in zip(pts, pts[1:]): L.append(L[-1] + (b - a).length)
    out = []
    for i in range(n):
        t = L[-1] * i / (n - 1)
        for k in range(len(pts) - 1):
            if L[k] <= t <= L[k + 1]:
                f = (t - L[k]) / max(1e-6, L[k + 1] - L[k]); out.append(pts[k].lerp(pts[k + 1], f)); break
    return out
tp = resample(tp, 10)
rings = []
for k, p in enumerate(tp):
    d = (tp[min(k + 1, len(tp) - 1)] - tp[max(k - 1, 0)]).normalized()
    u, v = frame(d)
    t = k / (len(tp) - 1)
    r = 0.03 + 0.055 * math.sin(math.pi * min(1, t * 1.15)) ** 0.8 * (1 - t * 0.35) + 0.004
    pts = [p + (u * math.cos(a) + v * math.sin(a)) * r for a in [i / 12 * math.tau for i in range(12)]]
    rings.append((pts, t))
tail.tube(rings, close_start=True, close_end=True, centers=tp)
PARTS.append(tail.finish(centers=tail.centers))

# ------------------------------------------------------------------------------------------
# head: an authored anime skull (face shell) under a smoothed hair envelope (hair shell)
hc = Vector((J('head').x, J('head').y, 1.68))
NLAT, NLON = 20, 32
def sph_dir(phi, th):
    return Vector((math.sin(phi) * math.sin(th), -math.sin(phi) * math.cos(th), math.cos(phi)))
# measured envelope radii
R = [[(hit(hc, sph_dir(i / NLAT * math.pi, j / NLON * math.tau), 0.3, 0.1) - hc).length for j in range(NLON)] for i in range(NLAT + 1)]
def smooth_field(F, iters, keep_max=False):
    for _ in range(iters):
        G = [[0] * NLON for _ in range(NLAT + 1)]
        for i in range(NLAT + 1):
            for j in range(NLON):
                nb = [F[i][j], F[i][(j + 1) % NLON], F[i][(j - 1) % NLON]]
                if i > 0: nb.append(F[i - 1][j])
                if i < NLAT: nb.append(F[i + 1][j])
                G[i][j] = max(nb) * 0.5 + sum(nb) / len(nb) * 0.5 if keep_max else sum(nb) / len(nb)
        F = G
    return F
HAIR_R = smooth_field(R, 3, keep_max=True)
SKIN_R = smooth_field(R, 1)   # lightly smoothed raw surface: close to the skull where there is no hair
r_face = 0.142
def skull_r(phi, th):
    """Anime skull: round cranium, cheeks tapering into a small chin, flatter face plane."""
    z = math.cos(phi)                   # 1 top .. -1 bottom
    front = -math.cos(th) if False else math.cos(th)  # 1 = facing forward
    r = r_face * (1.0 + 0.10 * max(0, z))                 # slightly taller cranium
    if z < 0:
        k = (-z) ** 1.4
        r *= 1 - 0.30 * k * (0.6 + 0.4 * max(0, -front))   # jaw narrows, more at the back
        r *= 1 - 0.08 * k * max(0, front)                   # chin tucks in a little
    r *= 1 - 0.06 * max(0, front) ** 3                      # flatten the face plane
    return r
# face shell: front sector between brow and chin; everything else is hair
def face_cell(i, j):
    phi = (i + 0.5) / NLAT * math.pi; th = ((j + 0.5) / NLON) * math.tau
    front = math.cos(th)
    z = hc.z + math.cos(phi) * r_face * 1.1
    if z < 1.50: return False
    bang = SKIN_R[i][j] > skull_r(phi, th) * 1.12   # the sculpted bangs/side locks hang here
    if front > 0.42 and z < 1.76: return not bang
    if front > 0.0 and z < 1.66: return not bang       # cheeks/jaw sides
    return False
face = Part('face', MAT['faceskin']); hair = Part('hair', MAT['hair'])
for part in (face, hair):
    part.gv = [[None] * NLON for _ in range(NLAT + 1)]
def gv(part, i, j, is_face):
    if part.gv[i][j] is None:
        phi = i / NLAT * math.pi; th = j / NLON * math.tau
        d = sph_dir(phi, th)
        r = skull_r(phi, th) if is_face else max(HAIR_R[i][j], skull_r(phi, th) + 0.012)
        part.gv[i][j] = part.bm.verts.new(hc + d * r)
    return part.gv[i][j]
for i in range(NLAT):
    for j in range(NLON):
        j2 = (j + 1) % NLON
        quad = [(i, j), (i, j2), (i + 1, j2), (i + 1, j)]
        isf = face_cell(i, j)
        part = face if isf else hair
        vs = [gv(part, a, b, isf) for a, b in quad]
        if i == 0: vs = vs[1:]; quad = quad[1:]
        if i == NLAT - 1: vs = vs[:3]; quad = quad[:3]
        if len(set(vs)) < 3: continue
        if part is hair and hc.z + math.cos((i + 0.5) / NLAT * math.pi) * r_face * 1.1 < 1.50 and SKIN_R[i][j] < skull_r((i + 0.5) / NLAT * math.pi, (j + 0.5) / NLON * math.tau) * 1.12: continue
        try: f = part.bm.faces.new(vs)
        except ValueError: continue
        for l, (a, b) in zip(f.loops, quad):
            uu = (b / NLON + 0.5) % 1.0
            if j == NLON - 1 and b == 0: uu = 1.0
            l[part.uv].uv = (uu, 1 - a / NLAT)
# the face shell also closes the skull under the hair so nothing is hollow when hair moves
for i in range(NLAT):
    for j in range(NLON):
        if face_cell(i, j): continue
        if hc.z + math.cos((i + 0.5) / NLAT * math.pi) * r_face * 1.1 < 1.50: continue
        j2 = (j + 1) % NLON
        quad = [(i, j), (i, j2), (i + 1, j2), (i + 1, j)]
        vs = [gv(face, a, b, True) for a, b in quad]
        if i == 0: vs = vs[1:]; quad = quad[1:]
        if i == NLAT - 1: vs = vs[:3]; quad = quad[:3]
        if len(set(vs)) < 3: continue
        try: f = face.bm.faces.new(vs)
        except ValueError: continue
        for l, (a, b) in zip(f.loops, quad):
            uu = (b / NLON + 0.5) % 1.0
            if j == NLON - 1 and b == 0: uu = 1.0
            l[face.uv].uv = (uu, 1 - a / NLAT)
PARTS.append(face.finish(centers=[hc]))
PARTS.append(hair.finish(centers=[hc]))

# ------------------------------------------------------------------------------------------
# ears: authored flattened cones at the measured ear positions
ears = Part('ears', MAT['ear'])
for side in (1, -1):
    base = Vector((side * 0.10, -0.04, 1.775)); tip = Vector((side * 0.15, -0.04, 1.93))
    d = (tip - base).normalized(); u, v = frame(d)   # u ~ across (x-ish), v ~ front/back
    rings = []
    for k, t in enumerate([0.0, 0.3, 0.55, 0.75, 0.9, 1.0]):
        c = base.lerp(tip, t)
        rw = 0.05 * (1 - t) ** 0.9 + 0.004; rt = 0.02 * (1 - t) + 0.003
        pts = [c + u * math.cos(a) * rw + v * math.sin(a) * rt for a in [i / 10 * math.tau for i in range(10)]]
        rings.append((pts, t))
    ears.tube(rings, close_start=True, close_end=True, centers=[base.lerp(tip, t) for t in [0.0, 0.3, 0.55, 0.75, 0.9, 1.0]])
PARTS.append(ears.finish(centers=ears.centers))

# ------------------------------------------------------------------------------------------
# armature from the measured joints; bone +Y along the bone, +Z toward the character's front
bpy.ops.object.armature_add(location=(0, 0, 0))
ARM = bpy.context.active_object; ARM.name = 'Armature'
bpy.ops.object.mode_set(mode='EDIT')
eb = ARM.data.edit_bones
for b in list(eb): eb.remove(b)
BONES = [
    ('hips', None, 'hips', 'spine'), ('spine', 'hips', 'spine', 'chest'), ('chest', 'spine', 'chest', 'neck'),
    ('neck', 'chest', 'neck', 'head'), ('head', 'neck', 'head', 'headTop'),
]
for s in ('L', 'R'):
    BONES += [(f'clavicle{s}', 'chest', f'clav{s}', f'shoulder{s}'), (f'upperArm{s}', f'clavicle{s}', f'shoulder{s}', f'elbow{s}'),
              (f'forearm{s}', f'upperArm{s}', f'elbow{s}', f'wrist{s}'), (f'hand{s}', f'forearm{s}', f'wrist{s}', f'hand{s}'),
              (f'upperLeg{s}', 'hips', f'hip{s}', f'knee{s}'), (f'lowerLeg{s}', f'upperLeg{s}', f'knee{s}', f'ankle{s}'),
              (f'foot{s}', f'lowerLeg{s}', f'ankle{s}', f'toe{s}'), (f'toe{s}', f'foot{s}', f'toe{s}', f'toeEnd{s}')]
ntail = len(tp)
for i in range(ntail - 1):
    BONES.append((f'tail{i}', 'hips' if i == 0 else f'tail{i-1}', f'tail{i}', f'tail{i+1}'))
JX = {k: J(k) for k in rig}
for i, p_ in enumerate(tp): JX[f'tail{i}'] = p_
JX['clavL'] = JX['chest'].lerp(JX['shoulderL'], 0.3); JX['clavR'] = JX['chest'].lerp(JX['shoulderR'], 0.3)
for s in ('L', 'R'):
    JX[f'toeEnd{s}'] = JX[f'toe{s}'] + Vector((0, -0.07, 0))
created = {}
for name, parent, h, t in BONES:
    b = eb.new(name); b.head = JX[h]; b.tail = JX[t]
    if (b.tail - b.head).length < 0.01: b.tail = b.head + Vector((0, 0, 0.02))
    b.align_roll(Vector((0, -1, 0)) if not name.startswith('tail') else Vector((0, 0, 1)))
    if parent: b.parent = created[parent]
    created[name] = b
bpy.ops.object.mode_set(mode='OBJECT')

# weights: bone heat per shell; head-only shells are pinned to the head bone
for ob in PARTS:
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True); ARM.select_set(True); bpy.context.view_layer.objects.active = ARM
    if ob.name in ('face', 'hair', 'ears'):
        bpy.ops.object.parent_set(type='ARMATURE_NAME')
        vg = ob.vertex_groups.new(name='head'); vg.add(range(len(ob.data.vertices)), 1.0, 'REPLACE')
    else:
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
        if ob.name == 'tail':
            for vg in list(ob.vertex_groups):
                if not vg.name.startswith('tail') and vg.name != 'hips': ob.vertex_groups.remove(vg)
        if ob.name in ('tee', 'pants', 'arms', 'neck', 'crocs'):
            for vg in list(ob.vertex_groups):
                if vg.name.startswith('tail'): ob.vertex_groups.remove(vg)
        if ob.name == 'tee':
            # sleeves ride on the upper arm; the shoulder row blends into the chest over 4 cm
            for s_, sign in (('L', 1), ('R', -1)):
                ua = ob.vertex_groups[f'upperArm{s_}']; ch = ob.vertex_groups['chest']
                for v in ob.data.vertices:
                    x = v.co.x * sign
                    if x < 0.165 or v.co.z < 1.3: continue
                    w = min(1.0, max(0.0, (x - 0.165) / 0.05))
                    for vg in ob.vertex_groups: vg.remove([v.index])
                    ua.add([v.index], w, 'REPLACE'); ch.add([v.index], 1 - w, 'REPLACE')

# rest pose: arms down (the animator's canonical rest), baked into the meshes and the armature
bpy.ops.object.select_all(action='DESELECT'); ARM.select_set(True); bpy.context.view_layer.objects.active = ARM
bpy.ops.object.mode_set(mode='POSE')
for s_, sign in (('L', 1), ('R', -1)):
    pb = ARM.pose.bones[f'upperArm{s_}']
    cur = (pb.matrix.to_3x3() @ Vector((0, 1, 0))).normalized()
    want = Vector((sign * 0.17, 0, -1)).normalized()
    q = cur.rotation_difference(want)
    from mathutils import Matrix
    head = pb.matrix.to_translation()
    pb.matrix = Matrix.Translation(head) @ q.to_matrix().to_4x4() @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()
bpy.ops.object.mode_set(mode='OBJECT')
for ob in PARTS:
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    mod = next(m for m in ob.modifiers if m.type == 'ARMATURE')
    bpy.ops.object.modifier_copy(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name)
bpy.ops.object.select_all(action='DESELECT'); ARM.select_set(True); bpy.context.view_layer.objects.active = ARM
bpy.ops.object.mode_set(mode='POSE'); bpy.ops.pose.armature_apply(selected=False); bpy.ops.object.mode_set(mode='OBJECT')

# export
bpy.ops.object.select_all(action='DESELECT')
for ob in PARTS: ob.select_set(True)
ARM.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, use_selection=True, export_skins=True, export_yup=True, export_apply=True, export_normals=True, export_texcoords=True, export_image_format='AUTO')
tri = sum(len(p.polygons) for ob in PARTS for p in [ob.data])
print('RETOPO DONE', OUT, 'faces:', {ob.name: len(ob.data.polygons) for ob in PARTS}, 'verts:', sum(len(ob.data.vertices) for ob in PARTS), 'bones:', len(ARM.data.bones))
bpy.ops.wm.save_as_mainfile(filepath=SP + '/catkid-retopo.blend')
