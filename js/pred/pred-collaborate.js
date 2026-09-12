/*
 * Collaboration Features
 * - Share Link (Copy to Clipboard)
 * - Export Image (html2canvas)
 */

var collaborationInitialized = false;
function initCollaborationUi() {
    if (collaborationInitialized) return;
    collaborationInitialized = true;
    $('#share_url').click(function () {
        copyLinkToClipboard();
    });

    $('#export_img').click(function () {
        exportResultImage();
    });
}
window.AppShell.registerInitializer('collaboration', initCollaborationUi, 40);

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
        showToast("URLをクリップボードにコピーしました！\n\n" + url, 'success', 4500);
    }, function (err) {
        console.error('Could not copy text: ', err);
        showToast("コピーに失敗しました。", 'error', 6000);
    });
}

function exportResultImage() {
    var button = document.getElementById('export_img');
    var viewportWidth = document.documentElement.clientWidth;
    var viewportHeight = document.documentElement.clientHeight;
    var scrollLeft = window.pageXOffset || document.documentElement.scrollLeft || 0;
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop || 0;

    if (button) {
        button.setAttribute('aria-busy', 'true');
        button.classList.add('is-busy');
    }
    document.documentElement.classList.add('image-export-in-progress');

    prepareMapForImageExport().then(function () {
        return html2canvas(document.body, {
            useCORS: true,
            allowTaint: false,
            backgroundColor: getComputedStyle(document.body).backgroundColor || '#ffffff',
            imageTimeout: 15000,
            logging: false,
            width: viewportWidth,
            height: viewportHeight,
            windowWidth: viewportWidth,
            windowHeight: viewportHeight,
            x: scrollLeft,
            y: scrollTop,
            scrollX: scrollLeft,
            scrollY: scrollTop,
            onclone: function (clonedDocument) {
                clonedDocument.documentElement.classList.add('image-export-in-progress');
                flattenLeafletSvgTransforms(clonedDocument);
            }
        });
    }).then(function (canvas) {
        // Logically we want to trigger a download
        var link = document.createElement('a');
        link.download = 'prediction_result_' + moment().format("YYYYMMDD_HHmmss") + '.png';
        link.href = canvas.toDataURL("image/png");
        link.click();
    }).catch(function (err) {
        console.error("Export failed:", err);
        showToast("画像の保存に失敗しました。", 'error', 6000);
    }).then(function () {
        finishImageExport(button);
    }, function (error) {
        finishImageExport(button);
        throw error;
    });
}

// Leaflet positions its SVG renderer with a CSS translate matching the
// viewBox origin. html2canvas can omit that translate while rasterising the
// SVG, which shifts paths, ellipses and SVG circle markers towards the upper
// left. Replace the translate with equivalent absolute offsets in the cloned
// document only; the live map remains untouched.
function flattenLeafletSvgTransforms(clonedDocument) {
    var renderers = clonedDocument.querySelectorAll('#map_canvas .leaflet-overlay-pane svg.leaflet-zoom-animated');
    Array.prototype.forEach.call(renderers, function (svg) {
        var values = String(svg.getAttribute('viewBox') || '').trim().split(/[ ,]+/).map(Number);
        if (values.length !== 4 || values.some(function (value) { return !isFinite(value); })) return;
        svg.style.transform = 'none';
        svg.style.webkitTransform = 'none';
        svg.style.left = values[0] + 'px';
        svg.style.top = values[1] + 'px';
    });
}

function prepareMapForImageExport() {
    if (typeof map !== 'undefined' && map) {
        if (typeof map.stop === 'function') map.stop();
        if (typeof map.invalidateSize === 'function') map.invalidateSize({ pan: false, animate: false });
    }
    return waitForAnimationFrames(2).then(function () {
        return waitForVisibleMapTiles(8000);
    }).then(function () {
        // Tile completion may change pane dimensions. Reproject vector paths once
        // more immediately before html2canvas clones the document.
        if (typeof map !== 'undefined' && map && typeof map.invalidateSize === 'function') {
            map.invalidateSize({ pan: false, animate: false });
        }
        return waitForAnimationFrames(2);
    });
}

function waitForAnimationFrames(count) {
    return new Promise(function (resolve) {
        function next() {
            if (count <= 0) {
                resolve();
                return;
            }
            count -= 1;
            window.requestAnimationFrame(next);
        }
        next();
    });
}

function waitForVisibleMapTiles(timeoutMs) {
    var tiles = Array.prototype.slice.call(document.querySelectorAll('#map_canvas img.leaflet-tile'));
    var pending = tiles.filter(function (tile) {
        // A completed tile with naturalWidth=0 has already failed and will not
        // emit another event; do not make every export wait for the timeout.
        return !tile.complete;
    });
    if (pending.length === 0) return Promise.resolve();

    return new Promise(function (resolve) {
        var settled = false;
        var remaining = pending.length;
        var timer = window.setTimeout(done, timeoutMs);

        function done() {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            pending.forEach(function (tile) {
                tile.removeEventListener('load', onTileSettled);
                tile.removeEventListener('error', onTileSettled);
            });
            resolve();
        }

        function onTileSettled() {
            remaining -= 1;
            if (remaining <= 0) done();
        }

        pending.forEach(function (tile) {
            tile.addEventListener('load', onTileSettled, { once: true });
            tile.addEventListener('error', onTileSettled, { once: true });
        });
    });
}

function finishImageExport(button) {
    document.documentElement.classList.remove('image-export-in-progress');
    if (button) {
        button.removeAttribute('aria-busy');
        button.classList.remove('is-busy');
    }
}
