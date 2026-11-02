import type { CharacterProps } from './Character.js';
import type { ReactNode } from 'react';
import { Gift } from './ChristmasProps.js';

// Shared local attachment points keep the packing scene aligned with the rig.
export const hedgehogParcels = [
  {x:-116,y:-100,size:1.05,color:'#d94b49'},
  {x:-28,y:-104,size:1,color:'#399e88'},
  {x:-76,y:-161,size:.98,color:'#efb83d'},
  {x:-53,y:-207,size:.38,color:'#76bbd9'},
] as const;
const ink='#3e3b34', fur='#b17a45', cream='#ffe0ad';
const quillMarks=[[-137,-12],[-159,39],[-107,32],[-140,83],[-98,91],[-167,153],[-145,197],[-108,221],[-79,-44],[-43,38],[-65,-6]];

/** The crown and back share one continuous quilled silhouette. */
export function Hedgehog({frame,mouth='rest',wingFlap=0,parcels=3,look=0,tilt=0,emotion='happy',walk=false,stride,crouch=0,bend=0,rightHand,leftHand,rightProp,leftProp,rightPropAngle=0,leftPropAngle=0}:CharacterProps) {
  const blink=frame%173>166,step=walk?Math.sin(stride??frame/5):0;
  const open=mouth!=='rest'&&mouth!=='closed';
  const near=rightHand??[105,158],far=leftHand??[39,160];
  const paw=(hand:readonly[number,number],prop:ReactNode,angle:number,side:'near'|'far')=><g>
    <path d={`M${side==='near'?90:22} 126Q${hand[0]+(side==='near'?15:-18)} ${hand[1]-22} ${hand[0]} ${hand[1]}`} stroke={ink} strokeWidth="31" fill="none"/>
    <path d={`M${side==='near'?90:22} 126Q${hand[0]+(side==='near'?15:-18)} ${hand[1]-22} ${hand[0]} ${hand[1]}`} stroke="#fff0cf" strokeWidth="24" fill="none"/>
    <g transform={`translate(${hand[0]} ${hand[1]}) rotate(${angle})`}>{prop}<ellipse rx="17" ry="19" fill={fur}/></g>
  </g>;
  return <g stroke={ink} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <g fill={fur}>
      <path d={`M-45 240L${-49+step*13} ${278-Math.max(0,step)*9}M63 240L${65-step*13} ${278-Math.max(0,-step)*9}`} fill="none" stroke={ink} strokeWidth="28"/>
      <path d={`M-45 240L${-49+step*13} ${278-Math.max(0,step)*9}M63 240L${65-step*13} ${278-Math.max(0,-step)*9}`} fill="none" stroke={fur} strokeWidth="21"/>
      <ellipse cx={-46+step*13} cy={283-Math.max(0,step)*9} rx="35" ry="14"/>
      <ellipse cx={67-step*13} cy={283-Math.max(0,-step)*9} rx="35" ry="14"/>
    </g>
    <g transform={`translate(0 ${walk?-Math.abs(step)*2:Math.sin(frame/49)*.5}) rotate(${bend} 0 265) translate(0 ${crouch*30}) scale(1 ${1-crouch*.11})`}>
      <path d="M101-43Q106-72 94-99Q86-96 80-82Q69-101 42-107Q42-96 45-86Q21-104-14-109Q-11-93-2-83Q-27-101-59-101Q-55-89-49-81L-81-98-76-78-119-88-107-67-150-68-134-47-174-42-156-21-193-9-175 8-207 29-187 38-210 68-192 70-214 105-193 104-209 141-187 137-201 174-174 165-181 202-154 189-159 224-131 210-128 241-101 229-94 256-72 248-58 270Q-10 280-25 263Q60 221 65 127L49-30Z" fill="#9d6338"/>
      <path d="M-178 116Q-183 29-119-31Q-83-66-29-49" fill="none" stroke="#c28b50" strokeWidth="15"/>
      <g stroke="#714a2e" strokeWidth="2.6" fill="none">{quillMarks.map(([x,y],i)=><path key={i} d={`M${x!-7} ${y!-9}l7 19 11-15`}/>)}</g>
      <path d="M-37-76l-6-12M17-78l-8-11M61-77l-8-12" fill="none" stroke="#bf8950" strokeWidth="4"/>
      {hedgehogParcels.slice(0,parcels).map((p,i)=><Gift key={i} {...p}/>)}
      {/* The green coat is broad at the shoulders and short above the feet. */}
      <path d="M-31 85Q25 68 84 96Q101 152 115 251Q48 276-70 249L-67 174Z" fill="#275f46"/>
      <path d="M26 106Q56 100 70 123L77 248Q42 268-5 256Q21 221 24 180Z" fill={cream}/>
      <path d="M-51 239Q-18 258 11 254M87 116L103 241 79 248" fill="none" stroke="#eabe43" strokeWidth="5"/>
      {/* The wing root tucks underneath the cape at the shoulder seam. */}
      <g transform={`translate(-32 105) rotate(${28-wingFlap*30})`} stroke="#c49751" strokeWidth="3.5">
        <path d="M0 4C-4-34-34-81-70-102C-96-119-111-101-91-76L-76-57C-106-83-139-103-149-84C-160-62-124-34-107-23C-145-43-151-22-127-1L-108 12C-140 8-139 32-110 36L-72 41C-91 54-62 68-46 53Q-12 51 0 4Z" fill="#fff0cf"/>
        <path d="M-78-77Q-18-24-12 13M-125-61Q-80-18-27 25M-111 1Q-72 26-40 31M-76 40Q-52 45-27 34" fill="none" strokeWidth="2.5"/>
      </g>
      {/* Red cape; its cream edge returns directly to the collar. */}
      <path d="M-35 83Q-65 125-104 180L-153 230Q-126 256-66 252Q-25 240-19 190Q-7 123 43 106Z" fill="#bf343e"/>
      <path d="M-125 224Q-93 247-61 230Q-39 213-35 182Q-28 139 5 119" fill="none" stroke="#f0c34c" strokeWidth="5"/>
      <path d="M-149 231Q-126 253-86 252Q-45 254-31 225Q-15 193-14 165Q-9 127 28 109" fill="none" stroke={ink} strokeWidth="23"/>
      <path d="M-149 231Q-126 253-86 252Q-45 254-31 225Q-15 193-14 165Q-9 127 28 109" fill="none" stroke="#fff0cf" strokeWidth="16"/>
      <g transform="translate(-76 188)" stroke="#f0c34c" strokeWidth="3" fill="none">
        <path d="M0-19V19M-17-10L17 10M-17 10L17-10M-5-15L0-10 5-15M-5 15L0 10 5 15M-15-4L-10-4-11-10M15 4L10 4 11 10M-11 10L-10 4-15 4M11-10L10-4 15-4"/>
      </g>
      {/* Smaller face inset into the quill-covered nape; the collar overlaps its base. */}
      <g transform={`rotate(${tilt} 39 76) translate(-3 -11) translate(39 76) scale(.8772) translate(-39 -76)`}>
        <path d="M-8 58L7 44-7 39 9 25-9 22Q-16 6-12-12Q-20-31-12-42Q11-68 57-68Q92-71 115-53Q121-20 143-15Q163-13 162 7Q160 44 130 68Q97 95 48 90Q13 90-8 68L3 56Z" fill={cream}/>
        <path d="M-12 22Q-58 18-52-14Q-45-43-22-35Q-8-30-4-16" fill={fur}/>
        <path d="M-25 9Q-46-1-36-20Q-25-28-12-10Z" fill="#e8a08c" stroke="none"/>
        {blink?<path d="M61-10Q82-31 103-10" fill="none" strokeWidth="4.5"/>:<>
          <ellipse cx="82" cy="-13" rx="22" ry="28" fill="#fffdf6"/>
          <ellipse cx={87+Math.max(-4,Math.min(4,look*.5))} cy="-10" rx="13" ry="20" fill="#292f32" stroke="none"/>
          <ellipse cx="91" cy="-20" rx="5" ry="6" fill="white" stroke="none"/>
        </>}
        <path d={emotion==='surprised'?'M66-49q16-19 32-5':emotion==='thinking'?'M65-43l29-4':'M65-47q16-13 31-4'} fill="none" strokeWidth="3.8"/>
        <ellipse cx="54" cy="31" rx="18" ry="9" fill="#ef9e90" opacity=".8" stroke="none"/>
        <ellipse cx="154" cy="-3" rx="17" ry="14" fill="#303134"/>
        <ellipse cx="154" cy="-9" rx="7" ry="3" fill="#f6f0df" stroke="none"/>
        {open?<ellipse cx="125" cy="49" rx={mouth==='round'?8:12} ry={mouth==='open'?11:6} fill="#754238" strokeWidth="2.5"/>:<path d="M104 43Q122 62 143 44" fill="none" strokeWidth="3.7"/>}
        <path d="M105 40l-5 5" fill="none" strokeWidth="2.5"/>
      </g>
      <g transform="translate(0 -13)"><path d="M-33 73C-45 63-60 76-52 87C-68 93-58 110-44 108C-41 125-22 126-14 116C-4 131 14 129 20 119C34 133 51 128 57 118C72 129 89 118 86 109C104 117 120 103 112 93C130 90 125 72 111 76L88 88Q26 99-13 75Z" fill="#fff0cf"/></g>
      <path d="M51 113L36 171 58 174 67 127 72 171 93 167 76 112Z" fill="#c43d43"/>
      {paw(far,leftProp,leftPropAngle,'far')}
      {paw(near,rightProp,rightPropAngle,'near')}
      <path d="M66 102L74 117 91 119 79 131 82 148 66 140 51 148 54 131 42 119 59 117Z" fill="#f3c343" stroke="#587347" strokeWidth="4"/>
      <path d="M66 110l5 11 11 1-9 8 2 10-9-5-9 5 2-10-8-8 11-1Z" fill="#ffdc6c" stroke="none"/>
    </g>
  </g>;
}
