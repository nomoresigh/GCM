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
    stats: { total: 0, success: 0, fail: 0 },
};

let pollInterval = null;

/**
 * SillyTavern의 CORS 프록시(/proxy/)를 통해 외부 API에 요청합니다.
 * config.yaml에서 enableCorsProxy: true 필요
 * @param {string} url 요청할 외부 URL
 * @param {RequestInit} [options] fetch 옵션
 * @returns {Promise<Response>} fetch 응답
 */
async function proxyFetch(url, options = {}) {
    const proxyUrl = `/proxy/${encodeURIComponent(url)}`;

    const headers = {};
    if (options.headers) {
        if (options.headers instanceof Headers) {
            options.headers.forEach((v, k) => { headers[k] = v; });
        } else {
            Object.assign(headers, options.headers);
        }
    }

    const fetchOptions = {
        method: options.method || "GET",
        headers: headers,
    };

    if (options.body != null) {
        fetchOptions.body = options.body;
    }

    return fetch(proxyUrl, fetchOptions);
}

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
    updateStatsUI();
}

function saveSettings() {
    saveSettingsDebounced();
}

function getSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = JSON.parse(JSON.stringify(defaultSettings));
    }
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
}

function recordRequest(success) {
    const s = getSettings();
    if (!s.stats) s.stats = { total: 0, success: 0, fail: 0 };
    s.stats.total++;
    if (success) s.stats.success++;
    else s.stats.fail++;
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
        const res = await proxyFetch(GITHUB_DEVICE_CODE_URL, {
            method: "POST",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                client_id: CLIENT_ID,
                scope: "read:user user:email copilot",
            }),
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
            const res = await proxyFetch(GITHUB_OAUTH_TOKEN_URL, {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    client_id: CLIENT_ID,
                    device_code: deviceCode,
                    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                }),
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
        const res = await proxyFetch(`${COPILOT_API_BASE}/models`, {
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

        if (models.length === 0) {
            $("#copilot_models_list").empty().hide();
            $("#copilot_model_detail").hide();
            $("#copilot_toggle_models_btn").hide();
            setModelsPanelCollapsed(true);
            toastr.warning("가져올 수 있는 모델이 없습니다.");
            return;
        }

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
    $("#copilot_toggle_models_btn").show();
    setModelsPanelCollapsed(false);

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
                setModelsPanelCollapsed(false);
                $("#copilot_model_detail").show();
                $("#copilot_model_json").val(JSON.stringify(m, null, 2));
            });

            groupHtml.append(modelEl);
        }
        container.append(groupHtml);
    }
}

function setModelsPanelCollapsed(collapsed) {
    const panel = $("#copilot_models_panel");
    const button = $("#copilot_toggle_models_btn");
    if (collapsed) {
        panel.slideUp(150);
        button.val("▸ 펼치기");
    } else {
        panel.slideDown(150);
        button.val("▾ 접기");
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
        const tokenRes = await proxyFetch(COPILOT_INTERNAL_TOKEN_URL, {
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
        const userRes = await proxyFetch("https://api.github.com/copilot_internal/user", {
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
        const remaining = typeof val.remaining === "number" ? val.remaining : null;

        const remainingDisplay = unlimited
            ? "∞회 남음"
            : (remaining !== null ? `${remaining}회 남음` : "-");

        const color = (!unlimited && typeof remaining === "number" && remaining <= 0)
            ? "color:#f44336;" : "";

        rows += `<tr>
            <td>${label}:</td>
            <td style="${color}">${remainingDisplay}</td>
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
    $("#copilot_toggle_models_btn").on("click", () => {
        const panelVisible = $("#copilot_models_panel").is(":visible");
        setModelsPanelCollapsed(panelVisible);
    });

    // 사용량
    $("#copilot_fetch_usage_btn").on("click", fetchUsageInfo);

    // 통계 초기화
    $("#copilot_reset_stats_btn").on("click", () => {
        getSettings().stats = { total: 0, success: 0, fail: 0, retries: 0 };
        saveSettings();
        updateStatsUI();
        toastr.info("통계가 초기화되었습니다.");
    });

    // 설정 로드
    loadSettings();
    setModelsPanelCollapsed(true);

});