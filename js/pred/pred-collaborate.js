/*
 * Collaboration Features
 * - Share Link (Copy to Clipboard)
 * - Export Image (html2canvas)
 */

$(document).ready(function () {
    $('#share_url').click(function () {
        copyLinkToClipboard();
    });

    $('#export_img').click(function () {
        exportResultImage();
    });
});

function copyLinkToClipboard() {
    // Ensure the URL is up-to-date with current settings
    // We can trigger runPrediction's URL update logic, or just manually construct it if needed.
    // However, runPrediction updates the history state. 
    // Let's assume the user has run the prediction or the URL is current.
    // If not, we might want to force a URL update without running prediction?
    // For now, let's grab the current window.location.href

    var url = window.location.href;

    // Copy to clipboard
    navigator.clipboard.writeText(url).then(function () {
        // Show success message (Tipsy or simple alert)
        alert("URLをクリップボードにコピーしました！\n\n" + url);
    }, function (err) {
        console.error('Could not copy text: ', err);
        alert("コピーに失敗しました。");
    });
}

function exportResultImage() {
    // Use html2canvas to capture the map_canvas
    var element = document.getElementById('map_canvas');

    // We want to capture the map, but maybe also the overlay info?
    // The scenario_info is separate.
    // Let's modify the body to capture everything or just the map.
    // Capturing 'body' might be too much (includes scrollbars etc).
    // Let's capture map_canvas and overlay 'scenario_info' on top if possible?
    // html2canvas takes a DOM element.

    // To enable cross-origin images (tiles), we need useCORS: true
    // And the tile server must support CORS (OSM/Mapbox usually do).

    html2canvas(document.body, { /* capture full body to include UI overlays */
        useCORS: true,
        allowTaint: true,
        ignoreElements: (element) => {
            // Ignore headers, buttons that strictly shouldn't be in the screenshot?
            // Maybe ignore the 'input_form' if it's open? User might want it.
            return false;
        }
    }).then(function (canvas) {
        // Logically we want to trigger a download
        var link = document.createElement('a');
        link.download = 'prediction_result_' + moment().format("YYYYMMDD_HHmmss") + '.png';
        link.href = canvas.toDataURL("image/png");
        link.click();
    }).catch(function (err) {
        console.error("Export failed:", err);
        alert("画像の保存に失敗しました。");
    });
}
