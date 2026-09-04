(function (root) {
    'use strict';

    var initialized = false;
    var initializerSequence = 0;
    var featureInitializers = [];
    var registeredInitializers = new Set();
    var completedInitializers = new Set();
    var DARK_TILE = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    var DARK_TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';
    var darkTileLayer = null;
    var lightTileLayer = null;

    function report(error, context, userMessage, type) {
        if (root.AppNotifications) return root.AppNotifications.report(error, context, userMessage, type);
        if (root.console && console.error) console.error(context || 'app-shell', error);
        return error;
    }

    function readSetting(key) {
        try { return localStorage.getItem(key); }
        catch (error) { report(error, 'settings.read'); return null; }
    }

    function writeSetting(key, value) {
        try { localStorage.setItem(key, String(value)); }
        catch (error) { report(error, 'settings.write'); }
    }

    function invalidateMap() {
        setTimeout(function () {
            if (root.map && typeof root.map.invalidateSize === 'function') root.map.invalidateSize();
        }, 0);
    }

    function toggleCustomApiInput() {
        var select = document.getElementById('api_source');
        var input = document.getElementById('api_custom_url');
        if (!select || !input) return;
        var custom = select.value === 'custom';
        input.hidden = !custom;
        input.style.display = custom ? 'block' : 'none';
        input.setAttribute('aria-hidden', custom ? 'false' : 'true');
    }

    function switchTab(tabName) {
        var panelId = String(tabName).indexOf('panel-') === 0 ? String(tabName) : 'panel-' + tabName;
        document.querySelectorAll('.sidebar-tab[data-panel]').forEach(function (tab) {
            var selected = tab.getAttribute('data-panel') === panelId;
            tab.classList.toggle('active', selected);
            tab.setAttribute('aria-selected', selected ? 'true' : 'false');
            tab.tabIndex = selected ? 0 : -1;
        });
        document.querySelectorAll('.sidebar-panel').forEach(function (panel) {
            var selected = panel.id === panelId;
            panel.classList.toggle('active', selected);
            panel.hidden = !selected;
        });
    }

    function initSidebar() {
        var sidebar = document.getElementById('app-sidebar');
        var toggle = document.getElementById('sidebar-toggle');
        var tabList = document.querySelector('.sidebar-tabs');
        if (sidebar) sidebar.setAttribute('aria-label', '予測ツール操作パネル');
        if (tabList) tabList.setAttribute('role', 'tablist');
        document.querySelectorAll('.sidebar-tab[data-panel]').forEach(function (tab) {
            var panelId = tab.getAttribute('data-panel');
            var panel = document.getElementById(panelId);
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-controls', panelId);
            if (!tab.id) tab.id = 'tab-' + panelId;
            if (panel) {
                panel.setAttribute('role', 'tabpanel');
                panel.setAttribute('aria-labelledby', tab.id);
            }
            tab.addEventListener('click', function () { switchTab(panelId); });
            tab.addEventListener('keydown', function (event) {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                var tabs = Array.from(document.querySelectorAll('.sidebar-tab[data-panel]'));
                var index = tabs.indexOf(tab);
                var direction = event.key === 'ArrowRight' ? 1 : -1;
                var next = tabs[(index + direction + tabs.length) % tabs.length];
                switchTab(next.getAttribute('data-panel'));
                next.focus();
                event.preventDefault();
            });
        });
        var active = document.querySelector('.sidebar-tab[data-panel].active') || document.querySelector('.sidebar-tab[data-panel]');
        if (active) switchTab(active.getAttribute('data-panel'));

        if (toggle) {
            toggle.type = 'button';
            toggle.setAttribute('aria-controls', 'app-sidebar');
            function updateToggle() {
                var open = document.body.classList.contains('sidebar-open');
                toggle.textContent = open ? '≪' : '≫';
                toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
                toggle.setAttribute('aria-label', open ? 'サイドバーを閉じる' : 'サイドバーを開く');
            }
            toggle.addEventListener('click', function () {
                document.body.classList.toggle('sidebar-open');
                updateToggle();
                setTimeout(invalidateMap, 300);
            });
            updateToggle();
        }
    }

    function isDark() {
        var html = document.documentElement;
        return html.classList.contains('dark-mode') || (!html.classList.contains('light-mode') && root.matchMedia('(prefers-color-scheme: dark)').matches);
    }

    function applyMapTile() {
        if (!root.map || !root.L || !root.L.TileLayer) return;
        if (isDark()) {
            if (!darkTileLayer) darkTileLayer = root.L.tileLayer(DARK_TILE, { attribution: DARK_TILE_ATTR, maxZoom: 19 });
            root.map.eachLayer(function (layer) {
                if (layer instanceof root.L.TileLayer && layer !== darkTileLayer) {
                    lightTileLayer = layer;
                    root.map.removeLayer(layer);
                }
            });
            if (!root.map.hasLayer(darkTileLayer)) darkTileLayer.addTo(root.map);
        } else {
            if (darkTileLayer && root.map.hasLayer(darkTileLayer)) root.map.removeLayer(darkTileLayer);
            if (lightTileLayer && !root.map.hasLayer(lightTileLayer)) lightTileLayer.addTo(root.map);
        }
    }

    function initTheme() {
        var html = document.documentElement;
        var saved = readSetting('dark-mode');
        if (saved === 'true') html.classList.add('dark-mode');
        else if (saved === 'false') html.classList.add('light-mode');
        var toggles = Array.from(document.querySelectorAll('[data-theme-toggle]'));
        function updateLabels() {
            var dark = isDark();
            toggles.forEach(function (button) {
                button.setAttribute('aria-pressed', dark ? 'true' : 'false');
                if (button.id === 'mobile_dark_mode_toggle') button.textContent = dark ? 'ライト' : 'ダーク';
                if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', dark ? 'ライトモードへ切替' : 'ダークモードへ切替');
            });
        }
        function toggleTheme() {
            var currentlyDark = isDark();
            html.classList.toggle('dark-mode', !currentlyDark);
            html.classList.toggle('light-mode', currentlyDark);
            writeSetting('dark-mode', currentlyDark ? 'false' : 'true');
            applyMapTile();
            updateLabels();
            if (root.showToast) root.showToast(currentlyDark ? 'ライトモードに切替' : 'ダークモードに切替', 'info', 2000);
        }
        toggles.forEach(function (button) { button.addEventListener('click', toggleTheme); });
        var scheme = root.matchMedia('(prefers-color-scheme: dark)');
        if (scheme && scheme.addEventListener) scheme.addEventListener('change', function () {
            if (readSetting('dark-mode') == null) {
                applyMapTile();
                updateLabels();
            }
        });
        updateLabels();
        setTimeout(applyMapTile, 1500);
    }

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function enablePanelDrag(panel, handle, guard) {
        if (!panel || !handle || handle.dataset.dragBound === 'true') return;
        handle.dataset.dragBound = 'true';
        var dragging = false;
        var offsetX = 0;
        var offsetY = 0;
        handle.style.cursor = 'grab';
        function move(event) {
            if (!dragging) return;
            var maxLeft = Math.max(0, root.innerWidth - panel.offsetWidth);
            var maxTop = Math.max(0, root.innerHeight - Math.min(panel.offsetHeight, root.innerHeight));
            panel.style.left = clamp(event.clientX - offsetX, 0, maxLeft) + 'px';
            panel.style.top = clamp(event.clientY - offsetY, 0, maxTop) + 'px';
        }
        function stop() {
            if (!dragging) return;
            dragging = false;
            handle.style.cursor = 'grab';
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', stop);
        }
        handle.addEventListener('pointerdown', function (event) {
            if ((guard && !guard()) || event.target.closest('button, a, input, select')) return;
            var rect = panel.getBoundingClientRect();
            dragging = true;
            handle.style.cursor = 'grabbing';
            panel.style.left = rect.left + 'px';
            panel.style.top = rect.top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            document.addEventListener('pointermove', move);
            document.addEventListener('pointerup', stop);
            event.preventDefault();
        });
    }

    function initSidebarResize() {
        var handle = document.getElementById('sidebar-resize-handle');
        var sidebar = document.getElementById('app-sidebar');
        if (!handle || !sidebar) return;
        var saved = Number(readSetting('sidebar-width'));
        if (Number.isFinite(saved) && saved >= 280 && saved <= 700) document.documentElement.style.setProperty('--sidebar-width', saved + 'px');
        var resizing = false;
        var startX = 0;
        var startWidth = 0;
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-label', 'サイドバー幅を変更');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.tabIndex = 0;
        function setWidth(width) {
            var next = clamp(width, 280, 700);
            document.documentElement.style.setProperty('--sidebar-width', next + 'px');
            handle.setAttribute('aria-valuenow', String(Math.round(next)));
            return next;
        }
        handle.addEventListener('pointerdown', function (event) {
            resizing = true;
            startX = event.clientX;
            startWidth = sidebar.offsetWidth;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
            if (handle.setPointerCapture) handle.setPointerCapture(event.pointerId);
            event.preventDefault();
        });
        handle.addEventListener('pointermove', function (event) {
            if (!resizing) return;
            setWidth(startWidth + startX - event.clientX);
            invalidateMap();
        });
        function stopResize() {
            if (!resizing) return;
            resizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            writeSetting('sidebar-width', sidebar.offsetWidth);
            invalidateMap();
        }
        handle.addEventListener('pointerup', stopResize);
        handle.addEventListener('pointercancel', stopResize);
        handle.addEventListener('keydown', function (event) {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            var direction = event.key === 'ArrowLeft' ? 10 : -10;
            setWidth(sidebar.offsetWidth + direction);
            writeSetting('sidebar-width', sidebar.offsetWidth + direction);
            invalidateMap();
            event.preventDefault();
        });
        setWidth(sidebar.offsetWidth);
    }

    function initFloatingPanels() {
        var launchPanel = document.getElementById('launch_window_panel');
        enablePanelDrag(launchPanel, launchPanel && launchPanel.querySelector('.ensemble-stats-header'));

        var ensemblePanel = document.getElementById('ensemble_stats_panel');
        var ensembleToggle = document.getElementById('ensemble_stats_toggle');
        if (ensembleToggle && ensembleToggle.dataset.collapseBound !== 'true') {
            ensembleToggle.dataset.collapseBound = 'true';
            ensembleToggle.setAttribute('aria-expanded', 'true');
            ensembleToggle.addEventListener('click', function () {
                var body = ensemblePanel && ensemblePanel.querySelector('.ensemble-stats-body');
                if (!body) return;
                var expanding = body.hidden || body.style.display === 'none';
                body.hidden = !expanding;
                body.style.display = expanding ? 'block' : 'none';
                ensembleToggle.innerHTML = expanding ? '&minus;' : '&#43;';
                ensembleToggle.setAttribute('aria-expanded', expanding ? 'true' : 'false');
                ensemblePanel.style.maxHeight = expanding ? '90vh' : 'none';
                if (expanding) {
                    ensemblePanel.style.left = '';
                    ensemblePanel.style.bottom = '';
                    ensemblePanel.style.top = '';
                    ensemblePanel.style.right = '';
                } else if (root.innerWidth > 768) {
                    ensemblePanel.style.left = '8px';
                    ensemblePanel.style.bottom = '8px';
                    ensemblePanel.style.top = 'auto';
                    ensemblePanel.style.right = 'auto';
                }
            });
        }
        enablePanelDrag(ensemblePanel, ensemblePanel && ensemblePanel.querySelector('.ensemble-stats-header'), function () { return root.innerWidth > 768; });

        var metrics = document.getElementById('scenario_info_floating_container');
        var metricsAnchor = document.getElementById('metrics_restore_anchor');
        var popoutMetrics = document.getElementById('popout_metrics_btn');
        function updateMetricsButton(floating) {
            if (!popoutMetrics) return;
            popoutMetrics.textContent = floating ? 'RESULTSへ戻す' : '外に出す';
            popoutMetrics.setAttribute('aria-pressed', floating ? 'true' : 'false');
            popoutMetrics.title = floating ? 'シナリオ概要をRESULTSへ戻す' : 'シナリオ概要を地図上に表示';
        }
        function restoreMetrics() {
            if (!metrics || !metricsAnchor || !metricsAnchor.parentNode) return;
            metricsAnchor.parentNode.insertBefore(metrics, metricsAnchor);
            metrics.classList.remove('floating-metrics-mode');
            metrics.style.left = '';
            metrics.style.top = '';
            updateMetricsButton(false);
        }
        function floatMetrics() {
            if (!metrics || root.innerWidth <= 768) return;
            document.body.appendChild(metrics);
            metrics.classList.add('floating-metrics-mode');
            updateMetricsButton(true);
        }
        if (popoutMetrics) {
            popoutMetrics.addEventListener('click', function () {
                if (metrics && metrics.classList.contains('floating-metrics-mode')) restoreMetrics();
                else floatMetrics();
            });
        }
        enablePanelDrag(metrics, metrics && metrics.querySelector('.scenario-summary-drag-handle'), function () {
            return root.innerWidth > 768 && metrics.classList.contains('floating-metrics-mode');
        });
        root.addEventListener('resize', function () {
            if (!metrics) return;
            if (root.innerWidth <= 768 && metrics.classList.contains('floating-metrics-mode')) restoreMetrics();
            if (popoutMetrics) popoutMetrics.hidden = root.innerWidth <= 768;
        });
        if (popoutMetrics) popoutMetrics.hidden = root.innerWidth <= 768;
        if (root.innerWidth > 768) floatMetrics();
    }

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        var localHost = root.location && (
            root.location.hostname === 'localhost' ||
            root.location.hostname === '127.0.0.1' ||
            root.location.hostname === '::1' ||
            root.location.hostname === '[::1]'
        );
        var localPwaEnabled = localHost && root.location.search && new URLSearchParams(root.location.search).get('pwa') === '1';
        if (localHost && !localPwaEnabled) {
            // Development files change independently. A cached shell can otherwise
            // combine old and new modules and silently stop prediction rendering.
            root.addEventListener('load', function () {
                navigator.serviceWorker.getRegistrations().then(function (registrations) {
                    return Promise.all(registrations.map(function (registration) { return registration.unregister(); }));
                }).catch(function (error) {
                    report(error, 'service-worker.local-unregister');
                });
                if (root.caches && typeof root.caches.keys === 'function') {
                    root.caches.keys().then(function (keys) {
                        return Promise.all(keys.filter(function (key) {
                            return key.indexOf('wasa-predictor-') === 0;
                        }).map(function (key) { return root.caches.delete(key); }));
                    }).catch(function (error) {
                        report(error, 'service-worker.local-cache-clear');
                    });
                }
            }, { once: true });
            return;
        }
        var reloadForUpdate = false;

        function offerUpdate(registration) {
            if (!registration.waiting || registration._wasaUpdateOffered) return;
            registration._wasaUpdateOffered = true;
            var toast = root.showToast ? root.showToast('新しいバージョンの準備ができました。', 'info', 30000) : null;
            if (!toast) return;
            var action = document.createElement('button');
            action.type = 'button';
            action.className = 'toast-action';
            action.textContent = '今すぐ更新';
            action.addEventListener('click', function () {
                reloadForUpdate = true;
                if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            });
            toast.insertBefore(action, toast.querySelector('.toast-close'));
        }

        root.addEventListener('load', function () {
            navigator.serviceWorker.addEventListener('controllerchange', function () {
                if (reloadForUpdate) root.location.reload();
            });
            navigator.serviceWorker.register('./sw.js').then(function (registration) {
                if (root.console && console.info) console.info('Service Worker scope:', registration.scope);
                offerUpdate(registration);
                registration.addEventListener('updatefound', function () {
                    var worker = registration.installing;
                    if (!worker) return;
                    worker.addEventListener('statechange', function () {
                        if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(registration);
                    });
                });
            }).catch(function (error) {
                report(error, 'service-worker.register', 'オフライン機能を開始できませんでした。オンライン機能は引き続き利用できます。', 'warning');
            });
        }, { once: true });
    }

    function initAccessibility() {
        var autoModal = document.getElementById('auto_search_modal');
        if (autoModal) {
            autoModal.setAttribute('role', 'dialog');
            autoModal.setAttribute('aria-modal', 'true');
            autoModal.setAttribute('aria-hidden', autoModal.style.display === 'none' ? 'true' : 'false');
            var title = autoModal.querySelector('h3');
            if (title) { title.id = title.id || 'auto_search_title'; autoModal.setAttribute('aria-labelledby', title.id); }
            var close = document.getElementById('auto_close_x');
            if (close) { close.type = 'button'; close.setAttribute('aria-label', '\u9589\u3058\u308b'); }
        }
        var launchPanel = document.getElementById('launch_window_panel');
        if (launchPanel) {
            launchPanel.setAttribute('role', 'region');
            launchPanel.setAttribute('aria-label', '\u653e\u7403\u30a6\u30a3\u30f3\u30c9\u30a6\u5206\u6790');
        }
        var mobileNav = document.getElementById('mobile_nav');
        if (mobileNav) mobileNav.setAttribute('aria-label', '\u30e2\u30d0\u30a4\u30eb\u64cd\u4f5c');
        ['run_auto_search_btn'].forEach(function (id) {
            var button = document.getElementById(id);
            if (button) button.setAttribute('type', 'button');
        });
    }

    function runInitializer(entry) {
        if (completedInitializers.has(entry.name)) return;
        completedInitializers.add(entry.name);
        try {
            entry.callback();
        } catch (error) {
            report(error, 'initializer.' + entry.name, '機能「' + entry.name + '」の初期化に失敗しました。', 'warning');
        }
    }

    function runFeatureInitializers() {
        featureInitializers.slice().sort(function (left, right) {
            return left.priority - right.priority || left.sequence - right.sequence;
        }).forEach(runInitializer);
    }

    function registerInitializer(name, callback, priority) {
        var normalizedName = String(name || '').trim();
        if (!normalizedName || typeof callback !== 'function') throw new TypeError('Initializer name and callback are required');
        if (registeredInitializers.has(normalizedName)) throw new Error('Initializer already registered: ' + normalizedName);
        registeredInitializers.add(normalizedName);
        var entry = {
            name: normalizedName,
            callback: callback,
            priority: Number.isFinite(Number(priority)) ? Number(priority) : 100,
            sequence: initializerSequence++
        };
        featureInitializers.push(entry);
        if (initialized && document.readyState !== 'loading') root.setTimeout(function () { runInitializer(entry); }, 0);
    }

    function init() {
        if (initialized) return;
        initialized = true;
        initAccessibility();
        initSidebar();
        initTheme();
        initSidebarResize();
        initFloatingPanels();
        toggleCustomApiInput();
        var apiSelect = document.getElementById('api_source');
        if (apiSelect) apiSelect.addEventListener('change', toggleCustomApiInput);
        runFeatureInitializers();
    }

    root.toggleCustomApiInput = toggleCustomApiInput;
    root.switchTab = switchTab;
    root.AppShell = { init: init, registerInitializer: registerInitializer, switchTab: switchTab, applyMapTile: applyMapTile };
    registerServiceWorker();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
}(typeof globalThis !== 'undefined' ? globalThis : this));
