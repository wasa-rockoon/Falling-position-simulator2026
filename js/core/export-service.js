(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ExportService = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    function escapeCsv(value) {
        var text = value == null ? '' : String(value);
        return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    }

    function rowsToCsv(headers, rows) {
        var keys = headers.map(function (header) { return typeof header === 'string' ? header : header.key; });
        var labels = headers.map(function (header) { return typeof header === 'string' ? header : header.label; });
        return [labels].concat((rows || []).map(function (row) {
            return keys.map(function (key) { return row && row[key]; });
        })).map(function (row) { return row.map(escapeCsv).join(','); }).join('\r\n');
    }

    function pointValue(point, objectKey, arrayIndex) {
        if (Array.isArray(point)) return point[arrayIndex];
        return point && point[objectKey];
    }

    function trajectoryRows(trajectory) {
        var points = trajectory && (trajectory.points || trajectory.flightPath || trajectory.flight_path) || [];
        return points.map(function (point) {
            return {
                series: trajectory && (trajectory.label || trajectory.variantId || trajectory.id) || '',
                latitude: pointValue(point, 'latitude', 0),
                longitude: pointValue(point, 'longitude', 1),
                altitude_m: pointValue(point, 'altitudeM', 2),
                datetime_utc: point.timeUtc || point.datetimeUtc || ''
            };
        });
    }

    function runLandingCsv(record) {
        var rows = record && record.output && Array.isArray(record.output.landings) ? record.output.landings : [];
        return rowsToCsv([
            { key: 'seriesId', label: 'series' },
            { key: 'latitude', label: 'latitude' },
            { key: 'longitude', label: 'longitude' },
            { key: 'timeUtc', label: 'datetime_utc' },
            { key: 'classification', label: 'land_sea' },
            { key: 'coastDistanceKm', label: 'coast_distance_km' }
        ], rows.map(function (landing) {
            return Object.assign({}, landing, {
                classification: landing.landSea && landing.landSea.classification || '',
                coastDistanceKm: landing.landSea && landing.landSea.coastDistanceKm
            });
        }));
    }

    function trajectoryCsv(trajectory) {
        return rowsToCsv(['series', 'latitude', 'longitude', 'altitude_m', 'datetime_utc'], trajectoryRows(trajectory));
    }

    function autoSearchCsv(candidates) {
        var modeLabels = {
            fast: '高速探索（粗探索で除外）',
            full: '全候補精密探索（粗探索で除外しない）',
            ranked: '段階的精密探索（良い候補から実行）'
        };
        var rows = (candidates || []).map(function (candidate) {
            return {
                timeJst: candidate.timeJst,
                site: candidate.site,
                mode: modeLabels[candidate.mode] || candidate.mode,
                ascentRate: candidate.ascentRate,
                descentRate: candidate.descentRate,
                burstAltitude: candidate.burstAltitude,
                precipitationMm: candidate.precipitationMm,
                windSpeedMs: candidate.windSpeedMs,
                coarseReason: candidate.coarseReason,
                seaPct: candidate.seaPct,
                maxOffshoreKm: Number.isFinite(Number(candidate.maxOffshoreKm)) ? Number(candidate.maxOffshoreKm).toFixed(1) : '',
                supportName: candidate.supportName,
                supportDistanceKm: Number.isFinite(Number(candidate.supportDistanceKm)) ? Number(candidate.supportDistanceKm).toFixed(1) : '',
                supportHasHistory: candidate.supportHasHistory ? 'あり' : 'なし'
            };
        });
        return rowsToCsv([
            { key: 'timeJst', label: '日時(JST)' },
            { key: 'site', label: '地点' },
            { key: 'mode', label: '探索モード' },
            { key: 'ascentRate', label: '上昇速度(m/s)' },
            { key: 'descentRate', label: '下降速度(m/s)' },
            { key: 'burstAltitude', label: '破裂高度(m)' },
            { key: 'precipitationMm', label: '降水量(mm)' },
            { key: 'windSpeedMs', label: '地上風速(m/s)' },
            { key: 'coarseReason', label: '粗探索結果' },
            { key: 'seaPct', label: '海落ち率(%)' },
            { key: 'maxOffshoreKm', label: '最大沖合距離(km)' },
            { key: 'supportName', label: '最寄り回収協力先' },
            { key: 'supportDistanceKm', label: '協力先距離(km)' },
            { key: 'supportHasHistory', label: '回収実績あり' }
        ], rows);
    }

    function xml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character];
        });
    }

    function trajectoryKml(trajectories, name) {
        var list = Array.isArray(trajectories) ? trajectories : [trajectories];
        var placemarks = list.filter(Boolean).map(function (trajectory, index) {
            var points = trajectoryRows(trajectory);
            var coordinates = points.map(function (point) {
                return [point.longitude, point.latitude, point.altitude_m || 0].join(',');
            }).join(' ');
            return '<Placemark><name>' + xml(trajectory.label || trajectory.id || 'trajectory-' + (index + 1)) + '</name><LineString><altitudeMode>absolute</altitudeMode><coordinates>' + coordinates + '</coordinates></LineString></Placemark>';
        }).join('');
        return '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + xml(name || 'WASA prediction') + '</name>' + placemarks + '</Document></kml>';
    }

    function runKml(record) {
        var output = record && record.output || {};
        var kml = trajectoryKml(output.trajectories || [], record && record.title);
        var pointPlacemarks = (output.landings || []).map(function (landing) {
            var latitude = Number(landing.latitude);
            var longitude = Number(landing.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return '';
            return '<Placemark><name>' + xml(landing.seriesId || 'landing') + '</name><Point><coordinates>' + longitude + ',' + latitude + ',0</coordinates></Point></Placemark>';
        }).join('');
        return kml.replace('</Document>', pointPlacemarks + '</Document>');
    }
    function safeFilename(value) {
        return String(value || 'prediction').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 120);
    }

    function download(text, filename, mimeType) {
        if (!root.document || !root.URL || !root.Blob) throw new Error('ブラウザのダウンロード機能を利用できません');
        var blob = new root.Blob(['\ufeff' + text], { type: mimeType || 'text/plain;charset=utf-8' });
        var url = root.URL.createObjectURL(blob);
        var link = root.document.createElement('a');
        link.href = url;
        link.download = safeFilename(filename);
        link.hidden = true;
        root.document.body.appendChild(link);
        link.click();
        root.setTimeout(function () { root.URL.revokeObjectURL(url); link.remove(); }, 1000);
        return filename;
    }

    function exportRun(record, format) {
        if (!record) throw new Error('出力する実行履歴がありません');
        var base = safeFilename((record.title || record.type || 'prediction') + '_' + (record.id || 'run'));
        if (format === 'kml') {
            return download(runKml(record), base + '.kml', 'application/vnd.google-earth.kml+xml;charset=utf-8');
        }
        if (record.type === 'auto_search') {
            return download(autoSearchCsv(record.output && record.output.candidates), base + '.csv', 'text/csv;charset=utf-8');
        }
        return download(runLandingCsv(record), base + '.csv', 'text/csv;charset=utf-8');
    }

    return {
        escapeCsv: escapeCsv,
        rowsToCsv: rowsToCsv,
        trajectoryRows: trajectoryRows,
        trajectoryCsv: trajectoryCsv,
        autoSearchCsv: autoSearchCsv,
        trajectoryKml: trajectoryKml,
        runKml: runKml,
        runLandingCsv: runLandingCsv,
        download: download,
        exportRun: exportRun,
        safeFilename: safeFilename
    };
}));
