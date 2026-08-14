(function (root) {
    'use strict';

    var ICONS = {
        success: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"></path></svg>',
        warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"></path></svg>',
        error: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"></path></svg>',
        info: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"></path></svg>'
    };

    function ensureContainer() {
        var container = document.getElementById('toast-container');
        if (!container && document.body) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }
        if (container) {
            container.setAttribute('aria-live', 'polite');
            container.setAttribute('aria-relevant', 'additions');
        }
        return container;
    }

    function dismiss(toast) {
        if (!toast || toast._dismissed) return;
        toast._dismissed = true;
        clearTimeout(toast._timer);
        toast.classList.add('toast-exit');
        setTimeout(function () {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }

    function show(message, type, duration) {
        var kind = ICONS[type] ? type : 'info';
        var container = ensureContainer();
        if (!container) return null;
        var toast = document.createElement('div');
        toast.className = 'toast toast-' + kind;
        toast.setAttribute('role', kind === 'error' || kind === 'warning' ? 'alert' : 'status');

        var icon = document.createElement('span');
        icon.className = 'toast-icon';
        icon.innerHTML = ICONS[kind];
        var text = document.createElement('span');
        text.className = 'toast-message';
        text.textContent = String(message);
        var close = document.createElement('button');
        close.type = 'button';
        close.className = 'toast-close';
        close.setAttribute('aria-label', '通知を閉じる');
        close.innerHTML = '&times;';
        close.addEventListener('click', function () { dismiss(toast); });
        toast.appendChild(icon);
        toast.appendChild(text);
        toast.appendChild(close);
        container.appendChild(toast);

        var delay = Number(duration);
        toast._timer = setTimeout(function () { dismiss(toast); }, Number.isFinite(delay) && delay > 0 ? delay : 4000);
        return toast;
    }

    function report(error, context, userMessage, type) {
        var normalized = error instanceof Error ? error : new Error(String(error));
        var label = context ? '[' + context + '] ' : '';
        if (root.console && console.error) console.error(label + normalized.message, normalized);
        if (document && document.dispatchEvent) {
            document.dispatchEvent(new CustomEvent('app:error', { detail: { error: normalized, context: context || '' } }));
        }
        if (userMessage) show(userMessage, type || 'error', 6000);
        return normalized;
    }

    function reportNonFatal(error, context) {
        var normalized = error instanceof Error ? error : new Error(String(error));
        var label = context ? '[' + context + '] ' : '';
        if (root.console && console.warn) console.warn(label + normalized.message, normalized);
        document.dispatchEvent(new CustomEvent('app:warning', { detail: { error: normalized, context: context || '' } }));
        return normalized;
    }

    var unexpectedReported = new WeakSet();
    function reportUnexpected(error, context) {
        if (error && typeof error === 'object') {
            if (unexpectedReported.has(error)) return;
            unexpectedReported.add(error);
        }
        report(error, context, '予期しないエラーが発生しました。詳細は開発者コンソールを確認してください。', 'error');
    }

    root.AppNotifications = { show: show, dismiss: dismiss, report: report, reportNonFatal: reportNonFatal };
    root.reportNonFatalError = reportNonFatal;
    root.showToast = show;
    root.dismissToast = dismiss;
    root.reportAppError = report;

    root.addEventListener('error', function (event) {
        if (event.error) reportUnexpected(event.error, 'window.error');
    });
    root.addEventListener('unhandledrejection', function (event) {
        reportUnexpected(event.reason || new Error('Unhandled promise rejection'), 'unhandledrejection');
    });
}(typeof globalThis !== 'undefined' ? globalThis : this));
