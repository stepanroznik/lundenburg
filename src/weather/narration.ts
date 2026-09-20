import { presenters } from './config.js';
import type { Atom, Edition, Fact, Forecast, Language, Period, Presenter, WeatherState } from './model.js';

const conditions: Record<Language, Record<WeatherState, string>> = {
  de: { clear: 'Die Sonne scheint.', 'partly-cloudy': 'Sonne und Wolken wechseln sich ab.', cloudy: 'Viele Wolken ziehen über uns hinweg.', fog: 'Nebel macht die Sicht ganz kurz.', drizzle: 'Es nieselt leicht.', rain: 'Es regnet.', showers: 'Ab und zu zieht ein Regenschauer vorbei.', 'heavy-rain': 'Es regnet kräftig.', thunderstorm: 'Es kann blitzen und donnern. Bleibt dann bitte drinnen.', snow: 'Schnee fällt vom Himmel.', windy: 'Der Wind weht kräftig.', hot: 'Es ist heiß. Denkt ans Trinken und an Schatten.', cold: 'Es ist frostig kalt.' },
  cs: { clear: 'Svítí sluníčko.', 'partly-cloudy': 'Sluníčko se střídá s mraky.', cloudy: 'Oblohu zakrývají mraky.', fog: 'Je mlha a vidíme jen kousek před sebe.', drizzle: 'Jemně mrholí.', rain: 'Prší.', showers: 'Občas přijde přeháňka.', 'heavy-rain': 'Pořádně prší.', thunderstorm: 'Mohou přijít bouřky. Při bouřce raději zůstaňte uvnitř.', snow: 'Padají sněhové vločky.', windy: 'Fouká silný vítr.', hot: 'Je horko. Nezapomeňte pít a odpočívat ve stínu.', cold: 'Je mrazivo.' },
  sk: { clear: 'Slniečko svieti.', 'partly-cloudy': 'Slniečko sa strieda s oblakmi.', cloudy: 'Oblohu zakrývajú oblaky.', fog: 'Je hmla a vidíme len kúsok pred seba.', drizzle: 'Jemne mrholí.', rain: 'Prší.', showers: 'Občas príde prehánka.', 'heavy-rain': 'Výdatne prší.', thunderstorm: 'Môžu prísť búrky. Počas búrky radšej zostaňte vnútri.', snow: 'Padajú snehové vločky.', windy: 'Fúka silný vietor.', hot: 'Je horúco. Nezabudnite piť a oddychovať v tieni.', cold: 'Je mrazivo.' },
};
// Future introductions put the following present-tense description in forecast context.
export function contextText(language: Language, edition: Edition, period: Period): string {
  const now: Record<Language, Record<Edition, string>> = {
    de: { morning: 'So sieht unser Wetter heute Morgen aus.', afternoon: 'So sieht unser Wetter jetzt am Nachmittag aus.', evening: 'So sieht unser Wetter jetzt am Abend aus.' },
    cs: { morning: 'Takhle to u nás vypadá dnes ráno.', afternoon: 'Takhle to u nás vypadá teď odpoledne.', evening: 'Takhle to u nás vypadá teď večer.' },
    sk: { morning: 'Takto to u nás vyzerá dnes ráno.', afternoon: 'Takto to u nás vyzerá teraz popoludní.', evening: 'Takto to u nás vyzerá teraz večer.' },
  };
  if (period === 'current' || (period === 'afternoon' && edition === 'afternoon') || (period === 'evening' && edition === 'evening')) return now[language][edition];
  const future: Record<Language, Record<Exclude<Period, 'current'>, string>> = {
    de: { afternoon: 'Und das ist die Vorhersage für heute Nachmittag.', evening: 'Schauen wir auf die Vorhersage für heute Abend.', tomorrow: 'Und so ist die Vorhersage für morgen.' },
    cs: { afternoon: 'A jaká je předpověď na dnešní odpoledne?', evening: 'Podívejme se na předpověď na dnešní večer.', tomorrow: 'A co nás podle předpovědi čeká zítra?' },
    sk: { afternoon: 'A aká je predpoveď na dnešné popoludnie?', evening: 'Pozrime sa na predpoveď na dnešný večer.', tomorrow: 'A čo nás podľa predpovede čaká zajtra?' },
  };
  return future[language][period as Exclude<Period, 'current'>];
}
export function temperatureText(language: Language, fact: Fact): string {
  const n = Math.round(fact.temperatureC);
  const value = n < 0 ? `mínus ${Math.abs(n)}` : `${n}`;
  const future = fact.period !== 'current';
  if (language === 'de') return `${future ? 'Die Temperatur erreicht etwa' : 'Die Temperatur liegt bei etwa'} ${n < 0 ? `minus ${Math.abs(n)}` : n} Grad.`;
  const a = Math.abs(n);
  const unit = a === 1 ? 'stupeň' : a >= 2 && a <= 4 ? (language === 'cs' ? 'stupně' : 'stupne') : (language === 'cs' ? 'stupňů' : 'stupňov');
  return language === 'cs' ? `${future ? 'Teplota vystoupí přibližně na' : 'Teď máme přibližně'} ${value} ${unit}.` : `${future ? 'Teplota vystúpi približne na' : 'Teraz máme približne'} ${value} ${unit}.`;
}
const greetings: Record<Presenter, string> = { knurpsi: 'Hallo aus Lundenburg! Ich bin Knurpsi.', sisi: 'Danke, Knurpsi! Sisi begrüßt euch aus Wien.', schalinka: 'Děkuju, Sisi! Tady Šalinka z Brna!', haluschka: 'Ďakujem, Šalinka! Tu je Haluška z Bratislavy.' };
const handoffs: Record<Presenter, string> = { knurpsi: 'Und jetzt zu Sisi nach Wien!', sisi: 'Weiter geht es mit Schalinka in Brno!', schalinka: 'A teď nás čeká Haluška v Bratislavě!', haluschka: 'To je od nás všetko. Majte krásny deň a dovidenia!' };
export const reactions: Record<Presenter, string[]> = { knurpsi: ['Gut vorbereitet macht der Tag noch mehr Spaß.', 'So, jetzt wissen wir Bescheid!'], sisi: ['Wie schön, dass ihr dabei seid.', 'Ein kleiner Blick aufs Wetter gehört einfach dazu.'], schalinka: ['Tak, a máme v tom jasno!', 'To byla naše malá výprava za počasím!'], haluschka: ['Som rada, že ste tu s nami.', 'Posielam vám milý pozdrav.'] };
// An optional copy provider may choose approved flavour only. Facts never leave templates.
export interface WeatherCopyGenerator { chooseReaction(presenter: Presenter, choices: readonly string[]): Promise<unknown> }
export async function speechPlan(forecast: Forecast, edition: Edition, copy?: WeatherCopyGenerator): Promise<Atom[]> {
  const atoms: Atom[] = [];
  for (const [index, p] of presenters.entries()) {
    const add = (purpose: Atom['purpose'], text: string, period: Period = 'current') => atoms.push({ id: `${p.id}-${atoms.length}`, presenter: p.id, language: p.language, purpose, text, period });
    add('greeting', greetings[p.id]);
    for (const fact of forecast.cities[p.id]) {
      add('context', contextText(p.language, edition, fact.period), fact.period);
      add('condition', conditions[p.language][fact.state], fact.period);
      add('temperature', temperatureText(p.language, fact), fact.period);
    }
    const choices = reactions[p.id];
    let reaction = choices[(new Date(forecast.broadcastAt).getUTCDate() + index) % choices.length]!;
    if (copy) {
      try {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const selection = await Promise.race([copy.chooseReaction(p.id, choices), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Copy timeout')), 2000); })]).finally(() => clearTimeout(timer));
        if (typeof selection === 'number' && Number.isInteger(selection) && choices[selection]) reaction = choices[selection]!;
      } catch { /* Deterministic narration remains complete. */ }
    }
    add('reaction', reaction, forecast.cities[p.id].at(-1)!.period);
    add(p.id === 'haluschka' ? 'goodbye' : 'handoff', handoffs[p.id]);
  }
  return atoms;
}
