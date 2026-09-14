// Offline reference generation using the original pinned image, no pull/download.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.dirname(fileURLToPath(import.meta.url));
const fix=path.join(root,'fixtures');
const suite=JSON.parse(fs.readFileSync(path.join(fix,'validation-suite.json')));
const baseline=JSON.parse(fs.readFileSync(path.join(fix,'baseline.json')));
const check=process.argv.includes('--check');
execFileSync('docker',['image','inspect',baseline.image],{stdio:'ignore'});
for(const entry of suite.cases) {
    const output=check?entry.referenceFile.replace('.json','.check.json'):entry.referenceFile;
    const outputPath=path.join(fix,output);
    try {
        execFileSync('docker',['run','--rm','--network','none','--mount','type=bind,source='+root+',target=/poc',
            '--entrypoint','python3',baseline.image,'/poc/build-reference.py',
            '--case',entry.caseFile,'--output',output],{stdio:'inherit',timeout:60000});
        if(check) assert.deepEqual(fs.readFileSync(outputPath),fs.readFileSync(path.join(fix,entry.referenceFile)),entry.id);
    } finally {
        if(check&&fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
}
console.log(check?'All five references reproduced byte-for-byte.':'Five references generated offline.');
