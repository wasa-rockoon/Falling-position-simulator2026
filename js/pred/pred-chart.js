/*
 * Advanced Visualization - Altitude Profile using Chart.js
 */

var altitudeChart = null;
var isChartVisible = false;

function toggleChart() {
    isChartVisible = !isChartVisible;
    if (isChartVisible) {
        $("#chart_container").show();
        $("#showHideChart").text("高度グラフを非表示");
    } else {
        $("#chart_container").hide();
        $("#showHideChart").text("高度グラフを表示");
    }
}

function updateAltitudeChart(tawhiriPrediction) {
    var ctx = document.getElementById('altitude_chart').getContext('2d');

    // グラフが既に表示中の場合のみデータを更新（自動表示しない）
    // ユーザーが手動でトグルした場合のみ表示される

    // Parse data from Tawhiri prediction (Ascent + Descent)
    var dataPoints = [];
    var labels = [];

    // Tawhiri returns an array of stages. Usually [0] is ascent, [1] is descent/float.
    // We need to concat them and extract altitude and time.

    var startTime = null;

    tawhiriPrediction.forEach(function (stage) {
        stage.trajectory.forEach(function (point) {
            var t = moment.utc(point.datetime);
            if (!startTime) startTime = t;

            var minutesFromStart = t.diff(startTime, 'minutes');

            dataPoints.push({
                x: minutesFromStart, // Time in minutes from launch
                y: point.altitude   // Altitude in meters
            });

            // For labels, we might just use formatted time or relative time
            // Chart.js can handle 'linear' scale for x-axis if we parse it right.
        });
    });

    // Destroy existing chart if it exists
    if (altitudeChart) {
        altitudeChart.destroy();
    }

    altitudeChart = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: '高度 (m)',
                data: dataPoints,
                borderColor: 'rgba(54, 162, 235, 1)',
                backgroundColor: 'rgba(54, 162, 235, 0.2)',
                fill: true,
                pointRadius: 0, // Hide points for smooth line
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    title: {
                        display: true,
                        text: '経過時間 (分)'
                    }
                },
                y: {
                    title: {
                        display: true,
                        text: '高度 (m)'
                    }
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: '高度プロファイル (Altitude Profile)'
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        title: function (context) {
                            return context[0].parsed.x + ' 分後';
                        }
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                axis: 'x',
                intersect: false
            }
        }
    });
}

// ============================================================
// Wind Speed Graph
// ============================================================

var windChart = null;
var isWindChartVisible = false;

function toggleWindChart() {
    isWindChartVisible = !isWindChartVisible;
    if (isWindChartVisible) {
        $("#wind_chart_container").show();
        $("#showHideWindChart").text("風速グラフを非表示");
    } else {
        $("#wind_chart_container").hide();
        $("#showHideWindChart").text("風速グラフを表示");
    }
}

function updateWindChart(tawhiriPrediction) {
    var ctx = document.getElementById('wind_chart').getContext('2d');

    // グラフが既に表示中の場合のみデータを更新（自動表示しない）

    // Collect all trajectory points across stages
    var allPoints = [];
    tawhiriPrediction.forEach(function (stage) {
        stage.trajectory.forEach(function (point) {
            allPoints.push(point);
        });
    });

    // Compute wind speed between consecutive points
    var dataPoints = []; // { x: windSpeed (m/s), y: altitude (m) }

    for (var i = 1; i < allPoints.length; i++) {
        var p0 = allPoints[i - 1];
        var p1 = allPoints[i];

        var t0 = moment.utc(p0.datetime);
        var t1 = moment.utc(p1.datetime);
        var dt = t1.diff(t0, 'seconds');

        if (dt <= 0) continue;

        // Haversine distance in km, convert to m
        var lat0 = p0.latitude;
        var lon0 = p0.longitude > 180 ? p0.longitude - 360 : p0.longitude;
        var lat1 = p1.latitude;
        var lon1 = p1.longitude > 180 ? p1.longitude - 360 : p1.longitude;

        var distKm = parseFloat(distHaversine(
            L.latLng(lat0, lon0),
            L.latLng(lat1, lon1),
            1
        ));
        var distM = distKm * 1000;

        var windSpeed = distM / dt; // m/s (horizontal component only)
        var avgAlt = (p0.altitude + p1.altitude) / 2;

        dataPoints.push({
            x: windSpeed,
            y: avgAlt
        });
    }

    // Destroy existing chart
    if (windChart) {
        windChart.destroy();
    }

    windChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: '水平風速 (m/s)',
                data: dataPoints,
                borderColor: 'rgba(255, 99, 132, 1)',
                backgroundColor: 'rgba(255, 99, 132, 0.3)',
                pointRadius: 1.5,
                pointHoverRadius: 4,
                showLine: true,
                borderWidth: 1.5,
                fill: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    title: {
                        display: true,
                        text: '水平風速 (m/s)'
                    },
                    min: 0
                },
                y: {
                    title: {
                        display: true,
                        text: '高度 (m)'
                    },
                    min: 0
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: '高度別 水平風速プロファイル'
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return '高度: ' + context.parsed.y.toFixed(0) + 'm, 風速: ' + context.parsed.x.toFixed(1) + ' m/s';
                        }
                    }
                }
            },
            interaction: {
                mode: 'nearest',
                intersect: false
            }
        }
    });
}
