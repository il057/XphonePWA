// phone/music.js

import * as spotifyManager from './spotifyManager.js';

document.addEventListener('DOMContentLoaded', () => {
    const musicContainer = document.getElementById('music-container');
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');

    // **关键的环境检测**
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    // isStandalone 检查应用是否以PWA模式运行
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isIosPwa = isIOS && isStandalone;

    // **场景1: 从Spotify回调到Safari浏览器**
    if (code) {
        // 如果是在iOS的Safari中（而不是在PWA模式下），则显示手动返回按钮
        // 这通常意味着用户是从PWA跳转过来进行授权的
        if (isIOS && !isStandalone) {
            musicContainer.innerHTML = `<div class="text-center p-8">
                <p class="font-semibold text-lg">即将完成！</p>
                <p class="text-gray-600 mt-2">请点击下方按钮，返回 Xphone 完成登录。</p>
                <a href="index.html?spotify_code=${code}" class="mt-6 inline-block bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-8 rounded-full shadow-lg">
                    返回 Xphone 应用
                </a>
            </div>`;
        } else {
            // 在其他平台（如桌面浏览器），尝试自动跳转回 PWA 的 index.html
            // PWA会从URL中读取 'spotify_code' 并完成登录
            window.location.replace(`index.html?spotify_code=${code}`);
            musicContainer.innerHTML = `<div class="text-center p-8"><p>正在完成登录，请稍候...</p></div>`;
        }
        return; // 停止执行此页面的其余脚本，因为它只是一个中转页
    }

    if (error) {
        musicContainer.innerHTML = `<div class="text-center p-8">
            <p class="font-semibold text-lg text-red-600">登录已取消</p>
            <p class="text-gray-600 mt-2">您已取消授权流程。</p>
            <a href="index.html" class="mt-4 inline-block text-blue-500">返回应用</a>
        </div>`;
        return;
    }

    // **场景2: 在PWA应用内打开音乐页面**
    // 如果是iOS PWA，则显示手动输入框；否则只显示登录按钮
    renderStatus(isIosPwa);
    document.addEventListener('spotifyLoggedIn', () => renderStatus(isIosPwa));
    document.addEventListener('spotifyLoggedOut', () => renderStatus(isIosPwa));
});


async function renderStatus(isIosPwa = false) {
    const musicContainer = document.getElementById('music-container');

    if (spotifyManager.isLoggedIn()) {
        // ... (登录成功后的UI部分保持不变)
        try {
            const token = localStorage.getItem('spotify_access_token');
            const response = await fetch("https://api.spotify.com/v1/me", {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (!response.ok) {
                await spotifyManager.refreshAccessToken();
                renderStatus(isIosPwa);
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
        // **根据是否为iOS PWA，决定是否显示手动输入框**
        const manualInputSection = `
            <div class="mt-8 pt-8 border-t">
                <p class="text-gray-600 mb-2">第2步：粘贴授权码 (仅iOS)</p>
                <div class="flex gap-2">
                    <input type="text" id="paste-code-input" placeholder="从浏览器粘贴授权码" class="w-full p-2 border rounded-md text-center">
                    <button id="submit-code-btn" class="px-4 py-2 bg-green-500 text-white rounded-md font-semibold">提交</button>
                </div>
            </div>
        `;

        musicContainer.innerHTML = `
            <div id="login-view" class="text-center py-8 px-4">
                <p class="font-semibold text-lg mb-2">第1步：获取授权</p>
                <button id="login-btn" class="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-full inline-flex items-center">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-spotify mr-2" viewBox="0 0 16 16"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0m3.669 11.538a.5.5 0 0 1-.686.165c-1.879-1.147-4.243-1.407-7.028-.77a.499.499 0 0 1-.222-.973c3.048-.696 5.662-.397 7.77.892a.5.5 0 0 1 .166.686m.979-2.178a.624.624 0 0 1-.858.205c-2.15-1.321-5.428-1.704-7.972-.932a.625.625 0 0 1-.362-1.194c2.905-.881 6.517-.454 8.986 1.063a.624.624 0 0 1 .206.858m.084-2.268C10.154 5.56 5.9 5.419 3.438 6.166a.748.748 0 1 1-.434-1.432c2.825-.857 7.523-.692 10.492 1.07a.747.747 0 1 1-.764 1.288"/></svg>
                    前往 Spotify 登录
                </button>
                ${isIosPwa ? manualInputSection : ''}
            </div>
        `;
        document.getElementById('login-btn').addEventListener('click', spotifyManager.login);
        
        // 只在iOS PWA模式下才添加提交按钮的监听器
        if (isIosPwa) {
            document.getElementById('submit-code-btn').addEventListener('click', () => {
                const pastedCode = document.getElementById('paste-code-input').value.trim();
                if (pastedCode) {
                    spotifyManager.getAccessToken(pastedCode);
                } else {
                    alert("请输入从浏览器获取的授权码");
                }
            });
        }
    }
}