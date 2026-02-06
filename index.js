// SillyTavern GitHub Copilot Manager Extension
import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";

const extensionName = "GCM";
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

const CLIENT_ID = "01ab8ac9400c4e429b23";
const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";
const COPILOT_API_BASE = "https://api.githubcopilot.com";
const COPILOT_INTERNAL_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";

const defaultSettings = {
    token: "",
    autoRetry: false,
    retryCount: 3,
    retryDelay: 2,
    retryOn400: true,
    retryOnModelErr: true,
    retryOn429: true,
    retryOn500: true,
    stats: { total: 0, success: 0, fail: 0, retries: 0 },
};

let pollInterval = null;

// ============================================================
// 설정 로드 / 저장
// ============================================================
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], JSON.parse(JSON.stringify(defaultSettings)));
    }
    const s = extension_settings[extensionName];

    // UI에 반영
    if (s.token) {
        $("#copilot_token_display").val(s.token);
        $("#copilot_token_info").text("토큰이 저장되어 있습니다.");
    } else {
        $("#copilot_token_display").val("");
        $("#copilot_token_info").text("");
    }
    $("#copilot_auto_retry").prop("checked", s.autoRetry).trigger("input");
    $("#copilot_retry_count").val(s.retryCount);
    $("#copilot_retry_delay").val(s.retryDelay);
    $("#copilot_retry_on_400").prop("checked", s.retryOn400);
    $("#copilot_retry_on_model_err").prop("checked", s.retryOnModelErr);
    $("#copilot_retry_on_429").prop("checked", s.retryOn429);
    $("#copilot_retry_on_500").prop("checked", s.retryOn500);

    updateStatsUI();
}

function saveSettings() {
    saveSettingsDebounced();
}

function getSettings() {
    return extension_settings[extensionName];
}

// ============================================================
// 통계
// ============================================================
function updateStatsUI() {
    const s = getSettings().stats || defaultSettings.stats;
    $("#copilot_req_total").text(s.total);
    $("#copilot_req_success").text(s.success);
    $("#copilot_req_fail").text(s.fail);
    $("#copilot_req_retries").text(s.retries);
}

function recordRequest(success, retried = false) {
    const s = getSettings();
    if (!s.stats) s.stats = { total: 0, success: 0, fail: 0, retries: 0 };
    s.stats.total++;
    if (success) s.stats.success++;
    else s.stats.fail++;
    if (retried) s.stats.retries++;
    saveSettings();
    updateStatsUI();
}

