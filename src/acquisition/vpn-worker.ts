import type { AcquisitionConfig } from './model.js';
interface VpnJob {url:string;partial:string;maxBytes:number;policy:AcquisitionConfig}
// Runs only inside the rootless VPN network/mount namespace. The outer worker
// retains broadcast protection and owns the process group and catalogue import.
import fs from 'node:fs';
import { download } from './io.js';
async function main():Promise<void>{
  const file=process.argv[2];if(!file)throw new Error('VPN job missing');
  const job=JSON.parse(fs.readFileSync(file,'utf8')) as VpnJob;
  await download(job.url,job.partial,job.maxBytes,job.policy,()=>{});
}
main().catch(() => { console.error('Isolated media download failed.'); process.exitCode = 1; });
