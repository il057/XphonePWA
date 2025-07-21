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
        console.error("Could not fetch playlists due to CORS or network issue. This is expected in some browser environments.");
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

// 这个函数现在主要由iOS PWA的手动流程调用
export async function getAccessToken(code) {
    const verifier = localStorage.getItem("spotify_code_verifier");
    if (!verifier) {
        alert("登录失败：会话验证信息丢失。请重新尝试登录。");
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

        // 清理URL中的授权码 (如果存在)
        if (window.location.search.includes('spotify_code')) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        // 成功后，初始化播放器并跳转到 music.html
        if (window.Spotify && !isPlayerInitialized) {
             initializePlayer(accessToken);
        }
        // 如果当前不在music.html，则跳转过去
        if (!window.location.pathname.endsWith('music.html')) {
            window.location.href = 'music.html';
        } else {
            // 如果已经在music.html，手动触发登录事件来刷新UI
            document.dispatchEvent(new CustomEvent('spotifyLoggedIn'));
        }

    } catch (error) {
        console.error("用授权码交换令牌失败:", error);
        alert(`登录失败: ${error.message}`);
        if (window.location.search.includes('spotify_code')) {
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    }
}

// **修改: 启动逻辑，重新加入对URL参数的处理**
(async () => {
    const params = new URLSearchParams(window.location.search);
    // 这个 'spotify_code' 是我们自己定义，用于从Safari安全地传递code回PWA
    const code = params.get('spotify_code');

    if (code) {
        // 如果URL中有code，说明是自动登录流程，直接调用getAccessToken
        await getAccessToken(code);
    } else {
        // 正常启动应用，检查是否存在有效token
        const validToken = await ensureValidToken();
        if (validToken && window.Spotify && !isPlayerInitialized) {
            initializePlayer(validToken);
        }
    }
})();


function generateCodeVerifier(length) { let text = ''; let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < length; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); } return text; }
async function generateCodeChallenge(codeVerifier) { const data = new TextEncoder().encode(codeVerifier); const digest = await window.crypto.subtle.digest('SHA-256', data); return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }