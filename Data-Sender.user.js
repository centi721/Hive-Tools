// ==UserScript==
// @name         Data Sender
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Monitors item list updates.
// @author       Arone
// @match        https://www.amazon.co.jp/vine/vine-items?queue=encore*
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // --- Firebase設定 ---
    const FIREBASE_PROJECT_ID = "hivepremierchart";
    const FIREBASE_COLLECTION = "vine_counts";
    const ENCODED_KEY = "YTlGM2tMN3hRMm1aOHJUMXZZNnBING5KMGNXNXVC";
    const FIREBASE_API_KEY = atob(ENCODED_KEY);

    // --- セッション保存キー ---
    const SESSION_LAST_COUNT_KEY = "vineDataSender_lastCount";

    // Firebaseへデータを送信する関数
    function sendToFirebase(count) {
        const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${FIREBASE_COLLECTION}`;
        const now = new Date().toISOString();

        const payload = {
            fields: {
                count: { integerValue: count.toString() },
                timestamp: { timestampValue: now },
                apiKey: { stringValue: FIREBASE_API_KEY }
            }
        };

        GM_xmlhttpRequest({
            method: "POST",
            url: url,
            headers: {
                "Content-Type": "application/json"
            },
            data: JSON.stringify(payload),
            onload: (res) => {
                if (res.status === 200) {
                    console.log(`[Data Sender] Firebaseへ送信成功: ${count}個`);
                } else {
                    console.error("[Data Sender] Firebase送信エラー:", res.status, res.responseText);
                }
            },
            onerror: (err) => {
                console.error("[Data Sender] Firebase通信エラー:", err);
            }
        });
    }

    // ページから商品件数を取得する関数
    function getItemCountFromDoc() {
        try {
            const container = document.getElementById('vvp-items-grid-container');
            if (!container) return null;
            const pTag = container.querySelector('p');
            if (!pTag) return null;
            const strongTag = pTag.querySelector('strong');
            if (strongTag) {
                const num = parseInt(strongTag.textContent.replace(/,/g, '').trim(), 10);
                return isNaN(num) ? 0 : num;
            }
        } catch (e) {
            console.error("[Data Sender] アイテム数の取得に失敗しました", e);
        }
        return 0;
    }

    // メイン処理 (ページ読み込み完了時に実行)
    window.addEventListener('load', () => {

        // 1. URLの厳密な判定 (余計なパラメータがあるカテゴリページなどは除外)
        if (window.location.search !== '?queue=encore') {
            console.log("[Data Sender] 対象外のURLパラメータのため動作をスキップします。");
            return;
        }

        // 2. リロード(手動/自動)かどうかの判定 (タブ復元によるキャッシュ送信を防止)
        const navEntries = performance.getEntriesByType("navigation");
        let isReload = false;
        if (navEntries.length > 0) {
            isReload = (navEntries[0].type === "reload");
        } else {
            // 古いブラウザ用
            isReload = (performance.navigation.type === 1);
        }

        if (!isReload) {
            console.log("[Data Sender] タブ復元または初回表示のため、送信をスキップします。");
            return;
        }

        // 3. アイテム数の取得
        const currentCount = getItemCountFromDoc();
        if (currentCount === null || currentCount < 0) {
            console.log("[Data Sender] アイテム数が見つかりませんでした。");
            return;
        }

        // 4. セッションに保存された前回値との比較
        const lastCountStr = sessionStorage.getItem(SESSION_LAST_COUNT_KEY);
        const lastCount = lastCountStr !== null ? parseInt(lastCountStr, 10) : null;

        if (lastCount === null) {
            // 初回(比較対象なし)は強制送信
            console.log(`[Data Sender] 初回リロード検知 (${currentCount}個)。送信します。`);
            sendToFirebase(currentCount);
            sessionStorage.setItem(SESSION_LAST_COUNT_KEY, currentCount.toString());

        } else if (lastCount !== currentCount) {
            // 値に変動があれば送信
            console.log(`[Data Sender] 商品数の変動を検知 (${lastCount} -> ${currentCount})。送信します。`);
            sendToFirebase(currentCount);
            sessionStorage.setItem(SESSION_LAST_COUNT_KEY, currentCount.toString());

        } else {
            // 変動なし
            console.log(`[Data Sender] 商品数に変動なし (${currentCount}個)。送信をスキップします。`);
        }
    });

})();
