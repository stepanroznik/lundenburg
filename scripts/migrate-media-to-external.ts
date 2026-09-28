import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { loadConfig } from '../src/config.js';
import { assertMediaStorage, generatedShowRoot } from '../src/media-storage.js';
import { catalogue } from '../src/intermissions/catalogue.js';

interface ShowMetadata {
  id: string;
  title: string;
  description: string;
  language: string;
  weight: number;
  enabled: boolean;
  episodeTitleTemplate?: string;
}

const config = loadConfig();
assertMediaStorage(config);
const root = path.resolve(config.media.root);
if (root !== '/mnt/lkp-media/LKP') throw new Error(`Refusing unexpected migration destination: ${root}`);

const shows: Record<string, ShowMetadata> = {
  Bluey: {
    id: 'bluey', title: 'Bluey', language: 'en', weight: 1, enabled: true,
    episodeTitleTemplate: 'Staffel {season}, Folge {episode}',
    description: 'Die junge Blue Heeler-Hündin Bluey verwandelt mit ihrer Schwester Bingo und ihren Eltern den Familienalltag in fantasievolle Spiele.',
  },
  'Bobo Siebenschläfer': {
    id: 'bobo-siebenschlaefer', title: 'Bobo Siebenschläfer', language: 'de', weight: 1, enabled: true,
    description: 'Bobo entdeckt mit seiner Familie die kleinen Abenteuer des Alltags und lernt dabei die Welt Schritt für Schritt kennen.',
  },
  'Die Sendung mit dem Elefanten': {
    id: 'sendung-mit-dem-elefanten', title: 'Die Sendung mit dem Elefanten', language: 'de', weight: 1, enabled: true,
    description: 'Lach- und Sachgeschichten für jüngere Kinder erklären Natur, Technik, Sprache und den Alltag auf spielerische Weise.',
  },
  Krtek: {
    id: 'der-kleine-maulwurf', title: 'Der kleine Maulwurf', language: 'cs', weight: 1, enabled: true,
    episodeTitleTemplate: 'Staffel {season}, Folge {episode}',
    description: 'Der neugierige kleine Maulwurf erlebt mit seinen Freunden warmherzige Abenteuer in der Natur.',
  },
  'Tom and Jerry Cartoons Complete Collection (1940-2007) [DVDRip] M8': {
    id: 'tom-und-jerry', title: 'Tom und Jerry', language: 'en', weight: 1, enabled: true,
    episodeTitleTemplate: 'Folge {episode}',
    description: 'Kater Tom und Maus Jerry liefern sich einfallsreiche, turbulente und meist wortlose Verfolgungsjagden.',
  },
};

function atomicText(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // ntfs3 has shown unreliable same-directory rename behaviour for these
  // copied sidecars. These are regenerated metadata files; direct replacement
  // avoids leaving a temporary file behind and never touches media payloads.
  fs.writeFileSync(file, content);
}

function writeShow(directory: string, metadata: ShowMetadata): void {
  atomicText(path.join(directory, 'show.yaml'), stringify(metadata, { lineWidth: 0 }));
}

function copyMissing(source: string, destination: string): void {
  if (!fs.existsSync(source)) return;
  const sourceInfo = fs.statSync(source);
  if (sourceInfo.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      if (entry.startsWith('.source-originals')) continue;
      copyMissing(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }
  if (!sourceInfo.isFile()) return;
  const destinationInfo = fs.existsSync(destination) ? fs.statSync(destination) : undefined;
  // A prior interrupted copy can leave a truncated file. Replace only a file
  // whose length differs from its known local source; matching files are left alone.
  if (!destinationInfo || destinationInfo.size !== sourceInfo.size) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  }
}

for (const [directory, metadata] of Object.entries(shows)) writeShow(path.join(root, directory), metadata);

const localLibrary = '/home/lundenburg/lkp-media';
for (const directory of ['byl-jednou-jeden-zivot', 'the-man-from-earth', 'wreck-it-ralph']) {
  copyMissing(path.join(localLibrary, directory), path.join(root, directory));
}

const weatherRoot = generatedShowRoot(config, 'weather');
writeShow(weatherRoot, {
  id: 'lkp-weather', title: 'LKP Wetterfreunde', language: 'mul', weight: 1, enabled: false,
  description: 'Aktuelle Wetterberichte für Lundenburg, Wien, Brünn und Bratislava mit den LKP-Wetterfreunden.',
});
copyMissing('/home/lundenburg/lkp-weather/runtime/weather/episodes', path.join(weatherRoot, 'episodes'));

for (const file of fs.existsSync(path.join(weatherRoot, 'episodes'))
  ? fs.readdirSync(path.join(weatherRoot, 'episodes'), { recursive: true, encoding: 'utf8' })
  : []) {
  if (!file.endsWith('programme.json')) continue;
  const metadataFile = path.join(weatherRoot, 'episodes', file);
  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8')) as { mediaPath?: string; subtitlePath?: string };
  const directory = path.dirname(metadataFile);
  metadata.mediaPath = path.join(directory, 'weather.mp4');
  metadata.subtitlePath = path.join(directory, 'subtitles.vtt');
  atomicText(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
}

const intermissionRoot = generatedShowRoot(config, 'intermissions');
copyMissing('/home/lundenburg/lkp-intermissions/runtime/intermissions', intermissionRoot);
writeShow(intermissionRoot, {
  id: 'lkp-intermissions', title: 'LKP Pausenfilme', language: 'mul', weight: 1, enabled: false,
  description: 'Kurze saisonale Geschichten, Dialoge und Senderkennungen mit Knurpsi, Sisi, Schalinka und Haluschka.',
});
const published = path.join(intermissionRoot, 'published.json');
if (fs.existsSync(published)) {
  const manifest = JSON.parse(fs.readFileSync(published, 'utf8')) as { clips?: Array<{ id: string; title: string; synopsis: string; mediaPath: string }> };
  for (const clip of manifest.clips ?? []) {
    const skit = catalogue.find((entry) => entry.id === clip.id);
    clip.mediaPath = path.join(intermissionRoot, 'videos', `${clip.id}.mp4`);
    if (skit) { clip.title = skit.title; clip.synopsis = skit.synopsis; }
  }
  atomicText(published, `${JSON.stringify(manifest, null, 2)}\n`);
}
for (const skit of catalogue) {
  const metadataFile = path.join(intermissionRoot, 'videos', `${skit.id}.json`);
  if (!fs.existsSync(metadataFile)) continue;
  const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8')) as Record<string, unknown>;
  atomicText(metadataFile, `${JSON.stringify({ ...metadata, title: skit.title, synopsis: skit.synopsis }, null, 2)}\n`);
}

console.log(`External media layout prepared at ${root}. Local source files were retained.`);
