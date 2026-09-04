import { readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
    path.join(repositoryRoot, 'js'),
    path.join(repositoryRoot, 'cors-proxy.js'),
    path.join(repositoryRoot, 'sw.js')
];

async function collectJavaScript(target) {
    const entries = await readdir(target, { withFileTypes: true }).catch(() => []);
    if (entries.length === 0) return target.endsWith('.js') ? [target] : [];
    const files = [];
    for (const entry of entries) {
        const child = path.join(target, entry.name);
        if (entry.isDirectory()) files.push(...await collectJavaScript(child));
        else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(child);
    }
    return files;
}

const files = (await Promise.all(targets.map(collectJavaScript))).flat();
for (const file of files) {
    await execFileAsync(process.execPath, ['--check', file]);
}
console.log(`Syntax OK: ${files.length} files`);
