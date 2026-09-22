// These transforms match the character rig. Released props start at the exact
// same position as the hand that held them; feet are outside the torso transform.
export type Point = [number, number];
export const mix = (a: Point, b: Point, p: number): Point => [a[0]+(b[0]-a[0])*p,a[1]+(b[1]-a[1])*p];
export function bodyPoint(p: Point, bend = 0, crouch = 0): Point {
  const a = bend*Math.PI/180, y=p[1]-265;
  return [p[0]*Math.cos(a)-y*Math.sin(a),265+(p[0]*Math.sin(a)+y*Math.cos(a))*(1-crouch*.36)];
}
export function worldPoint(p: Point, x: number, y = 595, flip = false, bend = 0, crouch = 0, scale = 1.05): Point {
  const b=bodyPoint(p,bend,crouch); return [x+b[0]*scale*(flip?-1:1),y+b[1]*scale];
}
export function localPoint(p: Point, x: number, y = 595, flip = false, bend = 0, crouch = 0, scale = 1.05): Point {
  const bx=(p[0]-x)/scale*(flip?-1:1), by=((p[1]-y)/scale-265)/(1-crouch*.36), a=-bend*Math.PI/180;
  return [bx*Math.cos(a)-by*Math.sin(a),265+bx*Math.sin(a)+by*Math.cos(a)];
}
