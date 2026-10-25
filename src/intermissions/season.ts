export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
const monthFormatters=new Map<string,Intl.DateTimeFormat>();
export function seasonAt(date: Date, timezone = 'Europe/Prague'): Season {
  if(!monthFormatters.has(timezone))monthFormatters.set(timezone,new Intl.DateTimeFormat('en',{timeZone:timezone,month:'numeric'}));
  const month=Number(monthFormatters.get(timezone)!.format(date));
  return month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';
}
