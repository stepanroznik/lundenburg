import React from 'react';
import type { Film } from '../model.js';
import { Actor } from './Actor.js';
import { Outdoor, Tree, Splash, Leaf, BeachBall, Flower, Shadow, clamp, smooth, lerp, ink } from './Scenery.js';
import { mix, worldPoint, localPoint, type Point } from './Motion.js';
import { WateringCan, Umbrella, Rake, PoolSurroundings } from './Props.js';

const Snowball = ({ x=0, y=0, r=26 }: {x?:number;y?:number;r?:number}) => <g><circle cx={x} cy={y} r={r} fill="#fffefa" stroke="#adc9d1" strokeWidth="3"/><path d={`M${x-r*.55} ${y+r*.2}q${r*.3} ${r*.45} ${r*.85} ${r*.3}`} fill="none" stroke="#dcebee" strokeWidth="3"/></g>;
const SnowEars = () => <g fill="#fffefa" stroke="#adc9d1" strokeWidth="4"><ellipse cx="-29" cy="-55" rx="24" ry="64" transform="rotate(-10 -29 -55)"/><ellipse cx="31" cy="-55" rx="24" ry="64" transform="rotate(12 31 -55)"/></g>;
const arc = (a:Point,b:Point,p:number,height:number):Point => [lerp(a[0],b[0],p),lerp(a[1],b[1],p)-Math.sin(clamp(p)*Math.PI)*height];
const at = (t:number,start:number,duration:number) => smooth((t-start)/duration);

function WaterFlight({t,from,to,start,duration,lift}: {t:number;from:Point;to:Point;start:number;duration:number;lift:number}) {
  return <g fill="#58b4cc" stroke="#d2f7fb" strokeWidth="2">{Array.from({length:22},(_,i)=>{
    const p=(t-start-(i%6)*.025)/duration;
    if(p<0||p>1)return null;
    const q=arc(from,to,p,lift), spread=Math.sin(p*Math.PI);
    const x=q[0]+Math.sin(i*2.4)*27*spread,y=q[1]+Math.cos(i*1.7)*36*spread;
    return <path key={i} d="M0-14Q-11-1-7 7Q0 18 8 7Q12-1 0-14Z" transform={`translate(${x} ${y}) rotate(${(to[0]>from[0]?35:-35)+p*60}) scale(${.55+i%4*.17})`}/>;
  })}</g>;
}

export function SilentScene({film,frame}:{film:Film;frame:number}) {
  const t=frame/film.fps, common={film,frame}, scene=film.skit.scene;
  if(scene==='puddles') {
    const run=at(t,.2,1.6), jump=clamp((t-1.8)/1.25), lift=Math.sin(jump*Math.PI);
    const brace=at(t,2.4,.8), hand=mix([100,190],[155,105],brace);
    const grip=worldPoint(hand,1280,595,true);
    const impact:Point=[grip[0]-Math.sin(25*Math.PI/180)*268*1.05,grip[1]-Math.cos(25*Math.PI/180)*268*1.05];
    return <><Outdoor frame={frame}/><ellipse cx="760" cy="907" rx="290" ry="56" fill="#85cddd" stroke="#5daab8" strokeWidth="4"/>
      {[0,1,2].map(i=><ellipse key={i} cx="760" cy="903" rx={100+i*65+Math.sin(frame/16)*5} ry={12+i*9} fill="none" stroke="#caeff1" strokeWidth="3"/>)}
      <Actor {...common} id="schalinka" x={t<1.8?lerp(410,535,run):lerp(535,730,smooth(jump))} y={595-lift*210} outfit="raincoat" walk={run>0&&run<1} stride={run*18} crouch={t<1.8?at(t,1.45,.25)*.35:at(t,3.05,.15)*(1-at(t,3.3,.4))*.4} rightHand={mix([115,200],[110,90],lift)} leftHand={mix([-100,208],[-115,90],lift)} look={7} emotion={t>4.3?'surprised':'happy'}/>
      <Actor {...common} id="haluschka" x={1280} flip outfit="raincoat" rightHand={hand} rightProp={<g transform="rotate(25)"><Umbrella/></g>} look={t>5.4?0:7} tilt={t>5.4?-4:0}/>
      <Splash x={760} y={885} p={(t-3.05)/.8}/><WaterFlight t={t} from={[775,880]} to={impact} start={3.07} duration={.85} lift={95}/>
      <Splash x={impact[0]} y={impact[1]} p={(t-3.92)/.32}/><WaterFlight t={t} from={impact} to={[730,610]} start={3.92} duration={.65} lift={85}/>
      <Splash x={730} y={618} p={(t-4.57)/.5}/>
      {t>4.57&&Array.from({length:8},(_,i)=><ellipse key={i} cx={658+i*20} cy={618+(i%3)*36+Math.min(70,(t-4.57)*32)} rx="5" ry="12" fill="#69bacc" opacity={1-at(t,6,1)}/>)}
    </>;
  }
  if(scene==='flowers') {
    const approach=at(t,.25,1.1), plant=at(t,1.25,1.2), stand=at(t,2.6,.7);
    const kx=lerp(560,755,approach), bend=38*plant*(1-stand), crouch=.25*plant*(1-stand);
    const planted:Point=[960,856];
    const flowerGrip=t<1.25?worldPoint([145,145],kx):mix(worldPoint([145,145],755),planted,plant);
    const kh=localPoint(flowerGrip,kx,595,false,bend,crouch);
    const pick=at(t,3,.65), raise=at(t,3.65,.7), pour=at(t,4.4,.3)*(1-at(t,6.1,.3)), put=at(t,6.5,.7);
    const sx=1260, sb=(30*pick*(1-raise)+30*put)*(1-at(t,7.25,.55)), sc=(.3*pick*(1-raise)+.3*put)*(1-at(t,7.25,.55));
    const canGround:Point=[1135,831], canUp:Point=[1140,733], canPos=mix(mix(canGround,canUp,raise),canGround,put);
    const sh=localPoint(t<3.65?mix(worldPoint([110,205],sx,595,true,sb,sc),canGround,pick):canPos,sx,595,true,sb,sc);
    const blossom=at(t,7.4,1.3), shake=t>6.5&&t<7.6?Math.sin((t-6.5)*12)*7*(1-blossom):0;
    const flowerTop=t<2.45?[flowerGrip[0],flowerGrip[1]-105] as Point:[960,751] as Point;
    return <><Outdoor frame={frame}/><ellipse cx="960" cy="923" rx="142" ry="25" fill="#a88962"/>
      <Actor {...common} id="knurpsi" x={kx} walk={approach>0&&approach<1} stride={approach*20} bend={bend} crouch={crouch} rightHand={t<2.6?kh:mix(kh,[110,207],stand)} look={7} tilt={t>8?-6:0}/>
      <Actor {...common} id="sisi" x={sx} flip bend={sb} crouch={sc} rightHand={t<7.2?sh:[110,205]} look={t>8.8?0:7} tilt={t>8.8?-5:0}/>
      <Flower x={flowerTop[0]} y={flowerTop[1]} scale={1.17} angle={shake}/>
      <g transform={`translate(${canPos[0]} ${canPos[1]})`}><WateringCan angle={-22*pour}/></g>
      {t>4.7&&t<6.15&&Array.from({length:18},(_,i)=>{const p=((frame*4+i*13)%150)/150;return <ellipse key={i} cx={1008-p*37+(i%3)*7} cy={767+p*144} rx="3" ry="6" fill="#69bacc"/>;})}
      {t>7.4&&<g transform={`translate(${lerp(960,1280,blossom)} ${lerp(742,480,blossom)-Math.sin(blossom*Math.PI)*115}) rotate(${blossom*220})`}>{[0,1,2,3,4].map(i=><ellipse key={i} cy="-14" rx="11" ry="18" fill="#fb7f87" transform={`rotate(${i*72})`}/>)}<circle r="12" fill="#fdbf11"/></g>}
    </>;
  }
  if(scene==='pool') {
    const p=at(t,1,6.5), sprint=at(t,4,3.5), sx=lerp(340,1480,p),hx=lerp(440,1660,sprint);
    return <><PoolSurroundings frame={frame}/><path d="M-40 680H1960v400H-40Z" fill="#e7e6d9"/><rect x="-20" y="715" width="1960" height="365" fill="#77cbd8" stroke="#eaf9f5" strokeWidth="17"/>
      <path d="M1700 737V623q0-27 23-27t23 27v114m75 0V623q0-27 23-27t23 27v114m-121-85h75m-75 44h75" fill="none" stroke="#6e939a" strokeWidth="9"/>
      <g stroke="#e7f7ee" strokeWidth="5" strokeDasharray="20 18"><path d="M0 887H1920"/><path d="M0 1035H1920"/></g>
      <Actor {...common} id="schalinka" x={sx} y={653+Math.sin(frame/6)*9} scale={.76} outfit="swimsuit" arm={-50+Math.sin(frame/5)*65} leftArm={Math.sin(frame/5+Math.PI)*30} look={7} shadow={false} rotate={8}/>
      <path d="M0 757Q120 737 240 757T480 757T720 757T960 757T1200 757T1440 757T1680 757T1920 757V1080H0Z" fill="#55bdcf"/>
      <g fill="none" stroke="#b0edf0" strokeWidth="5" opacity=".85">{Array.from({length:8},(_,i)=><path key={i} d={`M${(i*280+frame*2)%2100-100} ${805+i%3*90}q55-15 100 0`}/>)}</g>
      <ellipse cx={hx} cy={897+Math.sin(frame/16)*8} rx="135" ry="45" fill="#fdbf11" stroke="#d3942e" strokeWidth="5"/><ellipse cx={hx} cy={883+Math.sin(frame/16)*8} rx="69" ry="21" fill="#55bdcf"/>
      <g clipPath="url(#pool-upper)"><Actor {...common} id="haluschka" x={hx} y={792+Math.sin(frame/16)*8} scale={.68} outfit="swimsuit" rightHand={[110,145]} leftHand={[-110,145]} look={t>7?0:6} shadow={false}/></g>
      <defs><clipPath id="pool-upper"><rect width="1920" height="872"/></clipPath></defs>
      <Splash x={sx-80} y={754} p={(frame%25)/25}/>
    </>;
  }
  if(scene==='beachball') {
    const throwP=clamp((t-1.25)/1.6), back=clamp((t-5.3)/1.6);
    const held:Point=[668,720], perch:Point=[1300,288];
    const ball=t<1.25?held:t<2.85?arc(held,perch,throwP,100):t<5.3?perch:t<6.9?arc(perch,held,back,85):held;
    const angle=t<1.25?0:t<2.85?throwP*300:t<5.3?300:t<6.9?300+back*320:620;
    return <><Outdoor season="summer" frame={frame}/><path d="M0 865Q680 725 1190 872T1920 890V1080H0Z" fill="#f3dda9"/>
      <Actor {...common} id="knurpsi" x={510} outfit="summer" rightHand={t<1.25||t>6.9?localPoint([held[0]-53,held[1]+48],510):mix([165,90],[110,205],at(t,1.5,.5))} leftHand={t<1.25||t>6.9?[50,170]:[-100,200]} look={7}/>
      <Actor {...common} id="sisi" x={1300} flip outfit="summer" tilt={t>5.1&&t<5.55?-10*Math.sin(clamp((t-5.1)/.45)*Math.PI):0} rightHand={[110,200]} leftHand={[-100,200]} emotion={t>2.85&&t<5.1?'thinking':'happy'} look={t>2.85&&t<5.1?-1:7}/>
      <BeachBall x={ball[0]} y={ball[1]} r={95} angle={angle}/><Shadow x={ball[0]} y={929} r={55}/>
    </>;
  }
  if(scene==='leaves') {
    const run=at(t,.8,1.8), dive=clamp((t-2.6)/1.25), settle=at(t,3.7,.25), peek=at(t,5.7,1.25);
    const sx=t<2.6?lerp(1530,1350,run):lerp(1350,975,smooth(dive));
    const sy=595-Math.sin(dive*Math.PI)*175;
    const crouch=(t<2.6?at(t,2.3,.2)*.3:settle*.95)*(1-peek);
    const rakeMove=t<2.45?Math.sin(t*Math.PI*2)*25*(1-at(t,2.1,.35)):0;
    const rakeGrip:Point=[695+rakeMove,725];
    return <><Outdoor season="autumn" frame={frame}/>
      <Actor {...common} id="knurpsi" x={530} rightHand={localPoint(rakeGrip,530)} leftHand={localPoint([rakeGrip[0],rakeGrip[1]-75],530)} look={t>5.7?7:0} emotion={t>3.8?'thinking':'happy'}/>
      <g transform={`translate(${rakeGrip[0]} ${rakeGrip[1]})`}><Rake/></g>
      {/* Always mounted: the foreground pile alone hides her, with planted feet. */}
      <Actor {...common} id="schalinka" x={sx} y={sy} flip crouch={crouch} walk={run>0&&run<1} stride={run*30} rightHand={mix([110,205],[115,92],Math.sin(dive*Math.PI))} leftHand={mix([-100,205],[-115,92],Math.sin(dive*Math.PI))} look={t>6.8?0:7} tilt={t>6.8?-5:0}/>
      <g><path d={`M675 925Q695 840 744 800Q750 735 825 ${680+peek*45}Q859 ${575+peek*70} 946 ${590+peek*70}Q1030 ${571+peek*70} 1100 ${677+peek*45}Q1190 720 1222 807Q1280 848 1291 925Z`} fill="#c78743" stroke="#9f7047" strokeWidth="5"/>
        {Array.from({length:195},(_,i)=>{const u=((i*89)%197)/197,v=((i*53)%199)/199,x=700+u*565,top=920-(332-peek*70)*Math.sin(u*Math.PI);return <Leaf key={i} x={x} y={lerp(top,917,v)} angle={i*137+Math.sin(frame/17+i)*at(t,3.7,.2)*(1-at(t,4.4,.5))*8} s={1.02+i%3*.18} color={['#da8045','#eaa44c','#c35b41','#bb9952'][i%4]!}/>;})}
      </g>
      {t>3.65&&t<5.5&&Array.from({length:42},(_,i)=>{const p=clamp((t-3.65-(i%4)*.04)/1.7);return <Leaf key={i} x={975+Math.cos(i*2.4)*p*370} y={690-Math.sin(p*Math.PI)*(160+i%5*26)+p*220} angle={i*77+p*340} s={.7+i%3*.2} color={i%2?'#da8045':'#eaa44c'}/>;})}
      {peek>.8&&<Leaf x={937} y={623} angle={75} s={.65}/>}
    </>;
  }
  if(scene==='snowballs') {
    const wind=at(t,.8,.5), release=1.5, fly=clamp((t-release)/1.1), duck=at(t,2,.24)*(1-at(t,2.9,.45));
    const hand=mix([125,112],[105,50],wind), start=worldPoint([105,33],545), recover=at(t,2,.45),drop=clamp((t-3.35)/.65);
    return <><Outdoor season="winter" frame={frame}/><Tree x={1525} y={892} s={1.12} winter/>
      <Actor {...common} id="knurpsi" x={545} outfit="scarf" rightHand={t<release?hand:mix([175,85],[110,205],recover)} leftHand={[-100,205]} rightProp={t<release?<Snowball y={-17} r={27}/>:undefined} look={7} tilt={t>4.7?-5:0}/>
      <Actor {...common} id="schalinka" x={1325} flip outfit="scarf" crouch={duck} bend={duck*12} rightHand={mix([110,200],[95,65],duck)} leftHand={mix([-100,200],[-95,65],duck)} look={t>4.6?0:7} emotion={t>4&&t<4.7?'surprised':'happy'}/>
      {t>=release&&t<2.6&&<Snowball x={arc(start,[1525,449],fly,150)[0]} y={arc(start,[1525,449],fly,150)[1]} r={28}/>}
      <Splash x={1525} y={460} p={(t-2.6)/.6} color="#fffefa"/>
      {t>=3.35&&<g transform={`translate(1325 ${lerp(325,515,drop)})`} fill="#fffefa" stroke="#adc9d1" strokeWidth="3"><path d="M-109 0Q-91-46-61-24Q-35-70 9-27Q51-57 69-20Q99-31 109 0Q82 28 45 9Q11 33-20 11Q-79 38-109 0Z"/></g>}
      <Splash x={1325} y={530} p={(t-4)/.65} color="#fffefa"/>
    </>;
  }
  if(scene==='snowman') {
    const middle=at(t,1.2,1.6),head=at(t,3.7,1.3),ears=at(t,7.9,1.2);
    const mx=lerp(755,950,middle),my=lerp(831,664,middle)-Math.sin(middle*Math.PI)*45;
    const hx=lerp(1180,950,head),hy=lerp(854,540,head)-Math.sin(head*Math.PI)*35;
    const kx=lerp(lerp(560,735,at(t,.25,.7)),590,at(t,2.9,.6)), sc=at(t,.5,.6)*(1-at(t,1.2,.7)),sb=24*sc;
    const sx=lerp(1360,1150,at(t,3,.7))+200*at(t,6.4,.7)*(1-ears);
    const earCrouch=.75*at(t,7.1,.7)*(1-at(t,7.9,.6));
    const hc=at(t,3,.65)*(1-at(t,3.7,.7))+earCrouch,hb=28*hc;
    const carrot=at(t,5.5,.65),earPos=mix([1210,912],[950,492],ears);
    return <><Outdoor season="winter" frame={frame}/><Shadow x={950} y={925} r={140}/>
      <Actor {...common} id="haluschka" x={kx} outfit="scarf" walk={t>.25&&t<.95||t>2.9&&t<3.5} stride={t*18} crouch={sc} bend={sb} rightHand={t<2.9?localPoint([mx-57,my+49],kx,595,false,sb,sc):[110,205]} leftHand={t<2.9?localPoint([mx-74,my-5],kx,595,false,sb,sc):[-100,205]} look={7} tilt={t>9?-5:0}/>
      <Actor {...common} id="sisi" x={sx} flip outfit="scarf" walk={t>3&&t<3.7||t>6.4&&t<7.1||t>7.9&&t<9.1} stride={t*16} crouch={hc} bend={hb} rightHand={t>3&&t<5.1?localPoint([hx+43,hy+36],sx,595,true,hb,hc):t>5.5&&t<6.15?localPoint(mix([1100,680],[978,549],carrot),sx,595,true):t>7.1&&t<9.1?localPoint(mix(worldPoint([110,205],sx,595,true,hb,hc),[earPos[0]+40,earPos[1]-8],at(t,7.1,.65)),sx,595,true,hb,hc):[110,205]} leftHand={t>3.5&&t<5.1?localPoint([hx+52,hy-15],sx,595,true,hb,hc):[-100,205]} look={7} tilt={t>9?-6:0}/>
      <Snowball x={950} y={821} r={111}/><Snowball x={mx} y={my} r={84}/><Snowball x={hx} y={hy} r={61}/>
      {head===1&&<g fill={ink}><circle cx="930" cy="533" r="6"/><circle cx="973" cy="533" r="6"/>{[0,1,2,3,4].map(i=><circle key={i} cx={927+i*12} cy={568+Math.sin(i/4*Math.PI)*9} r="3"/>)}<circle cx="950" cy="628" r="7"/><circle cx="950" cy="670" r="7"/></g>}
      {t>5.5&&<path d="M-8-8L46 0-8 8Z" transform={`translate(${lerp(1100,958,carrot)} ${lerp(680,549,carrot)})`} fill="#fd6f04" stroke="#c56524" strokeWidth="2"/>}
      <g transform={`translate(${earPos[0]} ${earPos[1]})`}><SnowEars/></g>
      {t>9.1&&<g stroke="#fdbf11" strokeWidth="5" strokeLinecap="round"><path d="M812 457l-21-18m48-15l-8-27m217 65l25-12m-50-14l13-24"/></g>}
    </>;
  }
  // Haluschka walks to the snag, bends down, frees the tail and holds the kite
  // into the wind before releasing it. Sisi keeps hold of the same string.
  const walk=at(t,.35,1.7),bendIn=at(t,2.05,.6),free=at(t,3.25,.7),stand=at(t,4,.65),flight=at(t,5.4,2.2);
  const x=lerp(1390,1030,walk)+160*at(t,6,.9),bend=42*bendIn*(1-stand),crouch=.4*bendIn*(1-stand);
  const kite=t<4?mix([850,822],[850,790],free):t<5.4?mix([850,790],[850,570],at(t,4,1.4)):mix([850,570],[1190+Math.sin(frame/28)*20,240],flight);
  const grip:Point=[kite[0]+72,kite[1]+10];
  const hand=t<2.05?[115,205] as Point:t<3.95?localPoint(mix(worldPoint([115,205],x,595,true,bend,crouch),[900,875],bendIn),x,595,true,bend,crouch):t<5.4?localPoint(grip,x,595,true,bend,crouch):[110,205] as Point;
  const spool=worldPoint([140,105],600);
  return <><Outdoor season="autumn" frame={frame}/>
    <Actor {...common} id="sisi" x={600} look={7} rightHand={[140,105]} rightProp={<circle r="23" fill="#a97857" stroke={ink} strokeWidth="4"/>} leftHand={[-100,205]} tilt={flight>0?-7:4} emotion={flight>0?'happy':'thinking'}/>
    <Actor {...common} id="haluschka" x={x} flip walk={walk>0&&walk<1||t>6&&t<6.9} stride={t*17} bend={bend} crouch={crouch} rightHand={hand} leftHand={[-100,205]} look={7} tilt={flight>0?-6:4}/>
    <path d={`M${spool[0]} ${spool[1]}Q${lerp(780,1000,flight)} ${lerp(910,610,flight)} ${kite[0]} ${kite[1]}`} fill="none" stroke="#826c51" strokeWidth="3"/>
    <path d={`M${kite[0]} ${kite[1]+93}Q${kite[0]-85} ${kite[1]+160} ${lerp(900,kite[0]+10,Math.max(free,flight))} ${lerp(897,kite[1]+242,flight)}`} fill="none" stroke="#e09265" strokeWidth="5"/>
    <path d="M897 916l5-57m-3 16l-15-10" stroke="#9e7952" strokeWidth="7" strokeLinecap="round"/>
    <g transform={`translate(${kite[0]} ${kite[1]}) rotate(${Math.sin(frame/25)*7*flight})`} stroke={ink} strokeWidth="4"><path d="M0-103L88 0 0 93-88 0Z" fill="#02aafd"/><path d="M0-103V93L88 0Z" fill="#fb1143"/><path d="M-88 0H88M0-103V93" fill="none" stroke="#fff2d8" strokeWidth="4"/></g>
    {flight>0&&[0,1,2].map(i=><path key={i} d="M-15-9L15 9V-9L-15 9Z" transform={`translate(${kite[0]-15+Math.sin(i)*20} ${kite[1]+125+i*45}) rotate(${i*20})`} fill={['#fdbf11','#79c718','#fd6f04'][i]}/>)}
    {free<1&&<path d={`M902 886q${-22*(1-free)} 17-18-5t25 0`} fill="none" stroke="#e09265" strokeWidth="5"/>}
    {flight>0&&<g stroke="#fffdf6" strokeWidth="5" fill="none" opacity=".6"><path d={`M300 ${360+Math.sin(frame/20)*12}h130m760 95h160m-710-40h90`}/></g>}
  </>;
}
