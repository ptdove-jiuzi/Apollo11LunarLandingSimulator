const fs=require('fs'),path=require('path'),vm=require('vm');
const dir=process.argv[2];
const ctx={console,Math,isFinite,setTimeout,setInterval,clearInterval};
ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
for(const f of ['00-constants.js','01-math.js','02-astro.js','03-physics.js'])
  vm.runInContext(fs.readFileSync(path.join(dir,'apollo11','webdata','js',f),'utf8'),ctx,{filename:f});
const V=ctx.APL.V,M=ctx.APL.M,A=ctx.APL.Astro,B=ctx.APL.BODY,P=ctx.APL.Physics;
const w=new P.World(); w.running=true; w.t=362000;
const orb=P.orbitOverSite(w,111);
const mods=P.buildSaturnVStack().filter(m=>['LM_D','LM_A','SM','CM'].includes(m.id));
const c=new P.Craft({id:'CSM',r:orb.r,v:orb.v,modules:mods,mode:'prograde'});
c.primary='MOON'; c.stageIndex=5; w.addCraft(c);
const g=id=>c.modules.find(m=>m.id===id).prop;
// T1: SM 够用 → 只动 SM
const lm0=g('LM_D'), sm0=g('SM');
let ok1=w.impulsiveBurn(c,0.5,[1,0,0]);
console.log('T1 SM够用:', (ok1&&g('SM')<sm0&&g('LM_D')===lm0)?'PASS 只烧SM':'FAIL');
// T2: SM 烧干后再烧 → 失败且不偷 LM
w.impulsiveBurn(c,99,[1,0,0]);
const lmAfterDrain=g('LM_D');
let ok2=w.impulsiveBurn(c,0.5,[1,0,0]);
console.log('T2 SM烧干后再烧:', (!ok2&&g('LM_D')===lmAfterDrain)?'PASS 失败且LM_D仍='+lmAfterDrain.toFixed(0)+'kg':'FAIL LM_D='+g('LM_D').toFixed(0));
// T3: 已坠毁不再刷事件
const ms=A.moonState(w.t);
const up=V.unit(V.sub(c.r,ms.r));
const c2=new P.Craft({id:'X',r:V.add(ms.r,V.mul(up,B.MOON.radius*0.999)),v:ms.v.slice(),
  modules:P.buildSaturnVStack().filter(m=>m.id==='CM'),mode:'prograde'});
c2.primary='MOON'; w.addCraft(c2); c2.crashed=true;
const ev0=w.events.length;
w.checkSurface(c2);
console.log('T3 坠毁后不再刷事件:', w.events.length===ev0?'PASS':'FAIL');
// T4: LM 自己的机动仍可用（主级 LM_D=3，可向上借 LM_A=4）
const w2=new P.World(); w2.running=true; w2.t=362000;
const o2=P.orbitOverSite(w2,111);
const lmOnly=P.buildSaturnVStack().filter(m=>m.group==='LM');
const cl=new P.Craft({id:'LM',r:o2.r,v:o2.v,modules:lmOnly,mode:'prograde'});
cl.primary='MOON'; cl.stageIndex=3; w2.addCraft(cl);
const d0=cl.modules.find(m=>m.id==='LM_D').prop;
cl.modules.find(m=>m.id==='LM_D').prop=1;   // 把下降级抽干
let ok4=w2.impulsiveBurn(cl,0.3,[1,0,0]);
console.log('T4 LM下降级空了向上升级借:', ok4?'PASS（借到了LM_A）':'FAIL');
