import type { WeatherState } from './model.js';
export { presenters, presenter } from '../characters/registry.js';
export const weatherStyle = (state: WeatherState) => ({
  outfit: ['snow', 'cold'].includes(state) ? 'scarf' : ['rain', 'drizzle', 'showers', 'heavy-rain', 'thunderstorm'].includes(state) ? 'raincoat' : ['clear', 'hot'].includes(state) ? 'summer' : 'everyday',
  prop: ['rain', 'drizzle', 'showers', 'heavy-rain'].includes(state) ? 'umbrella' : state === 'hot' ? 'fan' : state === 'windy' ? 'hat' : 'pointer',
  mood: state === 'thunderstorm' ? 'careful' : state === 'hot' ? 'warm' : 'happy',
});
