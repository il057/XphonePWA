// 文件: spotifyManager.js

const clientId = '5ca835c1531e4e6ba28decdd1913ca18';
const redirectUri = 'https://il057.github.io/XphonePWA/music.html';
//const redirectUri = 'http://127.0.0.1:5500/music.html';

let player;
let deviceId;
let accessToken = localStorage.getItem('spotify_access_token') || null;
let isPlayerInitialized = false;

window.onSpotifyWebPlaybackSDKReady = () => {
    const token = localStorage.getItem('spotify_access_token');
    if (token) {
        initializePlayer(token);
    }
};

function initializePlayer(token) {
    if (isPlayerInitialized || !token) return;

    player = new Spotify.Player({
        name: 'XPhone Music Player',
        getOAuthToken: cb => { cb(token); }
    });

    player.addListener('player_state_changed', state => {
        const stateUpdateEvent = new CustomEvent('spotifyStateUpdate', { detail: state });
        document.dispatchEvent(stateUpdateEvent);
    });

    player.addListener('ready', ({ device_id }) => {
        deviceId = device_id;
        isPlayerInitialized = true;
        document.dispatchEvent(new CustomEvent('spotifyLoggedIn'));
    });

    player.addListener('not_ready', () => { isPlayerInitialized = false; });
    player.addListener('authentication_error', () => { refreshAccessToken(); });
    player.connect();
}

async function ensureValidToken() {
    const refreshToken = localStorage.getItem('spotify_refresh_token');
    const expiresAt = localStorage.getItem('spotify_token_expires_at');
    if (!accessToken || Date.now() >= Number(expiresAt)) {
        if (!refreshToken) return null;
        return await refreshAccessToken(refreshToken);
    }
    return accessToken;
}

export async function refreshAccessToken(refreshToken) {
    const storedRefreshToken = refreshToken || localStorage.getItem('spotify_refresh_token');
    if (!storedRefreshToken) return null;
    const params = new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: storedRefreshToken,
    });
    try {
        const result = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params
        }).then(res => res.json());

        if (result.error) throw new Error(result.error_description);

        accessToken = result.access_token;
        const newExpiresAt = Date.now() + result.expires_in * 1000;
        localStorage.setItem('spotify_access_token', accessToken);
        localStorage.setItem('spotify_token_expires_at', newExpiresAt);
        if (result.refresh_token) {
            localStorage.setItem('spotify_refresh_token', result.refresh_token);
        }
        initializePlayer(accessToken);
        return accessToken;
    } catch (error) {
        logout();
        return null;
    }
}

export function isLoggedIn() { return !!accessToken; }

export async function login() {
    const verifier = generateCodeVerifier(128);
    const challenge = await generateCodeChallenge(verifier);
    localStorage.setItem("spotify_code_verifier", verifier);
    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'streaming user-read-email user-read-private playlist-read-private user-modify-playback-state',
        code_challenge_method: 'S256',
        code_challenge: challenge,
    });
    document.location = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

function logout() {
    accessToken = null;
    localStorage.removeItem('spotify_access_token');
    localStorage.removeItem('spotify_refresh_token');
    localStorage.removeItem('spotify_token_expires_at');
    if(player) player.disconnect();
    isPlayerInitialized = false;
    document.dispatchEvent(new CustomEvent('spotifyLoggedOut'));
}

export async function getUserPlaylists() {
    const token = await ensureValidToken();
    if (!token) return [];
    try {
        const response = await fetch("https://api.spotify.com/v1/me/playlists", {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (!response.ok) return [];
        const data = await response.json();
        return data.items || [];
    } catch (error) {
        console.error("无法获取播放列表，这可能是由于网络或CORS问题。", error);
        return [];
    }
}

export async function playPlaylist(playlistUri) {
    const token = await ensureValidToken();
    if (!token || !deviceId) return;
    fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        body: JSON.stringify({ context_uri: playlistUri }),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
}

export async function toggleShuffle(shuffleState) {
    const token = await ensureValidToken();
    if (!token || !deviceId) return;
    fetch(`https://api.spotify.com/v1/me/player/shuffle?state=${shuffleState}&device_id=${deviceId}`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` },
    });
}

export function togglePlay() { if (player) player.togglePlay(); }
export function nextTrack() { if (player) player.nextTrack(); }
export function previousTrack() { if (player) player.previousTrack(); }

// **新增：处理手动提交的 code**
export async function handleManualCode(code) {
    const verifier = localStorage.getItem("spotify_code_verifier");
    if (!verifier) {
        alert("登录失败：验证信息已过期，请重新登录。");
        return;
    }
    const musicContainer = document.getElementById('music-container');
    if (musicContainer) {
        musicContainer.innerHTML = `<div class="text-center p-8"><p>正在完成登录，请稍候...</p></div>`;
    }
    await getAccessToken(code, verifier);
}

// **重构：将 Token 获取逻辑独立出来**
async function getAccessToken(code, verifier) {
    const tokenParams = new URLSearchParams({
        client_id: clientId,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
    });

    try {
        const result = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: tokenParams
        }).then(res => res.json());

        if (result.error) {
            throw new Error(result.error_description || result.error);
        }
        
        accessToken = result.access_token;
        const expiresAt = Date.now() + result.expires_in * 1000;
        localStorage.setItem('spotify_access_token', accessToken);
        localStorage.setItem('spotify_refresh_token', result.refresh_token);
        localStorage.setItem('spotify_token_expires_at', expiresAt);
        localStorage.removeItem("spotify_code_verifier");

        if (window.Spotify) {
            if (player) player.disconnect();
            isPlayerInitialized = false;
            initializePlayer(accessToken);
        }
        
        // 发出事件，让 music.js 更新UI
        document.dispatchEvent(new CustomEvent('spotifyLoggedIn'));

    } catch (error) {
        console.error("用授权码交换令牌失败:", error);
        alert(`登录失败: ${error.message}`);
        // 登录失败时也触发登出事件，以重置UI到初始状态
        document.dispatchEvent(new CustomEvent('spotifyLoggedOut'));
    }
}

// **简化自执行函数，只处理自动流程**
(async () => {
    const params = new URLSearchParams(window.location.search);
    const codeFromUrl = params.get('code');

    if (codeFromUrl) {
        const verifier = localStorage.getItem("spotify_code_verifier");
        window.history.replaceState({}, document.title, window.location.pathname); // 立即清理URL
        
        if (verifier && window.matchMedia('(display-mode: standalone)').matches) {
            // 只有在PWA模式下且有verifier时，才尝试自动登录
            await getAccessToken(codeFromUrl, verifier);
        }
    } else {
        // 正常启动，检查旧token
        const validToken = await ensureValidToken();
        if (validToken && window.Spotify && !isPlayerInitialized) {
            initializePlayer(validToken);
        }
    }
})();

// PKCE 辅助函数 (保持不变)
function generateCodeVerifier(length) { let text = ''; let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < length; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); } return text; }
async function generateCodeChallenge(codeVerifier) { const data = new TextEncoder().encode(codeVerifier); const digest = await window.crypto.subtle.digest('SHA-256', data); return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }