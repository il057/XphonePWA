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

async function refreshAccessToken(refreshToken) {
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

(async () => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    if (code) {
        const verifier = localStorage.getItem("spotify_code_verifier");
        const tokenParams = new URLSearchParams({
            client_id: clientId,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: redirectUri,
            code_verifier: verifier,
        });
        try {
            const result = await fetch("https://accounts.spotify.com/api/token", { // **再次直接请求官方API**
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: tokenParams
            }).then(res => res.json());

            if (result.access_token) {
                accessToken = result.access_token;
                const expiresAt = Date.now() + result.expires_in * 1000;
                localStorage.setItem('spotify_access_token', accessToken);
                localStorage.setItem('spotify_refresh_token', result.refresh_token);
                localStorage.setItem('spotify_token_expires_at', expiresAt);
                
                //  成功获取token后，移除URL中的参数并尝试引导用户返回PWA**
                window.history.replaceState({}, document.title, "./music.html");
                
                // 给用户一个明确的提示
                const musicContainer = document.getElementById('music-container');
                if (musicContainer) {
                    musicContainer.innerHTML = `
                        <div class="text-center p-8">
                            <p class="font-semibold text-lg text-green-600">授权成功！</p>
                            <p class="text-gray-600 mt-2">请手动切换回 Xphone 应用。</p>
                            <p class="text-xs text-gray-400 mt-4">(如果PWA没有自动刷新，请手动重启)</p>
                        </div>
                    `;
                }
            } else {
                 throw new Error(result.error_description || '获取Token失败');
            }
        } catch(error) {
            console.error("处理回调时出错:", error);
            alert("登录失败: " + error.message);
        }
    }

    // 检查并初始化播放器
    const validToken = await ensureValidToken();
    if (validToken && window.Spotify && !isPlayerInitialized) {
        initializePlayer(validToken);
    }
})();

function generateCodeVerifier(length) { let text = ''; let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'; for (let i = 0; i < length; i++) { text += possible.charAt(Math.floor(Math.random() * possible.length)); } return text; }
async function generateCodeChallenge(codeVerifier) { const data = new TextEncoder().encode(codeVerifier); const digest = await window.crypto.subtle.digest('SHA-256', data); return btoa(String.fromCharCode.apply(null, [...new Uint8Array(digest)])).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }