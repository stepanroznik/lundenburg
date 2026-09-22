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
    synopsis: 'The original rainbow L spins in; KIDS bounces in from the right; the plus overshoots and settles.',
    lines: [line('knurpsi', 'Lundenburg!', .04), line('schalinka', 'Kids!', .04), line('sisi', 'Preeemiuuum!', .05)] },
  { id: '02-mydlo', title: 'Mýdlo', scene: 'soap', kind: 'voiced', cast: ['haluschka', 'schalinka'], lead: 1.2, tail: 1.4,
    synopsis: 'Haluschka showers with a bar of soap. Schalinka prefers the Svratka; Haluschka gives the camera a long look.',
    lines: [line('schalinka', soapDialogue[0], .25), line('haluschka', soapDialogue[1], .65), line('schalinka', soapDialogue[2], .25)] },
  { id: '03-stavebni-povoleni', title: 'Stavební povolení', scene: 'dam', kind: 'voiced', cast: ['knurpsi', 'sisi'], lead: .7, tail: .08,
    synopsis: 'Knurpsi builds a small dam, proudly explains beaver efficiency, then freezes at the words building permit.',
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
    synopsis: 'Sisi explains her white fur and blue eyes, and her breed’s railway connection. Knurpsi cautiously backs away.',
    lines: [line('knurpsi', 'Sisi, du bist doch ein weißes Kaninchen.'), line('sisi', 'Ein Weißer Wiener, bitte.'),
      line('knurpsi', 'Ein Kaninchen aus Wien?'), line('sisi', 'Weißes Fell, blaue Augen. Kein Albino!'),
      line('sisi', 'Meine Rasse züchtete Wilhelm Mucke, ein Wiener Eisenbahner. Erstmals ausgestellt: 1907.'),
      line('knurpsi', 'Ein Wiener Kaninchen von einem Eisenbahner?', .35), line('sisi', 'Ja.', .5),
      line('knurpsi', 'Das ist wirklich sehr österreichisch.', .4), line('sisi', 'Was soll das denn heißen?', .1)],
    sources: ['https://www.arche-austria.at/index.php?id=83'] },
  { id: '05-brnensky-drak', title: 'Brněnský drak', scene: 'dragon', kind: 'voiced', cast: ['haluschka', 'schalinka'], lead: .45, tail: .12,
    synopsis: 'Schalinka’s dragon identity unravels, revealing the crocodile in Brno’s Old Town Hall. It is all Brno marketing.',
    lines: [line('haluschka', 'Schalinka, a ty si vlastne aké zviera?'),
      {...line('schalinka', 'Drak.'), direction: {stability: .8, style: 0, speed: .86, previousText: 'Ptáš se, jaké jsem zvíře?', nextText: 'V Brně mi říkají brněnský drak.'}},
      {...line('haluschka', 'Drak?'), direction: {stability: .8, style: 0, previousText: 'A ty si vlastne aké zviera?', nextText: 'Mne skôr pripomínaš krokodíla.'}}, line('schalinka', 'Jo.'),
      line('haluschka', 'Mne skôr pripomínaš krokodíla.'), line('schalinka', 'Pššt! To je teda slušnost!', .85),
      line('schalinka', 'No dobře. Jsem krokodýl.'), line('schalinka', 'Ale nikomu ani slovo, jo?', .4),
      line('schalinka', 'V Brně máme krokodýla na Staré radnici už stovky let. Jenže všichni mu říkají Brněnský drak.'),
      line('haluschka', 'A prečo?'), line('schalinka', 'Protože drak zní líp.', .4), line('haluschka', 'Takže marketing.', .2), line('schalinka', 'Brněnskej.', .02)],
    sources: ['https://www.brno.cz/w/o-brnenskem-drakovi', 'https://cosedeje.brno.cz/documents/317111/790956/BM_1301.pdf/6d3720aa-9912-180f-ee3d-59d35fde5d73?t=1671363847174'] },
  { id: '06-gerecht-geteilt', title: 'Gerecht geteilt', scene: 'biscuits', kind: 'voiced', cast: ['knurpsi', 'sisi'], lead: .6, tail: 1,
    synopsis: 'Three biscuits, two friends, and Knurpsi’s suspicious new job as quality inspector.',
    lines: [line('knurpsi', 'Drei Kekse. Ich teile ganz gerecht.'), line('sisi', 'Einer für dich, einer für mich. Und der dritte?'),
      line('knurpsi', 'Für die Qualitätskontrolle.', .4), line('sisi', 'Und wer macht die?', .5), line('knurpsi', 'Ich.', .5),
      line('sisi', 'Dann kontrolliere ich die Kontrolle.')] },
  { id: '07-soutez-v-tichu', title: 'Soutěž v tichu', scene: 'quiet', kind: 'voiced', cast: ['schalinka', 'haluschka'], lead: .5, tail: .9,
    synopsis: 'Schalinka challenges Haluschka to stay quiet, then immediately announces her own victory.',
    lines: [line('schalinka', 'Dáme soutěž, kdo vydrží déle mlčet?'), line('haluschka', 'Dobre. Odteraz.', 7.5),
      {...line('schalinka', 'Já vyhrávám.', .8), direction: {speed: .78, stability: .85, style: 0, previousText: 'Tak, už je to dlouhá chvíle.', nextText: 'Pořád ještě mlčím.'}},
      line('haluschka', 'Už nie.', .8), {...line('schalinka', 'To bylo jen průběžné skóre.'), direction: {speed: .8, stability: .85, style: 0, previousText: 'Ale vždyť soutěž ještě neskončila.'}}] },
  { id: '08-spring-puddles', title: 'Jarní kaluže', scene: 'puddles', kind: 'silent', season: 'spring', cast: ['schalinka', 'haluschka'], seconds: 10,
    synopsis: 'Schalinka jumps in a puddle. Haluschka opens her umbrella just in time; the splash showers Schalinka instead.', lines: [] },
  { id: '09-spring-flowers', title: 'Malá zahrádka', scene: 'flowers', kind: 'silent', season: 'spring', cast: ['knurpsi', 'sisi'], seconds: 11,
    synopsis: 'Knurpsi plants a flower. Sisi waters it, then proudly wears the fallen blossom on her crown.', lines: [] },
  { id: '10-summer-pool', title: 'Koupaliště Břeclav', scene: 'pool', kind: 'silent', season: 'summer', cast: ['schalinka', 'haluschka'], seconds: 11,
    synopsis: 'At Břeclav’s outdoor pool, Schalinka swims past Haluschka’s ring; Haluschka glides serenely to the finish.', lines: [] },
  { id: '11-summer-beachball', title: 'Míč na útěku', scene: 'beachball', kind: 'silent', season: 'summer', cast: ['knurpsi', 'sisi'], seconds: 10,
    synopsis: 'Knurpsi bounces a beach ball to Sisi. It lands on her ears, and she calmly returns it with a nod.', lines: [] },
  { id: '12-autumn-leaves', title: 'Hromada listí', scene: 'leaves', kind: 'silent', season: 'autumn', cast: ['knurpsi', 'schalinka'], seconds: 11,
    synopsis: 'Knurpsi rakes a perfect pile. Schalinka dives into it and emerges with a leaf balanced on her snout.', lines: [] },
  { id: '13-autumn-kite', title: 'Papírový drak', scene: 'kite', kind: 'silent', season: 'autumn', cast: ['sisi', 'haluschka'], seconds: 11,
    synopsis: 'Sisi holds the spool. Haluschka walks over, frees the tail from a twig, lifts the kite into the wind and releases it.', lines: [] },
  { id: '14-winter-snowballs', title: 'Koulovačka', scene: 'snowballs', kind: 'silent', season: 'winter', cast: ['knurpsi', 'schalinka'], seconds: 10,
    synopsis: 'Knurpsi lobs a snowball. Schalinka ducks; snow drops from the tree onto Schalinka. They share a grin.', lines: [] },
  { id: '15-winter-snowman', title: 'Sněhulák', scene: 'snowman', kind: 'silent', season: 'winter', cast: ['sisi', 'haluschka'], seconds: 12,
    synopsis: 'Haluschka stacks the snowballs. Sisi adds a carrot, then crowns their snowman with long snow-rabbit ears.', lines: [] },
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
