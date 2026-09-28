import { presenter } from '../characters/registry.js';
import type { Presenter } from '../characters/types.js';
import type { Line, Skit } from './model.js';

const line = (speaker: Presenter, text: string, pauseAfter = .2): Line => ({ speaker, text, language: presenter(speaker).language, pauseAfter });
export const soapDialogue = [
  'Haluško, ty se sprchuješ s mýdlem?',
  'Hej. U nás na Slovensku sa normálne mydlia ovce aj barany.',
  'Zajímavé. No, já si vystačím s vodou ve Svratce.',
] as const;

export const catalogue: Skit[] = [
  { id: '01-channel-ident', title: 'Lundenburg! Kids! Preeemiuuum!', scene: 'ident', kind: 'ident', cast: ['knurpsi', 'schalinka', 'sisi'], lead: 0, tail: 0,
    synopsis: 'Das ursprüngliche Regenbogen-L dreht sich ins Bild, KIDS hüpft von rechts herein und das Plus schwingt über sein Ziel hinaus.',
    lines: [line('knurpsi', 'Lundenburg!', .04), line('schalinka', 'Kids!', .04), line('sisi', 'Preeemiuuum!', .05)] },
  { id: '02-mydlo', title: 'Die Seife', scene: 'soap', kind: 'voiced', cast: ['haluschka', 'schalinka'], lead: 1.2, tail: 1.4,
    synopsis: 'Haluschka duscht mit einem Stück Seife. Schalinka bevorzugt die Svratka; Haluschka blickt lange in die Kamera.',
    lines: [line('schalinka', soapDialogue[0], .25), line('haluschka', soapDialogue[1], .65), line('schalinka', soapDialogue[2], .25)] },
  { id: '03-stavebni-povoleni', title: 'Die Baugenehmigung', scene: 'dam', kind: 'voiced', cast: ['knurpsi', 'sisi'], lead: .7, tail: .08,
    synopsis: 'Knurpsi baut einen kleinen Damm, erklärt stolz die Effizienz der Biber und erstarrt beim Wort Baugenehmigung.',
    lines: [line('sisi', 'Knurpsi, warum bauen Biber ständig Dämme?'), line('knurpsi', 'Wir sind einfach sehr effizient.'),
      line('knurpsi', 'In Brdy, in Tschechien, wollte der Staat ein Feuchtgebiet wiederherstellen. Damit das Wasser in der Landschaft bleibt.'), line('sisi', 'Das war schon geplant?'),
      line('knurpsi', 'Ja. Aber die Behörden klärten noch die Pläne und wem die Grundstücke gehören.', .35),
      line('knurpsi', 'Inzwischen bauten Biber dort ihre Dämme. Das Wasser staute sich, und das Feuchtgebiet entstand ganz von selbst.'),
      line('sisi', 'Die Biber haben also die Arbeit übernommen?'),
      line('knurpsi', 'Genau. Damit sparten sie dem Staat rund dreißig Millionen tschechische Kronen!', .4),
      line('sisi', 'Dreißig Millionen?'), line('knurpsi', 'Und bezahlt wurden wir in Zweigen.', .7),
      line('sisi', 'Und eine Baugenehmigung?', 1.25), line('knurpsi', 'Was ist das?', .02)],
    fact: 'Biberdämme in Brdy: rund 30 Millionen Kč gespart.',
    sources: ['https://brdy.aopk.gov.cz/web/en/-/beavers-save-governments-money?redirect=/web/en', 'https://ct24.ceskatelevize.cz/clanek/regiony/bobr-v-brdech-vytvoril-mokrad-usetril-statu-miliony-357585', 'https://www.idnes.cz/plzen/zpravy/brdy-padrtsky-rybnik-bobr-hraz-projekt.A250305_841392_plzen-zpravy_vb'] },
  { id: '04-eine-echte-wienerin', title: 'Eine echte Wienerin', scene: 'vienna', kind: 'voiced', cast: ['knurpsi', 'sisi'], lead: .5, tail: .9,
    synopsis: 'Sisi erklärt ihr weißes Fell, ihre blauen Augen und die Eisenbahngeschichte ihrer Rasse. Knurpsi weicht vorsichtig zurück.',
    lines: [line('knurpsi', 'Sisi, du bist doch ein weißes Kaninchen.'), line('sisi', 'Ein Weißer Wiener, bitte.'),
      line('knurpsi', 'Ein Kaninchen aus Wien?'), line('sisi', 'Weißes Fell, blaue Augen. Kein Albino!'),
      line('sisi', 'Meine Rasse züchtete Wilhelm Mucke, ein Wiener Eisenbahner. Erstmals ausgestellt: 1907.'),
      line('knurpsi', 'Ein Wiener Kaninchen von einem Eisenbahner?', .35), line('sisi', 'Ja.', .5),
      line('knurpsi', 'Das ist wirklich sehr österreichisch.', .4), line('sisi', 'Was soll das denn heißen?', .1)],
    sources: ['https://www.arche-austria.at/index.php?id=83'] },
  { id: '05-brnensky-drak', title: 'Der Brünner Drache', scene: 'dragon', kind: 'voiced', cast: ['haluschka', 'schalinka'], lead: .45, tail: .12,
    synopsis: 'Schalinkas Drachengeschichte fällt auseinander: In Wahrheit ist sie das Krokodil aus dem Alten Rathaus in Brünn. Alles nur Brünner Marketing.',
    lines: [line('haluschka', 'Schalinka, a ty si vlastne aké zviera?'),
      {...line('schalinka', 'Drak.'), direction: {stability: .8, style: 0, speed: .86, previousText: 'Ptáš se, jaké jsem zvíře?', nextText: 'V Brně mi říkají brněnský drak.'}},
      {...line('haluschka', 'Drak?'), direction: {stability: .8, style: 0, previousText: 'A ty si vlastne aké zviera?', nextText: 'Mne skôr pripomínaš krokodíla.'}}, line('schalinka', 'Jo.'),
      line('haluschka', 'Mne skôr pripomínaš krokodíla.'), line('schalinka', 'Pššt! To je teda slušnost!', .85),
      line('schalinka', 'No dobře. Jsem krokodýl.'), line('schalinka', 'Ale nikomu ani slovo, jo?', .4),
      line('schalinka', 'V Brně máme krokodýla na Staré radnici už stovky let. Jenže všichni mu říkají Brněnský drak.'),
      line('haluschka', 'A prečo?'), line('schalinka', 'Protože drak zní líp.', .4), line('haluschka', 'Takže marketing.', .2), line('schalinka', 'Brněnskej.', .02)],
    sources: ['https://www.brno.cz/w/o-brnenskem-drakovi', 'https://cosedeje.brno.cz/documents/317111/790956/BM_1301.pdf/6d3720aa-9912-180f-ee3d-59d35fde5d73?t=1671363847174'] },
  { id: '06-gerecht-geteilt', title: 'Gerecht geteilt', scene: 'biscuits', kind: 'voiced', cast: ['knurpsi', 'sisi'], lead: .6, tail: 1,
    synopsis: 'Drei Kekse, zwei Freunde und Knurpsis verdächtige neue Aufgabe als Qualitätsprüfer.',
    lines: [line('knurpsi', 'Drei Kekse. Ich teile ganz gerecht.'), line('sisi', 'Einer für dich, einer für mich. Und der dritte?'),
      line('knurpsi', 'Für die Qualitätskontrolle.', .4), line('sisi', 'Und wer macht die?', .5), line('knurpsi', 'Ich.', .5),
      line('sisi', 'Dann kontrolliere ich die Kontrolle.')] },
  { id: '07-soutez-v-tichu', title: 'Der Schweigewettbewerb', scene: 'quiet', kind: 'voiced', cast: ['schalinka', 'haluschka'], lead: .5, tail: .9,
    synopsis: 'Schalinka fordert Haluschka zum Schweigen heraus und verkündet sofort ihren eigenen Sieg.',
    lines: [line('schalinka', 'Dáme soutěž, kdo vydrží déle mlčet?'), line('haluschka', 'Dobre. Odteraz.', 7.5),
      {...line('schalinka', 'Já vyhrávám.', .8), direction: {speed: .78, stability: .85, style: 0, previousText: 'Tak, už je to dlouhá chvíle.', nextText: 'Pořád ještě mlčím.'}},
      line('haluschka', 'Už nie.', .8), {...line('schalinka', 'To bylo jen průběžné skóre.'), direction: {speed: .8, stability: .85, style: 0, previousText: 'Ale vždyť soutěž ještě neskončila.'}}] },
  { id: '08-spring-puddles', title: 'Frühlingspfützen', scene: 'puddles', kind: 'silent', season: 'spring', cast: ['schalinka', 'haluschka'], seconds: 10,
    synopsis: 'Schalinka springt in eine Pfütze. Haluschka öffnet rechtzeitig ihren Schirm, sodass die Fontäne Schalinka selbst erwischt.', lines: [] },
  { id: '09-spring-flowers', title: 'Der kleine Garten', scene: 'flowers', kind: 'silent', season: 'spring', cast: ['knurpsi', 'sisi'], seconds: 11,
    synopsis: 'Knurpsi pflanzt eine Blume. Sisi gießt sie und trägt die herabgefallene Blüte anschließend stolz als Krone.', lines: [] },
  { id: '10-summer-pool', title: 'Freibad Břeclav', scene: 'pool', kind: 'silent', season: 'summer', cast: ['schalinka', 'haluschka'], seconds: 11,
    synopsis: 'Im Freibad von Břeclav schwimmt Schalinka an Haluschkas Schwimmring vorbei, während Haluschka gelassen ins Ziel gleitet.', lines: [] },
  { id: '11-summer-beachball', title: 'Der Ausreißer-Ball', scene: 'beachball', kind: 'silent', season: 'summer', cast: ['knurpsi', 'sisi'], seconds: 10,
    synopsis: 'Knurpsi spielt Sisi einen Strandball zu. Er landet auf ihren Ohren, und sie befördert ihn gelassen zurück.', lines: [] },
  { id: '12-autumn-leaves', title: 'Der Laubhaufen', scene: 'leaves', kind: 'silent', season: 'autumn', cast: ['knurpsi', 'schalinka'], seconds: 11,
    synopsis: 'Knurpsi harkt einen perfekten Laubhaufen. Schalinka springt hinein und taucht mit einem Blatt auf der Schnauze wieder auf.', lines: [] },
  { id: '13-autumn-kite', title: 'Der Papierdrache', scene: 'kite', kind: 'silent', season: 'autumn', cast: ['sisi', 'haluschka'], seconds: 11,
    synopsis: 'Sisi hält die Spule. Haluschka kommt herüber, befreit den Drachenschwanz von einem Zweig, hebt den Drachen in den Wind und lässt ihn los.', lines: [] },
  { id: '14-winter-snowballs', title: 'Die Schneeballschlacht', scene: 'snowballs', kind: 'silent', season: 'winter', cast: ['knurpsi', 'schalinka'], seconds: 10,
    synopsis: 'Knurpsi wirft einen Schneeball. Schalinka duckt sich, doch Schnee fällt vom Baum auf sie herab. Beide müssen lachen.', lines: [] },
  { id: '15-winter-snowman', title: 'Der Schneemann', scene: 'snowman', kind: 'silent', season: 'winter', cast: ['sisi', 'haluschka'], seconds: 12,
    synopsis: 'Haluschka stapelt die Schneekugeln. Sisi setzt eine Karotte ein und krönt den Schneemann mit langen Schneehasenohren.', lines: [] },
];

export function validateCatalogue(skits = catalogue): void {
  const ids = new Set<string>();
  for (const s of skits) {
    if (ids.has(s.id)) throw new Error(`Duplicate skit: ${s.id}`);
    ids.add(s.id);
    if (s.kind === 'silent' && (s.lines.length || !s.season || !s.seconds)) throw new Error(`Invalid silent skit: ${s.id}`);
    if (s.kind !== 'silent' && !s.lines.length) throw new Error(`Missing dialogue: ${s.id}`);
    for (const l of s.lines) {
      if (!s.cast.includes(l.speaker) || presenter(l.speaker).language !== l.language || !l.text.trim()) throw new Error(`Character/language mismatch: ${s.id}`);
    }
  }
}
