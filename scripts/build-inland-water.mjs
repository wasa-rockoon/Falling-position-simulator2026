import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SOURCE_URL = 'https://nlftp.mlit.go.jp/ksj/gml/data/W09/W09-05/W09-05_GML.zip';
const SOURCE_ZIP_SHA256 = 'e5d0f1bc77427c8c44a855ff361d3b9d94b76fe3c5e31a423ab9abc570950787';
const DATA_VERSION = 'ksj-w09-05-2005';
const SIMPLIFY_TOLERANCE_DEGREES = 0.0001;
const EXPECTED = { curves: 1240, orientedCurves: 1240, surfaces: 556, features: 556, holes: 667 };

const input = process.argv[2];
const output = process.argv[3] || path.resolve('data/inland_water_japan_w09_05.geojson');
if (!input) {
    console.error('Usage: node scripts/build-inland-water.mjs <W09-05-g.xml> [output.geojson]');
    process.exit(2);
}

const xml = fs.readFileSync(input, 'utf8');

function decodeXml(value) {
    return String(value || '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function squaredDistanceToSegment(point, first, second) {
    let x = first[0];
    let y = first[1];
    const dx = second[0] - x;
    const dy = second[1] - y;
    if (dx || dy) {
        let fraction = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
        fraction = Math.max(0, Math.min(1, fraction));
        x += dx * fraction;
        y += dy * fraction;
    }
    const offsetX = point[0] - x;
    const offsetY = point[1] - y;
    return offsetX * offsetX + offsetY * offsetY;
}

function simplifyOpen(points, first, last, toleranceSquared, outputPoints) {
    let maximum = toleranceSquared;
    let selected = -1;
    for (let index = first + 1; index < last; index += 1) {
        const distance = squaredDistanceToSegment(points[index], points[first], points[last]);
        if (distance > maximum) {
            selected = index;
            maximum = distance;
        }
    }
    if (selected >= 0) {
        simplifyOpen(points, first, selected, toleranceSquared, outputPoints);
        outputPoints.push(points[selected]);
        simplifyOpen(points, selected, last, toleranceSquared, outputPoints);
    }
}

function simplifyRing(points) {
    if (points.length <= 4) return points;
    const open = points.slice(0, -1);
    const simplified = [open[0]];
    simplifyOpen(open, 0, open.length - 1, SIMPLIFY_TOLERANCE_DEGREES ** 2, simplified);
    simplified.push(open.at(-1));
    simplified.push(simplified[0]);
    return simplified.length >= 4 ? simplified : points;
}

const curves = new Map();
for (const match of xml.matchAll(/<gml:Curve gml:id="([^"]+)">([\s\S]*?)<\/gml:Curve>/g)) {
    const values = (match[2].match(/<gml:posList>([\s\S]*?)<\/gml:posList>/)?.[1] || '')
        .trim().split(/\s+/).map(Number);
    const coordinates = [];
    for (let index = 0; index + 1 < values.length; index += 2) coordinates.push([values[index + 1], values[index]]);
    curves.set(match[1], coordinates);
}

const orientedCurves = new Map();
for (const match of xml.matchAll(/<gml:OrientableCurve gml:id="([^"]+)"(?:\s+orientation="([+-])")?>([\s\S]*?)<\/gml:OrientableCurve>/g)) {
    orientedCurves.set(match[1], {
        reference: match[3].match(/xlink:href="#([^"]+)"/)?.[1],
        reverse: match[2] === '-'
    });
}

function resolveRing(id) {
    const oriented = orientedCurves.get(id);
    const points = (curves.get(oriented?.reference || id) || []).map((coordinate) => coordinate.slice());
    if (oriented?.reverse) points.reverse();
    if (points.length && (points[0][0] !== points.at(-1)[0] || points[0][1] !== points.at(-1)[1])) {
        points.push(points[0].slice());
    }
    return simplifyRing(points);
}

const surfaces = new Map();
let holeCount = 0;
for (const match of xml.matchAll(/<gml:Surface gml:id="([^"]+)">([\s\S]*?)<\/gml:Surface>/g)) {
    const exterior = match[2].match(/<gml:exterior>[\s\S]*?xlink:href="#([^"]+)"[\s\S]*?<\/gml:exterior>/)?.[1];
    const interiors = [...match[2].matchAll(/<gml:interior>[\s\S]*?xlink:href="#([^"]+)"[\s\S]*?<\/gml:interior>/g)]
        .map((interior) => interior[1]);
    holeCount += interiors.length;
    surfaces.set(match[1], [resolveRing(exterior), ...interiors.map(resolveRing)].filter((ring) => ring.length >= 4));
}

function optionalNumber(block, tag) {
    const value = block.match(new RegExp(`<ksj:${tag}>([^<]+)</ksj:${tag}>`))?.[1];
    return value == null || value === '' ? null : Number(value);
}

const features = [];
for (const match of xml.matchAll(/<ksj:Lake gml:id="([^"]+)">([\s\S]*?)<\/ksj:Lake>/g)) {
    const surfaceId = match[2].match(/<ksj:bounds xlink:href="#([^"]+)"/)?.[1];
    const coordinates = surfaces.get(surfaceId);
    if (!coordinates?.length) continue;
    features.push({
        type: 'Feature',
        properties: {
            sourceId: match[1],
            name: decodeXml(match[2].match(/<ksj:lakeName>([\s\S]*?)<\/ksj:lakeName>/)?.[1] || ''),
            administrativeAreaCodes: [...match[2].matchAll(/<ksj:administrativeAreaCode[^>]*>([^<]+)<\/ksj:administrativeAreaCode>/g)].map((item) => item[1]),
            maxWaterDepthM: optionalNumber(match[2], 'maxWaterDepth'),
            elevationM: optionalNumber(match[2], 'elevationOfWater')
        },
        geometry: { type: 'Polygon', coordinates }
    });
}

const actual = {
    curves: curves.size,
    orientedCurves: orientedCurves.size,
    surfaces: surfaces.size,
    features: features.length,
    holes: holeCount
};
for (const [key, expected] of Object.entries(EXPECTED)) {
    if (actual[key] !== expected) throw new Error(`Unexpected W09 structure: ${key}=${actual[key]}, expected ${expected}`);
}

const collection = {
    type: 'FeatureCollection',
    name: 'inland_water_japan_w09_05',
    metadata: {
        dataVersion: DATA_VERSION,
        sourceUrl: SOURCE_URL,
        sourceZipSha256: SOURCE_ZIP_SHA256,
        sourceDate: '2005-09-01',
        coordinateReferenceSystem: 'JGD2000 / (B, L)',
        simplifyToleranceDegrees: SIMPLIFY_TOLERANCE_DEGREES
    },
    features
};

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(collection)}\n`, 'utf8');
console.log(`Generated ${output}: ${features.length} water polygons, ${holeCount} holes, ${fs.statSync(output).size} bytes.`);
