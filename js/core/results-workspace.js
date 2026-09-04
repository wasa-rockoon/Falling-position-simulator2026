(function (root, factory) {
    var api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.ResultsWorkspace = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    var initialized = false;
    var historyRequest = 0;
    var historyRefreshTimer = null;
    var deleteConfirmTimers = new Map();
    var VALID_VIEWS = ['overview', 'charts', 'history'];
    var TYPE_LABELS = {
        single: '単発予測',
        ehime_ensemble: '愛媛13条件',
        auto_search: '放球自動探索',
        uncertainty: '不確実性解析'
    };
    var STATUS_LABELS = {
        draft: '準備中',
        running: '実行中',
        pause_requested: '中断待ち',
        paused: '中断中',
        completed: '完了',
        partial: '一部完了',
        failed: '失敗',
        cancelled: '取消'
    };

    function element(id) {
        return root.document ? root.document.getElementById(id) : null;
    }

    function report(error, context) {
        if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(error, context);
        else if (root.console && root.console.error) root.console.error(context, error);
    }

    function typeLabel(type) {
        return TYPE_LABELS[type] || type || '実行';
    }

    function statusLabel(status) {
        return STATUS_LABELS[status] || status || '不明';
    }

    function percent(value) {
        if (value === null || value === undefined || value === '') return '-';
        var number = Number(value);
        return Number.isFinite(number) ? number.toFixed(number % 1 === 0 ? 0 : 1) + '%' : '-';
    }

    function formatJst(value) {
        if (!value) return '時刻不明';
        var date = new Date(value);
        if (!Number.isFinite(date.getTime())) return String(value);
        try {
            return new Intl.DateTimeFormat('ja-JP', {
                timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', hour12: false
            }).format(date) + ' JST';
        } catch (_error) {
            return date.toISOString();
        }
    }

    function rememberView(view) {
        try { if (root.localStorage) root.localStorage.setItem('results-active-view', view); }
        catch (error) { report(error, 'results.view.save'); }
    }

    function restoredView() {
        try {
            var value = root.localStorage && root.localStorage.getItem('results-active-view');
            return VALID_VIEWS.indexOf(value) >= 0 ? value : 'overview';
        } catch (error) {
            report(error, 'results.view.restore');
            return 'overview';
        }
    }

    function activate(view, options) {
        options = options || {};
        if (VALID_VIEWS.indexOf(view) < 0 || !root.document) return false;
        root.document.querySelectorAll('[data-results-view]').forEach(function (button) {
            var selected = button.getAttribute('data-results-view') === view;
            button.classList.toggle('active', selected);
            button.setAttribute('aria-selected', selected ? 'true' : 'false');
            button.tabIndex = selected ? 0 : -1;
        });
        root.document.querySelectorAll('[data-results-panel]').forEach(function (panel) {
            var selected = panel.getAttribute('data-results-panel') === view;
            panel.classList.toggle('active', selected);
            panel.hidden = !selected;
        });
        if (options.remember !== false) rememberView(view);
        if (view === 'history') refreshHistory();
        if (view === 'charts' && root.PredictionCharts && typeof root.PredictionCharts.render === 'function') root.PredictionCharts.render();
        return true;
    }

    function diagnosticsIsOpen() {
        var panel = element('scenario_template');
        return !!panel && panel.style.display !== 'none' && root.getComputedStyle(panel).display !== 'none';
    }

    function setDiagnosticsOpen(open, options) {
        options = options || {};
        var panel = element('scenario_template');
        if (!panel) return false;
        panel.style.display = open ? 'block' : 'none';
        panel.setAttribute('aria-hidden', open ? 'false' : 'true');
        ['diagnostics_toggle', 'showHideDebug', 'showHideDebug_status'].forEach(function (id) {
            var trigger = element(id);
            if (!trigger) return;
            trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
        var mainTrigger = element('diagnostics_toggle');
        if (mainTrigger) mainTrigger.classList.toggle('active', open);
        var resultTrigger = element('showHideDebug');
        if (resultTrigger) resultTrigger.textContent = open ? '診断ログを閉じる' : '診断ログ';
        if (open && options.focus !== false) {
            var close = element('diagnostics_close');
            if (close) close.focus();
        }
        return open;
    }

    function toggleDiagnostics() {
        return setDiagnosticsOpen(!diagnosticsIsOpen());
    }

    function appendText(parent, tag, className, text) {
        var child = root.document.createElement(tag);
        if (className) child.className = className;
        child.textContent = text;
        parent.appendChild(child);
        return child;
    }

    function updateStatusBadge(latest) {
        var badge = element('results_status_badge');
        if (!badge) return;
        var status = latest && latest.status || 'draft';
        badge.className = 'run-status-badge status-' + status;
        badge.textContent = latest ? statusLabel(status) : '未実行';
        badge.title = latest ? typeLabel(latest.type) + ' / ' + formatJst(latest.updatedAt) : 'まだ実行履歴がありません';
    }

    function isActiveStatus(status) {
        var active = root.RunRecord && Array.isArray(root.RunRecord.activeStatuses) ? root.RunRecord.activeStatuses : ['running', 'pause_requested', 'paused'];
        return active.indexOf(status) >= 0;
    }

    function historyMeta(item) {
        var parts = [typeLabel(item.type), formatJst(item.updatedAt)];
        if (item.launchPointLabel) parts.push(item.launchPointLabel);
        return parts.join(' · ');
    }

    function historySummary(item) {
        var summary = item.summary || {};
        var parts = [];
        if (Number(summary.landingCount) > 0) parts.push('着地点 ' + Number(summary.landingCount) + '件');
        if (summary.seaRate !== null && summary.seaRate !== undefined && Number.isFinite(Number(summary.seaRate))) parts.push('海上率 ' + percent(summary.seaRate));
        if (summary.unknownRate !== null && summary.unknownRate !== undefined && Number.isFinite(Number(summary.unknownRate)) && Number(summary.unknownRate) > 0) parts.push('不明 ' + percent(summary.unknownRate));
        if (summary.nearestSupportDistanceKm !== null && summary.nearestSupportDistanceKm !== undefined && Number.isFinite(Number(summary.nearestSupportDistanceKm))) parts.push('支援地点 ' + Number(summary.nearestSupportDistanceKm).toFixed(1) + ' km');
        return parts.length ? parts.join(' / ') : '保存済みの概要値はありません';
    }

    function clearDeleteConfirmation(runId, button) {
        var timer = deleteConfirmTimers.get(runId);
        if (timer) root.clearTimeout(timer);
        deleteConfirmTimers.delete(runId);
        if (button && button.isConnected) {
            button.dataset.confirmDelete = 'false';
            button.textContent = '削除';
        }
    }

    async function removeHistory(item, button) {
        if (!root.RunRepository || isActiveStatus(item.status)) return;
        if (button.dataset.confirmDelete !== 'true') {
            button.dataset.confirmDelete = 'true';
            button.textContent = 'もう一度押して削除';
            deleteConfirmTimers.set(item.runId, root.setTimeout(function () { clearDeleteConfirmation(item.runId, button); }, 5000));
            return;
        }
        clearDeleteConfirmation(item.runId, button);
        button.disabled = true;
        try {
            if (root.HistoryController && typeof root.HistoryController.hide === 'function') root.HistoryController.hide(item.runId);
            await root.RunRepository.remove(item.runId);
            if (root.showToast) root.showToast('実行履歴を削除しました。', 'info', 1800);
            await refreshHistory();
        } catch (error) {
            report(error, 'results.history.remove');
            if (root.showToast) root.showToast(error.message || '履歴を削除できませんでした。', 'warning', 2600);
            button.disabled = false;
        }
    }

    function renderHistoryItem(item) {
        var article = root.document.createElement('article');
        article.className = 'run-history-item' + (item.pinned ? ' is-pinned' : '');
        article.dataset.runId = item.runId;

        var header = appendText(article, 'div', 'run-history-item-header', '');
        appendText(header, 'strong', 'run-history-title', item.title || typeLabel(item.type));
        appendText(header, 'span', 'run-status-badge status-' + item.status, statusLabel(item.status));
        appendText(article, 'div', 'run-history-meta', historyMeta(item));
        appendText(article, 'div', 'run-history-summary', historySummary(item));

        var actions = appendText(article, 'div', 'run-history-actions', '');
        function addHistoryAction(label, operation, successMessage) {
            var button = appendText(actions, 'button', 'result-text-button', label);
            button.type = 'button';
            button.addEventListener('click', async function () {
                button.disabled = true;
                try {
                    await operation();
                    if (successMessage && root.showToast) root.showToast(successMessage, 'info', 1800);
                } catch (error) {
                    report(error, 'results.history.' + label);
                    if (root.showToast) root.showToast(error.message || '履歴を操作できませんでした。', 'warning', 2600);
                } finally {
                    button.disabled = false;
                }
            });
            return button;
        }
        if (root.HistoryController) {
            var hasMapData = item.type !== 'auto_search';
            var mapToggle = appendText(actions, 'button', 'result-text-button', root.HistoryController.isVisible(item.runId) ? '地図から消す' : '地図表示');
            mapToggle.type = 'button';
            mapToggle.setAttribute('aria-pressed', root.HistoryController.isVisible(item.runId) ? 'true' : 'false');
            mapToggle.addEventListener('click', async function () {
                mapToggle.disabled = true;
                try {
                    if (root.HistoryController.isVisible(item.runId)) {
                        root.HistoryController.hide(item.runId);
                        if (root.showToast) root.showToast('保存した結果を地図から消しました。履歴は保持されています。', 'info', 1800);
                    } else {
                        await root.HistoryController.show(item.runId);
                        if (root.showToast) root.showToast('保存した結果を地図に表示しました。', 'info', 1800);
                    }
                    var visible = root.HistoryController.isVisible(item.runId);
                    mapToggle.textContent = visible ? '地図から消す' : '地図表示';
                    mapToggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
                } catch (error) {
                    report(error, 'results.history.map');
                    if (root.showToast) root.showToast(error.message || '履歴を地図で操作できませんでした。', 'warning', 2600);
                } finally {
                    mapToggle.disabled = false;
                }
            });
            if (!hasMapData) mapToggle.remove();
            addHistoryAction('CSV', function () { return root.HistoryController.exportRecord(item.runId, 'csv'); });
            var kmlAction = addHistoryAction('KML', function () { return root.HistoryController.exportRecord(item.runId, 'kml'); });
            if (!hasMapData) kmlAction.remove();
            if (isActiveStatus(item.status)) addHistoryAction('再開', function () { return root.HistoryController.resume(item.runId); });
            else addHistoryAction('再実行準備', function () { return root.HistoryController.prepareRerun(item.runId); }, '保存した条件をSETTINGSへ反映しました。');
        }
        var pin = appendText(actions, 'button', 'result-text-button', item.pinned ? '固定解除' : '固定');
        pin.type = 'button';
        pin.setAttribute('aria-pressed', item.pinned ? 'true' : 'false');
        pin.addEventListener('click', async function () {
            pin.disabled = true;
            try {
                await root.RunRepository.setPinned(item.runId, !item.pinned);
                await refreshHistory();
            } catch (error) {
                report(error, 'results.history.pin');
                pin.disabled = false;
            }
        });
        var remove = appendText(actions, 'button', 'result-text-button result-text-button-danger', isActiveStatus(item.status) ? '実行中は削除不可' : '削除');
        remove.type = 'button';
        remove.disabled = isActiveStatus(item.status);
        remove.dataset.confirmDelete = 'false';
        remove.addEventListener('click', function () { removeHistory(item, remove); });
        return article;
    }

    async function refreshHistory() {
        var list = element('run_history_list');
        if (!list || !root.RunRepository || typeof root.RunRepository.listHistory !== 'function') return [];
        var requestId = ++historyRequest;
        list.setAttribute('aria-busy', 'true');
        try {
            var filter = element('run_history_filter');
            var selectedType = filter && filter.value || '';
            var allItems = await root.RunRepository.listHistory();
            var items = selectedType ? allItems.filter(function (item) { return item.type === selectedType; }) : allItems;
            if (requestId !== historyRequest) return items;
            updateStatusBadge(allItems[0] || null);
            list.replaceChildren();
            if (!items.length) {
                appendText(list, 'p', 'run-history-empty', selectedType ? 'この種類の実行履歴はありません。' : '保存された実行履歴はありません。');
            } else {
                items.forEach(function (item) { list.appendChild(renderHistoryItem(item)); });
            }
            list.setAttribute('aria-busy', 'false');
            return items;
        } catch (error) {
            if (requestId !== historyRequest) return [];
            report(error, 'results.history.list');
            list.replaceChildren();
            appendText(list, 'p', 'run-history-empty is-error', '実行履歴を読み込めませんでした。診断ログを確認してください。');
            list.setAttribute('aria-busy', 'false');
            return [];
        }
    }

    function scheduleHistoryRefresh() {
        if (historyRefreshTimer) root.clearTimeout(historyRefreshTimer);
        historyRefreshTimer = root.setTimeout(refreshHistory, 120);
    }

    function bindViewTabs() {
        root.document.querySelectorAll('[data-results-view]').forEach(function (button) {
            button.addEventListener('click', function () { activate(button.getAttribute('data-results-view')); });
            button.addEventListener('keydown', function (event) {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                var index = VALID_VIEWS.indexOf(button.getAttribute('data-results-view'));
                var nextView = VALID_VIEWS[(index + (event.key === 'ArrowRight' ? 1 : -1) + VALID_VIEWS.length) % VALID_VIEWS.length];
                activate(nextView);
                var next = root.document.querySelector('[data-results-view="' + nextView + '"]');
                if (next) next.focus();
                event.preventDefault();
            });
        });
    }

    function bindDiagnostics() {
        ['diagnostics_toggle', 'showHideDebug', 'showHideDebug_status'].forEach(function (id) {
            var trigger = element(id);
            if (trigger) trigger.addEventListener('click', toggleDiagnostics);
        });
        var close = element('diagnostics_close');
        if (close) close.addEventListener('click', function () { setDiagnosticsOpen(false); });
        root.document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && diagnosticsIsOpen()) setDiagnosticsOpen(false, { focus: false });
        });
        setDiagnosticsOpen(false, { focus: false });
    }

    function init() {
        if (initialized || !root.document) return;
        initialized = true;
        bindViewTabs();
        bindDiagnostics();
        var filter = element('run_history_filter');
        if (filter) filter.addEventListener('change', refreshHistory);
        var refresh = element('run_history_refresh');
        if (refresh) refresh.addEventListener('click', refreshHistory);
        root.addEventListener('wasa:run-repository-change', scheduleHistoryRefresh);
        root.addEventListener('wasa:map-display-cleared', scheduleHistoryRefresh);
        activate(restoredView(), { remember: false });
        refreshHistory();
    }

    if (root.AppShell && typeof root.AppShell.registerInitializer === 'function') {
        root.AppShell.registerInitializer('results-workspace', init, 15);
    }

    return {
        init: init,
        activate: activate,
        setDiagnosticsOpen: setDiagnosticsOpen,
        toggleDiagnostics: toggleDiagnostics,
        refreshHistory: refreshHistory,
        typeLabel: typeLabel,
        statusLabel: statusLabel,
        formatJst: formatJst,
        formatPercent: percent
    };
}));