// ============================================================
// GitHub Device Flow 인증
// ============================================================
async function startAuth() {
    $("#copilot_auth_btn").val("⏳ 진행 중...").prop("disabled", true);
    $("#copilot_auth_progress").slideDown();
    $("#copilot_auth_status").text("서버 통신 중...").css("color", "");

    try {
        const body = new URLSearchParams({
            client_id: CLIENT_ID,
            scope: "read:user user:email copilot",
        });
        const res = await fetch(GITHUB_DEVICE_CODE_URL, {
            method: "POST",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        const { user_code, verification_uri, device_code, interval } = data;

        $("#copilot_user_code").text(user_code);
        $("#copilot_verify_url").attr("href", verification_uri).text(verification_uri);
        $("#copilot_auth_status").text("브라우저에서 위 코드를 입력하세요!").css("color", "#FF9800");

        // 브라우저 열기
        window.open(verification_uri, "_blank");

        // 폴링 시작
        pollForToken(device_code, interval || 5);
    } catch (err) {
        toastr.error(`인증 시작 실패: ${err.message}`);
        resetAuthUI();
    }
}

function pollForToken(deviceCode, interval) {
    if (pollInterval) {
        clearTimeout(pollInterval);
        pollInterval = null;
    }

    let pollDelay = interval * 1000;

    const pollOnce = async () => {
        try {
            const body = new URLSearchParams({
                client_id: CLIENT_ID,
                device_code: deviceCode,
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            });

            const res = await fetch(GITHUB_OAUTH_TOKEN_URL, {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: body.toString(),
            });

            const data = await res.json();

            if (data.access_token) {
                pollInterval = null;

                const s = getSettings();
                s.token = data.access_token;
                saveSettings();

                $("#copilot_token_display").val(data.access_token);
                $("#copilot_token_info").text(`토큰 타입: ${data.token_type || "bearer"} | 스코프: ${data.scope || "N/A"}`);
                $("#copilot_auth_status").text("✅ 인증 완료!").css("color", "#4CAF50");

                toastr.success("GitHub Copilot 토큰 발급 완료!");
                setTimeout(() => {
                    $("#copilot_auth_progress").slideUp();
                    resetAuthUI();
                }, 2000);
                return;
            }

            if (data.error === "authorization_pending") {
                pollInterval = setTimeout(pollOnce, pollDelay);
                return;
            }
            if (data.error === "slow_down") {
                pollDelay += 5000;
                pollInterval = setTimeout(pollOnce, pollDelay);
                return;
            }
            if (data.error === "expired_token" || data.error === "access_denied") {
                pollInterval = null;
                toastr.warning("인증 시간이 초과되었거나 거부되었습니다. 다시 시도해주세요.");
                resetAuthUI();
                return;
            }
            if (data.error) {
                pollInterval = null;
                toastr.error(`인증 실패: ${data.error}`);
                resetAuthUI();
                return;
            }
        } catch (err) {
            console.error("Copilot poll error:", err);
        }

        pollInterval = setTimeout(pollOnce, pollDelay);
    };

    pollInterval = setTimeout(pollOnce, pollDelay);
}

function resetAuthUI() {
    $("#copilot_auth_btn").val("🔐 토큰 발급 시작").prop("disabled", false);
}

// ============================================================
// 모델 목록 가져오기
// ============================================================
async function fetchModels() {
    const token = getSettings().token;
    if (!token) {
        toastr.warning("먼저 토큰을 발급받아주세요.");
        return;
    }

    $("#copilot_fetch_models_btn").val("⏳ 가져오는 중...").prop("disabled", true);

    try {
        const res = await fetch(`${COPILOT_API_BASE}/models`, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Accept": "application/json",
                "Copilot-Integration-Id": "vscode-chat",
                "Editor-Version": "vscode/1.96.0",
                "Editor-Plugin-Version": "copilot-chat/0.24.0",
            },
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = await res.json();
        const models = data.data || [];

        renderModels(models);
        toastr.success(`${models.length}개 모델을 불러왔습니다.`);
    } catch (err) {
        toastr.error(`모델 목록 실패: ${err.message}`);
    } finally {
        $("#copilot_fetch_models_btn").val("🔄 모델 목록 새로고침").prop("disabled", false);
    }
}

function renderModels(models) {
    const container = $("#copilot_models_list");
    container.empty().show();

    // 카테고리별 그룹핑
    const categories = {
        powerful: { label: "🔴 Powerful", models: [] },
        versatile: { label: "🟡 Versatile", models: [] },
        lightweight: { label: "🟢 Lightweight", models: [] },
        other: { label: "⚪ 기타 (내부/레거시)", models: [] },
    };

    for (const m of models) {
        if (m.capabilities?.type === "embeddings") continue; // 임베딩 모델 스킵
        const cat = m.model_picker_category || (m.model_picker_enabled ? "other" : "other");
        if (categories[cat]) {
            categories[cat].models.push(m);
        } else {
            categories.other.models.push(m);
        }
    }

    for (const [key, cat] of Object.entries(categories)) {
        if (cat.models.length === 0) continue;

        const groupHtml = $(`<div class="copilot-model-group">
            <div class="copilot-model-group-header">${cat.label} (${cat.models.length})</div>
        </div>`);

        for (const m of cat.models) {
            const maxCtx = m.capabilities?.limits?.max_context_window_tokens;
            const maxOut = m.capabilities?.limits?.max_output_tokens;
            const vision = m.capabilities?.supports?.vision ? "👁️" : "";
            const thinking = m.capabilities?.supports?.adaptive_thinking || m.capabilities?.supports?.max_thinking_budget ? "🧠" : "";
            const preview = m.preview ? " (Preview)" : "";

            const modelEl = $(`
                <div class="copilot-model-item" data-model-id="${m.id}">
                    <div class="copilot-model-name">
                        ${m.name}${preview} ${vision} ${thinking}
                    </div>
                    <div class="copilot-model-meta">
                        <span class="copilot-dim">${m.id}</span>
                        <span class="copilot-dim">| ${m.vendor}</span>
                        ${maxCtx ? `<span class="copilot-dim">| ctx:${(maxCtx / 1000).toFixed(0)}K</span>` : ""}
                        ${maxOut ? `<span class="copilot-dim">| out:${(maxOut / 1000).toFixed(0)}K</span>` : ""}
                    </div>
                </div>
            `);

            modelEl.on("click", () => {
                $(".copilot-model-item").removeClass("selected");
                modelEl.addClass("selected");
                $("#copilot_model_detail").show();
                $("#copilot_model_json").val(JSON.stringify(m, null, 2));
            });

            groupHtml.append(modelEl);
        }
        container.append(groupHtml);
    }
}

// ============================================================
// 구독 / 사용량 정보
// ============================================================
async function fetchUsageInfo() {
    const token = getSettings().token;
    if (!token) {
        toastr.warning("먼저 토큰을 발급받아주세요.");
        return;
    }

    $("#copilot_fetch_usage_btn").val("⏳ 확인 중...").prop("disabled", true);

    try {
        // 1) Copilot 내부 토큰 정보 (구독 상태)
        const tokenRes = await fetch(COPILOT_INTERNAL_TOKEN_URL, {
            headers: {
                "Authorization": `token ${token}`,
                "Accept": "application/json",
            },
        });

        let tokenData = {};
        if (tokenRes.ok) {
            tokenData = await tokenRes.json();
        }

        // 2) 사용자 프리미엄 요청 사용량
        const userRes = await fetch("https://api.github.com/copilot_internal/user", {
            headers: {
                "Authorization": `token ${token}`,
                "Accept": "application/json",
                "X-GitHub-Api-Version": "2024-11-01",
            },
        });

        let userData = {};
        if (userRes.ok) {
            userData = await userRes.json();
        }

        // UI 업데이트
        $("#copilot_usage_info").show();

        // 구독 플랜
        const plan = userData.copilot_plan || tokenData.sku || "알 수 없음";
        $("#copilot_plan").text(plan);

        // Chat 활성 여부
        $("#copilot_chat_enabled").text(
            tokenData.chat_enabled ? "✅ 활성" : (tokenData.chat_enabled === false ? "❌ 비활성" : "-")
        );

        // 토큰 만료
        if (tokenData.expires_at) {
            const expDate = new Date(tokenData.expires_at * 1000);
            $("#copilot_token_expires").text(expDate.toLocaleString("ko-KR"));
        }

        // 쿼터 리셋일 (= 구독 갱신일)
        if (userData.quota_reset_date) {
            const resetDate = new Date(userData.quota_reset_date);
            $("#copilot_renewal").text(resetDate.toLocaleDateString("ko-KR"));
        } else if (tokenData.expires_at) {
            const expDate = new Date(tokenData.expires_at * 1000);
            expDate.setDate(expDate.getDate() + 30);
            $("#copilot_renewal").text(expDate.toLocaleDateString("ko-KR") + " (추정)");
        }

        // 프리미엄 사용량 렌더링
        if (userData.quota_snapshots) {
            renderPremiumUsage(userData.quota_snapshots);
        }

        toastr.success("구독/사용량 정보를 불러왔습니다.");
    } catch (err) {
        toastr.error(`정보 조회 실패: ${err.message}`);
    } finally {
        $("#copilot_fetch_usage_btn").val("📊 사용량 확인").prop("disabled", false);
    }
}

function renderPremiumUsage(snapshots) {
    // 기존 프리미엄 테이블이 있으면 제거
    $("#copilot_premium_table").remove();

    let rows = "";
    for (const [key, val] of Object.entries(snapshots)) {
        const label = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        const unlimited = val.unlimited === true;
        const entitlement = typeof val.entitlement === "number" ? val.entitlement : null;
        const remaining = typeof val.remaining === "number" ? val.remaining : null;
        const used = (entitlement !== null && remaining !== null) ? Math.max(entitlement - remaining, 0) : null;

        const usedDisplay = unlimited ? "∞" : (remaining !== null ? remaining : "-");
        const limitDisplay = unlimited ? "∞" : (entitlement !== null ? entitlement : "-");

        const pctValue = (typeof val.percent_remaining === "number")
            ? Math.round(val.percent_remaining)
            : (entitlement && remaining !== null)
                ? Math.round((remaining / entitlement) * 100)
                : null;
        const pct = pctValue !== null ? ` (${pctValue}%)` : "";

        const color = (!unlimited && typeof used === "number" && typeof entitlement === "number" && used >= entitlement)
            ? "color:#f44336;" : "";

        rows += `<tr>
            <td>${label}:</td>
            <td style="${color}">${usedDisplay} / ${limitDisplay}${pct}</td>
        </tr>`;

        const overageCount = val.overage ?? val.overage_count;
        if (typeof overageCount === "number" && overageCount > 0) {
            rows += `<tr>
                <td style="padding-left:20px; color:#FF9800;">↳ 초과분:</td>
                <td style="color:#f44336;">${overageCount}</td>
            </tr>`;
        }
    }

    const tableHtml = `
        <div id="copilot_premium_table" class="copilot-info-box" style="margin-top:8px;">
            <b>📊 프리미엄 요청 사용량</b>
            <table class="copilot-usage-table" style="margin-top:6px;">
                ${rows}
            </table>
        </div>
    `;

    $("#copilot_usage_info").append(tableHtml);
}

// ============================================================
// 자동 재시도 로직 (외부에서 호출 가능)
// ============================================================
/**
 * Copilot Chat API를 자동 재시도와 함께 호출합니다.
 * 다른 확장이나 SillyTavern 커스텀 연동에서 사용할 수 있습니다.
 *
 * @param {Object} requestBody - chat/completions 요청 body
 * @returns {Promise<Object>} 응답 JSON
 */
async function copilotChatWithRetry(requestBody) {
    const s = getSettings();
    const token = s.token;
    if (!token) throw new Error("Copilot 토큰이 없습니다.");

    const maxRetries = s.autoRetry ? s.retryCount : 0;
    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(`${COPILOT_API_BASE}/chat/completions`, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "Copilot-Integration-Id": "vscode-chat",
                    "Editor-Version": "vscode/1.96.0",
                    "Editor-Plugin-Version": "copilot-chat/0.24.0",
                },
                body: JSON.stringify(requestBody),
            });

            if (res.ok) {
                const json = await res.json();
                recordRequest(true, attempt > 0);
                return json;
            }

            // 에러 처리
            const errBody = await res.text();
            const shouldRetry = checkShouldRetry(res.status, errBody, s);

            if (shouldRetry && attempt < maxRetries) {
                const s2 = getSettings();
                recordRequest(false, true);
                console.warn(`[GCM] 재시도 ${attempt + 1}/${maxRetries} (HTTP ${res.status})`);
                toastr.warning(`재시도 중... (${attempt + 1}/${maxRetries})`);
                await sleep(s2.retryDelay * 1000);
                continue;
            }

            lastError = `HTTP ${res.status}: ${errBody}`;
            recordRequest(false, attempt > 0);
            throw new Error(lastError);

        } catch (err) {
            if (attempt >= maxRetries) {
                recordRequest(false, attempt > 0);
                throw err;
            }
            lastError = err;
            await sleep(s.retryDelay * 1000);
        }
    }
    throw new Error(lastError || "알 수 없는 에러");
}

