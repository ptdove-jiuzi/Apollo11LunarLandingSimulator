// M2 全流程复刻（Node，无浏览器）：定位月球段的性能/逻辑问题
const fs=require('fs'),path=require('path'),vm=require('vm');
const dir=process.argv[2];
const ctx={console,Math,isFinite};ctx.window=ctx;ctx.globalThis=ctx;vm.createContext(ctx);
for(const f of ['00-constants.js','01-math.js','02-astro.js','03-physics.js'])
  vm.runInContext(fs.readFileSync(path.join(dir,'apollo11','webdata','js',f),'utf8'),ctx,{filename:f});
const V=ctx.APL.V, M=ctx.APL.M, A=ctx.APL.Astro, B=ctx.APL.BODY, P=ctx.APL.Physics;
const w=new P.World(); w.running=true; w.t=700;
// M2 场景（parking）
const rp=B.EARTH.radius+183.2, ra=B.EARTH.radius+185.9, a=(rp+ra)/2, e=(ra-rp)/(ra+rp);
const incP=ctx.APL.SITE.parkingInclination*M.D2R;
const tofP=72*3600, uArr=V.unit(A.moonState(w.t+tofP).r);
let bestST=null;
M.raanCandidates(incP,uArr).forEach(raanP=>{
  const nP=M.orbitNormal(incP,raanP);
  let d=V.sub(uArr,V.mul(nP,V.dot(uArr,nP))); if(V.mag(d)<1e-9)return; d=V.unit(d);
  const rDep=V.mul(d,-(rp+ra)/2);
  const vDep=V.mul(V.unit(V.cross(nP,rDep)),Math.sqrt(B.EARTH.mu/V.mag(rDep)));
  const Lb=M.lambert(B.EARTH.mu,rDep,A.moonState(w.t+tofP).r,tofP,true);
  const dv=Lb?V.mag(V.sub(Lb.v1,vDep)):1e9;
  if(!bestST||dv<bestST.dv)bestST={dv,r:rDep,v:vDep};
});
const mods=P.buildSaturnVStack().filter(m=>m.stage>=2&&m.id!=='S-IC'&&m.id!=='S-II'&&m.id!=='ESA');
const c=new P.Craft({id:'CSM',r:bestST.r,v:bestST.v,modules:mods,mode:'prograde'});
c.stageIndex=2; w.addCraft(c);
// 窗口搜索（同 solveTLI）
const mu=B.EARTH.mu, rel0=V.sub(c.r,[0,0,0]), vrel0=V.sub(c.v,[0,0,0]);
const el=M.elements(mu,rel0,vrel0), period=2*Math.PI*Math.sqrt(el.a**3/mu);
let best=null;
for(let k=0;k<=120;k++){
  const wait=k*period/25;
  const s1=M.propagate(mu,rel0,vrel0,wait);
  for(const h of [64,68,72,76,80]){
    const tof=h*3600, tg=A.moonState(w.t+wait+tof).r;
    const Lb=M.lambert(mu,s1.r,tg,tof,true); if(!Lb)continue;
    const dv=V.mag(V.sub(Lb.v1,s1.v));
    if(!best||dv<best.dv)best={dv,tof,wait};
  }
}
console.log('窗口: 等待',(best.wait/60).toFixed(1),'min  tof='+(best.tof/3600).toFixed(0)+'h  Δv='+best.dv.toFixed(4));
// 等窗口
let t=0; const STEP=1/60*2000;
while(w.t < 700+best.wait-1 && t<3e6){ w.warp=2000; w.advance(1/60); t++; }
console.log('到窗口 t=+'+((w.t-700)/60).toFixed(1)+'min  步数',t);
// burnTLI（B面偏置）
{
  const rel=V.sub(c.r,[0,0,0]), vrel=V.sub(c.v,[0,0,0]);
  const tof=best.tof, tg=A.moonState(w.t+tof).r;
  let Lb=M.lambert(mu,rel,tg,tof,true);
  const eArr=V.unit(Lb.v2), msA=A.moonState(w.t+tof);
  const siteA=A.moonSurfacePoint(w.t+tof,ctx.APL.LANDING_SITE.lat,ctx.APL.LANDING_SITE.lon,0).r;
  const upS=V.unit(V.sub(siteA,msA.r));
  let bHat=V.sub(upS,V.mul(eArr,V.dot(upS,eArr)));
  if(V.mag(bHat)<1e-3){const hT=V.unit(V.cross(rel,Lb.v1));bHat=V.cross(eArr,hT);}
  bHat=V.unit(bHat);
  const vInf=V.mag(V.sub(Lb.v2,msA.v)), rpM=B.MOON.radius+250;
  const bMag=rpM*Math.sqrt(1+2*B.MOON.mu/(rpM*vInf*vInf));
  console.log('v∞='+(vInf).toFixed(3)+' km/s  瞄准半径 b='+bMag.toFixed(0)+' km');
  const Lb2=M.lambert(mu,rel,V.add(tg,V.mul(bHat,bMag)),tof,true);
  if(Lb2)Lb=Lb2;
  const dv1=V.sub(Lb.v1,vrel);
  w.impulsiveBurn(c,V.mag(dv1),V.unit(dv1));
  console.log('TLI Δv='+V.mag(dv1).toFixed(4)+' km/s  t=+'+((w.t-700)/60).toFixed(1)+'min');
}
// 地月滑行
let n0=0; const t0=Date.now();
while(c.primary!=='MOON' && n0<300000){ w.warp=50000; w.advance(1/60); n0++; }
console.log('进 SOI: t=+'+((w.t-700)/3600).toFixed(1)+'h  步数',n0,'  用时',Date.now()-t0,'ms');
// 接近月球
n0=0; const t1=Date.now();
let lastLog=-1e9;
while(V.dist(c.r,A.moonState(w.t).r)>3000 && n0<2000000 && !c.crashed){
  w.warp=2000; w.advance(1/60); n0++;
  if(n0-lastLog>20000){ lastLog=n0;
    console.log('  接近中 dist='+V.dist(c.r,A.moonState(w.t).r).toFixed(0)+'km  alt='+(V.dist(c.r,A.moonState(w.t).r)-B.MOON.radius).toFixed(0)+'km  步数',n0,' 用时',Date.now()-t1,'ms');
    if(Date.now()-t1>60000){console.log('  ⚠️ 超过 60 s，中止');break;}
  }
}
console.log('到 3000km: 步数',n0,'用时',Date.now()-t1,'ms  alt='+(V.dist(c.r,A.moonState(w.t).r)-B.MOON.radius).toFixed(0),'km');
// LOI
n0=0; const t2=Date.now(); let burns=0;
while(n0<2000000 && !c.crashed){
  w.warp=50; w.advance(1/60); n0++;
  if(true){
    const ms=A.moonState(w.t), rel=V.sub(c.r,ms.r), vrel=V.sub(c.v,ms.v);
    const alt=V.mag(rel)-B.MOON.radius, up=V.unit(rel);
    const vRad=Math.abs(V.dot(vrel,up));
    if(alt<2500 && (vRad<0.25||alt<150)){
      const r=P.lunarOrbitAlign(w,c,{plane:'current',dvCapKmS:0.9});
      if(r&&r.burned){burns++;console.log('  LOI burn#'+burns+' dv='+(r.dv*1000).toFixed(0)+' alt='+alt.toFixed(0));}
      if(r&&r.done)break;
    }
  }
  if(Date.now()-t2>60000){console.log('  ⚠️ LOI 超 60 s 中止');break;}
}
const ms=A.moonState(w.t), o=c.orbitRelative('MOON',w);
console.log('LOI 完成: burns='+burns+' 步数',n0,'用时',Date.now()-t2,'ms  轨道 '+
  (isFinite(o.periapsis)?(o.periapsis-B.MOON.radius).toFixed(0):'?')+'×'+(isFinite(o.apoapsis)?(o.apoapsis-B.MOON.radius).toFixed(0):'?')+'km e='+(isFinite(o.e)?o.e.toFixed(4):'?'));
