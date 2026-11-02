import type { Film } from '../model.js';
import type { CharacterId } from '../../characters/types.js';
import { Gift } from '../../characters/ChristmasProps.js';
import { hedgehogParcels } from '../../characters/Hedgehog.js';
import { Actor } from './Actor.js';
import { Outdoor, smooth, ink } from './Scenery.js';
import { mix } from './Motion.js';
import { europe } from './Europe.js';
import { christmasMapBeats, parcelStarts } from '../christmas-timing.js';

export function Star({ x=0, y=0, size=1, rotate=0 }: {x?:number;y?:number;size?:number;rotate?:number}) {
  return <g transform={`translate(${x} ${y}) scale(${size}) rotate(${rotate})`}><path d="M0-28L8-9 29-9 13 5 19 26 0 14-19 26-13 5-29-9-8-9Z" fill="#fdbf11" stroke="#ae9153" strokeWidth="3"/></g>;
}
export function ChristmasRoom({ frame }: {frame:number}) {
  return <><rect width="1920" height="1080" fill="#174f58"/>
    <path d="M0 810H1920V1080H0Z" fill="#c39c79"/><path d="M0 812H1920" stroke="#f6dbad" strokeWidth="18"/>
    <g stroke="#997455" strokeWidth="3" opacity=".5">{[860,940,1030].map(y=><path key={y} d={`M0 ${y}H1920`}/>)}{[150,620,1120,1640].map(x=><path key={x} d={`M${x} 820L${x-150} 1080`}/>)}</g>
    <ellipse cx="975" cy="965" rx="760" ry="80" fill="#934756"/><ellipse cx="975" cy="962" rx="700" ry="54" fill="none" stroke="#e5bd83" strokeWidth="5"/>
    <g transform="translate(1650 370)" stroke={ink} strokeWidth="5"><rect x="-236" y="-95" width="472" height="495" rx="15" fill="#d9b594"/>
      <path d="M-155 390V125Q-155-30 0-30T155 125V390Z" fill="#282f35"/><rect x="-260" y="-115" width="520" height="49" rx="9" fill="#f1dbc0"/>
      <path d="M-110 335l213 33m-190 1l190-36" stroke="#8e6247" strokeWidth="30" strokeLinecap="round"/>
      {[0,1,2].map(i=>{const x=-70+i*63,tip=180+Math.sin(frame/(9+i)+i)*17;return <g key={i} stroke="none">
        <path d={`M${x-38} 340C${x-70} 308 ${x-33} 271 ${x-21} 245Q${x-22} 280 ${x+4} 262Q${x+19} 245 ${x+6} ${tip}C${x+72} 260 ${x+58} 314 ${x+30} 340Z`} fill={i===1?'#fdbf11':'#ee792d'}/>
        <path d={`M${x-15} 340Q${x-37} 309 ${x+3} 277Q${x+27} 316 ${x+15} 340Z`} fill="#ffe2a2"/>
      </g>;})}
      <path d="M-190-98Q0-10 192-98" fill="none" stroke="#3c8264" strokeWidth="25"/>{[-150,-75,0,75,150].map((x,i)=><circle key={x} cx={x} cy={-80+Math.cos(i)*8} r="10" fill="#fdbf11" stroke="none"/>)}</g>
    <g transform="translate(315 757)" stroke={ink} strokeWidth="4"><path d="M-24-90H24V57H-24Z" fill="#a77350"/>
      <path d="M0-550L-118-340H-76L-183-180H-124L-235 5H235L124-180H183L76-340H118Z" fill="#347c61"/>
      <path d="M-88-327Q0-265 91-329M-148-163Q0-85 149-164M-207-4Q0 62 205-5" fill="none" stroke="#e2be70" strokeWidth="9"/>
      {Array.from({length:18},(_,i)=>{const y=-430+(i%6)*76,x=Math.sin(i*4.1)*(65+(i%6)*21);return <circle key={i} cx={x} cy={y} r={8+i%3*2} fill={['#fdbf11','#fb6580','#a9e5f5'][i%3]} opacity={.6+.4*Math.sin(frame/23+i)**2} stroke="none"/>;})}<Star y={-550} size={1.3}/>
      <Gift x={-120} y={40} size={1.1}/><Gift x={115} y={40} color="#02aafd"/></g>
    <g transform="translate(790 270)" stroke="#e9d4af" strokeWidth="11"><rect x="-155" y="-145" width="310" height="310" rx="70" fill="#19394e"/><path d="M0-140V165M-150 10H155"/>{[[-90,-90],[76,-55],[-60,95],[100,109]].map(([x,y],i)=><circle key={i} cx={x} cy={y} r="4" fill="#fff4d4" stroke="none"/>)}</g>
  </>;
}
function Friends({film,frame,quiet=false}: {film:Film;frame:number;quiet?:boolean}) {
  const ids:CharacterId[]=['knurpsi','sisi','schalinka','haluschka','jeschischek'];
  if(quiet)return <>
    <g stroke={ink} strokeWidth="5"><path d="M558 847v90M1265 847v90" strokeWidth="22" stroke="#6c4b3b"/>
      <rect x="535" y="590" width="760" height="270" rx="75" fill="#bf795f"/>
      {[570,805,1040].map(x=><rect key={x} x={x} y="615" width="220" height="180" rx="45" fill="#d08d6e"/>)}
      <rect x="525" y="794" width="785" height="75" rx="35" fill="#e0a57d"/></g>
    {ids.slice(0,4).map((id,i)=><Actor key={id} film={film} frame={frame} freeze={frame+i*31} id={id} x={625+i*185} y={665} scale={.61}
      shadow={false} crouch={.55} arm={78} leftArm={-9} tilt={i===1?-7:4} look={2} outfit={id==='haluschka'?'scarf':'everyday'}/>)}
    <path d="M571 798Q707 773 824 802Q1047 767 1266 800L1257 879Q1017 909 793 879Q676 901 566 864Z" fill="#437568" stroke={ink} strokeWidth="5"/>
    {[630,760,890,1020,1150].map(x=><path key={x} d={`M${x} 799l-14 72`} stroke="#b4c4a1" strokeWidth="7" opacity=".65"/>)}
    <ellipse cx="1465" cy="924" rx="173" ry="40" fill="#c78869" stroke={ink} strokeWidth="5"/>
    <Actor film={film} frame={frame} id="jeschischek" x={1470} y={720} scale={.65} flip shadow={false} parcels={0} crouch={.5} tilt={-4} rightHand={[83,166]}/>
    <Gift x={1350} y={944} size={.7} color="#cc5363"/>
  </>;
  return <>{ids.map((id,i)=><Actor key={id} film={film} frame={frame} freeze={frame+i*27} id={id} x={430+i*235} y={quiet?720:727} scale={.68} outfit={id==='haluschka'?'scarf':'everyday'} arm={72} leftArm={-5} tilt={quiet?Math.sin(frame/110+i)*2:0} look={id==='jeschischek'?-4:3} parcels={id==='jeschischek'?2:0} wingFlap={0} crouch={quiet?.65:0}/>)}</>;
}
function Presents({ film, frame }: {film:Film;frame:number}) {
  const t=frame/film.fps, liftStarts=parcelStarts,x=875,y=535,scale=1.05;
  const flying=Math.max(0,(t-17)/1.1),dy=-1250*Math.min(1,flying*flying);
  const trying=t>=11&&t<14, removing=t>=14&&t<16;
  const gesture=liftStarts.some(start=>t>=start&&t<start+1.6)||removing;
  return <><Outdoor season="winter" frame={frame}/>
    <text x="960" y="130" textAnchor="middle" fontSize="52" fill="#004f4f">Ein Geschenk zu viel</text>
    <g stroke={ink} strokeWidth="5"><path d="M1190 811l-22 100m355-100l22 100" stroke="#956345" strokeWidth="22"/>
      <rect x="1140" y="795" width="435" height="32" rx="10" fill="#c29567"/><path d="M1170 810H1547" stroke="#e7c99d" strokeWidth="4"/></g>
    <Actor film={film} frame={frame} id="jeschischek" x={x} y={y+dy} scale={scale} parcels={0} shadow={flying===0}
      rightHand={gesture?[118,125]:[97,163]} tilt={trying?-6:gesture?-3:0}
      wingFlap={trying||flying>0?Math.sin(frame/(flying>0?1.5:3)):0}
      emotion={trying?'thinking':flying>0?'surprised':'happy'} look={gesture?6:0}/>
    {hedgehogParcels.map((p,i)=>{
      const start=liftStarts[i]!, progress=smooth((t-start)/1.6), taking=i===3&&t>=14;
      const from:[number,number]=[1205+i*95,795-p.size*28*scale],to:[number,number]=[x+p.x*scale,y+p.y*scale];
      const move=taking?smooth((t-14)/1.6):progress;
      const pos=taking?mix(to,from,move):mix(from,to,move);
      const arc=-155*Math.sin(Math.PI*move);
      const attached=progress===1&&!taking;
      return <g key={i} transform={`translate(${pos[0]} ${pos[1]+arc+(attached?dy:0)})`}>
        <Gift size={p.size*scale} color={p.color}/>
        {move>0&&move<1&&[0,1,2].map(n=><Star key={n} x={-32+n*31} y={45+n%2*14} size={.14} rotate={frame*2+n*50}/>)}
      </g>;
    })}
    {t>17&&t<19&&[0,1,2].map(j=><Star key={j} x={x+j*44-44} y={840-Math.min(1,flying)*190+j*30} size={.45} rotate={frame*2}/>)}
  </>;
}
function Wish({index}: {index:number}) {
  return <g stroke={ink} strokeWidth="5" fill="none">{index===0?<><path d="M-110 35H105M-95 18V-29H35V18M35 18V-65H99V18M-74-30V-67H-49V-30" fill="#bf8b59"/>{[-65,10,74].map(x=><circle key={x} cx={x} cy="27" r="22" fill="#fd6f04"/>)}</>:index===1?<><rect x="-102" y="-27" width="204" height="87" rx="12" fill="#e2a9bf"/><path d="M-102-27L-68-88H137L102-27Z" fill="#f1cadd"/><path d="M-20-40V-98l40-8v54" stroke="#004f4f" strokeWidth="8"/><circle cx="-31" cy="-37" r="13" fill="#004f4f"/><circle cx="9" cy="-49" r="13" fill="#004f4f"/></>:index===2?<>{[-2,-1,0,1,2].map((n)=><g key={n} transform={`translate(${n*34} 0)`}><path d="M-12 60V-60L0-84 12-60V60Z" fill={['#fb1143','#fd6f04','#fdbf11','#79c718','#02aafd'][n+2]}/><path d="M-12-60H12"/></g>)}</>:<><path d="M-104-50Q0 4 100-50V-3Q0 53-104-3ZM36 28L21 99 77 110 91 12" fill="#c26b6f"/><path d="M25 87L81 99M-72-34v29M-35-20V9M8-16v32M50-24V8" stroke="#fff0bf"/></>}</g>;
}
function LetterScene({film,frame}:{film:Film;frame:number}) {
  const cueIndex=film.cues.reduce((last,c,i)=>frame>=c.from?i:last,-1),reveal=cueIndex>=13;
  const wish=cueIndex===6?0:cueIndex===8?3:Math.max(0,Math.min(3,cueIndex-1));
  const addressed=cueIndex>=10&&cueIndex<13,writing=cueIndex>=5&&cueIndex<10;
  return <><ChristmasRoom frame={frame}/>
    <Actor film={film} frame={frame} id="knurpsi" x={435} y={657} scale={.81} look={5} arm={75}/>
    <Actor film={film} frame={frame} id="sisi" x={684} y={720} scale={.7} look={4} arm={75}/>
    <Actor film={film} frame={frame} id="schalinka" x={1080} y={727} scale={.68} look={-4} arm={75}/>
    <Actor film={film} frame={frame} id="haluschka" x={1310} y={720} scale={.7} outfit="scarf" look={-5} arm={75}/>
    <Actor film={film} frame={frame} id="jeschischek" x={1630} y={640} scale={.88} flip parcels={2} tilt={addressed?4:0} emotion={cueIndex===11?'surprised':'happy'} look={4}/>
    <g transform="translate(962 355) rotate(-2)">
      <rect x="-290" y="-188" width="580" height="370" rx="8" fill="#bf9e70" opacity=".3" transform="translate(12 14)"/>
      <rect x="-290" y="-188" width="580" height="370" rx="8" fill="#fff8e8" stroke="#d6b87e" strokeWidth="5"/>
      {reveal?<>
        <path d="M-235 127Q0 92 235 127" stroke="#86a66d" strokeWidth="7" fill="none"/>
        <path d="M180-130L137-64H158L121-6H236L204-64H224Z" fill="#4e8a64" stroke={ink} strokeWidth="3"/><Star x={180} y={-139} size={.4}/>
        {(['knurpsi','sisi','schalinka','haluschka','jeschischek'] as const).map((id,i)=><g key={id} transform={`translate(${-195+i*95} 0)`}>
          <Actor film={film} frame={frame} freeze={55+i*15} id={id} x={0} y={-9} scale={.26} shadow={false} parcels={0} arm={75}/>
        </g>)}
        <text y="153" textAnchor="middle" fontSize="29" fill="#ad4554">♥</text>
      </>:addressed?<g stroke={ink} strokeWidth="4">
        <path d="M-228-115L0-166 228-115V128H-228Z" fill="#ead09e"/>
        <rect x="-223" y="-114" width="446" height="242" rx="5" fill="#fff0ce"/>
        <path d="M-223 128L-54-1Q0-29 54-1L223 128M-223-114L0 41 223-114" fill="none" stroke="#c6a879"/>
        <rect x="-126" y="-27" width="252" height="65" rx="10" fill="#fff8e8" stroke="none"/>
        <text y="17" textAnchor="middle" fontSize="36" fill="#315f46" stroke="none">Pro Ježíška</text>
      </g>:<>
        <text y="-132" textAnchor="middle" fontSize="34" fill="#004f4f">{writing?'Milý Ježíšku…':['Holzeisenbahn','Schmuckschatulle','Pastelky','Teplý šál'][wish]}</text>
        <Wish index={wish}/>
        {writing&&<g transform="translate(216 76) rotate(29)" stroke={ink} strokeWidth="3"><path d="M-10-90H10V35L0 58-10 35Z" fill="#e9b740"/><path d="M-10 35H10L0 58Z" fill="#ddbc87"/><path d="M-3 52L0 58 3 52" fill={ink}/></g>}
      </>}
    </g>
    <g transform="translate(965 936)" stroke={ink} strokeWidth="5"><path d="M-275 12L-247 104M275 12L247 104" strokeWidth="19"/><rect x="-350" y="-20" width="700" height="42" rx="16" fill="#b78059"/>{[-220,-78,78,220].map((x,i)=><g key={x} transform={`translate(${x} -40) rotate(${i*7-8})`}><rect x="-46" y="-17" width="92" height="43" fill="#fff5de"/><path d="M-44-15L0 8 44-15" fill="none"/></g>)}</g>
  </>;
}
const chapter=(index:number)=>index<2?'intro':index===2?'czech':index===3?'christkind':index===4?'germany':index===5?'finland':index<=8?'poland':index<=19?'tio':'ending';
function GiftBringer({kind}:{kind:string}) {
  if(kind==='poland')return <g stroke={ink} strokeWidth="4">
    <g transform="translate(-97 -35)"><Star size={1.15}/><path d="M0 24V66" strokeWidth="8"/></g>
    <g transform="translate(92 -27) scale(.48)"><GiftBringer kind="christkind"/></g>
    <g transform="translate(-98 104)"><path d="M-46-13Q0 16 46-13L32 23H-32ZM-32 23l-9 17m73-17l9 17" fill="#bb8b56"/>
      <ellipse cy="-12" rx="27" ry="16" fill="#fff0ce"/><circle cx="-16" cy="-18" r="12" fill="#edc9a2"/><path d="M-20-19l6 2" strokeWidth="2"/><Star x={22} y={-48} size={.45}/></g>
    <g transform="translate(94 106)"><path d="M-30 29L-22-6H22L30 29Z" fill="#b8414c"/><circle cy="-17" r="23" fill="#edc9a2"/>
      <path d="M-22-27L-18-58 0-69 18-58 22-27Z" fill="#b8414c"/><path d="M0-58V-33m-9-13H9" stroke="#edc36f" strokeWidth="3"/>
      <path d="M-19-5Q0 32 19-5" fill="#fff6df"/><path d="M42 27V-45q0-17 15-17t6 23" stroke="#c5a45f" fill="none"/>
      <circle cx="-8" cy="-17" r="2"/><circle cx="8" cy="-17" r="2"/></g>
  </g>;
  const angel=kind==='christkind';
  return <g stroke={ink} strokeWidth="4">
    {angel&&<><path d="M-25-10C-70-68-133-81-123-36Q-100 21-34 22M25-10C70-68 133-81 123-36Q100 21 34 22" fill="#fff4d4"/>
      <path d="M-108-42l69 46m147-46L39 4" stroke="#d9bd7e" strokeWidth="2.5"/>
      <path d="M-40-23Q-66-75-25-91Q33-109 44-55L37-19Z" fill="#d9ad4c"/></>}
    <path d="M-39-3Q0-22 39-3L70 105Q0 123-70 105Z" fill={angel?'#f1d487':'#b43c4a'}/>
    <path d="M0 7V106M-62 93Q0 113 62 93" stroke={angel?'#d2ab53':'#f8edcf'} strokeWidth="6" fill="none"/>
    <path d="M-39 12Q-65 31-70 61m109-49q26 19 31 49" stroke={ink} strokeWidth="19" fill="none" strokeLinecap="round"/>
    <path d="M-39 12Q-65 31-70 61m109-49q26 19 31 49" stroke={angel?'#f1d487':'#b43c4a'} strokeWidth="12" fill="none" strokeLinecap="round"/>
    <circle cy="-39" r="37" fill="#f1cda6"/>
    {angel?<><path d="M-36-52Q-21-98 31-64L37-40Q18-53 9-65Q-9-43-36-37Z" fill="#deb44e"/>
      <ellipse cy="-107" rx="28" ry="8" fill="none" stroke="#dfbd62" strokeWidth="5"/>
      <Star x={0} y={25} size={.32}/></>:<><path d="M-39-56Q-32-103 5-106Q38-104 52-70L37-55Z" fill="#b43c4a"/>
      <path d="M-37-55H39" stroke="#fff6df" strokeWidth="12"/>
      <circle cx="53" cy="-70" r="10" fill="#fff6df"/>
      <path d="M-35-27Q0 40 35-27Q16-14 0-24Q-16-14-35-27Z" fill="#fff6df"/>
      <path d="M-11-29q11-8 22 0" fill="none" strokeWidth="2"/></>}
    <path d="M-19-43l7-2m24 0l7 2" fill="none" strokeWidth="2.2"/>
    <circle cx="-13" cy="-37" r="2.6"/><circle cx="13" cy="-37" r="2.6"/>
    <path d="M-6-24q6 6 12 0" fill="none" strokeWidth="2"/>
    <ellipse cy="-31" rx="5" ry="4" fill="#dfa580" stroke="none"/>
    <Gift x={74} y={69} size={.68} color={angel?'#56a28b':'#77a956'}/>
    <ellipse cx="-70" cy="61" rx="10" ry="12" fill="#f1cda6"/><ellipse cx="70" cy="61" rx="10" ry="12" fill="#f1cda6"/>
  </g>;
}
/** Domestic Tió: feed, blanket, three taps, then treats emerge from its rear. */
function Tio({phase,frame,film}:{phase:number;frame:number;film:Film}) {
  const t=frame/film.fps,beats=christmasMapBeats(film),reveal=smooth((t-beats.treats)/.7);
  const tap=beats.taps.find(at=>t>=at-.35&&t<at+.2);
  const swing=tap===undefined?-45:t<=tap?-45*(1-smooth((t-(tap-.35))/.35)):-45*smooth((t-tap)/.2);
  return <g transform="translate(1495 452)" stroke={ink} strokeWidth="5">
    <ellipse cx="15" cy="135" rx="264" ry="28" fill="#d5bb8f" stroke="none"/>
    <path d="M-121 54l-23 51m117-51l17 51" stroke="#a87548" strokeWidth="19" strokeLinecap="round"/>
    <rect x="-143" y="-35" width="273" height="115" rx="48" fill="#9b6843"/><path d="M-90-10h170M-70 21H94" stroke="#bc9266" strokeWidth="3"/>
    <ellipse cx="-120" cy="21" rx="51" ry="61" fill="#d5a66e"/><path d="M-163-28Q-150-111-77-61L-69-22Z" fill="#c53f50"/><path d="M-166-27L-69-22" stroke="#303d40" strokeWidth="16"/>
    <circle cx="-140" cy="12" r="5"/><circle cx="-112" cy="12" r="5"/><path d="M-144 37Q-125 59-105 34" fill="none"/>
    {reveal>0&&<g transform={`translate(${reveal*95} 0)`}><Gift x={125} y={86} size={.65} color="#79c718"/>{[0,1,2].map(i=><g key={i} transform={`translate(${130+i*35} ${124-i%2*22}) rotate(${i*17})`}><path d="M-14 0L-28-12V12ZM14 0L28-12V12Z" fill="#fdbf11"/><rect x="-14" y="-12" width="28" height="24" rx="8" fill="#fb6580"/></g>)}</g>}
    <path d={`M-45-37Q71-66 142-31L172 ${93-reveal*105}Q81 ${82-reveal*35}-24 72Z`} fill="#bc4250"/>
    <path d={`M-13-25L-1 67M28-33L42 70M77-35L91 ${59-reveal*22}`} stroke="#f1cf8f" strokeWidth="8"/>
    {phase>=11&&phase<14&&<><ellipse cx="-175" cy="106" rx="55" ry="15" fill="#fff0d0"/><circle cx="-190" cy="83" r="21" fill="#fd6f04"/><path d="M-188 63l12-12" stroke="#79c718"/></>}
    {tap!==undefined&&<g transform={`translate(100 -140) rotate(${swing})`}>
      <path d="M0 0L-90 105" stroke="#8e6247" strokeWidth="15" strokeLinecap="round"/>
      <path d="M190-45L21-11 18 17 190 25Z" fill="#497964"/>
      <ellipse rx="24" ry="16" fill="#efd2ae"/><path d="M-5-10L4 9M4-12L13 7" strokeWidth="2"/>
    </g>}
    {tap!==undefined&&Math.abs(t-tap)<.07&&<Star x={10} y={-35} size={.5}/>}
  </g>;
}
function MapScene({film,frame}:{film:Film;frame:number}) {
  const index=Math.max(0,film.cues.reduce((last,c,i)=>frame>=c.from?i:last,-1)),part=chapter(index);
  const names=part==='czech'?['Czechia']:part==='christkind'?['Austria','Germany']:part==='germany'?['Germany']:part==='finland'?['Finland']:part==='poland'?['Poland']:[];
  const title=({intro:'Kouzelná vánoční mapa',czech:'Česko · Ježíšek',christkind:'Österreich und Teile Deutschlands · Christkind',germany:'Deutschland · Weihnachtsmann',finland:'Suomi · Joulupukki',poland:'Polska',tio:'Catalunya · Tió de Nadal',ending:'Každá rodina má své zvyky'}[part]);
  const turn=smooth((frame/film.fps-christmasMapBeats(film).starTurns)/.35);
  return <><rect width="1920" height="1080" fill="#163f53"/><rect x="70" y="105" width="1040" height="662" rx="35" fill="#d6ebee"/>
    <defs><clipPath id="christmas-europe"><rect x="70" y="105" width="1040" height="662" rx="35"/></clipPath></defs><g clipPath="url(#christmas-europe)"><g transform="translate(100 100)">{europe.map(c=><path key={c.name} d={c.d} fill={names.includes(c.name)?'#fdbf11':'#99bdac'} stroke="#527c78" strokeWidth="1.8"/>)}
      {part==='tio'&&<><circle cx="255" cy="580" r="25" fill="#fb6580" stroke="#fff0d0" strokeWidth="5"/><path d="M255 580L348 543" stroke="#004f4f" strokeWidth="3"/><text x="350" y="544" fill="#004f4f" fontSize="22">Catalunya</text></>}
      <text x="20" y="635" fontSize="18" fill="#345f65">Natural Earth · Beispiele, keine festen Brauchgrenzen</text>
    </g></g><rect x="1160" y="105" width="690" height="662" rx="35" fill="#fff2d5"/>
    <text x="960" y="68" textAnchor="middle" fontSize="45" fill="#fff4d4">{title}</text>
    {part==='tio'?<><Tio phase={index} frame={frame} film={film}/><text x="1505" y="664" textAnchor="middle" fontSize="35" fill="#004f4f">{index>=14?'Caga, tió!':'Polínko zůstává doma'}</text></>:part==='poland'?<><g transform="translate(1495 350)"><GiftBringer kind="poland"/></g>{['Gwiazdor · Aniołek','Dzieciątko','Święty Mikołaj'].map((s,i)=><text key={s} x="1505" y={550+i*58} textAnchor="middle" fontSize="37" fill="#004f4f">{s}</text>)}</>:part==='czech'?<Actor film={film} frame={frame} id="jeschischek" x={1495} y={340} scale={.9}/>:part==='christkind'||part==='germany'||part==='finland'?<g transform="translate(1505 390) scale(1.4)"><GiftBringer kind={part}/></g>:<>{index>=22?<g>
      <g transform="translate(1668 421)" stroke={ink} strokeWidth="5"><rect x="-101" y="-154" width="202" height="314" rx="9" fill="#a47750"/><path d="M0-147V153M-112-153H112M-80 162v18M80 162v18" fill="none"/><circle cx="-16" cy="12" r="6" fill="#efd6a3"/><circle cx="16" cy="12" r="6" fill="#efd6a3"/><path d="M-61-93q28 17 45-2M26 83q24 15 43-2" stroke="#bd936d" fill="none"/></g>
      <g transform="translate(1375 430)"><Star size={1.7} rotate={turn*90}/><path d={`M0 0L${turn*145} ${-105*(1-turn)}`} stroke="#dbac43" strokeWidth="7" strokeLinecap="round"/>
      <circle r="11" fill="#fff4d4" stroke="#dbac43" strokeWidth="4"/></g>
      <text x="1505" y="674" textAnchor="middle" fontSize="34" fill="#004f4f">Navigační hvězda</text>
    </g>:<><Star x={1505} y={350} size={2.6}/><text x="1505" y="550" textAnchor="middle" fontSize="37" fill="#004f4f">Lundenburská pohádka</text><text x="1505" y="610" textAnchor="middle" fontSize="30" fill="#004f4f">Gemeinsam Freude schenken</text></>}</>}
    <Actor film={film} frame={frame} id="schalinka" x={440} y={830} scale={.53} arm={75} look={5} emotion={index===14?'surprised':'happy'}/>
    <Actor film={film} frame={frame} id="jeschischek" x={850} y={830} scale={.53} arm={65} look={4} emotion={index>=23?'thinking':'happy'} rightHand={index>=22?[117,128]:[104,158]} rightProp={index>=22?<Star rotate={turn*90}/>:undefined}/>
    {(['knurpsi','sisi','haluschka'] as const).map((id,i)=><Actor key={id} film={film} frame={frame} id={id} x={1210+i*215} y={830} scale={.5} arm={75} look={-5}/>)}
    <text x="95" y="1030" fontSize="25" fill="#fff4d4">Vánoční zvyky se liší podle kraje i rodiny. Die gemeinsame Geschenkplanung ist LKP-Fantasie.</text>
  </>;
}
export function ChristmasScene({film,frame}:{film:Film;frame:number}) {
  switch(film.skit.scene) {
    case 'christmas-presents': return <Presents film={film} frame={frame}/>;
    case 'christmas-fireplace': return <><ChristmasRoom frame={frame}/><Friends film={film} frame={frame} quiet/></>;
    case 'christmas-letters': return <LetterScene film={film} frame={frame}/>;
    case 'christmas-map': return <MapScene film={film} frame={frame}/>;
    default: return null;
  }
}
