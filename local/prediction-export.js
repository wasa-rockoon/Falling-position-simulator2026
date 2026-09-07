'use strict';
const exportsApi = require('../js/core/export-service');
function predictionExport(data, format) {
    if (!['csv','kml'].includes(format) || !Array.isArray(data.prediction)) throw new Error('予測結果の出力形式が不正です。');
    const trajectory = { label: 'Tawhiri', points: data.prediction.flatMap(stage => (stage.trajectory || []).map(point => ({ latitude: point.latitude, longitude: point.longitude, altitudeM: point.altitude, timeUtc: point.datetime }))) };
    return format === 'csv' ? exportsApi.trajectoryCsv(trajectory) : exportsApi.trajectoryKml(trajectory, 'Tawhiri prediction');
}
module.exports = { predictionExport };
