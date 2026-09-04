(function (root) {
    'use strict';

    var CONTENT = {
        autoSearch: {
            title: '放球自動探索',
            sections: [
                ['この機能でできること', '複数の放球地点と時刻を自動で予測し、雨・風・海率などの条件を満たす候補を探します。'],
                ['入力項目の意味', '海率下限は「この値以上なら候補に残す」という下限です。高速は粗探索で候補を絞り、全候補精密は粗探索で不合格にせず全候補を精密計算します。段階的は有望な候補から計算します。API呼び出し上限は再試行を含むHTTP試行数の上限です。'],
                ['実行手順', '期間、間隔、探索モード、条件、対象地点を設定し、表示される呼び出し回数と所要時間の見積もりを確認して探索を開始します。中断は現在のAPI呼び出しが終わったところで次へ進まず停止します。「中止して新規探索」は進行中の通信を中止して新しい探索を準備します。'],
                ['結果の読み方・注意点', '海率、予想着地点、漁港までの距離などを候補比較に使います。予報・地理データ・軌道モデルには誤差があるため、探索結果だけで放球可否を決定しないでください。']
            ]
        },
        uncertainty: {
            title: '不確実性解析',
            sections: [
                ['この機能でできること', '上昇速度、下降速度、破裂高度にばらつきを与えて複数回予測し、着地点の広がりと海上率を確認します。'],
                ['入力項目の意味', 'CVは平均値に対するばらつきの割合です。分布は値の生成方法、再現用シードは同じ条件で同じ乱数系列を再現するための文字列です。サンプル数とAPI呼び出し上限は解析量を制限します。'],
                ['実行手順', '地点と日時を選び、分布・CV・サンプル数・上限を設定して解析を開始します。中断は現在のAPI呼び出し後に停止し、中止して新規解析では進行中の通信を止めます。'],
                ['結果の読み方・注意点', '点群は各試行の着地点、95%楕円と密度等高線は広がりの近似、海上率CIは推定幅です。不確実性解析は安全を保証せず、入力したばらつきの外側や気象予報自体の誤差も残ります。']
            ]
        },
        gas: {
            title: 'ガス・破裂高度計算',
            sections: [
                ['この機能でできること', '機体重量と目標上昇速度から必要ヘリウム量、ボンベ使用量、予測破裂高度を計算します。'],
                ['入力項目の意味', '通常モードは各重量を積み上げ、検証用モードは気球以外の総重量を直接指定します。終端速度は予測設定の下降速度へ反映されます。破裂高度は4つの形状・判定方法を比較できます。'],
                ['実行手順', '気球、機体、パラシュート、環境、ボンベ条件を入力し、反映する破裂高度方式を選択して「予測条件へ反映」を押します。'],
                ['結果の読み方・注意点', '球近似・直径は既定の選択肢ですが、常に最も正確という意味ではありません。計算値にはモデル誤差があるため運用マージンが必要です。1200 g気球は係数未確定のため使用できません。']
            ]
        },
        apiSource: {
            title: 'API接続先',
            sections: [
                ['この設定でできること', '予測計算を送信するTawhiri APIの接続先を選びます。'],
                ['選択肢の意味', 'SondeHub (Public)は公開API、Localhost (Docker)は開発・現地PCで動かすローカルAPI、カスタムは指定した互換APIを使用します。'],
                ['使い方', '通常の公開ページではSondeHub (Public)を選びます。ローカル環境を準備している場合だけLocalhostを選び、カスタムではHTTPSのAPI URLを入力します。'],
                ['注意点', 'GitHub Pages自体は予測APIを実行せず、ブラウザから選択したAPIへ接続します。公開APIの混雑・停止・呼び出し制限により失敗する場合があります。Localhostは公開ページの他の利用者からは利用できません。']
            ]
        },        history: {
            title: '履歴・出力',
            sections: [
                ['この機能でできること', '単発予測、愛媛13条件、自動探索、不確実性解析を実行単位で自動保存し、再表示や出力に利用します。'],
                ['入力項目の意味', '種類フィルターで表示対象を絞れます。固定した履歴は自動整理の対象外になります。'],
                ['実行手順', '地図表示、CSV/KML出力、再実行準備、固定、削除を履歴ごとに選びます。再実行準備は設定を戻すだけで、自動的には予測しません。'],
                ['結果の読み方・注意点', '「地図表示を消す」は保存履歴を残して地図上の線や点だけを消します。「削除」は保存済みの実行記録を削除します。CSVは表計算、KMLは地理表示向けです。']
            ]
        }
    };

    var panel;
    var title;
    var body;
    var lastTrigger;

    function createButton(key, label) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'context-help-trigger';
        button.textContent = '?';
        button.dataset.helpTopic = key;
        button.setAttribute('aria-label', label + 'の使い方');
        button.setAttribute('aria-haspopup', 'dialog');
        button.setAttribute('aria-controls', 'context_help_panel');
        return button;
    }

    function mountPanel() {
        document.body.insertAdjacentHTML('beforeend', '<aside id="context_help_panel" class="context-help-panel" role="dialog" aria-modal="false" aria-labelledby="context_help_title" hidden><header><div><span class="context-help-eyebrow">使い方</span><h2 id="context_help_title"></h2></div><div class="context-help-header-actions"><button id="context_help_move" type="button">右へ</button><button id="context_help_close" type="button" aria-label="使い方を閉じる">&times;</button></div></header><div id="context_help_body" class="context-help-body"></div></aside>');
        panel = document.getElementById('context_help_panel');
        title = document.getElementById('context_help_title');
        body = document.getElementById('context_help_body');
        document.getElementById('context_help_close').addEventListener('click', close);
        document.getElementById('context_help_move').addEventListener('click', function () {
            var moveRight = !panel.classList.contains('is-right');
            panel.classList.toggle('is-right', moveRight);
            this.textContent = moveRight ? '左へ' : '右へ';
        });
    }

    function render(topic) {
        var content = CONTENT[topic];
        if (!content) return;
        title.textContent = content.title;
        body.replaceChildren();
        content.sections.forEach(function (section) {
            var block = document.createElement('section');
            var heading = document.createElement('h3');
            var paragraph = document.createElement('p');
            heading.textContent = section[0];
            paragraph.textContent = section[1];
            block.appendChild(heading);
            block.appendChild(paragraph);
            body.appendChild(block);
        });
    }

    function open(topic, trigger) {
        if (!CONTENT[topic]) return;
        lastTrigger = trigger || document.activeElement;
        render(topic);
        panel.hidden = false;
        document.body.classList.add('context-help-open');
        document.getElementById('context_help_close').focus();
    }

    function close() {
        if (!panel || panel.hidden) return;
        panel.hidden = true;
        document.body.classList.remove('context-help-open');
        if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
    }

    function insertAfterTitle(selector, key) {
        var heading = document.querySelector(selector);
        if (!heading || heading.parentNode.querySelector('[data-help-topic="' + key + '"]')) return;
        heading.parentNode.classList.add('context-help-heading');
        heading.insertAdjacentElement('afterend', createButton(key, CONTENT[key].title));
    }


    function insertApiSourceHelp() {
        var select = document.getElementById('api_source');
        if (!select || select.parentNode.querySelector('[data-help-topic="apiSource"]')) return;
        var row = document.createElement('span');
        row.className = 'api-source-select-row';
        select.parentNode.insertBefore(row, select);
        row.appendChild(select);
        row.appendChild(createButton('apiSource', CONTENT.apiSource.title));
    }    function init() {
        mountPanel();
        insertAfterTitle('#auto_search_title', 'autoSearch');
        insertAfterTitle('#gas_calculator_title', 'gas');
        insertAfterTitle('#uncertainty_title', 'uncertainty');
        insertAfterTitle('#run_history_heading', 'history');
        insertApiSourceHelp();
        document.addEventListener('click', function (event) {
            var trigger = event.target.closest('[data-help-topic]');
            if (trigger) open(trigger.dataset.helpTopic, trigger);
        });
        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && panel && !panel.hidden) {
                event.preventDefault();
                event.stopImmediatePropagation();
                close();
            }
        }, true);
    }

    root.ContextHelp = { open: open, close: close, content: CONTENT };
    root.AppShell.registerInitializer('context-help', init, 90);
}(typeof globalThis !== 'undefined' ? globalThis : this));