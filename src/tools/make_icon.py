# -*- coding: utf-8 -*-
"""生成阿波罗11号登月模拟器的应用图标（多尺寸 .ico + PNG）。

构图（小尺寸下可辨识优先）：
  深空底 → 右上暖白月牙 → 左下蓝色地球 → 青色轨道弧连接两者 →
  弧上一枚金色飞船标记。4 倍超采样后 LANCZOS 缩小。
"""

import math
import os

from PIL import Image, ImageDraw

SS = 4
BASE = 256
N = BASE * SS

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")
os.makedirs(OUT_DIR, exist_ok=True)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def soft_disc(size, center, radius, color, core=0.0):
    """带柔和外缘的圆（核心不透明，边缘渐隐）。"""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    steps = 26
    r0 = radius * (1.0 - core)
    for i in range(steps + 1):
        t = i / steps
        r = r0 + (radius - r0) * t
        a = int(255 * (1 - t) ** 1.5)
        d.ellipse([center[0] - r, center[1] - r, center[0] + r, center[1] + r],
                  fill=color + (a,))
    d.ellipse([center[0] - r0, center[1] - r0, center[0] + r0, center[1] + r0],
              fill=color + (255,))
    return img


def main():
    # ---------------- 背景 ----------------
    bg = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bg)
    for y in range(N):
        t = y / (N - 1)
        bd.line([(0, y), (N, y)], fill=lerp((16, 24, 46), (4, 6, 14), t ** 0.75) + (255,))
    seed = 1107201969
    for _ in range(120):
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        x = (seed / 0x7FFFFFFF) * N
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        y = (seed / 0x7FFFFFFF) * N
        seed = (seed * 1103515245 + 12345) & 0x7FFFFFFF
        b = 0.4 + (seed / 0x7FFFFFFF) * 0.6
        r = (1.0 + (seed / 0x7FFFFFFF) * 1.6) * SS
        c = int(205 * b)
        bd.ellipse([x - r, y - r, x + r, y + r],
                   fill=(c, c, min(255, c + 25), int(80 + 150 * b)))

    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    img.alpha_composite(bg)

    # ---------------- 地球（左下）----------------
    er = int(N * 0.150)
    ec = (int(N * 0.235), int(N * 0.740))
    d = ImageDraw.Draw(img)
    for i in range(10):                       # 大气辉光
        rr = er + (i + 1) * SS * 1.6
        a = int(150 * (1 - i / 10) ** 1.9)
        d.ellipse([ec[0] - rr, ec[1] - rr, ec[0] + rr, ec[1] + rr],
                  outline=(120, 195, 255, a), width=max(1, int(SS * 1.5)))
    d.ellipse([ec[0] - er, ec[1] - er, ec[0] + er, ec[1] + er], fill=(26, 88, 176, 255))
    hx, hy = ec[0] - int(er * 0.30), ec[1] - int(er * 0.32)
    hr = int(er * 0.82)
    d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=(56, 132, 222, 255))
    hr2 = int(er * 0.55)
    d.ellipse([hx - hr2, hy - hr2, hx + hr2, hy + hr2], fill=(104, 180, 246, 255))
    # 一小片陆地
    d.ellipse([ec[0] - er * 0.66, ec[1] + er * 0.00, ec[0] + er * 0.26, ec[1] + er * 0.66],
              fill=(52, 134, 104, 235))

    # ---------------- 月球（右上，干净的月牙）----------------
    mr = int(N * 0.250)
    mc = (int(N * 0.745), int(N * 0.270))
    d = ImageDraw.Draw(img)
    for i in range(10):                       # 月华
        rr = mr + (i + 1) * SS * 1.7
        a = int(115 * (1 - i / 10) ** 2.0)
        d.ellipse([mc[0] - rr, mc[1] - rr, mc[0] + rr, mc[1] + rr],
                  outline=(255, 235, 185, a), width=max(1, int(SS * 1.4)))
    # 亮月盘
    d.ellipse([mc[0] - mr, mc[1] - mr, mc[0] + mr, mc[1] + mr], fill=(243, 238, 222, 255))
    # 内阴影（营造立体感）
    d.ellipse([mc[0] - int(mr * 0.80), mc[1] - int(mr * 0.80),
               mc[0] + int(mr * 0.80), mc[1] + int(mr * 0.80)], fill=(234, 228, 208, 255))
    # 挖出月牙：偏移的深空色圆
    ox = mc[0] - int(mr * 0.52)
    oy = mc[1] - int(mr * 0.36)
    orr = int(mr * 1.02)
    d.ellipse([ox - orr, oy - orr, ox + orr, oy + orr], fill=(10, 14, 28, 255))
    # 月牙外缘描一圈暖光
    for i in range(3):
        rr = mr + i * SS * 1.2
        a = int(150 * (1 - i / 3))
        d.arc([mc[0] - rr, mc[1] - rr, mc[0] + rr, mc[1] + rr], 250, 60,
              fill=(255, 250, 232, a), width=max(1, int(SS * 1.5)))

    # ---------------- 轨道弧（青色）----------------
    pts = []
    for i in range(181):
        t = i / 180.0
        ang = math.radians(158 + t * 128)
        x = N * 0.50 + math.cos(ang) * N * 0.50
        y = N * 0.575 + math.sin(ang) * N * 0.40
        pts.append((x, y))
    arc = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ad = ImageDraw.Draw(arc)
    ad.line(pts, fill=(70, 195, 255, 40), width=int(SS * 6.5), joint="curve")
    ad.line(pts, fill=(110, 220, 255, 120), width=int(SS * 3.2), joint="curve")
    ad.line(pts, fill=(200, 244, 255, 245), width=int(SS * 1.4), joint="curve")
    img.alpha_composite(arc)

    # ---------------- 飞船标记（金色箭头，位于弧末段）----------------
    si = int(len(pts) * 0.655)
    sx, sy = pts[si]
    dx, dy = pts[si + 3][0] - pts[si][0], pts[si + 3][1] - pts[si][1]
    ln = math.hypot(dx, dy) or 1
    ux, uy = dx / ln, dy / ln
    nx_, ny_ = -uy, ux
    L, W = N * 0.068, N * 0.037
    tri = [(sx + ux * L, sy + uy * L),
           (sx - ux * L * 0.55 + nx_ * W, sy - uy * L * 0.55 + ny_ * W),
           (sx - ux * L * 0.55 - nx_ * W, sy - uy * L * 0.55 - ny_ * W)]
    img.alpha_composite(soft_disc(N, (int(sx), int(sy)), int(N * 0.095), (255, 190, 78), core=0.0))
    d = ImageDraw.Draw(img)
    d.polygon(tri, fill=(255, 202, 92, 255))
    d.line(tri + [tri[0]], fill=(255, 248, 220, 255), width=max(1, int(SS * 1.1)))

    # ---------------- 圆角裁切 + 描边 ----------------
    mask = rounded_mask(N, int(N * 0.215))
    out = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    out.putalpha(Image.composite(out.getchannel("A"), Image.new("L", (N, N), 0), mask))
    ring = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle(
        [SS * 2, SS * 2, N - SS * 2, N - SS * 2],
        radius=int(N * 0.205), outline=(122, 172, 240, 135), width=int(SS * 2.0))
    out.alpha_composite(ring)

    # ---------------- 输出 ----------------
    sizes = [256, 128, 64, 48, 32, 16]
    imgs = [out.resize((s, s), Image.LANCZOS) for s in sizes]
    ico_path = os.path.join(OUT_DIR, "icon.ico")
    imgs[0].save(ico_path, format="ICO", sizes=[(s, s) for s in sizes])
    out.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT_DIR, "icon.png"), format="PNG")

    prev = Image.new("RGBA", (400, 148), (20, 24, 34, 255))
    x = 12
    for s in [128, 64, 48, 32, 16]:
        p = out.resize((s, s), Image.LANCZOS)
        prev.paste(p, (x, (148 - s) // 2), p)
        x += s + 14
    prev.save(os.path.join(OUT_DIR, "icon_preview.png"), format="PNG")
    print("已生成:", ico_path)


if __name__ == "__main__":
    main()
