#!/usr/bin/env node

import { Command } from 'commander';
import { terminateChildren, failureCode } from './io.js';
import { registerContent } from './cli.js';
import { startWorkerHeartbeat } from './supervisor.js';
if(process.env.LKP_ACQUISITION_WORKER==='1')startWorkerHeartbeat();
const program=new Command().name('lkp-content').option('-c, --config <file>','channel config YAML');
registerContent(program);
for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => { terminateChildren(); process.exit(signal === 'SIGTERM' ? 143 : 130); });
program.parseAsync().catch(error => { console.error(`Content operation failed (${failureCode(error)}); consult content status/history. Provider responses and credentials are not logged.`); process.exitCode = 1; });
