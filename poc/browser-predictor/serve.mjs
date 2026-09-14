import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.bin':'application/octet-stream'};
export async function startServer(port=0) {
    const server=http.createServer(async(req,res)=>{
        try {
            const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
            const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
            if(!file.startsWith(root+path.sep)||!mime[path.extname(file)]) {res.writeHead(404).end();return;}
            const body=await fs.readFile(file);
            res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
            res.end(body);
        } catch {res.writeHead(404).end();}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
    const server=await startServer(4010);
    console.log('Phase 0: http://127.0.0.1:'+server.address().port+' (Ctrl+C to stop)');
}
