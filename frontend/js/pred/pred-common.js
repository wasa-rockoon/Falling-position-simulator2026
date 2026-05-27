/*
 * 共通ユーティリティ
 * - showToast
 * - getSettings
 * - 入力バリデーション
 * - プリセット保存/復元
 */

(function () {
    var PRESET_KEY = 'predictor_presets';
    var LAST_SETTINGS_KEY = 'predictor_last_settings';
    var PRESET_FIELDS = [
        'site', 'lat', 'lon', 'initial_alt',
        'year', 'month', 'day', 'hour', 'min',
        'ascent', 'burst', 'drag',
        'flight_profile', 'prediction_type', 'enable_drift', 'drift_hours',
        'api_source', 'api_custom_url'
    ];

    var VALIDATION_RULES = {
        lat: { min: -90, max: 90, label: '緯度' },
        lon: { min: -180, max: 360, label: '経度' },
        initial_alt: { min: 0, max: 50000, label: '高度' },
        ascent: { min: 0.1, max: 30, label: '上昇速度' },
        burst: { min: 100, max: 50000, label: 'バースト/浮遊高度' },
        drag: { min: 0.1, max: 40, label: '下降速度' },
        drift_hours: { min: 1, max: 168, label: '漂流時間' },
        year: { min: 2020, max: 2100, label: '年' },
        day: { min: 1, max: 31, label: '日' },
        hour: { min: 0, max: 23, label: '時' },
        min: { min: 0, max: 59, label: '分' }
    };

    function ensureToastContainer() {
        var c = document.getElementById('toast_container');
        if (c) return c;

        c = document.createElement('div');
        c.id = 'toast_container';
        c.style.position = 'fixed';
        c.style.top = '12px';
        c.style.right = '12px';
        c.style.zIndex = '1200';
        c.style.display = 'flex';
        c.style.flexDirection = 'column';
        c.style.gap = '8px';
        document.body.appendChild(c);
        return c;
    }

    window.showToast = function (message, type, durationMs) {
        var container = ensureToastContainer();
        var toast = document.createElement('div');
        var bg = '#3b82f6';
        if (type === 'success') bg = '#16a34a';
        if (type === 'warning') bg = '#f59e0b';
        if (type === 'error') bg = '#dc2626';

        toast.textContent = message;
        toast.style.background = bg;
        toast.style.color = '#ffffff';
        toast.style.padding = '8px 12px';
        toast.style.borderRadius = '8px';
        toast.style.boxShadow = '0 6px 18px rgba(0,0,0,0.2)';
        toast.style.fontSize = '12px';
        toast.style.maxWidth = '300px';
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 150ms ease';

        container.appendChild(toast);
        requestAnimationFrame(function () {
            toast.style.opacity = '1';
        });

        var duration = typeof durationMs === 'number' ? durationMs : 2200;
        setTimeout(function () {
            toast.style.opacity = '0';
            setTimeout(function () {
                if (toast.parentNode) toast.parentNode.removeChild(toast);
            }, 180);
        }, duration);
    };

    window.formatJstDateTime = function (dateLike) {
        var m = moment.utc(dateLike).clone().utcOffset(9 * 60);
        return m.format('YYYY-MM-DD HH:mm');
    };

    window.formatDecimal = function (val, digits) {
        var n = Number(val);
        if (!isFinite(n)) return '-';
        return n.toFixed(typeof digits === 'number' ? digits : 2);
    };

    window.getSettings = function () {
        var s = {};
        s.profile = $('#flight_profile').val();
        s.pred_type = $('#prediction_type').val();

        var year = parseInt($('#year').val(), 10);
        var month = parseInt($('#month').val(), 10);
        var day = parseInt($('#day').val(), 10);
        var hour = parseInt($('#hour').val(), 10);
        var min = parseInt($('#min').val(), 10);

        var launchLocal = moment([year, month - 1, day, hour, min, 0, 0]).utcOffset(9 * 60, true);
        s.launch_datetime = launchLocal.clone().utc().format();

        s.launch_latitude = parseFloat($('#lat').val());
        s.launch_longitude = parseFloat($('#lon').val());
        if (s.launch_longitude < 0) s.launch_longitude += 360;
        s.launch_altitude = parseFloat($('#initial_alt').val());
        s.ascent_rate = parseFloat($('#ascent').val());

        if (s.profile === 'standard_profile') {
            s.burst_altitude = parseFloat($('#burst').val());
            s.descent_rate = parseFloat($('#drag').val());
        } else {
            s.float_altitude = parseFloat($('#burst').val());
        }

        s.enable_drift = $('#enable_drift').is(':checked');
        s.drift_hours = parseInt($('#drift_hours').val(), 10);
        s.api_source = $('#api_source').val() || 'sondehub';
        s.api_custom_url = $('#api_custom_url').val() || '';
        return s;
    };

    function ensureValidationMessageEl(id) {
        var el = document.getElementById(id);
        if (el) return el;
        el = document.createElement('div');
        el.id = id;
        el.style.color = '#dc2626';
        el.style.fontSize = '11px';
        el.style.marginTop = '2px';
        el.style.display = 'none';
        return el;
    }

    window.validateField = function (inputEl) {
        if (!inputEl || !inputEl.id) return true;
        var rule = VALIDATION_RULES[inputEl.id];
        if (!rule) return true;

        var v = parseFloat(inputEl.value);
        var msgId = 'valid_' + inputEl.id;
        var msg = document.getElementById(msgId) || ensureValidationMessageEl(msgId);
        if (!msg.parentNode && inputEl.parentNode) {
            inputEl.parentNode.appendChild(msg);
        }

        if (!isFinite(v) || v < rule.min || v > rule.max) {
            inputEl.style.borderColor = '#dc2626';
            msg.textContent = rule.label + 'は ' + rule.min + '〜' + rule.max + ' の範囲で入力してください';
            msg.style.display = 'block';
            return false;
        }

        inputEl.style.borderColor = '';
        msg.textContent = '';
        msg.style.display = 'none';
        return true;
    };

    window.validateAllFields = function () {
        var ok = true;
        Object.keys(VALIDATION_RULES).forEach(function (id) {
            var el = document.getElementById(id);
            if (el && !window.validateField(el)) ok = false;
        });

        var burstEl = document.getElementById('burst');
        var initAltEl = document.getElementById('initial_alt');
        if (burstEl && initAltEl) {
            var burst = parseFloat(burstEl.value);
            var initAlt = parseFloat(initAltEl.value);
            if (isFinite(burst) && isFinite(initAlt) && burst <= initAlt) {
                ok = false;
                burstEl.style.borderColor = '#dc2626';
                var msgId = 'valid_burst';
                var msg = document.getElementById(msgId) || ensureValidationMessageEl(msgId);
                if (!msg.parentNode && burstEl.parentNode) burstEl.parentNode.appendChild(msg);
                msg.textContent = 'バースト/浮遊高度は打ち上げ高度より高くしてください';
                msg.style.display = 'block';
            }
        }

        return ok;
    };

    function getFormValues() {
        var values = {};
        PRESET_FIELDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            values[id] = el.type === 'checkbox' ? el.checked : el.value;
        });
        return values;
    }

    function applyFormValues(values) {
        PRESET_FIELDS.forEach(function (id) {
            var el = document.getElementById(id);
            if (!el || values[id] === undefined) return;
            if (el.type === 'checkbox') {
                el.checked = values[id] === true || values[id] === 'true' || values[id] === 1 || values[id] === '1';
            } else {
                el.value = values[id];
            }

            if (id === 'month' || id === 'site' || id === 'api_source' || id === 'prediction_type') {
                $(el).change();
            }
            if ((id === 'lat' || id === 'lon') && typeof plotClick === 'function') {
                plotClick();
            }
            if (typeof window.validateField === 'function') {
                window.validateField(el);
            }
        });

        if (typeof toggleCustomApiInput === 'function') {
            toggleCustomApiInput();
        }
    }

    function loadPresets() {
        try {
            var raw = localStorage.getItem(PRESET_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (_e) {
            return [];
        }
    }

    function savePresets(presets) {
        localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
    }

    function updatePresetUI() {
        var select = document.getElementById('preset_select');
        if (!select) return;

        var oldVal = select.value;
        var presets = loadPresets();
        select.innerHTML = '<option value="">-- プリセット選択 --</option>';

        presets.forEach(function (p) {
            var opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = p.name;
            select.appendChild(opt);
        });

        if (oldVal) select.value = oldVal;
    }

    function savePreset(name) {
        var presets = loadPresets();
        var values = getFormValues();
        var updated = false;

        for (var i = 0; i < presets.length; i++) {
            if (presets[i].name === name) {
                presets[i].values = values;
                updated = true;
                break;
            }
        }

        if (!updated) {
            presets.push({ name: name, values: values });
        }

        savePresets(presets);
        updatePresetUI();
        showToast('プリセットを保存しました', 'success', 1800);
    }

    function deletePreset(name) {
        var presets = loadPresets().filter(function (p) {
            return p.name !== name;
        });
        savePresets(presets);
        updatePresetUI();
        showToast('プリセットを削除しました', 'warning', 1800);
    }

    window.saveLastSettings = function () {
        localStorage.setItem(LAST_SETTINGS_KEY, JSON.stringify(getFormValues()));
    };

    function restoreLastSettings() {
        try {
            var raw = localStorage.getItem(LAST_SETTINGS_KEY);
            if (!raw) {
                showToast('前回設定はありません', 'warning', 1800);
                return;
            }
            applyFormValues(JSON.parse(raw));
            showToast('前回設定を復元しました', 'success', 1800);
        } catch (_e) {
            showToast('前回設定の復元に失敗しました', 'error', 2200);
        }
    }

    function bindValidationEvents() {
        Object.keys(VALIDATION_RULES).forEach(function (id) {
            var el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', function () {
                window.validateField(el);
            });
            el.addEventListener('blur', function () {
                window.validateField(el);
            });
        });
    }

    function bindPresetEvents() {
        var loadBtn = document.getElementById('preset_load_btn');
        var saveBtn = document.getElementById('preset_save_btn');
        var deleteBtn = document.getElementById('preset_delete_btn');
        var restoreBtn = document.getElementById('preset_restore_btn');
        var select = document.getElementById('preset_select');

        if (!select) return;

        updatePresetUI();

        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                var nameEl = document.getElementById('preset_name');
                var name = nameEl ? (nameEl.value || '').trim() : '';
                if (!name) {
                    showToast('保存名を入力してください', 'warning', 1800);
                    return;
                }
                savePreset(name);
                if (nameEl) nameEl.value = '';
            });
        }

        if (loadBtn) {
            loadBtn.addEventListener('click', function () {
                var name = select.value;
                if (!name) {
                    showToast('プリセットを選択してください', 'warning', 1800);
                    return;
                }
                var presets = loadPresets();
                var target = null;
                for (var i = 0; i < presets.length; i++) {
                    if (presets[i].name === name) {
                        target = presets[i];
                        break;
                    }
                }
                if (!target) {
                    showToast('プリセットが見つかりません', 'error', 1800);
                    return;
                }
                applyFormValues(target.values);
                showToast('プリセットを読み込みました', 'success', 1800);
            });
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', function () {
                var name = select.value;
                if (!name) {
                    showToast('削除するプリセットを選択してください', 'warning', 1800);
                    return;
                }
                if (!window.confirm('プリセット「' + name + '」を削除しますか？')) return;
                deletePreset(name);
            });
        }

        if (restoreBtn) {
            restoreBtn.addEventListener('click', function () {
                restoreLastSettings();
            });
        }
    }

    $(function () {
        bindValidationEvents();
        bindPresetEvents();
    });
})();
