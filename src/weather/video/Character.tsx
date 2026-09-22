import React from 'react';
import { Character as SharedCharacter } from '../../characters/Character.js';
import { weatherStyle } from '../characters.js';
import type { Mouth, Presenter, WeatherState } from '../model.js';

// Keep the weather-show contract while sharing the same rig with intermissions.
export function Character({ state, ...props }: { id: Presenter; frame: number; mouth?: Mouth; state: WeatherState; pointing: boolean; target?: [number, number] }) {
  const style = weatherStyle(state);
  return <SharedCharacter {...props} outfit={style.outfit as 'scarf' | 'raincoat' | 'summer' | 'everyday'} prop={style.prop === 'umbrella' ? 'umbrella' : style.prop === 'fan' ? 'fan' : 'pointer'} {...(state === 'snow' ? { ambient: 'snow' as const } : state === 'windy' ? { ambient: 'wind' as const } : {})}/>;
}