// ---- 平面设置追踪 ----
c._planePhase=null; c.stageIndex=5; c.throttleCmd=0;
let psBurns=0, n1=0; const t3=Date.now(); let lastP='';
let guard=0;
while(n1<3000000 && !c.crashed){
  w.warp=300; w.advance(1/60); n1++;
  const rr=P.lunarPlaneSetup(w,c,{apoKm:10000,tolDeg:0.5});
  if(rr&&rr.burned){psBurns++;
    const msx=A.moonState(w.t), ox=c.orbitRelative('MOON',w);
    console.log('  PS burn#'+psBurns+' ['+rr.phase+'] dv='+(rr.dv*1000).toFixed(0)+' dAng='+(rr.dAng||0).toFixed(2)+
      '°  轨道 '+(isFinite(ox.periapsis)?(ox.periapsis-B.MOON.radius).toFixed(0):'?')+'×'+(isFinite(ox.apoapsis)?(ox.apoapsis-B.MOON.radius).toFixed(0):'?')+'km');
  }
  if(rr&&rr.done){console.log('  PS 完成 phase='+rr.phase+' 用时',Date.now()-t3,'ms 步数',n1);break;}
  if(n1%200000===0){const msx=A.moonState(w.t);
    console.log('  PS进行 t=+'+((w.t-700)/3600).toFixed(1)+'h alt='+(V.dist(c.r,msx.r)-B.MOON.radius).toFixed(0)+'km phase='+(rr&&rr.phase)+' dAng='+(rr&&rr.dAng||0).toFixed(2)+'°');}
  if(Date.now()-t3>120000){console.log('  ⚠️ PS 超 120 s');break;}
}
if(c.crashed){const msx=A.moonState(w.t);console.log('  ✘ 坠毁! alt='+(V.dist(c.r,msx.r)-B.MOON.radius).toFixed(1)+'km v='+(V.mag(V.sub(c.v,msx.v))*1000).toFixed(0)+'m/s');}
const of=c.orbitRelative('MOON',w);
console.log('最终轨道 '+(isFinite(of.periapsis)?(of.periapsis-B.MOON.radius).toFixed(0):'?')+'×'+(isFinite(of.apoapsis)?(of.apoapsis-B.MOON.radius).toFixed(0):'?')+'km  LM_D prop='+(c.modules.find(m=>m.id==='LM_D')||{prop:0}).prop.toFixed(0));
