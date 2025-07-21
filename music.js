// phone/music.js

import * as spotifyManager from './spotifyManager.js';

document.addEventListener('DOMContentLoaded', () => {
    const musicContainer = document.getElementById('music-container');
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    // 场景1: 用户从 Spotify 授权后带着 code 返回此页面
    if (code) {
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

        // 如果已经在 PWA 内部，则显示加载中，spotifyManager 会自动处理
        if (isStandalone) {
            musicContainer.innerHTML = `<div class="text-center p-8"><p>正在完成登录，请稍候...</p></div>`;
            return; // 停止脚本，交由 spotifyManager 处理
        }
        
        // 如果在 PWA 外部 (例如 iOS 的 Safari)，则必须显示手动复制指引
        musicContainer.innerHTML = `<div class="text-center p-8">
            <p class="font-semibold text-lg">授权成功！</p>
            <p class="text-gray-600 mt-2">请复制下面的授权码，然后手动返回 Xphone 应用并粘贴以完成登录。</p>
            <div class="my-4 p-3 bg-gray-200 rounded font-mono text-sm break-all">${code}</div>
            <button id="copy-code-btn" class="mt-2 inline-block bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-full shadow-lg">
                复制授权码
            </button>
        </div>`;
        document.getElementById('copy-code-btn').addEventListener('click', () => {
            navigator.clipboard.writeText(code).then(() => {
                alert('授权码已复制！');
            }, () => {
                alert('自动复制失败，请手动复制。');
            });
        });
        return; // 停止脚本，等待用户手动操作
    }

    // 场景2: 用户取消了授权
    if (error) {
        musicContainer.innerHTML = `<div class="text-center p-8">
            <p class="font-semibold text-lg text-red-600">登录已取消</p>
            <p class="text-gray-600 mt-2">您已取消授权流程。</p>
            <a href="index.html" class="mt-4 inline-block text-blue-500">返回应用</a>
        </div>`;
        return;
    }

    // 场景3: 正常加载 PWA 内的音乐页面
    renderStatus();
    document.addEventListener('spotifyLoggedIn', renderStatus);
    document.addEventListener('spotifyLoggedOut', renderStatus);
});

async function renderStatus() {
    const musicContainer = document.getElementById('music-container');

    if (spotifyManager.isLoggedIn()) {
        try {
            const token = localStorage.getItem('spotify_access_token');
            const response = await fetch("https://api.spotify.com/v1/me", {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) { // 如果token失效，尝试刷新
                await spotifyManager.refreshAccessToken();
                renderStatus(); // 再次渲染
                return;
            }
            const profile = await response.json();
            musicContainer.innerHTML = `
                <div class="text-center">
                    <img src="${profile.images?.[0]?.url || ''}" class="w-24 h-24 rounded-full mx-auto mb-4 shadow-lg">
                    <p class="font-semibold text-lg">已作为 ${profile.display_name} 登录</p>
                    <p class="text-gray-500 mt-2">现在可以前往任意聊天室<br>发起“一起听”功能了</p>
                </div>
            `;
        } catch (e) {
             musicContainer.innerHTML = `<p class="text-red-500">加载用户信息失败，请稍后再试。</p>`;
        }
    } else {
        musicContainer.innerHTML = `
            <div id="login-view" class="text-center py-8 px-4">
                <button id="login-btn" class="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-full inline-flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-spotify mr-2" viewBox="0 0 16 16">
                    <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0m3.669 11.538a.5.5 0 0 1-.686.165c-1.879-1.147-4.243-1.407-7.028-.77a.499.499 0 0 1-.222-.973c3.048-.696 5.662-.397 7.77.892a.5.5 0 0 1 .166.686m.979-2.178a.624.624 0 0 1-.858.205c-2.15-1.321-5.428-1.704-7.972-.932a.625.625 0 0 1-.362-1.194c2.905-.881 6.517-.454 8.986 1.063a.624.624 0 0 1 .206.858m.084-2.268C10.154 5.56 5.9 5.419 3.438 6.166a.748.748 0 1 1-.434-1.432c2.825-.857 7.523-.692 10.492 1.07a.747.747 0 1 1-.764 1.288"/>
                    </svg>
                    使用 Spotify 登录
                </button>
                <div class="mt-8 border-t pt-6">
                    <p class="text-gray-600 mb-2">如果您是在 iOS 上手动返回的应用，请在此处粘贴授权码：</p>
                    <input type="text" id="manual-code-input" class="form-input w-full max-w-sm mx-auto p-2 border rounded" placeholder="粘贴授权码...">
                    <button id="submit-code-btn" class="mt-3 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-5 rounded-full">
                        提交
                    </button>
                </div>
            </div>
        `;
        document.getElementById('login-btn').addEventListener('click', spotifyManager.login);
        document.getElementById('submit-code-btn').addEventListener('click', () => {
            const manualCode = document.getElementById('manual-code-input').value.trim();
            if (manualCode) {
                spotifyManager.handleManualCode(manualCode);
            } else {
                alert('请输入授权码。');
            }
        });
    }
}