// SPDX-License-Identifier: AGPL-3.0-only
import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../web/dist');
const host=process.env.NONVERBA_BIND||'127.0.0.1';
const port=Number(process.env.NONVERBA_PORT||4173);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.json':'application/json'};
const server=http.createServer(async(req,res)=>{
  try{
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
    const url=new URL(req.url,'http://localhost');const requested=decodeURIComponent(url.pathname);
    const relative=requested==='/'?'index.html':requested.replace(/^\/+/, '');
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    if(!(await stat(file)).isFile()){res.writeHead(404);return res.end();}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Permissions-Policy':'camera=(self), microphone=(self), geolocation=(self)','Referrer-Policy':'no-referrer','Cross-Origin-Opener-Policy':'same-origin'});
    res.end(req.method==='HEAD'?undefined:await readFile(file));
  }catch{res.writeHead(404,{'Content-Type':'text/plain'});res.end('Not found');}
});
server.listen(port,host,()=>console.log(`Non-verba camera: http://${host}:${port}`));
