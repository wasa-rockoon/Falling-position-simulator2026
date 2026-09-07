import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const destination=path.join(root,'desktop/.staging/simulator');
if (!destination.startsWith(root + path.sep) || path.basename(destination)!=='simulator') throw new Error('Invalid staging directory');
await fs.rm(destination,{recursive:true,force:true}); await fs.mkdir(destination,{recursive:true});
const html=await fs.readFile(path.join(root,'index.html'),'utf8');
const files=new Set(['LICENSE','index.html','cors-proxy.js','sw.js','manifest.json','favicon.ico','sites.json','ports.json', 'local/prediction-export.js','local/service.js','local/http-api.js','local/docker-compose.yml']);
for(const match of html.matchAll(/(?:src|href)=["']([^"'#?]+)["']/g)) if(!/^(?:https?:|data:)/.test(match[1])) files.add(match[1]);
for(const name of files){const source=path.resolve(root,name);if(!source.startsWith(root+path.sep)) throw new Error('Invalid asset path');try{if((await fs.stat(source)).isFile()){await fs.mkdir(path.dirname(path.join(destination,name)),{recursive:true});await fs.copyFile(source,path.join(destination,name));}}catch(e){if(e.code!=='ENOENT')throw e;}}
for(const name of ['js','css','images','data','local/scripts']) await fs.cp(path.join(root,name),path.join(destination,name),{recursive:true,filter: source=>!source.includes('__pycache__')&&!source.endsWith('_test.py')});
console.log('Desktop runtime staged without datasets, logs, or secrets.');
