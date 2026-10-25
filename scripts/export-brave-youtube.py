#!/usr/bin/env python3
"""Export only YouTube cookies through Brave's browser API on a Windows/WSL PC.

Close Brave first. This temporary extension handles Windows app-bound encryption
without decrypting its database, changing browser policy, or installing a third
party extension. Cookie values are written only to the private runtime file.
"""
import atexit,http.server,json,os,pathlib,secrets,subprocess,tempfile,time
root=pathlib.Path(__file__).resolve().parent.parent
brave='/mnt/c/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'
if not pathlib.Path(brave).is_file():raise SystemExit('This helper requires Windows Brave at its standard installation path and WSL.')
check=subprocess.run(['powershell.exe','-NoProfile','-Command','if (Get-Process brave -ErrorAction SilentlyContinue) { exit 1 }'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
if check.returncode:raise SystemExit('Close Brave completely before exporting its YouTube session.')
private=root/'runtime/youtube';private.mkdir(exist_ok=True,parents=True);private.chmod(0o700)
ext=private/'brave-export-extension';ext.mkdir(exist_ok=True)
def cleanup():
 for name in ['export.js','manifest.json']:(ext/name).unlink(missing_ok=True)
 try:ext.rmdir()
 except OSError:pass
atexit.register(cleanup)
nonce=secrets.token_urlsafe(32)
received=False
class Receiver(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  global received
  if self.path != '/'+nonce:
   self.send_error(404);return
  size=int(self.headers.get('Content-Length','0'))
  if size<=0 or size>262144:
   self.send_error(400);return
  try:
   payload=json.loads(self.rfile.read(size))
   cookies=payload['cookies']
   lines=['# Netscape HTTP Cookie File','# YouTube-only export from the authorized Brave session.']
   for c in cookies:
    domain=c['domain'];host=domain.lstrip('.')
    if host!='youtube.com' and not host.endswith('.youtube.com'):raise ValueError('Unexpected cookie domain')
    values=[('#HttpOnly_' if c.get('httpOnly') else '')+domain,'FALSE' if c.get('hostOnly') else 'TRUE',c.get('path','/'),'TRUE' if c.get('secure') else 'FALSE',str(int(c.get('expirationDate',0))),c['name'],c['value']]
    if any('\t' in v or '\n' in v or '\r' in v for v in values):raise ValueError('Invalid cookie field')
    lines.append('\t'.join(values))
   if not any(c['name'] in ['SID','__Secure-1PSID','__Secure-3PSID'] for c in cookies):raise ValueError('No signed-in YouTube session')
   target=private/'cookies.txt';fd,temporary=tempfile.mkstemp(prefix='.cookies-',dir=private);os.fchmod(fd,0o600)
   with os.fdopen(fd,'w') as f:f.write('\n'.join(lines)+'\n')
   os.replace(temporary,target)
   received=True
   self.send_response(200);self.end_headers();self.wfile.write(b'YouTube session saved privately.')
   print(f'Exported {len(cookies)} YouTube cookies privately; no values printed.',flush=True)
  except Exception as e:
   self.send_response(400);self.end_headers();print('Cookie export validation failed: '+type(e).__name__,flush=True)
server=http.server.HTTPServer(('127.0.0.1',0),Receiver);server.timeout=1
port=server.server_address[1]
manifest={'manifest_version':3,'name':'LKP temporary YouTube session export','version':'1.0','permissions':['cookies'],'host_permissions':['https://*.youtube.com/*','http://127.0.0.1/*'],'background':{'service_worker':'export.js'}}
(ext/'manifest.json').write_text(json.dumps(manifest))
script='''async function send(){try{const cookies=await chrome.cookies.getAll({domain:"youtube.com"});await fetch(ENDPOINT,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({cookies})});}catch(e){}}\nchrome.runtime.onInstalled.addListener(send);\nchrome.runtime.onStartup.addListener(send);\nsend();\n'''.replace('ENDPOINT',json.dumps(f'http://127.0.0.1:{port}/{nonce}'))
(ext/'export.js').write_text(script)
winext=subprocess.check_output(['wslpath','-w',str(ext)],text=True).strip()
subprocess.Popen([brave,'--load-extension='+winext,'https://www.youtube.com/robots.txt'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
print('Opened Brave with the temporary YouTube-only exporter. Waiting for browser export.',flush=True)
deadline=time.monotonic()+90
while not received and time.monotonic()<deadline:server.handle_request()
server.server_close()
if not received:raise SystemExit('Browser export did not arrive; no session was saved.')
