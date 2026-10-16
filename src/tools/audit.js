// 静态审计：1) 真实加载全部 12 个模块（node --check 查不出悬空引用）
//           2) 校验所有 APL.* 导出真的存在  3) 扫描常见 bug 模式
const fs=require('fs'),path=require('path'),vm=require('vm');
const dir=process.argv[2];
const files=['00-constants.js','01-math.js','02-astro.js','03-physics.js','04-agc.js',
             '05-asm.js','06-render.js','07-app.js','08-programs.js','09-i18n.js',
             '10-tutorial.js','11-demo.js'];
const ctx={console,Math,isFinite,setTimeout,setInterval,clearInterval,clearTimeout,
           requestAnimationFrame:function(){},document:{getElementById:function(){return null;},
           querySelectorAll:function(){return[];},addEventListener:function(){}},
           window:null,localStorage:{getItem:function(){return null;},setItem:function(){}}};
ctx.window=ctx; ctx.globalThis=ctx; ctx.self=ctx;
vm.createContext(ctx);
let errs=[];
for(const f of files){
  try{ vm.runInContext(fs.readFileSync(path.join(dir,'apollo11','webdata','js',f),'utf8'),ctx,{filename:f}); }
  catch(e){ errs.push('[LOAD] '+f+': '+e.message); }
}
console.log('加载错误:', errs.length?errs.join('\n        '):'无 ✓');
// 导出完整性
const A=ctx.APL||{};
let bad=[];
function check(obj,prefix){
  for(const k in obj){
    if(obj[k]===undefined) bad.push(prefix+k+' = undefined');
    else if(typeof obj[k]==='object'&&obj[k]&&prefix==='APL.') {
      // 只查一层
    }
  }
}
check(A,'APL.');
for(const k of ['V','M','Astro','Physics','AGC','DSKY','Asm','Renderer','Camera','I18N','Tutorial','Demo'])
  if(!(k in A)) bad.push('APL.'+k+' 缺失');
else if(A[k]===undefined) bad.push('APL.'+k+' undefined');
const P=A.Physics||{};
for(const k of ['Craft','World','landingControl','descentGuidance','orbitOverSite',
  'lunarInsertionPlan','lunarOrbitAlign','lunarPlaneSetup','planeChangeToSite',
  'transEarthInjection','deorbitTo','rendezvousControl','lunarAscentControl',
  'impulsiveBurn','predict','jettisonModule'])
  if(!(k in P)&&typeof P[k]==='undefined') bad.push('Physics.'+k+' 缺失/undefined');
console.log('导出问题:', bad.length?bad.join('\n        '):'无 ✓');
// App 导出
const App=ctx.APLApp;
if(!App){ console.log('APLApp 未定义（index.html 之外的上下文正常）'); }
else{
  const need=['startMission','execTLI','undockLM','dockCraft','switchCraft','runCalculator',
              'logLine','finishMission','stageNow','updatePrediction'];
  const miss=need.filter(k=>typeof App[k]!=='function');
  console.log('App 接口缺失:', miss.length?miss.join(', '):'无 ✓');
}
// 常见 bug 模式扫描
const pats=[
  [/\bplaneChangeToSite\b/, 'planeChangeToSite 引用（函数已删，只允许出现在注释里）'],
  [/cam\.manual/, 'cam.manual（已被 userZoom 取代）'],
  [/world\.predict\(([^,]+,\s*[^,]+,\s*[^,]+)\);?\s*$/m, 'world.predict 三参旧签名（现在返回 {pts,state}）'],
];
for(const f of files){
  const src=fs.readFileSync(path.join(dir,'apollo11','webdata','js',f),'utf8');
  if(/planeChangeToSite/.test(src) && !/^\s*\/\//m.test(src.split('planeChangeToSite')[0].split('\n').pop()))
    console.log('  [PATTERN] '+f+' 引用 planeChangeToSite');
  if(/cam\.manual/.test(src)) console.log('  [PATTERN] '+f+' 还在用 cam.manual');
}
console.log('--- 审计完成 ---');
// ---- 补充：功能语义单元测试 ----
