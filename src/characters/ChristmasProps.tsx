/** Reusable vector parcels; origin is the grip point at the centre. */
export function Gift({ x=0, y=0, size=1, color='#fb1143' }: {x?:number;y?:number;size?:number;color?:string}) {
  return <g transform={`translate(${x} ${y}) scale(${size})`} stroke="#334c49" strokeWidth="3.5" strokeLinejoin="round">
    <rect x="-37" y="-27" width="74" height="55" rx="5" fill={color}/><path d="M-40-27H40V-17H-40Z" fill={color}/>
    <path d="M-7-27H7V28H-7Z" fill="#fff1bc"/><path d="M0-27C-38-56-42-13 0-27C38-56 42-13 0-27Z" fill="#fdbf11"/>
  </g>;
}
