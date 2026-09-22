import { Command } from 'commander';
import { catalogue } from './catalogue.js';
import { prepareSet } from './prepare.js';
import { renderSet } from './render.js';
import { publishLibrary } from './publish.js';
import { writeGallery } from './gallery.js';
import { eligibleSkits } from './model.js';

const app = new Command();
app.name('lkp-intermissions');
app.command('list').option('--today','List skits eligible for today in Europe/Prague').action(o=>console.log(JSON.stringify(o.today?eligibleSkits(catalogue,new Date()):catalogue,null,2)));
app.command('prepare').option('--audio <mode>','tts (paid on cache misses), cache, or silent preview','cache').option('--id <ids...>','Skit ids; defaults to the full set').action(async o=>{
  if(!['tts','cache','silent'].includes(o.audio))throw new Error('Invalid audio mode');
  await prepareSet(o.id??[],o.audio);
});
app.command('render').option('--id <ids...>').option('--stills').option('--seconds <times>','Comma-separated exact still times in seconds').option('--preview').option('--scale <scale>','Resolution scale, final output defaults to 1080p','1').option('--skip-existing').action(async o=>{
  const scale=Number(o.scale);if(!Number.isFinite(scale)||scale<=0||scale>1)throw new Error('Scale must be between 0 and 1');
  const seconds=o.seconds?String(o.seconds).split(',').map(Number):undefined;
  if(seconds?.some(s=>!Number.isFinite(s)||s<0))throw new Error('Invalid still time');
  await renderSet(o.id??[],{stills:Boolean(o.stills),preview:Boolean(o.preview),scale,skipExisting:Boolean(o.skipExisting),...(seconds?{seconds}:{})});
});
app.command('gallery').action(writeGallery);
app.command('publish').description('publish only current, verified full-HD renders for channel rotation').action(publishLibrary);
await app.parseAsync();
