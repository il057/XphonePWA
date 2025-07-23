// phone/music.js

import * as spotifyManager from './spotifyManager.js';

document.addEventListener('DOMContentLoaded', () => {
    const musicContainer = document.getElementById('music-container');
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    // **关键的环境检测**
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

    // --- 逻辑分发：处理来自Spotify的回调 ---
    if (code) {
        // 检查是否是iOS设备，并且当前不是在PWA(standalone)模式下运行
        // 这精确地匹配了从Spotify授权后跳回Safari的场景
        if (isIOS && !isStandalone) {
            // 场景A: 如果是iOS设备上的浏览器，显示手动复制界面
            musicContainer.innerHTML = `
                <div class="text-center p-4">
                    <p class="font-semibold text-lg mb-2">登录第2步：复制授权码</p>
                    <p class="text-gray-600 mb-4">请复制下方代码，然后手动返回Xphone应用，并粘贴到音乐页面的输入框中。</p>
                    <input type="text" readonly value="${code}" onclick="this.select(); document.execCommand('copy'); alert('已复制到剪贴板!');" class="w-full p-2 text-center border rounded-md bg-gray-100 mb-4 cursor-pointer">
            </div>`;
        } else {
            // 场景B: 其他所有设备（如Android, PC等），或者在某些意外情况下，执行原来的自动跳转逻辑
            window.location.replace(`index.html?spotify_code=${code}`);
        }
        return; // 停止后续脚本执行
    }

    if (error) {
        musicContainer.innerHTML = `<div class="text-center p-8">
            <p class="font-semibold text-lg text-red-600">登录已取消</p>
            <p class="text-gray-600 mt-2">您已取消授权流程。</p>
            <a href="index.html" class="mt-4 inline-block text-blue-500">返回应用</a>
        </div>`;
        return;
    }

    // PWA应用内音乐页面的正常逻辑
    renderStatus();
    document.addEventListener('spotifyLoggedIn', renderStatus);
    document.addEventListener('spotifyLoggedOut', renderStatus);
});


async function renderStatus() {
    const musicContainer = document.getElementById('music-container');
    
    // --- 同样需要平台检测 ---
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIosPWA = isIOS && isStandalone;

    if (spotifyManager.isLoggedIn()) {
        try {
            const token = localStorage.getItem('spotify_access_token');
            const response = await fetch("https://api.spotify.com/v1/me", {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) {
                await spotifyManager.refreshAccessToken();
                renderStatus();
                return;
            }
            const profile = await response.json();
            musicContainer.innerHTML = `
                <div class="text-center">
                    <img src="${profile.images?.[0]?.url || ''}" class="w-24 h-24 rounded-full mx-auto mb-4 shadow-lg">
                    <p class="font-semibold text-lg">已作为 ${profile.display_name} 登录</p>
                    <p class="text-gray-500 mt-2">现在可以前往任意聊天室<br>发起“一起听”功能了</p>
                    <div class="mt-8 pt-6 border-t">
                        <button id="logout-btn" class="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-5 rounded-full">
                            登出账号
                        </button>
                    </div>
                </div>
            `;
            document.getElementById('logout-btn').addEventListener('click', spotifyManager.logout);

        } catch (e) {
             musicContainer.innerHTML = `<p class="text-red-500">加载用户信息失败，请稍后再试。</p>`;
        }
    } else {
        // --- 根据平台显示不同的登录UI ---
        let loginHtml = `
            <div id="login-view" class="text-center py-16">
                <button id="login-btn" class="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-full inline-flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-spotify mr-2" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0m3.669 11.538a.5.5 0 0 1-.686.165c-1.879-1.147-4.243-1.407-7.028-.77a.499.499 0 0 1-.222-.973c3.048-.696 5.662-.397 7.77.892a.5.5 0 0 1 .166.686m.979-2.178a.624.624 0 0 1-.858.205c-2.15-1.321-5.428-1.704-7.972-.932a.625.625 0 0 1-.362-1.194c2.905-.881 6.517-.454 8.986 1.063a.624.624 0 0 1 .206.858m.084-2.268C10.154 5.56 5.9 5.419 3.438 6.166a.748.748 0 1 1-.434-1.432c2.825-.857 7.523-.692 10.492 1.07a.747.747 0 1 1-.764 1.288"/></svg>
                    使用 Spotify 登录
                </button>
            </div>
        `;

        // 如果是iOS PWA，则追加粘贴框
        if (isIosPWA) {
            loginHtml = `
                <div id="login-view" class="text-center py-8 px-4">
                    <p class="font-semibold text-lg mb-2">登录第1步：获取授权</p>
                    <button id="login-btn" class="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-full inline-flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-spotify mr-2" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0m3.669 11.538a.5.5 0 0 1-.686.165c-1.879-1.147-4.243-1.407-7.028-.77a.499.499 0 0 1-.222-.973c3.048-.696 5.662-.397 7.77.892a.5.5 0 0 1 .166.686m.979-2.178a.624.624 0 0 1-.858.205c-2.15-1.321-5.428-1.704-7.972-.932a.625.625 0 0 1-.362-1.194c2.905-.881 6.517-.454 8.986 1.063a.624.624 0 0 1 .206.858m.084-2.268C10.154 5.56 5.9 5.419 3.438 6.166a.748.748 0 1 1-.434-1.432c2.825-.857 7.523-.692 10.492 1.07a.747.747 0 1 1-.764 1.288"/></svg>
                        前往 Spotify 登录
                    </button>
                    <div class="mt-8 pt-8 border-t">
                        <p class="text-gray-600 mb-2">登录第3步：粘贴授权码</p>
                        <div class="flex gap-2">
                            <input type="text" id="paste-code-input" placeholder="在此处粘贴授权码" class="w-full p-2 border rounded-md text-center">
                            <button id="submit-code-btn" class="px-4 py-2 bg-green-500 text-white rounded-md font-semibold">完成登录</button>
                        </div>
                    </div>
                </div>
            `;
        }

        musicContainer.innerHTML = loginHtml;
        document.getElementById('login-btn').addEventListener('click', spotifyManager.login);
        
        if (isIosPWA) {
            document.getElementById('submit-code-btn').addEventListener('click', () => {
                const pastedCode = document.getElementById('paste-code-input').value.trim();
                if (pastedCode) {
                    spotifyManager.getAccessToken(pastedCode);
                } else {
                    alert("请输入授权码");
                }
            });
        }
    }
}