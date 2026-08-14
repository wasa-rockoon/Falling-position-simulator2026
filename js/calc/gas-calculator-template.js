(function (root) {
    'use strict';

    function mountButton() {
        if (document.getElementById('open_gas_calculator_btn')) return;
        var anchor = document.getElementById('run_auto_search_btn');
        if (!anchor) return;
        var button = document.createElement('button');
        button.type = 'button';
        button.id = 'open_gas_calculator_btn';
        button.className = 'feature-action-btn';
        button.textContent = 'ガス・破裂高度計算';
        anchor.insertAdjacentElement('afterend', button);
    }

    function mountModal() {
        if (document.getElementById('gas_calculator_modal')) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="gas_calculator_modal" class="gas-calculator-modal" hidden>
                <button id="gas_calculator_backdrop" class="gas-calculator-backdrop" type="button" aria-label="ガス計算を閉じる"></button>
                <section class="gas-calculator-dialog" role="dialog" aria-modal="true" aria-labelledby="gas_calculator_title">
                    <header class="gas-calculator-header">
                        <div>
                            <h2 id="gas_calculator_title">ガス・破裂高度計算</h2>
                            <p>2025年版WASA計算シートの浮力・ガス量・ボンベ残圧・破裂高度を一括計算します。</p>
                        </div>
                        <button id="gas_calculator_close" type="button" aria-label="閉じる">&times;</button>
                    </header>
                    <div class="gas-calculator-content">
                        <form class="gas-calculator-inputs">
                            <fieldset>
                                <legend>機体と充填条件</legend>
                                <label>気球質量
                                    <select id="gas_balloon_mass">
                                        <option value="1000">1000 g</option>
                                        <option value="1500">1500 g</option>
                                        <option value="2000" selected>2000 g</option>
                                        <option value="3000">3000 g</option>
                                    </select>
                                </label>
                                <label>コンポーネント重量 (g)<input id="gas_payload_mass" type="number" min="0" step="1" value="3571"></label>
                                <label>パラシュート等 (g)<input id="gas_recovery_mass" type="number" min="0" step="1" value="835"></label>
                                <label>その他重量 (g)<input id="gas_other_mass" type="number" min="0" step="1" value="320"></label>
                                <label>目標上昇速度 (m/s)<input id="gas_ascent_rate" type="number" min="0.1" step="0.1" value="5"></label>
                                <label>充填時温度 (℃)<input id="gas_fill_temperature" type="number" step="0.1" value="26"></label>
                                <label>残圧測定時温度 (℃)<input id="gas_cylinder_temperature" type="number" step="0.1" value="25"></label>
                                <label>充填時大気圧 (hPa)<input id="gas_pressure" type="number" min="1" step="0.1" value="1010"></label>
                            </fieldset>
                            <fieldset>
                                <legend>ヘリウムボンベ</legend>
                                <label>充填過程
                                    <select id="gas_cylinder_process">
                                        <option value="quasi-static">準静的（等温）</option>
                                        <option value="adiabatic">断熱（安全側）</option>
                                    </select>
                                </label>
                                <label>本数<input id="gas_cylinder_count" type="number" min="1" max="20" step="1" value="4"></label>
                                <label>1本の容積 (L)<input id="gas_cylinder_volume" type="number" min="0.1" step="0.1" value="47"></label>
                                <label>充填前圧力 (MPa)<input id="gas_cylinder_pressure" type="number" min="0" step="0.1" value="14"></label>
                                <label>終了目標残圧 (MPa)<input id="gas_target_pressure" type="number" min="0" step="0.01" value="0.2"></label>
                            </fieldset>
                        </form>
                        <div class="gas-calculator-results" aria-live="polite">
                            <p id="gas_calculator_error" class="gas-calculator-error" hidden></p>
                            <div class="gas-result-summary">
                                <div><span>総重量</span><strong id="gas_result_total_mass">-</strong></div>
                                <div><span>純浮力</span><strong id="gas_result_pure_lift">-</strong></div>
                                <div><span>全浮力</span><strong id="gas_result_total_lift">-</strong></div>
                                <div><span>必要ガス量</span><strong id="gas_result_volume">-</strong></div>
                                <div><span>推奨破裂高度</span><strong id="gas_result_burst">-</strong></div>
                                <div><span>ボンベ</span><strong id="gas_result_cylinders">-</strong></div>
                            </div>
                            <p id="gas_cylinder_warning" class="gas-calculator-warning" hidden>指定した本数では必要ガス量を充填できません。</p>
                            <details>
                                <summary>ボンベごとの使用量・残圧</summary>
                                <div class="gas-table-scroll"><table><thead><tr><th>本</th><th>状態</th><th>使用量</th><th>終了圧</th></tr></thead><tbody id="gas_cylinder_result_body"></tbody></table></div>
                            </details>
                            <details open>
                                <summary>破裂高度6方式の比較</summary>
                                <div class="gas-table-scroll"><table><thead><tr><th>形状</th><th>判定基準</th><th>破裂高度</th></tr></thead><tbody id="gas_burst_result_body"></tbody></table></div>
                                <p class="gas-calculator-note">2025年版シートと解説書に従い「球近似＋気球径」を推奨値に採用します。計算値にはモデル誤差があるため、運用マージンを別途確保してください。</p>
                            </details>
                            <button id="gas_apply_to_prediction" type="button">上昇速度・破裂高度を予測条件へ反映</button>
                        </div>
                    </div>
                </section>
            </div>
        `);
    }

    function mount() {
        mountButton();
        mountModal();
    }

    root.GasCalculatorTemplate = { mount: mount };
}(typeof globalThis !== 'undefined' ? globalThis : this));
