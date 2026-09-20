import React from 'react';
import type { WeatherState } from '../model.js';
export function WeatherIcon({ state, frame = 0 }: { state: WeatherState; frame?: number }) {
  const sunny = ['clear', 'hot', 'partly-cloudy'].includes(state);
  const rainy = ['rain', 'drizzle', 'showers', 'heavy-rain', 'thunderstorm'].includes(state);
  return <g strokeLinecap="round" strokeLinejoin="round">
    {sunny && <g transform={`rotate(${frame / 15} 0 0)`} stroke="#eab954" strokeWidth="5"><circle r="19" fill="#f5ca63"/>{Array.from({ length: 8 }, (_, i) => <path key={i} d="M0-29v-9" transform={`rotate(${i * 45})`}/>)}</g>}
    {!['clear', 'hot', 'cold', 'windy'].includes(state) && <path d="M-31 16C-55 13-45-17-25-14C-24-42 22-43 26-14C54-17 56 18 31 19Z" fill={state === 'thunderstorm' ? '#7e949a' : '#fbfcf5'} stroke="#7b9a9c" strokeWidth="3"/>}
    {rainy && [-20, 0, 20].map((x, i) => <path key={x} d={`M${x} ${27 + (frame + i * 6) % 12}l-5 10`} stroke="#589dbb" strokeWidth="5"/>)}
    {state === 'thunderstorm' && <path d="M4 12l-15 21h13l-9 22 28-31H8l8-12" fill="#f2c657"/>}
    {['snow', 'cold'].includes(state) && <g transform="translate(0 34)" stroke="#76b3c3" strokeWidth="4"><path d="M-15 0h30M-8-13L8 13M-8 13L8-13"/></g>}
    {['windy', 'fog'].includes(state) && <g fill="none" stroke="#8da7a0" strokeWidth="5"><path d="M-36-12h55q25 0 17-15M-29 3h60M-37 19h45q25 0 22 13"/></g>}
  </g>;
}
