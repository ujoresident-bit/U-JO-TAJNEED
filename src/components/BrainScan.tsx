// @ts-nocheck
import React, { useEffect, useRef } from 'react';

// Spaced-review "brain scan": a stack of sagittal MRI slices with one glowing point per review item.
// Cyan = due in 1 day, violet = 3 days, green = 7 days. Canvas 2D, ~30fps, paused when off-screen.

export interface BrainScanEvent { n: number; i: number; tier: number }
interface BrainScanProps {
  tiers: number[];          // review stage per item (0,1,2)
  active: number;           // index of the item being reviewed, -1 for none
  focusTier: number;        // tier to emphasise, -1 for none
  event: BrainScanEvent | null; // answer feedback: item i moved to tier
  small?: boolean;
}

const BrainScan: React.FC<BrainScanProps> = ({ tiers, active, focusTier, event, small }) => {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef({ active, focusTier, event });
  propsRef.current = { active, focusTier, event };
  const tiersRef = useRef(tiers);
  tiersRef.current = tiers;
  const n = Math.min(40, tiers.length);

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const cx = cv.getContext('2d');
    if (!cx) return;
    const tiersInit = tiersRef.current;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const low = (navigator.hardwareConcurrency || 8) <= 4;
    let W = 0, H = 0, dpr = 1;
    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = cv.getBoundingClientRect();
      W = r.width; H = r.height;
      cv.width = Math.max(1, Math.round(W * dpr)); cv.height = Math.max(1, Math.round(H * dpr));
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
var RC=[[79,214,236],[180,168,245],[111,224,180]],RED=[255,143,163],ICE=[207,239,248];
var seed=21;function rnd(){seed=(seed*16807)%2147483647;return seed/2147483647}
/* brain as a stack of sagittal MRI slices: cerebrum, cerebellum and brainstem, each slice folded like cortex */
function cer(t,k){var f=1+.028*Math.sin(11*t+k)+.017*Math.sin(19*t-k*2);var c=Math.cos(t),sn=Math.sin(t);
 return[c*1.0*f,(sn>=0?sn*.62:sn*.3-.03*Math.max(0,c)*Math.max(0,-sn))*f]}
var slices=[],pts=[];
var NSL=low?13:19,XS=.62;
for(var k=0;k<NSL;k++){var x=-XS+2*XS*k/(NSL-1),sc_=Math.sqrt(Math.max(0,1-(x/XS)*(x/XS))),polys=[];
 if(sc_>.12){[[1,.9],[.74,.45],[.5,.3]].forEach(function(L,li){var ring=[];for(var j=0;j<=(low?60:96);j++){var t=j/(low?60:96)*6.283,p=cer(t,k*.6+li*1.7),w=1+(li?.05*Math.sin(7*t+k+li):0);ring.push([x,p[1]*sc_*L[0]*w+(li?.04:0),p[0]*sc_*L[0]*w])}polys.push({r:ring,a:L[1]})})}
 if(Math.abs(x)<.36){var s2=Math.sqrt(1-(x/.36)*(x/.36)),ring=[];for(var j=0;j<=40;j++){var t=j/40*6.283;ring.push([x,-.4+.19*Math.sin(t)*s2,-.62+.36*Math.cos(t)*s2])}polys.push({r:ring,a:.8});
  var r2=[];for(var j=0;j<=40;j++){var t=j/40*6.283;r2.push([x,-.4+.12*Math.sin(t)*s2,-.62+.24*Math.cos(t)*s2])}polys.push({r:r2,a:.4})}
 if(Math.abs(x)<.1){var st=[];for(var j=0;j<=16;j++)st.push([x,-.3-j/16*.55,-.05-j/16*.05+(x/.1)*.05]);polys.push({r:st,a:.8})}
 slices.push({x:x,p:polys})}
slices.forEach(function(sl){sl.p.forEach(function(pl){pl.r.forEach(function(q,i){if(i%2===0)pts.push({x:q[0],y:q[1],z:q[2],a:.35+rnd()*.6,s:.8+rnd()*1.2})})})});
for(var i=0;i<(low?500:1300);i++){var ok=0,x,y,z;while(!ok){x=(rnd()*2-1)*.6;y=(rnd()*2-1)*.6;z=(rnd()*2-1)*1;ok=(z*z+(y/(y>0?.62:.3))*(y/(y>0?.62:.3))+x*x/.38<1)}pts.push({x:x,y:y,z:z,a:.15+rnd()*.3,s:.6+rnd()*.7})}
/* review items live inside the volume, linked like a clinical graph */
var items=[],tiers=tiersInit.slice(0,40);
tiers.forEach(function(t,i){var ok=0,x,y,z;while(!ok){x=(rnd()*2-1)*.5;y=(rnd()*2-1)*.45;z=(rnd()*2-1)*.8;ok=(x*x/.3+(y/.5)*(y/.5)+z*z/.64<1)&&items.every(function(o){return(o.x-x)*(o.x-x)+(o.y-y)*(o.y-y)+(o.z-z)*(o.z-z)>.07})}
 items.push({x:x,y:y,z:z,tier:t,col:RC[t].slice(),fl:0,flash:null,ph:rnd()*6.28})});
var links=[],pulses=[];
items.forEach(function(a,i){var d=items.map(function(b,j){return[j,(a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y)+(a.z-b.z)*(a.z-b.z)]}).filter(function(x){return x[0]!==i}).sort(function(p,q){return p[1]-q[1]}).slice(0,2);
 d.forEach(function(x){if(!links.some(function(e){return(e[0]===i&&e[1]===x[0])||(e[0]===x[0]&&e[1]===i)}))links.push([i,x[0]])})});

var rot={y:1.57,x:-.12,vy:0,base:1.57},active=-1,focusRing=-1,drag=null,T0n=0,lastEv=0,running=false,raf=0;
var lastD=0,last=0,T0=performance.now(),nextAmb=0,nextAct=0,burst=[];
function P(x,y,z,sc){var cy=Math.cos(rot.y),sy=Math.sin(rot.y),cxr=Math.cos(rot.x),sxr=Math.sin(rot.x);
 var x1=x*cy+z*sy,z1=-x*sy+z*cy,y2=y*cxr-z1*sxr,z2=y*sxr+z1*cxr,k=Math.max(.45,1+z2*.22);return{x:W/2+x1*sc*k,y:H/2-y2*sc*k,z:z2,k:k}}
function rgba(c,a){return"rgba("+(c[0]|0)+","+(c[1]|0)+","+(c[2]|0)+","+a+")"}
function sendPulse(i,col){var l=links.filter(function(e){return e[0]===i||e[1]===i});l.forEach(function(e){if(pulses.length<60)pulses.push({e:e,u:0,dir:e[0]===i?1:-1,v:.55,col:col})})}
function frame(t){
 if(!running)return;
 requestAnimationFrame(frame);
 var pr=propsRef.current;active=pr.active;focusRing=pr.focusTier;
 if(pr.event&&pr.event.n!==lastEv){lastEv=pr.event.n;moveItem(pr.event.i,pr.event.tier)}
 if(t-lastD<(reduce?250:32))return;lastD=t;
 var dt=Math.min(.06,(t-last)/1000||0);last=t;var T=(t-T0)/1000;T0n=T;
 rot.y=rot.base+(reduce?0:Math.sin(T*.3)*.85);rot.x+=(-.12-rot.x)*Math.min(1,dt*.8);
 cx.clearRect(0,0,W,H);
 var sc=Math.min(W*.4,H*(H<250?.5:.62));
 var scan=-.62+((T*.2)%1)*1.24;
 /* scale ticks (right edge) */
 cx.fillStyle="rgba(147,163,182,.55)";cx.font="500 9px 'Geist Mono',ui-monospace,monospace";cx.textAlign="right";
 var sm=H<250;
 for(var i=0;i<=20&&!sm;i++){var yy=H*.12+(H*.76)*i/20,L=i%5===0?10:5;cx.fillRect(W-14-L,yy,L,1);if(i%5===0)cx.fillText((100-i*5)+"",W-30,yy+3)}
 /* slice contours */
 cx.lineWidth=.8;
 slices.forEach(function(sl){var near=Math.abs(sl.x-scan)<.04;
  sl.p.forEach(function(pl){cx.strokeStyle=near?rgba(ICE,.9):"rgba(79,214,236,"+(.16*pl.a)+")";if(near){cx.shadowColor="rgba(79,214,236,.9)";cx.shadowBlur=10}
   cx.beginPath();for(var j=0;j<pl.r.length;j++){var p=P(pl.r[j][0],pl.r[j][1],pl.r[j][2],sc);j?cx.lineTo(p.x,p.y):cx.moveTo(p.x,p.y)}cx.stroke();cx.shadowBlur=0})});
 /* point cloud with scan highlight */
 pts.forEach(function(q){var p=P(q.x,q.y,q.z,sc),d=Math.abs(q.x-scan),hot=d<.05,al=(.2+.55*(p.z+1)/2)*q.a;
  if(hot){cx.fillStyle=rgba(ICE,Math.min(1,al+.55));cx.fillRect(p.x-1,p.y-1,2.2,2.2)}else{cx.fillStyle="rgba(160,205,225,"+al+")";cx.fillRect(p.x-q.s/2,p.y-q.s/2,q.s,q.s)}});
 /* items: links, signals, nodes, reticle */
 cx.globalCompositeOperation="lighter";
 var IP=items.map(function(o){return P(o.x,o.y,o.z,sc)});
 links.forEach(function(e){var a=items[e[0]],b=items[e[1]],pa=IP[e[0]],pb=IP[e[1]],act=active>-1&&(e[0]===active||e[1]===active);cx.strokeStyle=rgba(act?a.col:ICE,act?.65:.16);cx.lineWidth=act?1.3:.7;cx.beginPath();cx.moveTo(pa.x,pa.y);cx.lineTo(pb.x,pb.y);cx.stroke()});
 if(T>nextAmb&&!reduce){sendPulse(Math.floor(rnd()*16),ICE);nextAmb=T+.5}
 if(active>-1&&T>nextAct&&!reduce){sendPulse(active,items[active].col);nextAct=T+1.1}
 for(var i=pulses.length-1;i>=0;i--){var pl=pulses[i];pl.u+=dt*pl.v;if(pl.u>=1){items[pl.dir>0?pl.e[1]:pl.e[0]].fl=1;pulses.splice(i,1);continue}
  var u=pl.dir>0?pl.u:1-pl.u,A=IP[pl.e[0]],B=IP[pl.e[1]],x=A.x+(B.x-A.x)*u,y=A.y+(B.y-A.y)*u;
  var g=cx.createRadialGradient(x,y,0,x,y,9);g.addColorStop(0,rgba(pl.col,.95));g.addColorStop(1,rgba(pl.col,0));cx.fillStyle=g;cx.beginPath();cx.arc(x,y,9,0,7);cx.fill()}
 items.forEach(function(o,i){var p=IP[i],isA=i===active,dim=focusRing>-1&&o.tier!==focusRing&&!isA?.5:1;o.fl=Math.max(0,o.fl-dt*2);
  var tc=o.flash?o.flash:RC[o.tier];for(var k=0;k<3;k++)o.col[k]+=(tc[k]-o.col[k])*Math.min(1,dt*3);if(o.flash&&T>o.fe)o.flash=null;
  var r=(isA?5.5:3.4)*p.k,hr=r*(isA?9:5)*(1+o.fl*.7),tw=.8+.2*Math.sin(T*2+o.ph);
  var h=cx.createRadialGradient(p.x,p.y,0,p.x,p.y,hr);h.addColorStop(0,rgba(o.col,(.42*dim*tw)+o.fl*.4));h.addColorStop(1,rgba(o.col,0));cx.fillStyle=h;cx.beginPath();cx.arc(p.x,p.y,hr,0,7);cx.fill();
  cx.fillStyle=isA?"#fff":rgba(o.col,Math.min(1,.9*dim+o.fl));cx.beginPath();cx.arc(p.x,p.y,r*(1+o.fl*.4),0,7);cx.fill();
  if(isA){ /* targeting reticle + callout */
   var s=15+Math.sin(T*3)*2,a=T*.8;cx.strokeStyle=rgba(o.col,.95);cx.lineWidth=1.3;
   for(var q=0;q<4;q++){var an=a+q*Math.PI/2,cxx=p.x+Math.cos(an)*s,cyy=p.y+Math.sin(an)*s,tx=-Math.sin(an)*6,ty=Math.cos(an)*6;cx.beginPath();cx.moveTo(cxx-tx,cyy-ty);cx.lineTo(cxx,cyy);cx.lineTo(cxx+Math.cos(an+Math.PI/2)*0+(-Math.sin(an+Math.PI/2))*0+tx*0,cyy);cx.stroke()}
   cx.beginPath();cx.arc(p.x,p.y,s+7+((T*1.1)%1)*14,0,7);cx.strokeStyle=rgba(o.col,.5*(1-((T*1.1)%1)));cx.stroke();
   var right=p.x<W*.55,lx=right?W-56:56,ly=Math.max(30,Math.min(H-60,p.y-46));
   cx.strokeStyle=rgba(o.col,.7);cx.lineWidth=1;cx.beginPath();cx.moveTo(p.x+(right?s:-s),p.y);cx.lineTo(right?p.x+s+18:p.x-s-18,ly+14);cx.lineTo(lx+(right?-4:4),ly+14);cx.stroke();
   cx.textAlign=right?"right":"left";cx.fillStyle="#EAF1F7";cx.font="500 11px 'Geist',system-ui,sans-serif";cx.fillText("ITEM "+("0"+(i+1)).slice(-2),lx,ly+10);
   cx.fillStyle=rgba(o.col,1);cx.font="500 9.5px 'Geist Mono',ui-monospace,monospace";cx.fillText("DUE IN "+["1 DAY","3 DAYS","7 DAYS"][o.tier],lx,ly+26)}});
 cx.globalCompositeOperation="source-over";
 /* shock rings from answers */
 for(var i=burst.length-1;i>=0;i--){var b=burst[i],k=(T-b.t)/1.3;if(k>1){burst.splice(i,1);continue}var p=IP[b.i];cx.strokeStyle=rgba(b.c,(1-k)*.8);cx.lineWidth=1.5;cx.beginPath();cx.arc(p.x,p.y,10+k*80,0,7);cx.stroke()}
 /* EEG trace */
 var ey=H<250?H-20:H-34;cx.strokeStyle="rgba(111,224,180,.7)";cx.lineWidth=1.2;cx.beginPath();
 var n=Math.floor(Math.min(W-90,H<250?140:360)/2);for(var i=0;i<n;i++){var x=24+i*2,ph=(T*60+i)*.05,spike=Math.pow(Math.max(0,Math.sin((i+T*40)*.09)),24)*14,y=ey-spike*(Math.sin(i*.3)>0?1:-.6)+Math.sin(ph*3)*1.2+Math.sin(ph*1.3)*1.5;i?cx.lineTo(x,y):cx.moveTo(x,y)}cx.stroke();
 /* HUD */
 cx.strokeStyle="rgba(207,239,248,.22)";cx.lineWidth=1;[[6,6,1,1],[W-6,6,-1,1],[6,H-6,1,-1],[W-6,H-6,-1,-1]].forEach(function(c){cx.beginPath();cx.moveTo(c[0],c[1]+c[3]*12);cx.lineTo(c[0],c[1]);cx.lineTo(c[0]+c[2]*12,c[1]);cx.stroke()});
 cx.fillStyle="rgba(147,163,182,.85)";cx.font="500 9.5px 'Geist Mono',ui-monospace,monospace";cx.textAlign="left";
 cx.fillText(sm?"MEMORY SCAN":"MEMORY SCAN  ·  "+items.length+" ITEMS",16,22);cx.fillText("SAGITTAL X "+(scan>=0?"+":"")+scan.toFixed(2),16,H-14);
 if(!sm){cx.textAlign="right";cx.fillText("SPACED REVIEW  ·  1D / 3D / 7D",W-16,22)}}
function moveActive(ring){if(active<0)return;var o=items[active];if(ring===0){o.flash=RED;o.fe=T0n+.9}o.tier=ring;burst.push({i:active,t:T0n,c:ring===0?RED:RC[ring]});sendPulse(active,ring===0?RED:RC[ring])}

function moveItem(i,ring){var o=items[i];if(!o)return;if(ring===0){o.flash=RED;o.fe=T0n+.9}o.tier=ring;burst.push({i:i,t:T0n,c:ring===0?RED:RC[ring]});sendPulse(i,ring===0?RED:RC[ring])}
const down=(e)=>{drag={x:e.clientX};try{cv.setPointerCapture(e.pointerId)}catch(_){}};
const move=(e)=>{if(drag){var dx=e.clientX-drag.x;drag.x=e.clientX;rot.base+=dx*.008}};
const up=()=>{drag=null};
cv.addEventListener('pointerdown',down);cv.addEventListener('pointermove',move);cv.addEventListener('pointerup',up);
let visible=true;
const sync=()=>{const want=visible&&!document.hidden;if(want&&!running){running=true;last=performance.now();raf=requestAnimationFrame(frame)}else if(!want){running=false;cancelAnimationFrame(raf)}};
const io='IntersectionObserver' in window?new IntersectionObserver((es)=>{visible=es[0].isIntersecting;sync()}):null;
io&&io.observe(cv);
document.addEventListener('visibilitychange',sync);
const ro='ResizeObserver' in window?new ResizeObserver(()=>size()):null;
ro&&ro.observe(cv);
sync();
return()=>{running=false;cancelAnimationFrame(raf);io&&io.disconnect();ro&&ro.disconnect();document.removeEventListener('visibilitychange',sync);cv.removeEventListener('pointerdown',down);cv.removeEventListener('pointermove',move);cv.removeEventListener('pointerup',up)};
  }, [n]);

  return (
    <div className={`rv-stage${small ? ' small' : ''}`}>
      <canvas ref={cvRef} aria-label="Brain scan of review items. Cyan points are due tomorrow, violet in 3 days, green in 7 days." />
    </div>
  );
};

export default BrainScan;
