# -*- coding: utf-8 -*-
# 路线 08 §4：恢复真实推进剂并删掉两处演示补油。
#   CSM.propMass 24000 → 18410、LM.ascentProp 3000 → 2353；
#   删 11-demo.js 里"上升级补到 3200 kg / 服务舱补到 12000 kg"。
import io
def patch(p, pairs):
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert s.count(old) == 1, (p, old[:60], s.count(old))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(s)
    print('patched', p)

patch('apollo11/webdata/js/00-constants.js', [
 ("    propMass: 24000,", "    propMass: 18410,          // kg SPS 推进剂（真实 Apollo 11 值，路线 08 §4）"),
 ("    ascentProp: 3000,     // 下降段携带的上升级推进剂（这个重量要跟着一起降落，",
  "    ascentProp: 2353,     // 下降段携带的上升级推进剂（真实值，路线 08 §4；这个重量要跟着一起降落，"),
])
