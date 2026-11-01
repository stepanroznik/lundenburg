import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';

// Exercise the actual Python helper with synthetic manifest shapes; no VPN or
// provider requests are needed for this regression.
test('Austrian helper refuses all-short ORF video manifests before download',()=>{
  const program = `
import importlib.util, json
spec=importlib.util.spec_from_file_location('jantit','scripts/download-jantit-vpn.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
v=lambda f:{'height':540,'vcodec':'h264','fragments':f}
short=v([{}, {'duration':10.048}])
full=v([{}, {'duration':782}])
unknown={'height':720,'vcodec':'h264'}
print(json.dumps([m.placeholder_only({'formats':[short]},782),m.placeholder_only({'formats':[short,full]},782),m.placeholder_only({'formats':[short,unknown]},782),m.placeholder_only({'formats':[short]},10)]))
`;
  const result=JSON.parse(execFileSync('python3',['-c',program],{encoding:'utf8'}));
  assert.deepEqual(result,[true,false,false,false]);
});

test('Austrian helper cleans up an orphaned downloader child',()=>{
  const program = `
import importlib.util, os, pathlib, subprocess, sys, tempfile, time
spec=importlib.util.spec_from_file_location('jantit','scripts/download-jantit-vpn.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);m.become_subreaper()
with tempfile.TemporaryDirectory() as directory:
 marker=pathlib.Path(directory)/'pid'
 code="import pathlib,subprocess,sys,time; p=subprocess.Popen(['sleep','30']); pathlib.Path(sys.argv[1]).write_text(str(p.pid)); time.sleep(30)"
 parent=subprocess.Popen([sys.executable,'-c',code,str(marker)])
 try:
  deadline=time.monotonic()+5
  while not marker.exists():
   if time.monotonic()>deadline:raise RuntimeError('child did not start')
   time.sleep(.02)
  child=int(marker.read_text());parent.terminate();parent.wait(timeout=3)
  m.stop_descendants();os.waitpid(child,0)
  assert not pathlib.Path('/proc/'+str(child)).exists()
 finally:
  if parent.poll() is None:parent.kill();parent.wait()
  m.stop_descendants()
`;
  execFileSync('python3',['-c',program],{timeout:10000});
});
