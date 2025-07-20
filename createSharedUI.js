// createSharedUI.js

function createStatusBar() {
    // 1. 定义状态栏的HTML结构
    const statusBarHTML = `
        <header class="absolute top-0 left-0 right-0 px-6 pt-4 text-white z-10">
            <div class="flex justify-between items-center text-sm font-medium" style="text-shadow: 0 1px 3px rgba(0,0,0,0.3);">
                <span id="time"></span>
                <div class="flex items-center space-x-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M2 2a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H2zm12 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h12z"/>
                        <path d="M2 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4z"/>
                    </svg>
                    <span>100%</span>
                </div>
            </div>
        </header>
    `;

    // 2. 将HTML插入到页面的最前面
    document.body.insertAdjacentHTML('afterbegin', statusBarHTML);
}

function updateClock() {
    const now = new Date();
    const timeOpts = { hour: 'numeric', minute: '2-digit', hour12: true };
    const timeEl = document.getElementById('time');
    
    // 注意：因为主屏幕的时钟和日期不在每个页面都有，
    // 所以这里的逻辑只更新状态栏的时钟。
    if (timeEl) {
        timeEl.textContent = now.toLocaleTimeString('en-US', timeOpts);
    }
}

// 页面加载完成后，创建状态栏并启动时钟
document.addEventListener('DOMContentLoaded', () => {
    createStatusBar();
    updateClock(); // 立即更新一次
    setInterval(updateClock, 30000); // 每30秒更新一次
});