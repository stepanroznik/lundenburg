import React from 'react';
import type { Film } from '../model.js';
import { Actor } from './Actor.js';
import { Outdoor, Stick, Biscuit, Bench, clamp, smooth, lerp, ink } from './Scenery.js';

function Bathroom() {
  return <><rect width="1920" height="1080" fill="#eef6f1"/>
    <g stroke="#c9ddd5" strokeWidth="3">{Array.from({length:10},(_,i)=><path key={i} d={`M${i*215} 0V900`}/>)}{Array.from({length:5},(_,i)=><path key={i} d={`M0 ${i*200+65}H1920`}/>)}</g>
    <rect x="0" y="903" width="1920" height="177" fill="#d4e6d7"/>
    <path d="M160 130H957" stroke="#9cb4ad" strokeWidth="13" strokeLinecap="round"/>
    <path d="M171 149h150v725H171Z" fill="#bddccc" stroke={ink} strokeWidth="4"/><path d="M201 155v674m43-674v674m43-674v674" stroke="#92bfae" strokeWidth="7" fill="none"/>
    <g stroke={ink} strokeWidth="5"><path d="M801 820V248q0-90-91-90h-83" fill="none" stroke="#829d9f" strokeWidth="17"/><path d="M550 191q52-65 108 0v21H550Z" fill="#cadbdc"/><rect x="357" y="900" width="568" height="46" rx="22" fill="#fffcf4"/>
      <rect x="1560" y="292" width="215" height="237" rx="38" fill="#d9eff1" stroke="#93afab" strokeWidth="10"/><path d="M1590 478l137-141m-95 130l87-87" stroke="#fff" strokeWidth="8"/>
      <path d="M1633 682l-12 208h95l-11-208" fill="#fffcf7"/>
      <path d="M1530 617q0 103 137 103t137-103Z" fill="#fffcf7"/><ellipse cx="1667" cy="617" rx="137" ry="30" fill="#e1efed"/>
      <path d="M1670 614v-52q0-28 27-28h24" fill="none" stroke="#91abad" strokeWidth="14"/><path d="M1620 571h31" strokeWidth="10"/>
      <path d="M1817 574h80" stroke="#91abad" strokeWidth="9"/><path d="M1827 575h58v160h-58Z" fill="#f0bd73"/><path d="M1835 709h43" stroke="#ffe4b1" strokeWidth="8"/>
    </g>
  </>;
}
const soap = <g transform="rotate(-8)"><rect x="-39" y="-22" width="78" height="44" rx="18" fill="#f8efd4" stroke="#b9a47d" strokeWidth="3"/><path d="M-16 0q15-12 32 0" fill="none" stroke="#d7c6a2" strokeWidth="3"/><circle cx="31" cy="-24" r="12" fill="#fff" stroke="#bfd7d5" strokeWidth="2"/></g>;

function TownHall({ opacity }: { opacity: number }) {
  return <g opacity={opacity}>
    <rect x="620" y="140" width="680" height="761" rx="6" fill="#ead7b7" stroke="#b7a483" strokeWidth="5"/>
    <path d="M765 900V439Q765 260 960 244Q1155 260 1155 439V900" fill="#c7b899" stroke="#ab9876" strokeWidth="7"/>
    <path d="M625 152h665M637 202h641" stroke="#f8efd8" strokeWidth="15"/>
    <g fill="#f6ead3" stroke="#ad9b7d" strokeWidth="4"><path d="M715 290V163l-18-71-18 71v127m122-53V103l-18-60-18 60v151m344 0V103l-18-60-18 60v134m140 53V163l-18-71-18 71v127"/></g>
    <path d="M837 338v105m240-105v105" stroke="#665e50" strokeWidth="5"/>
    <g transform="translate(962 465)" fill="#8da08b" stroke="#536b60" strokeWidth="4"><path d="M-157-25Q-45-79 80-21L149-19 159-2 80 18Q-42 66-136 17L-210 40-181 8-227-23Z"/><path d="M74-10l90 1-17 21H75" fill="#bdc6a5"/><path d="M-71 23l-24 46 44-30m58-8l36 38-13-46"/><circle cx="96" cy="-19" r="6" fill="#334c49"/><path d="M-148-27l16-17 20 11 17-20 22 14 20-22 20 18 18-16 20 22" fill="#8da08b"/></g>
    <rect x="713" y="715" width="494" height="62" rx="8" fill="#f8efd8"/><text x="960" y="756" textAnchor="middle" fill="#776744" fontSize="28" letterSpacing="2">STARÁ RADNICE · BRNO</text>
  </g>;
}
function TrainCard({ opacity, frame }: { opacity: number; frame: number }) {
  return <g opacity={opacity} transform="translate(970 328)"><rect x="-226" y="-132" width="452" height="227" rx="36" fill="#fffcf4" stroke="#c9d7cc" strokeWidth="4"/>
    <g transform="translate(-7 -5)" stroke={ink} strokeWidth="4"><path d="M-140 20H100V-46H40V20M35-46h72" fill="#004f4f"/><path d="M-128 17V-17H40V23m-139-40v-41h23v41" fill="#02aafd"/><rect x="54" y="-30" width="30" height="29" rx="3" fill="#fffcf4"/>{[-99,-35,63].map((x,i)=><g key={x} transform={`translate(${x} 33) rotate(${frame*2})`}><circle r="23" fill="#fd6f04"/><path d="M-15 0H15M0-15V15" stroke="#fffcf4" strokeWidth="3"/></g>)}<path d="M-96-64q-19-18 4-27m13-15q18-18-4-26" stroke="#bad1cf" strokeWidth="13" fill="none" strokeLinecap="round"/></g>
    <text x="0" y="-86" textAnchor="middle" fontSize="32" fill="#004f4f">WIEN · 1907</text>
  </g>;
}

