(function(root){
'use strict';
function mount(){
if(document.getElementById('gas_calculator_modal'))return;
document.body.insertAdjacentHTML('beforeend', `
<div id="gas_calculator_modal" class="gas-calculator-modal" hidden>
<button id="gas_calculator_backdrop" class="gas-calculator-backdrop" type="button" aria-label="ガス計算を閉じる"></button>
<section class="gas-calculator-dialog" role="dialog" aria-modal="true" aria-labelledby="gas_calculator_title">
<header class="gas-calculator-header"><div><h2 id="gas_calculator_title">ガス・破裂高度計算</h2><p>2026年版モデルで必要ガス量、3つの充填過程、破裂高度を比較します。</p></div><button id="gas_calculator_close" type="button" aria-label="閉じる">&times;</button></header>
<div class="gas-calculator-content">
<form class="gas-calculator-inputs">
<fieldset><legend>気球・機体</legend>
<label>入力モード<select id="gas_input_mode"><option value="normal">通常モード</option><option value="verification">検証用モード</option></select></label>
<label>気球質量<select id="gas_balloon_mass"><option value="1000">1000 g</option><option value="1500">1500 g</option><option value="2000">2000 g</option><option value="3000" selected>3000 g</option></select></label>
<div id="gas_normal_fields">
<label>コンポーネント重量 (g)<input id="gas_component_mass" type="number" min="0" step="1" value="5900"></label>
<label>その他重量 (g)<input id="gas_other_mass" type="number" min="0" step="1" value="550"></label>
<label>パラシュート設定<select id="gas_parachute_preset"><option value="wasa-4.28">WASA 4.28 m/s（430 g）</option><option value="wasa-7.28">WASA 7.28 m/s（230 g）</option><option value="wasa-10.4">WASA 10.4 m/s（140 g）</option><option value="custom">任意入力（他団体など）</option></select></label>
<label>終端速度 (m/s)<input id="gas_terminal_velocity" type="number" min="0.01" step="0.01" value="4.28"></label>
<label>パラシュート重量 (g)<input id="gas_parachute_mass" type="number" min="0" step="1" value="430"></label>
<label>その他回収機器重量 (g)<input id="gas_recovery_equipment_mass" type="number" min="0" step="1" value="405"></label>
<p class="gas-calculator-note">回収系合計: <strong id="gas_recovery_mass">835 g</strong>。他団体は「任意入力」を選び、パラシュートと付属機器の実測重量を入力してください。</p>
</div>
<div id="gas_verification_fields" hidden><label>気球以外の総重量 (g)<input id="gas_verification_other_mass" type="number" min="0" step="1" value="7155"></label><p class="gas-calculator-note">回収系を含む、気球本体以外の総重量を直接入力します。</p></div>
<label>目標上昇速度 (m/s)<input id="gas_ascent_rate" type="number" min="0.1" step="0.1" value="6"></label>
</fieldset>
<fieldset><legend>環境・計算条件</legend>
<label>充填時温度 (℃)<input id="gas_fill_temperature" type="number" step="0.1" value="26"></label>
<label>残圧測定時温度 (℃)<input id="gas_cylinder_temperature" type="number" step="0.1" value="26"></label>
<label>充填時大気圧 (hPa)<input id="gas_pressure" type="number" min="1" step="0.1" value="1010"></label>
<label>ポリトロープ指数 n<input id="gas_polytropic_n" type="number" min="1" max="1.67" step="0.01" value="1.3"></label>
<label>表示するボンベ詳細<select id="gas_cylinder_process"><option value="polytropic">ポリトロープ</option><option value="quasi-static">準静的</option><option value="adiabatic">断熱</option></select></label>
</fieldset>
<fieldset class="gas-cylinder-fieldset"><legend>ヘリウムボンベ（4本）</legend>
<div class="gas-cylinder-grid gas-cylinder-grid-head"><span>本</span><span>容積 (L)</span><span>初期圧力 (MPa)</span></div>
<div class="gas-cylinder-grid"><strong>1</strong><input id="gas_cylinder_1_volume" aria-label="1本目の容積" type="number" min="0.1" step="0.1" value="47"><input id="gas_cylinder_1_pressure" aria-label="1本目の初期圧力" type="number" min="0" max="15" step="0.1" value="14"></div><div class="gas-cylinder-grid"><strong>2</strong><input id="gas_cylinder_2_volume" aria-label="2本目の容積" type="number" min="0.1" step="0.1" value="47"><input id="gas_cylinder_2_pressure" aria-label="2本目の初期圧力" type="number" min="0" max="15" step="0.1" value="14"></div><div class="gas-cylinder-grid"><strong>3</strong><input id="gas_cylinder_3_volume" aria-label="3本目の容積" type="number" min="0.1" step="0.1" value="47"><input id="gas_cylinder_3_pressure" aria-label="3本目の初期圧力" type="number" min="0" max="15" step="0.1" value="14"></div><div class="gas-cylinder-grid"><strong>4</strong><input id="gas_cylinder_4_volume" aria-label="4本目の容積" type="number" min="0.1" step="0.1" value="47"><input id="gas_cylinder_4_pressure" aria-label="4本目の初期圧力" type="number" min="0" max="15" step="0.1" value="14"></div>
<label>終了目標残圧 (MPa)<input id="gas_target_pressure" type="number" min="0.01" step="0.01" value="0.2"></label>
<label>1本目オフセット (MPa)<input id="gas_first_offset" type="number" min="0" step="0.01" value="0"></label>
</fieldset>
</form>
<div class="gas-calculator-results" aria-live="polite">
<p id="gas_calculator_error" class="gas-calculator-error" hidden></p>
<div class="gas-result-summary"><div><span>総重量</span><strong id="gas_result_total_mass">-</strong></div><div><span>純浮力</span><strong id="gas_result_pure_lift">-</strong></div><div><span>全浮力</span><strong id="gas_result_total_lift">-</strong></div><div><span>必要ガス量</span><strong id="gas_result_volume">-</strong></div><div><span>選択破裂高度</span><strong id="gas_result_burst">-</strong></div><div><span>密度差</span><strong>1.1138 kg/m³</strong></div></div>
<p id="gas_cylinder_warning" class="gas-calculator-warning" hidden>4本では不足する過程があります。</p>
<details open><summary>充填過程の比較</summary><div class="gas-table-scroll"><table><thead><tr><th>過程</th><th>指数 n</th><th>使用本数</th><th>最終使用ボンベ残圧</th></tr></thead><tbody id="gas_process_result_body"></tbody></table></div></details>
<details><summary id="gas_cylinder_detail_title">ボンベごとの使用量・残圧</summary><div class="gas-table-scroll"><table><thead><tr><th>本</th><th>状態</th><th>充填可能量</th><th>使用量</th><th>終了圧</th></tr></thead><tbody id="gas_cylinder_result_body"></tbody></table></div></details>
<details open><summary>破裂高度4方式の比較</summary>
<label class="gas-burst-method-select">予測へ反映する判定方式
<select id="gas_burst_method">
<option value="ellipsoidThickness">楕円体・膜厚</option>
<option value="ellipsoidLength">楕円体・長さ</option>
<option value="ellipsoidDiameter">楕円体・径</option>
<option value="sphereDiameter" selected>球近似・直径（既定）</option>
</select>
</label>
<div class="gas-table-scroll"><table><thead><tr><th>形状</th><th>判定基準</th><th>破裂高度</th></tr></thead><tbody id="gas_burst_result_body"></tbody></table></div><p class="gas-calculator-note">選択した方式の値を予測条件へ反映します。計算値にはモデル誤差があるため、運用マージンを別途確保してください。</p></details>
<button id="gas_apply_to_prediction" type="button">上昇速度・終端速度・選択した破裂高度を予測条件へ反映</button>
</div></div></section></div>`);
}
root.GasCalculatorTemplate={mount:mount};
}(typeof globalThis!=='undefined'?globalThis:this));
