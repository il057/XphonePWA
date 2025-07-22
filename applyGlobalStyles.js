// settings.js
// Import the shared database instance from db.js
import { db } from './db.js';
import { runActiveSimulationTick } from './simulationEngine.js';


/**
 * 全局样式应用函数
 * 该函数会连接到ChatDB，读取并应用壁纸、主题色和字体。
 */
async function applyGlobalStyles() {
    try {
        await db.open(); // 确保数据库已打开
        const settings = await db.globalSettings.get('main');

        // 如果没有设置，则不执行任何操作
        if (!settings) {
            console.log("未找到全局设置，使用默认样式。");
            return;
        }

        // --- 1. 应用壁纸 ---
        const wallpaperValue = settings.wallpaper;
        // 在所有页面上寻找一个带有 .wallpaper-bg 的元素来应用壁纸
        const wallpaperTarget = document.querySelector('.wallpaper-bg'); 
        if (wallpaperTarget && wallpaperValue) {
            if (wallpaperValue.startsWith('url(') || wallpaperValue.startsWith('linear-gradient')) {
                wallpaperTarget.style.backgroundImage = wallpaperValue;
                wallpaperTarget.style.backgroundColor = 'transparent';
            } else { // 假定是纯色值
                wallpaperTarget.style.backgroundImage = 'none';
                wallpaperTarget.style.backgroundColor = wallpaperValue;
            }
        }
        
        // --- 2. 应用主题色 ---
        const themeColor = settings.themeColor || '#3b82f6';
        const root = document.documentElement;
        root.style.setProperty('--theme-color', themeColor);
        root.style.setProperty('--theme-color-hover', shadeColor(themeColor, -15));

        // --- 3. 应用字体 ---
        const fontUrl = settings.fontUrl;
        const existingStyleTag = document.getElementById('global-styles-tag');
        if (fontUrl && fontUrl.trim() !== '') {
            const fontName = 'global-user-font';
            let styleTag = existingStyleTag;
            if (!styleTag) {
                styleTag = document.createElement('style');
                styleTag.id = 'global-styles-tag';
                document.head.appendChild(styleTag);
            }
            styleTag.textContent = `
                @font-face {
                    font-family: '${fontName}';
                    src: url('${fontUrl}');
                    font-display: swap;
                }
                body {
                    font-family: '${fontName}', 'Inter', sans-serif !important;
                }
            `;
        } else if (existingStyleTag) {
            // 如果字体URL为空，则移除样式
            existingStyleTag.remove();
        }

    } catch (error) {
        console.error("应用全局样式失败:", error);
    }
}

function shadeColor(color, percent) {
    if (!color.startsWith('#')) return color;
    let R = parseInt(color.substring(1, 3), 16);
    let G = parseInt(color.substring(3, 5), 16);
    let B = parseInt(color.substring(5, 7), 16);
    R = parseInt(R * (100 + percent) / 100);
    G = parseInt(G * (100 + percent) / 100);
    B = parseInt(B * (100 + percent) / 100);
    R = (R < 255) ? R : 255;
    G = (G < 255) ? G : 255;
    B = (B < 255) ? B : 255;
    const RR = ((R.toString(16).length === 1) ? "0" + R.toString(16) : R.toString(16));
    const GG = ((G.toString(16).length === 1) ? "0" + G.toString(16) : G.toString(16));
    const BB = ((B.toString(16).length === 1) ? "0" + B.toString(16) : B.toString(16));
    return "#" + RR + GG + BB;
}


async function checkAndRunBackgroundSimulation() {
    try {
        const settings = await db.globalSettings.get('main');
        
        // 检查功能是否开启
        if (!settings || !settings.enableBackgroundActivity) {
            return;
        }

        const now = Date.now();
        const lastTick = settings.lastActiveSimTick || 0;
        const interval = (settings.backgroundActivityInterval || 60) * 1000; // 转换为毫秒

        // 如果距离上次心跳的时间超过了设定的间隔
        if (now - lastTick > interval) {
            // 更新时间戳，防止重复执行
            await db.globalSettings.update('main', { lastActiveSimTick: now });
            // 执行心跳任务
            await runActiveSimulationTick();
        }
    } catch (error) {
        console.error("后台活动模拟检查失败:", error);
    }
    }
async function checkFooterNotifications() {
    const lastView = parseInt(localStorage.getItem('lastMomentsViewTimestamp') || '0');
    const newMomentsCount = await db.xzonePosts.where('timestamp').above(lastView).count();

    const unreadChatsCount = await db.chats.where('unreadCount').above(0).count();
    const chatDockItem = document.querySelector('.dock-item[href="chat.html"]');
    if (chatDockItem) {
        chatDockItem.classList.toggle('has-unread-glow', unreadChatsCount > 0);
    }

    const momentsDockItem = document.querySelector('.dock-item[href="moments.html"]');
    if (momentsDockItem) {
        momentsDockItem.classList.toggle('has-unread-glow', newMomentsCount > 0);
    }

    const chatIconLink = document.querySelector('a.app-icon-link[href="chat.html"]');
    if (chatIconLink) {
        chatIconLink.classList.toggle('has-unread-glow', unreadChatsCount > 0);
    }
    const summaryCount = await db.offlineSummary.count();
    const summaryIconLink = document.querySelector('a.app-icon-link[href="summary.html"]');
    if (summaryIconLink) {
        summaryIconLink.classList.toggle('has-unread-glow', summaryCount > 0);
    }
    
}


// 在页面加载时，同时执行样式应用和后台模拟启动
document.addEventListener('DOMContentLoaded', async() => {
    applyGlobalStyles();
    checkFooterNotifications();
});

window.addEventListener('load', async () => {
    await checkAndRunBackgroundSimulation();
});

function calcHeaderHeight(){
  const h = document.querySelector('.app-header')?.offsetHeight||56;
  document.documentElement.style.setProperty('--header-height',`${h}px`);
}
window.addEventListener('resize',calcHeaderHeight);
document.addEventListener('DOMContentLoaded',calcHeaderHeight);