export function VoicedScene({ film, frame }: { film: Film; frame: number }) {
  const t = frame / film.fps;
  const start = (i: number) => (film.cues[i]?.from ?? film.logoFrom) / film.fps;
  const end = (i: number) => ((film.cues[i]?.from ?? film.logoFrom) + (film.cues[i]?.frames ?? 0)) / film.fps;
  const common = { film, frame };
  const scene = film.skit.scene;
  if (scene === 'soap') {
    const enter = smooth(t/1.2), stare = t > end(2);
    return <><Bathroom/>
      <g stroke="#91c8d4" strokeWidth="5" strokeLinecap="round" opacity=".6">{Array.from({length:24},(_,i)=><path key={i} d={`M${563+i%5*20} ${222+(frame*8+i*37)%505}l-4 22`}/>)}</g>
      <Actor {...common} id="haluschka" x={612} y={590} outfit="bathing" rightHand={stare?[35,177]:[35+Math.sin(frame/9)*12,152+Math.sin(frame/9)*13]} rightProp={soap} look={stare?6*(1-smooth((t-end(2))/.8)):t>start(0)?6:0} tilt={stare?3:-5} emotion={stare&&t<end(2)+.6?'thinking':'happy'}/>
      <g fill="#fffefa" stroke="#c4ddda" strokeWidth="2">{Array.from({length:17},(_,i)=><circle key={i} cx={510+(i%7)*34} cy={825+(i%3)*28+Math.sin(frame/19+i)*4} r={22+i%4*5}/>)}{Array.from({length:6},(_,i)=><circle key={i+30} cx={550+i*23} cy={769+(i%2)*15} r={13+i%3*4}/>)}</g>
      <Actor {...common} id="schalinka" x={lerp(2160,1340,enter)} flip look={7} walk={enter<1} arm={t>start(2)&&t<end(2)?-20:54} tilt={t>start(2)?-5:5} emotion={t>end(1)&&t<start(2)?'thinking':'happy'}/>
      {stare && <g fill="#fffefa" stroke="#bdd7d3" strokeWidth="2"><circle cx="737" cy={490-(t-end(2))*48} r="18"/><circle cx="767" cy={472-(t-end(2))*57} r="9"/></g>}
    </>;
  }
  if (scene === 'dam') {
    const permitIndex = film.cues.findIndex(c=>c.text==='Und eine Baugenehmigung?');
    const permitCue = film.cues[permitIndex]!;
    const reactionAt = start(permitIndex)+(permitCue.asset.cues[permitCue.text.indexOf('Baugenehmigung')]?.start ?? .65)+.12;
    const permit = t >= reactionAt, twigIndex = permitIndex-1, finalTwig = smooth((t-start(twigIndex))/.9);
    const story = t >= start(2) && t < start(twigIndex);
    return <><Outdoor frame={frame}/><path d="M770 703Q875 748 1055 727Q1184 888 1012 1080H650Q870 905 770 703Z" fill="#91cdd5"/><path d="M811 802q55-18 140 0m-150 105q70-16 173 0m-227 82q68-15 148 0" fill="none" stroke="#d8f4f0" strokeWidth="6"/>
      {story && <g transform="translate(960 342)"><rect x="-330" y="-205" width="660" height="360" rx="35" fill="#fffdf5" stroke="#abc4b7" strokeWidth="4"/>
        <text y="-148" textAnchor="middle" fontSize="36" fill="#004f4f">BRDY · TSCHECHIEN</text>
        {t<start(5)?<><g transform="translate(-110 -23) rotate(-8)"><rect x="-66" y="-74" width="132" height="158" rx="5" fill="#e2f0f1" stroke={ink} strokeWidth="3"/><path d="M-41-46H41m-82 30H41m-82 30H20m-61 30H32" stroke="#7faeaf" strokeWidth="6"/></g><text x="100" y="-20" textAnchor="middle" fontSize="29" fill={ink}>Pläne …</text><text x="100" y="30" textAnchor="middle" fontSize="29" fill={ink}>Grundstücke …</text></>:<><ellipse cy="-10" rx="225" ry="69" fill="#9dd5d6"/><path d="M-167-2l330 28m-315 3l289-41m-296-1l311 57" stroke="#956545" strokeWidth="13" strokeLinecap="round"/>{[-240,-192,198,243].map(x=><path key={x} d={`M${x} 42v-83m0 39l-16-18m16 4l16-23`} stroke="#69994e" strokeWidth="6" fill="none"/>)}<text y="117" textAnchor="middle" fontSize={t>=start(7)?37:28} fill="#004f4f">{t>=start(7)?'≈ 30.000.000 Kč gespart!':'Biberdämme → Feuchtgebiet'}</text></>}
      </g>}
      <Actor {...common} id="knurpsi" x={525} look={permit?0:7} arm={permit?60:t<start(twigIndex)?12+Math.sin(frame/20)*12:45} emotion={permit?'surprised':'happy'} freeze={permit?Math.round(reactionAt*30):undefined} tilt={permit?0:-5} rightProp={t<start(twigIndex)?<Stick length={155} angle={-20}/>:undefined}/>
      <Actor {...common} id="sisi" x={1390} flip look={7} emotion={permit?'thinking':'happy'} tilt={permit?8:-3} arm={permit?5:54}/>
      <g transform="translate(924 883)">{Array.from({length:14},(_,i)=><Stick key={i} x={(i%3-1)*50} y={-Math.floor(i/3)*24} angle={i%2?18:-15} length={230-i%3*20}/>)}</g>
      {t >= start(twigIndex) && <Stick x={lerp(704,926,finalTwig)} y={lerp(743,742,finalTwig)-Math.sin(finalTwig*Math.PI)*60} angle={lerp(-25,10,finalTwig)} length={180}/>}
      {permit && t<start(permitIndex+1) && <g stroke={ink} strokeWidth="5" strokeLinecap="round"><path d="M390 478l-21-21m218-3l24-20"/></g>}
    </>;
  }
  if (scene === 'vienna') {
    const back = smooth((t-start(8))/(end(8)-start(8)+.8));
    return <><Outdoor frame={frame}/><Bench/>
      <TrainCard opacity={smooth((t-start(4))/.5)*(1-smooth((t-start(7))/.7))} frame={frame}/>
      <Actor {...common} id="knurpsi" x={590-back*1000} look={7} tilt={t>start(5)&&t<end(5)?-9:3} walk={back>0} arm={back>0?-12:52}/>
      <Actor {...common} id="sisi" x={1325} flip look={t>start(7)?9:7} emotion={t>start(7)?'unimpressed':t>start(1)&&t<start(3)?'thinking':'happy'} tilt={t>start(7)?7:-7} arm={t>start(3)&&t<start(4)?-45:t>start(8)?0:52}/>
      {t>start(3)&&t<start(4) && <g stroke="#02aafd" strokeWidth="4" strokeLinecap="round"><path d="M1192 556l-24-8m273 5l23-14"/></g>}
      <g stroke={ink} strokeWidth="5"><ellipse cx="958" cy="812" rx="180" ry="40" fill="#e9c48d"/><path d="M958 851v112m-82 0h164" fill="none" strokeWidth="15"/></g>
    </>;
  }
  if (scene === 'dragon') {
    const reveal = smooth((t-start(8))/.85), secret=t>start(5)&&t<start(8);
    return <><rect width="1920" height="1080" fill="#f8f3e7"/><path d="M0 915Q890 817 1920 904V1080H0Z" fill="#e8dfc8"/>
      <TownHall opacity={reveal}/>
      <Actor {...common} id="haluschka" x={510} look={t>start(11)?0:7} tilt={t>start(4)&&t<start(6)?-8:4} emotion={t>start(4)&&t<start(6)?'thinking':'happy'} arm={t>start(9)&&t<end(9)?-5:52}/>
      <Actor {...common} id="schalinka" x={1390-(secret?45:0)} flip look={secret?Math.sin(frame/14)*10:7} emotion={t>start(4)&&t<start(6)?'surprised':'happy'} arm={secret?-70:t>start(8)&&t<end(8)?-20:48} tilt={secret?8:-5}/>
      {t>start(5)&&t<end(5) && <g stroke={ink} strokeWidth="5" strokeLinecap="round"><path d="M1260 469l-22-20m227 30l23-20"/></g>}
    </>;
  }
  if (scene === 'biscuits') {
    const claim = smooth((t-start(2))/(end(2)-start(2))), reclaim = smooth((t-start(5))/(end(5)-start(5)));
    return <><Outdoor frame={frame}/>
      <Actor {...common} id="knurpsi" x={560} look={t>start(4)?0:7} arm={t>start(2)?-10:25} emotion={t>end(5)?'surprised':'happy'} tilt={t>end(5)?0:-5}/>
      <Actor {...common} id="sisi" x={1360} flip look={7} arm={t>start(5)?-10:52} emotion={t>start(2)&&t<start(5)?'unimpressed':'happy'} tilt={t>start(5)?-9:4}/>
      <g stroke={ink} strokeWidth="5"><path d="M750 813l-40 166m459-166l40 166" strokeWidth="19"/><ellipse cx="960" cy="795" rx="300" ry="68" fill="#e8c694"/><ellipse cx="960" cy="788" rx="190" ry="40" fill="#fffcf4"/></g>
      <Biscuit x={843} y={773}/><Biscuit x={1080} y={773}/>
      <Biscuit x={lerp(lerp(960,745,claim),1175,reclaim)} y={lerp(lerp(781,698,claim),698,reclaim)-Math.sin(reclaim*Math.PI)*48}/>
    </>;
  }
  const silence = t>end(1)&&t<start(2), announce=t>=start(2)&&t<end(2), lost=t>start(3);
  return <><Outdoor frame={frame}/><Bench/>
    <Actor {...common} id="schalinka" x={560} look={silence?Math.sin(frame/35)*8:7} rightHand={announce?[108,125]:[110,205]} leftHand={announce?[-110,135]:[-100,208]} tilt={announce?-5:lost?6:0} emotion={lost?'thinking':'happy'}/>
    <Actor {...common} id="haluschka" x={1370} flip look={lost?0:7} tilt={lost?-5:0} arm={52} freeze={silence?100:undefined}/>
    {silence && <g transform="translate(955 732) scale(1.7)" stroke={ink} strokeWidth="4">
      <path d="M-39-82V82M39-82V82" stroke="#b18b58" strokeWidth="7"/>
      <path d="M-30-74C-30-30-5-20-5 0C-5 20-30 30-30 74H30C30 30 5 20 5 0C5-20 30-30 30-74Z" fill="#b7e7e8" fillOpacity=".15"/>
      <path d={`M-24 ${-64+clamp((t-end(1))/(start(2)-end(1)))*45}H24L0-9Z`} fill="#edbd50" stroke="none"/>
      <path d={`M-24 68L0 ${64-clamp((t-end(1))/(start(2)-end(1)))*47} 24 68Z`} fill="#edbd50" stroke="none"/>
      <path d="M0 4v37" stroke="#edbd50" strokeWidth="2" strokeDasharray="3 4" strokeDashoffset={-frame%7}/>
      <path d="M-43-80H43M-43 80H43" stroke="#977047" strokeWidth="12" strokeLinecap="round"/>
      <path d="M-20-62q0 23 9 32m30 15q-7 19 1 34" stroke="#fff" strokeWidth="3" fill="none"/>
    </g>}
    {announce && <g stroke="#fdbf11" strokeWidth="6" strokeLinecap="round"><path d="M399 418l-20-34m67-2l-3-30m186 50l31-21"/></g>}
  </>;
}
