/*
 * 放球ウィンドウ互換入口。
 * 時刻候補の比較実行・見積り・中断・保存は放球自動探索へ統合しています。
 */
var _launchWindowUIInitialized = false;

function runLaunchWindowAnalysis() {
    if (typeof showAutoSearchWeatherPreset === 'function') return showAutoSearchWeatherPreset();
    if (typeof showToast === 'function') showToast('放球自動探索を初期化しています。', 'info', 1800);
    return null;
}

function clearLaunchWindowAnalysis() {
    if (typeof hideAutoSearchModal === 'function') hideAutoSearchModal();
}

function initLaunchWindowUI() {
    if (_launchWindowUIInitialized) return;
    _launchWindowUIInitialized = true;
    var runButton = document.getElementById('launch_window_run_btn');
    if (runButton) runButton.addEventListener('click', runLaunchWindowAnalysis);
}

window.AppShell.registerInitializer('launch-window', initLaunchWindowUI, 50);