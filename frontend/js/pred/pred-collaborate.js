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

    // Count tile images inside the map. If there are too many tiles,
    // html2canvas may try to inline many images which can trigger
    // external limits. In that case temporarily hide tile images
    // so overlays are captured without tile tiles to avoid large
    // image batches.
    var tileImgs = element.querySelectorAll('img.leaflet-tile');
    var tooManyTiles = tileImgs.length > 50;

    function doCapture() {
        html2canvas(element, {
            useCORS: true,
            allowTaint: true,
            imageTimeout: 5000
        }).then(function (canvas) {
            var link = document.createElement('a');
            link.download = 'prediction_result_' + moment().format("YYYYMMDD_HHmmss") + '.png';
            link.href = canvas.toDataURL("image/png");
            link.click();
        }).catch(function (err) {
            console.error("Export failed:", err);
            alert("画像の保存に失敗しました。");
        }).finally(function () {
            // restore tiles if hidden
            if (tooManyTiles) {
                tileImgs.forEach(function (img) { img.style.visibility = ''; });
            }
        });
    }

    if (tooManyTiles) {
        if (!confirm('地図タイルが多数検出されました。タイルを一時的に非表示にしてオーバーレイのみを保存しますか？ (はい=進める、いいえ=キャンセル)')) {
            return;
        }
        // hide tiles to avoid inlining many images
        tileImgs.forEach(function (img) { img.style.visibility = 'hidden'; });
        // small delay to allow rendering
        setTimeout(doCapture, 250);
    } else {
        doCapture();
    }
}
