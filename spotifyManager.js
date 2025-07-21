// spotifyManager.js

const clientId = '5ca835c1531e4e6ba28decdd1913ca18';
//const redirectUri = 'http://127.0.0.1:5500/music.html';
const redirectUri = 'https://il057.github.io/XphonePWA/music.html';

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
    // 关键：将 verifier 存入 PWA 自己的 localStorage
    localStorage.setItem("spotify_code_verifier", verifier);
    const params = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'streaming user-read-email user-read-private playlist-read-private user-modify-playback-state',
        code_challenge_method: 'S256',
        code_challenge: challenge,
    });
    // 跳转到外部浏览器
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
        console.error("无法获取播放列表:", error);
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

// **新增: 专门处理粘贴的授权码的函数**
export async function getAccessToken(code) {
    // 从 PWA 的 localStorage 中安全地取出 verifier
    const verifier = localStorage.getItem("spotify_code_verifier");
    if (!verifier) {
        alert("登录失败：无法找到本地验证信息。请重新点击登录按钮开始。");
        return;
    }

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

        // 手动触发登录成功事件
        document.dispatchEvent(new CustomEvent('spotifyLoggedIn'));

    } catch (error) {
        console.error("用授权码交换令牌失败:", error);
        alert(`登录失败: ${error.message}`);
    }
}


// **修改: 启动逻辑**
// 移除旧的、依赖URL参数的自动处理逻辑，只在正常加载时初始化播放器
(async () => {
    const validToken = await ensureValidToken();
    if (validToken && window.Spotify && !isPlayerInitialized) {
        initializePlayer(validToken);
    }
})();

function generateCodeVerifier(length) { let text = ''; let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < length; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); } return text; }
async function generateCodeChallenge(codeVerifier) { const data = new TextEncoder().encode(codeVerifier); const digest = await window.crypto.subtle.digest('SHA-256', data); return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }