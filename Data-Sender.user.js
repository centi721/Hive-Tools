// ==UserScript==
// @name         Data Sender
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Monitors item list updates.
// @author       Arone
// @match        https://www.amazon.co.jp/vine/vine-items?queue=encore*
// @grant        GM_xmlhttpRequest
// @connect      *
// @updateURL    https://github.com/centi721/Hive-Tools/raw/refs/heads/main/Data-Sender.user.js
// @downloadURL  https://github.com/centi721/Hive-Tools/raw/refs/heads/main/Data-Sender.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- Firebase設定 ---
    const FIREBASE_PROJECT_ID = "hivepremierchart";
    const FIREBASE_COLLECTION = "vine_counts";

    // APIキーはBase64で難読化
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
                    console.error(`[Data Sender] 送信エラー (Status: ${res.status}):`, res.responseText);
                }
            },
            onerror: (err) => {
                console.error("[Data Sender] 通信自体に失敗しました:", err);
            }
        });
    }

    // ページから商品件数を厳密に取得する関数
    // 戻り値: 数値(0含む) = 成功, null = 取得不可(エラーページ等)
    function getItemCountFromDoc(doc) {
        try {
            // 1. 商品タイルがあるか確認
            const itemTile = doc.querySelector('.vvp-item-tile');

            // 2. 「オファーはありません」メッセージがあるか確認
            const noOffersMsg = doc.querySelector('.vvp-no-offers-msg');

            // 判定ロジック
            if (itemTile) {
                // 商品があるので数字を探す
                const pTag = doc.querySelector('#vvp-items-grid-container p');
                const strongTag = pTag ? pTag.querySelector('strong') : null;

                if (strongTag) {
                    const num = parseInt(strongTag.textContent.replace(/,/g, '').trim(), 10);
                    return isNaN(num) ? null : num; // 数字じゃなければエラー扱い
                }
            } else if (noOffersMsg) {
                // 商品はないが、正常な「0件」画面である
                return 0;
            }

            // どちらでもない場合（CAPTCHA、犬画像、読み込み不全など）
            console.warn("[Data Sender] 商品も0件メッセージも見つかりません。ページ異常の可能性があります。");
            return null;

        } catch (e) {
            console.error("[Data Sender] 解析エラー:", e);
            return null;
        }
    }

    // メイン処理
    window.addEventListener('load', () => {

        // 1. URLチェック
        if (window.location.search !== '?queue=encore') {
            return;
        }

        // 2. リロード判定 (タブ復元防止)
        const navEntries = performance.getEntriesByType("navigation");
        let isReload = false;
        if (navEntries.length > 0) {
            isReload = (navEntries[0].type === "reload");
        } else {
            isReload = (performance.navigation.type === 1);
        }

        if (!isReload) {
            console.log("[Data Sender] 初回/復元のため送信スキップ");
            return;
        }

        // 3. アイテム数取得
        const currentCount = getItemCountFromDoc(document);

        // nullなら異常ページなので何もしない（0送信を防ぐ）
        if (currentCount === null) {
            console.log("[Data Sender] 有効なアイテム数が取得できないため中断しました");
            return;
        }

        // 4. 変動チェックと送信
        const lastCountStr = sessionStorage.getItem(SESSION_LAST_COUNT_KEY);
        const lastCount = lastCountStr !== null ? parseInt(lastCountStr, 10) : null;

        if (lastCount === null) {
            console.log(`[Data Sender] 初回送信: ${currentCount}個`);
            sendToFirebase(currentCount);
            sessionStorage.setItem(SESSION_LAST_COUNT_KEY, currentCount.toString());

        } else if (lastCount !== currentCount) {
            console.log(`[Data Sender] 変動あり (${lastCount} -> ${currentCount}) 送信`);
            sendToFirebase(currentCount);
            sessionStorage.setItem(SESSION_LAST_COUNT_KEY, currentCount.toString());

        } else {
            console.log(`[Data Sender] 変動なし (${currentCount}個)`);
        }
    });

})();
