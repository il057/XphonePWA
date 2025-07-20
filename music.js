import * as spotifyManager from './spotifyManager.js';

document.addEventListener('DOMContentLoaded', () => {
    const musicContainer = document.getElementById('music-container');

    async function renderStatus() {
        if (spotifyManager.isLoggedIn()) {
            const token = localStorage.getItem('spotify_access_token');
            const response = await fetch("https://api.spotify.com/v1/me", {
                headers: { Authorization: `Bearer ${token}` }
            });
            const profile = await response.json();
            musicContainer.innerHTML = `
                <div class="text-center">
                    <img src="${profile.images?.[0]?.url || ''}" class="w-24 h-24 rounded-full mx-auto mb-4 shadow-lg">
                    <p class="font-semibold text-lg">已作为 ${profile.display_name} 登录</p>
                    <p class="text-gray-500 mt-2">现在可以前往任意聊天室<br>发起“一起听”功能了</p>
                </div>
            `;
        } else {
            musicContainer.innerHTML = `
                <div id="login-view" class="text-center py-16">
                    <button id="login-btn" class="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-6 rounded-full inline-flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" class="bi bi-spotify" viewBox="0 0 16 16">
                        <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0m3.669 11.538a.5.5 0 0 1-.686.165c-1.879-1.147-4.243-1.407-7.028-.77a.499.499 0 0 1-.222-.973c3.048-.696 5.662-.397 7.77.892a.5.5 0 0 1 .166.686m.979-2.178a.624.624 0 0 1-.858.205c-2.15-1.321-5.428-1.704-7.972-.932a.625.625 0 0 1-.362-1.194c2.905-.881 6.517-.454 8.986 1.063a.624.624 0 0 1 .206.858m.084-2.268C10.154 5.56 5.9 5.419 3.438 6.166a.748.748 0 1 1-.434-1.432c2.825-.857 7.523-.692 10.492 1.07a.747.747 0 1 1-.764 1.288"/>
                        </svg>
                        使用 Spotify 登录
                    </button>
                </div>
            `;
            document.getElementById('login-btn').addEventListener('click', spotifyManager.login);
        }
    }

    renderStatus();
});