const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {isSimulator,allowedExternal}=require('../desktop/navigation');
const config=require('../forge.config');
test('desktop navigation rejects privileged protocols and lookalike origins',()=>{
 assert.equal(isSimulator('http://localhost:3100/?api_source=local'),true);
 for(const url of ['http://localhost:3100.evil.test/','file:///C:/secret','https://localhost:3100','javascript:alert(1)'])assert.equal(isSimulator(url),false);
 for(const url of ['file:///C:/secret','javascript:alert(1)','http://example.com','https://user:secret@example.com'])assert.equal(allowedExternal(url),false);
 assert.equal(allowedExternal('https://github.com/wasa-rockoon'),true);
});
test('desktop archive excludes local secrets and build outputs',()=>{
 for(const value of ['/local/.env','/local/.runtime/server.json','/desktop/.staging','/tests','/.git','/out','/docs'])assert.equal(config.packagerConfig.ignore(value),true,value);
 for(const value of ['/desktop','/desktop/main.js','/desktop/startup.html','/node_modules','/node_modules/electron-squirrel-startup/index.js','/package.json'])assert.equal(config.packagerConfig.ignore(value),false,value);
});
test('staged runtime contains required assets but no runtime secrets',()=>{
 const root=path.resolve(__dirname,'../desktop/.staging/simulator');
 if(!fs.existsSync(root))return;
 for(const item of ['index.html','cors-proxy.js','local/docker-compose.yml','local/scripts/weather_store.py','js/core/app-shell.js'])assert.ok(fs.existsSync(path.join(root,item)),item);
 for(const item of ['local/.env','local/.runtime','.git','node_modules'])assert.equal(fs.existsSync(path.join(root,item)),false,item);
});