function checkShouldRetry(status, body, settings) {
    if (status === 400 && settings.retryOn400) return true;
    if (status === 429 && settings.retryOn429) return true;
    if (status >= 500 && settings.retryOn500) return true;
    if (settings.retryOnModelErr && body && body.toLowerCase().includes("model")) return true;
    return false;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// 유틸리티
// ============================================================
function copyToClipboard(text, label = "텍스트") {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            toastr.info(`${label} 복사 완료!`);
        });
    } else {
        // 폴백
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toastr.info(`${label} 복사 완료!`);
    }
}

// ============================================================
// 초기화
// ============================================================
jQuery(async () => {
    const settingsHtml = await $.get(`${extensionFolderPath}/settings.html`);
    $("#extensions_settings").append(settingsHtml);

    // --- 이벤트 바인딩 ---

    // 인증
    $("#copilot_auth_btn").on("click", startAuth);
    $("#copilot_revoke_btn").on("click", () => {
        const s = getSettings();
        s.token = "";
        saveSettings();
        $("#copilot_token_display").val("");
        $("#copilot_token_info").text("");
        toastr.info("토큰이 삭제되었습니다.");
    });

    // 코드 복사
    $("#copilot_copy_code_btn").on("click", () => {
        const code = $("#copilot_user_code").text();
        if (code) copyToClipboard(code, "인증 코드");
    });

    // 토큰 보기/숨기기
    $("#copilot_toggle_token_btn").on("click", () => {
        const input = $("#copilot_token_display");
        if (input.attr("type") === "password") {
            input.attr("type", "text");
            $("#copilot_toggle_token_btn").val("🙈");
        } else {
            input.attr("type", "password");
            $("#copilot_toggle_token_btn").val("👁️");
        }
    });

    // 토큰 직접 입력 저장
    $("#copilot_save_token_btn").on("click", () => {
        const token = $("#copilot_token_display").val().trim();
        const s = getSettings();
        s.token = token;
        saveSettings();
        if (token) {
            $("#copilot_token_info").text("토큰이 저장되어 있습니다.");
            toastr.success("토큰이 저장되었습니다.");
        } else {
            $("#copilot_token_info").text("");
            toastr.info("토큰이 비어 있습니다.");
        }
    });

    $("#copilot_token_display").on("change", () => {
        const token = $("#copilot_token_display").val().trim();
        const s = getSettings();
        s.token = token;
        saveSettings();
        if (token) {
            $("#copilot_token_info").text("토큰이 저장되어 있습니다.");
        } else {
            $("#copilot_token_info").text("");
        }
    });

    $("#copilot_token_display").on("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            $("#copilot_save_token_btn").trigger("click");
        }
    });

    // 토큰 복사
    $("#copilot_copy_token_btn").on("click", () => {
        const token = getSettings().token;
        if (token) copyToClipboard(token, "토큰");
        else toastr.warning("저장된 토큰이 없습니다.");
    });

    // 모델 목록
    $("#copilot_fetch_models_btn").on("click", fetchModels);

    // 사용량
    $("#copilot_fetch_usage_btn").on("click", fetchUsageInfo);

    // 자동 재시도 토글
    $("#copilot_auto_retry").on("input", function () {
        const checked = $(this).prop("checked");
        getSettings().autoRetry = checked;
        saveSettings();
        if (checked) {
            $("#copilot_retry_options").slideDown();
        } else {
            $("#copilot_retry_options").slideUp();
        }
    });

    // 재시도 설정 변경
    $("#copilot_retry_count").on("change", function () {
        getSettings().retryCount = parseInt($(this).val()) || 3;
        saveSettings();
    });
    $("#copilot_retry_delay").on("change", function () {
        getSettings().retryDelay = parseInt($(this).val()) || 2;
        saveSettings();
    });
    $("#copilot_retry_on_400").on("change", function () {
        getSettings().retryOn400 = $(this).prop("checked");
        saveSettings();
    });
    $("#copilot_retry_on_model_err").on("change", function () {
        getSettings().retryOnModelErr = $(this).prop("checked");
        saveSettings();
    });
    $("#copilot_retry_on_429").on("change", function () {
        getSettings().retryOn429 = $(this).prop("checked");
        saveSettings();
    });
    $("#copilot_retry_on_500").on("change", function () {
        getSettings().retryOn500 = $(this).prop("checked");
        saveSettings();
    });

    // 통계 초기화
    $("#copilot_reset_stats_btn").on("click", () => {
        getSettings().stats = { total: 0, success: 0, fail: 0, retries: 0 };
        saveSettings();
        updateStatsUI();
        toastr.info("통계가 초기화되었습니다.");
    });

    // 설정 로드
    loadSettings();
});

// 외부에서 사용할 수 있도록 export
window.copilotChatWithRetry = copilotChatWithRetry;