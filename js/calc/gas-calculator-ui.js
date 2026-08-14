(function (root) {
    'use strict';

    var STORAGE_KEY = 'gas-calculator-settings-v1';
    var lastResult = null;
    var initialized = false;
    var fieldIds = [
        'gas_balloon_mass', 'gas_payload_mass', 'gas_recovery_mass', 'gas_other_mass',
        'gas_ascent_rate', 'gas_fill_temperature', 'gas_cylinder_temperature', 'gas_pressure',
        'gas_cylinder_process', 'gas_cylinder_count', 'gas_cylinder_volume',
        'gas_cylinder_pressure', 'gas_target_pressure'
    ];

    function element(id) {
        return document.getElementById(id);
    }

    function numberValue(id) {
        return Number(element(id).value);
    }

    function format(value, digits) {
        return Number(value).toLocaleString('ja-JP', {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        });
    }

    function readOptions() {
        return {
            balloonMassG: numberValue('gas_balloon_mass'),
            payloadMassG: numberValue('gas_payload_mass'),
            recoveryMassG: numberValue('gas_recovery_mass'),
            otherMassG: numberValue('gas_other_mass'),
            targetAscentRate: numberValue('gas_ascent_rate'),
            temperatureC: numberValue('gas_fill_temperature'),
            cylinderTemperatureC: numberValue('gas_cylinder_temperature'),
            pressureHpa: numberValue('gas_pressure'),
            cylinderProcess: element('gas_cylinder_process').value,
            cylinderCount: numberValue('gas_cylinder_count'),
            cylinderVolumeL: numberValue('gas_cylinder_volume'),
            cylinderPressureMpa: numberValue('gas_cylinder_pressure'),
            targetCylinderPressureMpa: numberValue('gas_target_pressure')
        };
    }

    function saveSettings() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(readOptions()));
        } catch (storageError) {
            if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(storageError, 'gas.settings.save');
        }
    }

    function restoreSettings() {
        var saved;
        try {
            saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        } catch (storageError) {
            if (typeof root.reportNonFatalError === 'function') root.reportNonFatalError(storageError, 'gas.settings.load');
            saved = null;
        }
        if (!saved) return;
        var mapping = {
            balloonMassG: 'gas_balloon_mass',
            payloadMassG: 'gas_payload_mass',
            recoveryMassG: 'gas_recovery_mass',
            otherMassG: 'gas_other_mass',
            targetAscentRate: 'gas_ascent_rate',
            temperatureC: 'gas_fill_temperature',
            cylinderTemperatureC: 'gas_cylinder_temperature',
            pressureHpa: 'gas_pressure',
            cylinderProcess: 'gas_cylinder_process',
            cylinderCount: 'gas_cylinder_count',
            cylinderVolumeL: 'gas_cylinder_volume',
            cylinderPressureMpa: 'gas_cylinder_pressure',
            targetCylinderPressureMpa: 'gas_target_pressure'
        };
        Object.keys(mapping).forEach(function (key) {
            if (saved[key] != null && element(mapping[key])) element(mapping[key]).value = saved[key];
        });
    }

    function setText(id, value) {
        var target = element(id);
        if (target) target.textContent = value;
    }

    function renderCylinderPlan(plan) {
        var partial = plan.cylinders.find(function (row) { return row.status === 'partial'; });
        var summary;
        if (plan.insufficient) {
            summary = 'ボンベ不足（あと ' + format(plan.remainingGasL, 0) + ' L）';
        } else {
            summary = plan.physicalCylindersUsed + '本を使用 / シート換算 ' + format(plan.workbookEquivalentCount, 3) + '本';
            if (partial) summary += ' / 最終残圧 ' + format(partial.residualPressureMpa, 2) + ' MPa';
        }
        setText('gas_result_cylinders', summary);
        var body = element('gas_cylinder_result_body');
        body.replaceChildren();
        plan.cylinders.forEach(function (row, index) {
            var tr = document.createElement('tr');
            var status = { full: '全量使用', partial: '途中まで', unused: '未使用' }[row.status];
            [
                String(index + 1), status, format(row.usedL, 0) + ' L', format(row.residualPressureMpa, 2) + ' MPa'
            ].forEach(function (value) {
                var td = document.createElement('td');
                td.textContent = value;
                tr.appendChild(td);
            });
            body.appendChild(tr);
        });
        element('gas_cylinder_warning').hidden = !plan.insufficient;
    }

    function renderBurst(result) {
        var labels = {
            ellipsoidMembrane: ['楕円体', '膜厚'],
            ellipsoidEquivalentDiameter: ['楕円体', '気球径（球相当）'],
            ellipsoidLength: ['楕円体', '気球長さ'],
            ellipsoidDiameter: ['楕円体', '気球径'],
            sphereMembrane: ['球', '膜厚'],
            sphereDiameter: ['球', '気球径（推奨）']
        };
        var body = element('gas_burst_result_body');
        body.replaceChildren();
        Object.keys(labels).forEach(function (key) {
            var tr = document.createElement('tr');
            if (key === result.recommendedMethod) tr.className = 'is-recommended';
            [labels[key][0], labels[key][1], format(result.methods[key], 2) + ' km'].forEach(function (value) {
                var td = document.createElement('td');
                td.textContent = value;
                tr.appendChild(td);
            });
            body.appendChild(tr);
        });
    }

    function calculateAndRender() {
        var error = element('gas_calculator_error');
        try {
            lastResult = root.BalloonGas.calculate(readOptions());
            error.hidden = true;
            setText('gas_result_total_mass', format(lastResult.totalMassKg, 3) + ' kg');
            setText('gas_result_pure_lift', format(lastResult.pureLiftKg, 3) + ' kg');
            setText('gas_result_total_lift', format(lastResult.totalLiftKg, 3) + ' kg');
            setText('gas_result_volume', format(lastResult.gasVolumeL, 0) + ' L（' + format(lastResult.gasVolumeM3, 3) + ' m³）');
            setText('gas_result_burst', format(lastResult.burst.recommendedKm, 2) + ' km');
            renderCylinderPlan(lastResult.cylinders);
            renderBurst(lastResult.burst);
            element('gas_apply_to_prediction').disabled = false;
            saveSettings();
        } catch (calculationError) {
            lastResult = null;
            error.textContent = calculationError.message || String(calculationError);
            error.hidden = false;
            element('gas_apply_to_prediction').disabled = true;
        }
    }

    function open() {
        element('gas_calculator_modal').hidden = false;
        calculateAndRender();
        element('gas_balloon_mass').focus();
    }

    function close() {
        element('gas_calculator_modal').hidden = true;
    }

    function applyToPrediction() {
        if (!lastResult) return;
        var ascent = element('ascent');
        var burst = element('burst');
        if (ascent) ascent.value = format(lastResult.inputs.targetAscentRate, 2).replace(/,/g, '');
        if (burst) burst.value = String(Math.round(lastResult.burst.recommendedKm * 1000));
        if (typeof root.showToast === 'function') {
            root.showToast('上昇速度と推奨破裂高度を予測条件へ反映しました', 'success', 3500);
        }
        close();
    }

    function init() {
        if (initialized) return;
        initialized = true;
        if (root.GasCalculatorTemplate) root.GasCalculatorTemplate.mount();
        if (!root.BalloonGas || !element('gas_calculator_modal')) return;
        restoreSettings();
        var form = element('gas_calculator_modal').querySelector('form');
        if (form) form.addEventListener('submit', function (event) { event.preventDefault(); });
        element('open_gas_calculator_btn').addEventListener('click', open);
        var mobileButton = element('mobile_nav_gas');
        if (mobileButton) mobileButton.addEventListener('click', open);
        element('gas_calculator_close').addEventListener('click', close);
        element('gas_calculator_backdrop').addEventListener('click', close);
        element('gas_apply_to_prediction').addEventListener('click', applyToPrediction);
        fieldIds.forEach(function (id) {
            element(id).addEventListener('input', calculateAndRender);
            element(id).addEventListener('change', calculateAndRender);
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && !element('gas_calculator_modal').hidden) close();
        });
        calculateAndRender();
    }

    root.GasCalculatorUI = { init: init, open: open, close: close, calculate: calculateAndRender };
    root.AppShell.registerInitializer('gas-calculator', init, 60);
}(typeof globalThis !== 'undefined' ? globalThis : this));
