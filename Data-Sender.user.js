// ==UserScript==
// @name         Data Sender
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Monitors item list updates.
// @author       Arone
// @match        https://www.amazon.co.jp/vine/vine-items?queue=encore*
// @grant        GM_xmlhttpRequest
// @connect      firestore.googleapis.com
// @updateURL    https://github.com/centi721/Hive-Tools/raw/refs/heads/main/Data-Sender.user.js
// @downloadURL  https://github.com/centi721/Hive-Tools/raw/refs/heads/main/Data-Sender.user.js
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
                    console.log(`[Vine Data Sender] Firebaseへ送信成功: ${count}個`);
                } else {
                    console.error("[Vine Data Sender] Firebase送信エラー:", res.status, res.responseText);
                }
            },
            onerror: (err) => {
                console.error("[Vine Data Sender] Firebase通信エラー:", err);
            }
        });
    }

    // ページから商品件数を取得する関数
    function getItemCountFromDoc() {
        try {
            // 1. 通常のアイテム一覧コンテナを探す
            const container = document.getElementById('vvp-items-grid-container');
            if (container) {
                // Aプラン: <strong>タグの中に数字があるか探す
                const strongTag = container.querySelector('strong');
                if (strongTag) {
                    const num = parseInt(strongTag.textContent.replace(/,/g, '').trim(), 10);
                    if (!isNaN(num)) return num;
                }

                // Bプラン: <p>タグの文章全体から「〇〇件」の数字を探す
                // 例: "結果182件の..." から 182 を抜き出す
                const pTag = container.querySelector('p');
                if (pTag) {
                    const text = pTag.textContent;
                    // 正規表現: 数字(カンマ含む) + "件" のパターンを探す
                    const match = text.match(/([0-9,]+)\s*件/);
                    if (match) {
                        const num = parseInt(match[1].replace(/,/g, '').trim(), 10);
                        if (!isNaN(num)) return num;
                    }
                }
            }

            // 2. 「アイテムがありません」のメッセージがある場合は「0個」として扱う
            const noOffers = document.querySelector('.vvp-no-offers-msg');
            if (noOffers) {
                return 0; // 正常な0個
            }

        } catch (e) {
            console.error("[Vine Data Sender] アイテム数の取得に失敗しました", e);
        }
        // どちらも見つからない場合は取得失敗（null）
        return null;
    }

    // メインロジック
    function executeSender() {
        // 3. アイテム数の取得
        const currentCount = getItemCountFromDoc();

        // 取得失敗時は何もせず終了 (0送信を防ぐ)
        if (currentCount === null) {
            console.log("[Vine Data Sender] 数値の取得に失敗(null)しました。送信を中止します。");
            return;
        }

        // 4. セッションに保存された前回値との比較
        const lastCountStr = sessionStorage.getItem(SESSION_LAST_COUNT_KEY);
        const lastCount = lastCountStr !== null ? parseInt(lastCountStr, 10) : null;

        if (lastCount === null) {
            // 初回(比較対象なし)は送信
            console.log(`[Vine Data Sender] 初回リロード検知 (${currentCount}個)。送信します。`);
            sendToFirebase(currentCount);
            sessionStorage.setItem(SESSION_LAST_COUNT_KEY, currentCount.toString());

        } else if (lastCount !== currentCount) {
            // 値に変動があれば送信
            console.log(`[Vine Data Sender] 商品数の変動を検知 (${lastCount} -> ${currentCount})。送信します。`);
            sendToFirebase(currentCount);
            sessionStorage.setItem(SESSION_LAST_COUNT_KEY, currentCount.toString());

        } else {
            // 変動なし
            console.log(`[Vine Data Sender] 商品数に変動なし (${currentCount}個)。送信をスキップします。`);
        }
    }

    // メイン処理 (ページ読み込み完了時に実行)
    window.addEventListener('load', () => {

        // 1. URLの厳密な判定 (余計なパラメータがあるカテゴリページなどは除外)
        if (window.location.search !== '?queue=encore') {
            console.log("[Vine Data Sender] 対象外のURLパラメータのため動作をスキップします。");
            return;
        }

        // 2. リロード(手動/自動)かどうかの判定 (タブ復元によるキャッシュ送信を防止)
        const navEntries = performance.getEntriesByType("navigation");
        let isAllowedNavigation = false;

        if (navEntries.length > 0) {
            const navType = navEntries[0].type;
            // リロード(F5等) または Amazon内からのリンク遷移なら許可
            if (navType === "reload") {
                isAllowedNavigation = true;
            } else if (navType === "navigate" && document.referrer.includes("amazon.co.jp")) {
                isAllowedNavigation = true;
            }
        } else {
            // 古いブラウザ用フォールバック
            isAllowedNavigation = (performance.navigation.type === 1);
        }

        if (!isAllowedNavigation) {
            console.log("[Data Sender] 初回/復元/外部からのアクセスのため送信スキップ");
            return;
        }

        // 取得を試みる (最大2回)
        let count = getItemCountFromDoc(); // 1回目
        if (count !== null) {
            executeSender();
        } else {
            // 取得失敗(読み込み遅延)の場合、1.5秒待って再トライ
            console.log("[Data Sender] 読み込み待ち... (1.5秒後に再試行)");
            setTimeout(() => {
                executeSender(); // 2回目 (ここでダメなら諦める)
            }, 1500);
        }
    });

})();
