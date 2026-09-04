(function (root) {
    'use strict';

    function mountButton() {
        if (document.getElementById('open_uncertainty_btn')) return;
        var anchor = document.getElementById('open_gas_calculator_btn') || document.getElementById('run_auto_search_btn');
        if (!anchor) return;
        var button = document.createElement('button');
        button.type = 'button';
        button.id = 'open_uncertainty_btn';
        button.className = 'feature-action-btn';
        button.textContent = '不確実性解析';
        anchor.insertAdjacentElement('afterend', button);
    }

    function mountModal() {
        if (document.getElementById('uncertainty_modal')) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="uncertainty_modal" class="uncertainty-modal" hidden>
                <button id="uncertainty_backdrop" class="uncertainty-backdrop" type="button" aria-label="不確実性解析を閉じる"></button>
                <section class="uncertainty-dialog" role="dialog" aria-modal="true" aria-labelledby="uncertainty_title">
                    <header class="uncertainty-header">
                        <div>
                            <h2 id="uncertainty_title">不確実性解析</h2>
                            <p>API上限を守りながら、海上率の信頼区間と着地点の収束をバッチごとに判定します。</p>
                        </div>
                        <button id="uncertainty_close" type="button" aria-label="閉じる">&times;</button>
                    </header>
                    <div class="uncertainty-content">
                        <section class="uncertainty-config">
                            <fieldset>
                                <legend>放球地点</legend>
                                <div class="uncertainty-inline-actions">
                                    <button id="uncertainty_select_all" type="button">すべて選択</button>
                                    <button id="uncertainty_select_none" type="button">現在地点のみ</button>
                                </div>
                                <div id="uncertainty_sites" class="uncertainty-site-list"></div>
                            </fieldset>
                            <fieldset class="uncertainty-grid uncertainty-datetime">
                                <legend>解析日時（JST）</legend>
                                <label>日付<input id="uncertainty_launch_date" type="date"></label>
                                <label>時刻<input id="uncertainty_launch_time" type="time" step="60"></label>
                                <button id="uncertainty_sync_datetime" type="button">SETTINGSの日時を読込</button>
                                <p>地点は上の選択、日時はここで指定した条件を全サンプルに使用します。</p>
                            </fieldset>                            <fieldset class="uncertainty-grid">
                                <legend>サンプリング</legend>
                                <label>方式
                                    <select id="uncertainty_method">
                                        <option value="sobol">Sobol（推奨）</option>
                                        <option value="lhs">Latin Hypercube</option>
                                        <option value="monte-carlo">モンテカルロ</option>
                                    </select>
                                </label>
                                <label>分布
                                    <select id="uncertainty_distribution">
                                        <option value="normal">正規分布</option>
                                        <option value="weibull">Weibull分布</option>
                                    </select>
                                </label>
                                <label>上昇速度 CV (%)<input id="uncertainty_ascent_cv" type="number" min="0" max="100" step="1" value="10"></label>
                                <label>下降速度 CV (%)<input id="uncertainty_descent_cv" type="number" min="0" max="100" step="1" value="15"></label>
                                <label>破裂高度 CV (%)<input id="uncertainty_burst_cv" type="number" min="0" max="100" step="1" value="12"></label>
                                <label>再現用シード<input id="uncertainty_seed" type="text" value="wasa-2026"></label>
                            </fieldset>
                            <fieldset class="uncertainty-grid">
                                <legend>逐次停止・API上限</legend>
                                <label>最小サンプル/地点<input id="uncertainty_min_samples" type="number" min="4" max="500" step="1" value="12"></label>
                                <label>バッチサイズ<input id="uncertainty_batch_size" type="number" min="2" max="100" step="1" value="8"></label>
                                <label>最大サンプル/地点<input id="uncertainty_max_samples" type="number" min="4" max="1000" step="1" value="48"></label>
                                <label>API呼出上限（全地点）<input id="uncertainty_call_limit" type="number" min="1" max="10000" step="1" value="100"></label>
                                <label>海上率CI許容幅 (±%)<input id="uncertainty_probability_tolerance" type="number" min="1" max="50" step="1" value="10"></label>
                                <label>平均着地点の収束 (km)<input id="uncertainty_centroid_tolerance" type="number" min="0.05" max="100" step="0.05" value="1"></label>
                            </fieldset>
                            <div id="uncertainty_estimate" class="uncertainty-estimate" aria-live="polite"></div>
                            <p id="uncertainty_error" class="uncertainty-error" hidden></p>
                            <div class="uncertainty-actions">
                                <button id="uncertainty_start" type="button">解析開始</button>
                                <button id="uncertainty_pause" type="button" disabled>現在のAPI呼出後に中断</button>
                                <button id="uncertainty_new" type="button">新規解析</button>
                            </div>
                        </section>
                        <section class="uncertainty-results" aria-live="polite">
                            <div class="uncertainty-progress-summary">
                                <strong id="uncertainty_status">未実行</strong>
                                <span id="uncertainty_progress_text">0 / 0</span>
                            </div>
                            <div class="uncertainty-progress"><div id="uncertainty_progress_bar"></div></div>
                            <div class="uncertainty-table-scroll">
                                <table>
                                    <thead><tr><th>地点</th><th>サンプル</th><th>海上率 (95% CI)</th><th>平均着地点</th><th>95%楕円（長×短）</th><th>状態</th></tr></thead>
                                    <tbody id="uncertainty_result_body"></tbody>
                                </table>
                            </div>
                            <p class="uncertainty-note">早期終了は「海上率の95%信頼区間」と「平均着地点」が2バッチ連続で収束した場合のみ行います。未判定の陸海データが20%を超える場合は収束扱いにしません。密度等高線は8点以上の着地点から計算するKDE近似です。</p>
                            <div class="uncertainty-map-tools">
                                <div class="uncertainty-map-legend" aria-label="地図凡例">
                                    <span><i class="uncertainty-dot is-water"></i>海上</span>
                                    <span><i class="uncertainty-dot is-land"></i>陸上</span>
                                    <span><i class="uncertainty-dot is-mean"></i>平均</span>
                                    <span><i class="uncertainty-line is-ellipse"></i>95%楕円</span>
                                    <span><i class="uncertainty-line is-density-50"></i>密度50%</span>
                                    <span><i class="uncertainty-line is-density-80"></i>80%</span>
                                    <span><i class="uncertainty-line is-density-95"></i>95%</span>
                                </div>
                                <div class="uncertainty-map-options" aria-label="地図表示レイヤー">
                                    <label><input id="uncertainty_show_points" type="checkbox" checked>着地点</label>
                                    <label><input id="uncertainty_show_ellipse" type="checkbox" checked>95%楕円</label>
                                    <label><input id="uncertainty_show_density" type="checkbox">密度等高線</label>
                                </div>
                                <div class="uncertainty-map-actions-block">
                                    <div class="uncertainty-result-actions">
                                        <button id="uncertainty_map_view" type="button" disabled>地図で確認</button>
                                        <button id="uncertainty_map_clear" type="button" disabled>地図表示を消す</button>
                                        <button id="uncertainty_export" type="button" disabled>CSV出力</button>
                                    </div>
                                    <p class="uncertainty-map-action-note">地図上の点・楕円・等高線だけを消します。解析結果と保存履歴は残ります。</p>
                                </div>
                            </div>
                        </section>
                    </div>
                </section>
            </div>
        `);
    }

    function mount() {
        mountButton();
        mountModal();
    }

    root.UncertaintyTemplate = { mount: mount };
}(typeof globalThis !== 'undefined' ? globalThis : this));
