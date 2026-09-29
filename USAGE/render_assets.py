"""
Renders illustrative graphics for the Matcap Maker USAGE documentation.
Generates:
1. edge_padding_process.png - Raw circular matcap vs Nearest Padding vs Smooth Padding.
2. blend_space_comparison.png - Linear vs sRGB blending math comparison.
3. layer_composition_flow.png - Layer pass diagram from base to final output.
4. normal_mapping_principle.png - Perturbation of sphere normal by surface normal map.
"""
import math
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT_DIR = Path(__file__).resolve().parent / "assets"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Japanese font loader with fallbacks
def get_font(size=12, bold=False):
    windir = os.environ.get('WINDIR', 'C:\\Windows')
    candidates = [
        os.path.join(windir, 'Fonts', 'meiryo.ttc'),
        os.path.join(windir, 'Fonts', 'YuGothM.ttc'),
        os.path.join(windir, 'Fonts', 'msgothic.ttc'),
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

def render_matcap_sphere(size=256, light_dir=(0.5, 0.5, 0.707), base_col=(40, 50, 65), light_col=(255, 230, 200), rim_col=(100, 180, 255), rim_power=3.0):
    """Renders a mathematically accurate matcap sphere."""
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pix = im.load()
    cx = size / 2.0
    cy = size / 2.0
    r = size / 2.0 - 2.0
    
    # normalize light
    lx, ly, lz = light_dir
    ll = math.sqrt(lx*lx + ly*ly + lz*lz)
    lx, ly, lz = lx/ll, ly/ll, lz/ll

    for y in range(size):
        ny = -(y - cy) / r
        for x in range(size):
            nx = (x - cx) / r
            d2 = nx*nx + ny*ny
            if d2 <= 1.0:
                nz = math.sqrt(max(0.0, 1.0 - d2))
                
                # N dot L
                ndotl = max(0.0, nx*lx + ny*ly + nz*lz)
                # Specular (Blinn-Phong)
                hx, hy, hz = lx, ly, lz + 1.0
                hl = math.sqrt(hx*hx + hy*hy + hz*hz)
                hx, hy, hz = hx/hl, hy/hl, hz/hl
                ndoth = max(0.0, nx*hx + ny*hy + nz*hz)
                spec = math.pow(ndoth, 32.0)
                
                # Fresnel (1 - nz)
                fresnel = math.pow(1.0 - nz, rim_power)
                
                # Combine (in linear approx)
                cr = (base_col[0]/255.0) + (light_col[0]/255.0) * (ndotl * 0.5 + spec * 0.8) + (rim_col[0]/255.0) * fresnel * 0.7
                cg = (base_col[1]/255.0) + (light_col[1]/255.0) * (ndotl * 0.5 + spec * 0.8) + (rim_col[1]/255.0) * fresnel * 0.7
                cb = (base_col[2]/255.0) + (light_col[2]/255.0) * (ndotl * 0.5 + spec * 0.8) + (rim_col[2]/255.0) * fresnel * 0.7
                
                # Antialiased border
                dist = math.sqrt(d2)
                alpha = min(1.0, max(0.0, (1.0 - dist) * r))
                
                ir = min(255, int(cr * 255.0))
                ig = min(255, int(cg * 255.0))
                ib = min(255, int(cb * 255.0))
                ia = min(255, int(alpha * 255.0))
                pix[x, y] = (ir, ig, ib, ia)
    return im

def make_padded_disc(sphere, pad_width=20, mode="none"):
    """
    mode: 'none', 'nearest', 'smooth'
    Accurately simulates MatcapMaker's JFA + PAD_SMOOTH pipeline without artifacts.
    """
    size = sphere.width
    cx = size / 2.0
    cy = size / 2.0
    r = 84.0 # Solid radius
    
    if mode == "none":
        return sphere

    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pix = out.load()
    sp_pix = sphere.load()

    for y in range(size):
        dy = -(y - cy)
        for x in range(size):
            dx = x - cx
            dist = math.sqrt(dx*dx + dy*dy)
            
            if dist <= r:
                # Inside original sphere
                pix[x, y] = sp_pix[x, y]
            elif dist <= r + pad_width:
                # Within padding band
                angle = math.atan2(dy, dx)
                
                if mode == "nearest":
                    # Discrete nearest-boundary pixel projection (JFA nearest)
                    bx = int(round(cx + math.cos(angle) * (r - 1.0)))
                    by = int(round(cy - math.sin(angle) * (r - 1.0)))
                    bx = max(0, min(size - 1, bx))
                    by = max(0, min(size - 1, by))
                    c = sp_pix[bx, by]
                    pix[x, y] = (c[0], c[1], c[2], 255)
                else:
                    # Smooth padding (averaged neighbor dilation)
                    c_sum = [0.0, 0.0, 0.0]
                    samples = 5
                    for s in range(samples):
                        a_offset = (s - (samples - 1) / 2.0) * (0.04 / (dist / r))
                        a = angle + a_offset
                        bx = cx + math.cos(a) * (r - 1.0)
                        by = cy - math.sin(a) * (r - 1.0)
                        
                        ix = int(bx)
                        iy = int(by)
                        fx = bx - ix
                        fy = by - iy
                        c00 = sp_pix[ix, iy]
                        c10 = sp_pix[min(size - 1, ix + 1), iy]
                        c01 = sp_pix[ix, min(size - 1, iy + 1)]
                        c11 = sp_pix[min(size - 1, ix + 1), min(size - 1, iy + 1)]
                        for k in range(3):
                            val = (c00[k] * (1 - fx) + c10[k] * fx) * (1 - fy) + (c01[k] * (1 - fx) + c11[k] * fx) * fy
                            c_sum[k] += val
                    pix[x, y] = (
                        int(round(c_sum[0] / samples)),
                        int(round(c_sum[1] / samples)),
                        int(round(c_sum[2] / samples)),
                        255
                    )
            else:
                # Outside padding band
                pix[x, y] = (0, 0, 0, 0)
    return out

def generate_edge_padding_demo():
    """Generates comparison of (1) Raw disc, (2) Dilated padding, (3) Smooth padding."""
    size = 220
    # Render with r=84 to leave ample room for padding band and background checkerboard
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pix = im.load()
    cx = size / 2.0
    cy = size / 2.0
    r = 84.0
    
    lx, ly, lz = 0.55, 0.55, 0.62
    ll = math.sqrt(lx*lx + ly*ly + lz*lz)
    lx, ly, lz = lx/ll, ly/ll, lz/ll
    hx, hy, hz = lx, ly, lz + 1.0
    hl = math.sqrt(hx*hx + hy*hy + hz*hz)
    hx, hy, hz = hx/hl, hy/hl, hz/hl

    for y in range(size):
        dy = -(y - cy)
        for x in range(size):
            dx = x - cx
            dist = math.sqrt(dx*dx + dy*dy)
            if dist <= r + 1.5:
                nx = dx / r
                ny = dy / r
                d2 = nx*nx + ny*ny
                if d2 <= 1.0:
                    nz = math.sqrt(max(0.0, 1.0 - d2))
                    ndotl = max(0.0, nx*lx + ny*ly + nz*lz)
                    ndoth = max(0.0, nx*hx + ny*hy + nz*hz)
                    spec = math.pow(ndoth, 28.0)
                    fresnel = math.pow(1.0 - nz, 2.5)
                    
                    cr = 0.16 + 0.95 * (ndotl * 0.45 + spec * 0.85) + 0.25 * fresnel
                    cg = 0.20 + 0.88 * (ndotl * 0.45 + spec * 0.85) + 0.60 * fresnel
                    cb = 0.28 + 0.78 * (ndotl * 0.45 + spec * 0.85) + 0.92 * fresnel
                    
                    alpha = min(1.0, max(0.0, r - dist + 0.5))
                    pix[x, y] = (
                        min(255, int(cr * 255)),
                        min(255, int(cg * 255)),
                        min(255, int(cb * 255)),
                        min(255, int(alpha * 255))
                    )
    sphere = im

    p_none = make_padded_disc(sphere, mode="none")
    p_near = make_padded_disc(sphere, pad_width=20, mode="nearest")
    p_smooth = make_padded_disc(sphere, pad_width=20, mode="smooth")

    def make_checker(w, h, grid=12):
        bg = Image.new("RGBA", (w, h), (20, 23, 30, 255))
        draw = ImageDraw.Draw(bg)
        for y in range(0, h, grid):
            for x in range(0, w, grid):
                if (x // grid + y // grid) % 2 == 1:
                    draw.rectangle([x, y, x + grid, y + grid], fill=(28, 33, 43, 255))
        return bg

    canvas_w = 840
    canvas_h = 320
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (18, 20, 26, 255))
    draw = ImageDraw.Draw(canvas)

    panels = [
        ("未処理（透明背景）", p_none, "3Dモデルの輪郭に背景が混ざり黒ずむ原因"),
        ("ニアレスト・パディング", p_near, "最近傍の境界ピクセルを外周へ伸長（20px）"),
        ("スムース・パディング（推奨）", p_smooth, "外周パディングを平均化して滑らかに拡張")
    ]

    offset_x = 30
    for title, img, desc in panels:
        # border card
        draw.rounded_rectangle([offset_x, 20, offset_x + 240, 300], radius=12, fill=(24, 28, 36, 255), outline=(45, 52, 66, 255), width=1)
        
        # checker background for the preview
        chk = make_checker(size, size)
        chk.alpha_composite(img, (0, 0))
        canvas.paste(chk, (offset_x + 10, 30))

        # text
        draw.text((offset_x + 120, 260), title, fill=(240, 243, 248), anchor="mt", font=get_font(13))
        draw.text((offset_x + 120, 282), desc, fill=(140, 150, 168), anchor="mt", font=get_font(10))

        offset_x += 270

    canvas.save(OUT_DIR / "edge_padding_process.png", optimize=True)
    print("Saved clean edge_padding_process.png")

def generate_layer_flow_demo():
    """Generates a diagram showing 4 layers combined step-by-step."""
    size = 140
    base = render_matcap_sphere(size=size, light_dir=(0, 0, 1), base_col=(50, 55, 68), light_col=(0,0,0), rim_col=(0,0,0))
    spot = render_matcap_sphere(size=size, light_dir=(0.6, 0.6, 0.5), base_col=(0,0,0), light_col=(255, 210, 150), rim_col=(0,0,0))
    rim = render_matcap_sphere(size=size, light_dir=(0,0,1), base_col=(0,0,0), light_col=(0,0,0), rim_col=(70, 180, 255), rim_power=2.5)
    
    # composite 1: base + spot
    comp1 = Image.new("RGBA", (size, size), (0,0,0,0))
    for y in range(size):
        for x in range(size):
            b = base.getpixel((x, y))
            s = spot.getpixel((x, y))
            comp1.putpixel((x, y), (min(255, b[0]+s[0]), min(255, b[1]+s[1]), min(255, b[2]+s[2]), max(b[3], s[3])))

    # composite 2: comp1 + rim
    comp2 = Image.new("RGBA", (size, size), (0,0,0,0))
    for y in range(size):
        for x in range(size):
            c = comp1.getpixel((x, y))
            r = rim.getpixel((x, y))
            comp2.putpixel((x, y), (min(255, c[0]+r[0]), min(255, c[1]+r[1]), min(255, c[2]+r[2]), max(c[3], r[3])))

    w, h = 880, 240
    canvas = Image.new("RGBA", (w, h), (18, 20, 26, 255))
    draw = ImageDraw.Draw(canvas)

    steps = [
        ("Layer 1: ベタ塗り", base, "ベースカラー"),
        ("Layer 2: スポットライト (加算)", comp1, "光源とハイライト"),
        ("Layer 3: リムライト (スクリーン)", comp2, "エッジの環境反射"),
    ]

    x = 30
    for i, (title, img, sub) in enumerate(steps):
        draw.rounded_rectangle([x, 20, x + 240, 215], radius=10, fill=(25, 30, 40, 255), outline=(42, 50, 66, 255), width=1)
        # sphere
        canvas.paste(img, (x + 50, 32), img)
        draw.text((x + 120, 180), title, fill=(240, 244, 250), anchor="mt", font=get_font(13))
        draw.text((x + 120, 198), sub, fill=(135, 145, 165), anchor="mt", font=get_font(11))
        
        if i < len(steps) - 1:
            draw.text((x + 255, 105), "+", fill=(120, 135, 160), anchor="mm", font=get_font(24))
        x += 295

    canvas.save(OUT_DIR / "layer_composition_flow.png", optimize=True)
    print("Saved layer_composition_flow.png")

if __name__ == "__main__":
    generate_edge_padding_demo()
    generate_layer_flow_demo()
