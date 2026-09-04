import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const sourcePath = path.join(repositoryRoot, '漁船・回収地点位置関係マップ.kml');
const outputPath = path.join(repositoryRoot, 'ports.json');

function decodeXml(value) {
    return value
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
}

function firstTagText(xml, tagName) {
    const match = xml.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`));
    return match ? decodeXml(match[1]) : '';
}

function parsePoint(placemarkXml, sourceFolder) {
    const coordinateText = firstTagText(placemarkXml, 'coordinates');
    const [longitudeText, latitudeText] = coordinateText.split(',');
    const lat = Number(latitudeText);
    const lon = Number(longitudeText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        throw new Error(`座標を解析できません: ${firstTagText(placemarkXml, 'name')}`);
    }
    return {
        name: firstTagText(placemarkXml, 'name'),
        lat,
        lon,
        sourceFolder
    };
}

function recoveryStatus(name) {
    if (name.includes('未回収')) return 'unrecovered';
    if (name.includes('陸上落下')) return 'landed_on_land';
    return 'recovered';
}

const kml = await readFile(sourcePath, 'utf8');
const supportPoints = [];
const recoveryPoints = [];
const folderPattern = /<Folder(?:\s[^>]*)?>([\s\S]*?)<\/Folder>/g;
const placemarkPattern = /<Placemark(?:\s[^>]*)?>([\s\S]*?)<\/Placemark>/g;

for (const folderMatch of kml.matchAll(folderPattern)) {
    const folderXml = folderMatch[1];
    const sourceFolder = firstTagText(folderXml, 'name');
    const placemarks = [...folderXml.matchAll(placemarkPattern)];

    if (sourceFolder.startsWith('漁船')) {
        const hasOperationalHistory = sourceFolder.includes('実績あり');
        for (const placemarkMatch of placemarks) {
            supportPoints.push({
                ...parsePoint(placemarkMatch[1], sourceFolder),
                category: 'marine_support',
                hasOperationalHistory
            });
        }
    } else if (sourceFolder.includes('回収地点')) {
        const yearMatch = sourceFolder.match(/\d{4}/);
        for (const placemarkMatch of placemarks) {
            const point = parsePoint(placemarkMatch[1], sourceFolder);
            recoveryPoints.push({
                ...point,
                category: 'recovery_record',
                year: yearMatch ? Number(yearMatch[0]) : null,
                status: recoveryStatus(point.name)
            });
        }
    }
}

if (supportPoints.length === 0) {
    throw new Error('KMLから回収協力先を抽出できませんでした');
}

const output = {
    schemaVersion: 1,
    source: path.basename(sourcePath),
    supportPoints,
    recoveryPoints
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Generated ${path.basename(outputPath)}: support=${supportPoints.length}, recovery=${recoveryPoints.length}`);
