const CACHE_NAME = 'xphone-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './sharedStyles.css',
  './db.js',
  './applyGlobalStyles.js',
  './simulationEngine.js',
  './spotifyManager.js',
  './chat.html',
  './chatRoom.html',
  './chatRoom.js',
  './contacts.html',
  './charPosts.html',
  './createSharedUI.js',
  './charProfile.html',
  './charEditProfile.html',
  './charEditProfile.js',
  './moments.html',
  './me.html',
  './me.js',
  './settings.html',
  './settings.js',
  './personalization.html',
  './personalization.js',
  './music.html',
  './music.js',
  './album.html',
  './summary.html',
  './worldbook.html',
  './worldbook.js',
  './worldbook-editor.html',
  './worldbook-editor.js',
  './favorites.html',
  './memories.html',
  './memories.js',
  './relationMap.html',
  './relationMap.js',
  './stickers.html',
  './stickers.js',
  './worldSetting.html',
  './worldSetting.js',
  './contactsPicker.html'
];

// 安装 Service Worker 并缓存文件
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// 拦截网络请求并从缓存中提供服务
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 如果缓存中有匹配的响应，则返回它
        if (response) {
          return response;
        }
        // 否则，正常发起网络请求
        return fetch(event.request);
      })
  );
});

// 激活 Service Worker 并清理旧缓存
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});