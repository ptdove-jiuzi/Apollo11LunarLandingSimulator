# -*- coding: utf-8 -*-
import io
p = 'tools/test_physics_p0.js'
s = io.open(p, encoding='utf-8').read()
# 世界已把 earthJ2 关掉，参考项也必须只用 μ 项（原 earthOnly 带 J2 → 残差是 J2 量级）
s = s.replace("const moonNear = V.sub(gNear, earthOnly(near));",
              "const moonNear = V.sub(gNear, earthPure(near));")
s = s.replace("const moonFar = V.sub(gFar, earthOnly(far));",
              "const moonFar = V.sub(gFar, earthPure(far));")
# 删掉不再使用的 earthOnly 定义
old = """// 只看月球贡献：减去地心项（地心项 = -μ_E r/r³ + J2）
function earthOnly(r) {
  const rr = V.mag(r), f = -BODY.EARTH.mu / (rr * rr * rr);
  const a = [r[0] * f, r[1] * f, r[2] * f];
  const R2 = BODY.EARTH.radius * BODY.EARTH.radius;
  const z2 = r[2] * r[2] / (rr * rr);
  const k = -1.5 * BODY.EARTH.J2 * BODY.EARTH.mu * R2 / Math.pow(rr, 5);
  a[0] += k * r[0] * (1 - 5 * z2);
  a[1] += k * r[1] * (1 - 5 * z2);
  a[2] += k * r[2] * (3 - 5 * z2);
  return a;
}
"""
assert old in s, 'earthOnly block not found'
s = s.replace(old, "// 只看月球贡献：减去地球 μ 项（世界已把 earthJ2 关掉，参考项就用 earthPure）\n")
io.open(p, 'w', encoding='utf-8').write(s)
print('ok')
