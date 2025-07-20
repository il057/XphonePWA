// phone/memories.js
import { db } from './db.js';

document.addEventListener('DOMContentLoaded', async () => {

    // --- DOM Elements ---
    const listEl = document.getElementById('memories-list');
    const filterBtn = document.getElementById('filter-btn');
    const filterModal = document.getElementById('filter-modal');
    const charFilterSelect = document.getElementById('char-filter-select');
    const applyFilterBtn = document.getElementById('apply-filter');
    const cancelFilterBtn = document.getElementById('cancel-filter');
    const editModal = document.getElementById('edit-modal');
    const editTextArea = document.getElementById('edit-textarea');
    const saveEditBtn = document.getElementById('save-edit');
    const cancelEditBtn = document.getElementById('cancel-edit');
    const headerTitle = document.querySelector('h1.text-base'); // 获取标题元素
    const backBtn = document.querySelector('a.header-btn');     // 获取返回按钮
    const filterBtnContainer = document.getElementById('filter-btn').parentElement; // 获取筛选按钮的容器
    
    
    // --- State ---
    let allMemories = [];
    let allChats = {};
    let activeTimers = [];
    let currentFilter = 'all';
    let editingMemoryId = null;
    let themeColor = '#3b82f6';
    const defaultAvatar = 'https://files.catbox.moe/kkll8p.svg';

    // --- Data Loading ---
    async function loadData() {
        [allMemories, allChats] = await Promise.all([
            db.memories.orderBy('timestamp').reverse().toArray(),
            db.chats.toArray().then(chats => chats.reduce((acc, chat) => {
                acc[chat.id] = chat;
                return acc;
            }, {}))
        ]);
        populateFilterDropdown();
    }

    // --- Rendering ---
    function renderMemories() {
        // Stop previous timers
        activeTimers.forEach(clearInterval);
        activeTimers = [];
        listEl.innerHTML = '';

        const memoriesToRender = allMemories.filter(mem => {
            if (currentFilter === 'all') return true;
            return mem.authorName === currentFilter;
        });

        memoriesToRender.sort((a, b) => {
            const scoreA = (a.type === 'countdown' && a.targetDate > Date.now() ? 20 : 0) + (a.isImportant ? 10 : 0);
            const scoreB = (b.type === 'countdown' && b.targetDate > Date.now() ? 20 : 0) + (b.isImportant ? 10 : 0);
            if (scoreA !== scoreB) {
                return scoreB - scoreA;
            }
            return b.timestamp - a.timestamp; // 如果重要性相同，则按时间排序
        });


        if (memoriesToRender.length === 0) {
            listEl.innerHTML = '<p class="text-center text-gray-500 py-8">没有找到相关回忆或约定</p>';
            return;
        }

        memoriesToRender.forEach(item => {
            let card;
            if (item.type === 'countdown') {
                card = createCountdownCard(item);
            } else {
                card = createDiaryCard(item);
            }
            listEl.appendChild(card);
        });
    }

    function createDiaryCard(memory) {
        const card = document.createElement('div');
        // 核心记忆不再有特殊背景色，只通过边框和图钉颜色区分
        card.className = "bg-white p-4 rounded-lg shadow-sm flex flex-col gap-3";
        if (memory.isImportant) {
            card.classList.add('border-l-4');
            card.style.borderColor = themeColor;
        }

        const memoryDate = new Date(memory.timestamp);
        const dateString = `${memoryDate.getFullYear()}-${String(memoryDate.getMonth() + 1).padStart(2, '0')}-${String(memoryDate.getDate()).padStart(2, '0')} ${String(memoryDate.getHours()).padStart(2, '0')}:${String(memoryDate.getMinutes()).padStart(2, '0')}`;
        
        const chat = allChats[memory.chatId];
        const authorName = chat ? chat.name : memory.authorName;
        const authorAvatar = chat ? (chat.settings.aiAvatar || defaultAvatar) : defaultAvatar;

        const pinIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M4.146.146A.5.5 0 0 1 4.5 0h7a.5.5 0 0 1 .5.5c0 .68-.342 1.174-.646 1.479-.126.125-.25.224-.354.298v4.431l.078.048c.203.127.476.314.751.555C12.36 7.775 13 8.527 13 9.5a.5.5 0 0 1-.5.5h-4v4.5c0 .276-.224.5-.5.5s-.5-.224-.5-.5V10h-4a.5.5 0 0 1-.5-.5c0-.973.64-1.725 1.17-2.189A5.921 5.921 0 0 1 5 6.708V2.277a2.77 2.77 0 0 1-.354-.298C4.342 1.674 4 1.179 4 .5a.5.5 0 0 1 .146-.354z"/></svg>`;
        
        // 置顶按钮的激活颜色使用主题色
        const pinBtn = document.createElement('button');
        pinBtn.dataset.pinId = memory.id;
        pinBtn.className = "pin-btn";
        pinBtn.title = "切换核心记忆";
        pinBtn.innerHTML = pinIconSVG;
        pinBtn.style.color = memory.isImportant ? themeColor : '#9ca3af'; // gray-400

        card.innerHTML = `
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-3">
                    <img src="${authorAvatar}" class="w-10 h-10 rounded-full object-cover">
                    <div>
                        <p class="font-semibold text-gray-800">${authorName}的日记</p>
                        <p class="text-xs text-gray-500">${dateString}</p>
                    </div>
                </div>
                <div class="flex items-center gap-3 text-xs" id="diary-actions-${memory.id}">
                    <button data-edit-id="${memory.id}" class="edit-btn text-gray-400 hover:text-blue-500">编辑</button>
                    <button data-delete-id="${memory.id}" class="delete-btn text-gray-400 hover:text-red-500">删除</button>
                </div>
            </div>
            <div class="text-sm text-gray-700 leading-relaxed ml-13">${memory.description.replace(/\n/g, '<br>')}</div>
        `;
        // 将按钮动态插入，以便附加事件监听器
        card.querySelector(`#diary-actions-${memory.id}`).prepend(pinBtn);
        return card;
    }

    function createCountdownCard(item) {
        const card = document.createElement('div');
        const isFinished = item.targetDate <= Date.now();
        
        const lightThemeColor = hexToRgba(themeColor, 0.15); 
        card.className = `p-4 rounded-lg shadow-sm flex flex-col gap-2`;
        if (isFinished) {
            card.classList.add('bg-gray-100', 'text-gray-500');
        } else {
            card.style.backgroundColor = lightThemeColor;
        }

        const countdownId = `countdown-${item.id}`;
        // 增加显示约定日期的 p 标签
        const targetDate = new Date(item.targetDate);
        const targetDateString = `${targetDate.getFullYear()}年${targetDate.getMonth() + 1}月${targetDate.getDate()}日 ${String(targetDate.getHours()).padStart(2, '0')}:${String(targetDate.getMinutes()).padStart(2, '0')}`;

        card.innerHTML = `
            <div class="flex justify-between items-start">
                <p class="font-semibold" style="${isFinished ? '' : `color: ${themeColor}`}">${item.description}</p>
                 <button data-delete-id="${item.id}" class="delete-btn text-gray-400 hover:text-red-500 text-xs">删除</button>
            </div>
            <p class="text-sm" style="${isFinished ? '' : `color: ${themeColor}`}">${item.authorName}的约定</p>
            <p class="text-xs text-gray-400">将于 ${targetDateString} 到期</p>
            <p id="${countdownId}" class="text-lg font-mono font-bold text-right" style="${isFinished ? '' : `color: ${themeColor}`}">
                ${isFinished ? '约定已完成' : '计算中...'}
            </p>
        `;
        
        if (!isFinished) {
            const timer = setInterval(() => {
                const now = new Date().getTime();
                const distance = item.targetDate - now;

                if (distance < 0) {
                    clearInterval(timer);
                    renderMemories(); // [修改] 倒计时结束后重绘整个列表，以更新排序和样式
                    return;
                }

                const days = Math.floor(distance / (1000 * 60 * 60 * 24));
                const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
                const seconds = Math.floor((distance % (1000 * 60)) / 1000);

                document.getElementById(countdownId).textContent = `${days}天 ${hours}时 ${minutes}分 ${seconds}秒`;
            }, 1000);
            activeTimers.push(timer);
        }
        return card;
    }


    // --- Event Handlers & Logic ---
    function populateFilterDropdown() {
        const authors = [...new Set(allMemories.map(mem => mem.authorName))];
        charFilterSelect.innerHTML = '<option value="all">显示全部</option>';
        authors.forEach(author => {
            const option = document.createElement('option');
            option.value = author;
            option.textContent = author;
            if (author === currentFilter) {
                option.selected = true;
            }
            charFilterSelect.appendChild(option);
        });
    }

    async function handleTogglePin(id) {
        const memory = allMemories.find(m => m.id === id);
        if (!memory) return;
        
        const newIsImportant = memory.isImportant ? 0 : 1;
        await db.memories.update(id, { isImportant: newIsImportant });
        
        // 重新加载并渲染以反映排序和样式的变化
        await loadData();
        renderMemories();
    }

    async function handleDelete(id) {
        const memoryToDelete = allMemories.find(m => m.id === id);
        if (!memoryToDelete) return;

        // 从 allChats 获取最新名字用于提示
        const chat = allChats[memoryToDelete.chatId];
        const authorName = chat ? chat.name : memoryToDelete.authorName;

        const confirmed = confirm(`确定要删除这条来自 “${authorName}” 的记录吗？`);
        if (confirmed) {
            await db.memories.delete(id);
            // 重新加载数据并渲染
            await loadData();
            renderMemories();
        }
    }

    function openEditModal(memory) {
        editingMemoryId = memory.id;
        editTextArea.value = memory.description;
        editModal.classList.remove('hidden');
    }

    async function handleSaveEdit() {
        if (!editingMemoryId) return;
        const newDescription = editTextArea.value.trim();
        if (!newDescription) {
            alert("内容不能为空！");
            return;
        }
        await db.memories.update(editingMemoryId, { description: newDescription });
        editModal.classList.add('hidden');
        editingMemoryId = null;
        await loadData();
        renderMemories();
    }

    // --- 颜色工具函数 ---
    function hexToRgba(hex, alpha = 1) {
        if (!hex || !hex.startsWith('#')) return `rgba(238, 242, 255, ${alpha})`; // 返回一个安全的默认色
        
        const hexValue = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
        
        const r = parseInt(hexValue.slice(1, 3), 16);
        const g = parseInt(hexValue.slice(3, 5), 16);
        const b = parseInt(hexValue.slice(5, 7), 16);

        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }


    // --- Event Listeners ---
    filterBtn.addEventListener('click', () => filterModal.classList.remove('hidden'));
    cancelFilterBtn.addEventListener('click', () => filterModal.classList.add('hidden'));
    applyFilterBtn.addEventListener('click', () => {
        currentFilter = charFilterSelect.value;
        filterModal.classList.add('hidden');
        renderMemories();
    });

    listEl.addEventListener('click', (e) => {
        const pinBtn = e.target.closest('.pin-btn');
        const editBtn = e.target.closest('.edit-btn');
        const deleteBtn = e.target.closest('.delete-btn');

        if (pinBtn) {
            const id = parseInt(pinBtn.dataset.pinId);
            handleTogglePin(id);
        } else if (editBtn) {
            const id = parseInt(editBtn.dataset.editId);
            const memory = allMemories.find(m => m.id === id);
            if (memory) openEditModal(memory);
        } else if (deleteBtn) {
            const id = parseInt(deleteBtn.dataset.deleteId);
            handleDelete(id);
        }
    });

    cancelEditBtn.addEventListener('click', () => editModal.classList.add('hidden'));
    saveEditBtn.addEventListener('click', handleSaveEdit);

    // --- Initialization ---
    async function main() {
        const urlParams = new URLSearchParams(window.location.search);
        const filterAuthorId = urlParams.get('authorId');
        const backTo = urlParams.get('backTo');

        // --- [修改] 主题色决定逻辑 ---
        const bubbleThemes = [ // 定义预设主题用于查找
            { name: '默认', value: 'default', colors: { userBg: '#dcf8c6' } },
            { name: '粉蓝', value: 'pink_blue', colors: { userBg: '#eff7ff' } },
            { name: '蓝白', value: 'blue_white', colors: { userBg: '#eff7ff' } },
            { name: '紫黄', value: 'purple_yellow', colors: { userBg: '#fffde4' } },
            { name: '黑白', value: 'black_white', colors: { userBg: '#343a40' } },
        ];
        
        // 1. 先加载所有数据
        await loadData(); 

        if (filterAuthorId && allChats[filterAuthorId]) {
            // 情境A: 查看特定角色的回忆
            const character = allChats[filterAuthorId];
            const charThemeSetting = character.settings?.theme;
            let finalThemeColors = null;

            if (typeof charThemeSetting === 'object' && charThemeSetting !== null) {
                finalThemeColors = charThemeSetting;
            } else if (typeof charThemeSetting === 'string') {
                const customPresets = await db.bubbleThemePresets.toArray();
                const allPresets = [...bubbleThemes, ...customPresets.map(p => ({ value: p.name, colors: p.colors }))];
                const preset = allPresets.find(t => t.value === charThemeSetting);
                if (preset) finalThemeColors = preset.colors;
            }
            
            if (finalThemeColors) {
                const themeSource = localStorage.getItem('chatAccentThemeSource') || 'user';
                themeColor = (themeSource === 'ai') ? finalThemeColors.aiBg : finalThemeColors.userBg;
            } else {
                const globalSettings = await db.globalSettings.get('main');
                themeColor = globalSettings?.themeColor || '#3b82f6';
            }
        } else {
            // 情境B: "我"的页面，使用全局主题色
            const globalSettings = await db.globalSettings.get('main');
            themeColor = globalSettings?.themeColor || '#3b82f6';
        }

        document.documentElement.style.setProperty('--theme-color', themeColor);
        // ---  UI定制逻辑，现在可以安全使用已设置好的 themeColor ---
        const filterBtnUiContainer = document.getElementById('filter-btn-container');
        if (filterAuthorId && allChats[filterAuthorId]) {
            const authorName = allChats[filterAuthorId].name;
            currentFilter = authorName;

            headerTitle.textContent = `与 ${authorName} 的回忆`;
            filterBtnUiContainer.style.display = 'none';

            if (backTo === 'charProfile') {
                backBtn.href = `charProfile.html?id=${filterAuthorId}`;
            }
        }

        renderMemories(); // 最后渲染页面内容
    }
    main();
});