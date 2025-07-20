// phone/stickers.js (最终版 - 按钮操作)
import { db } from './db.js';

document.addEventListener('DOMContentLoaded', () => {
    const gridContainer = document.getElementById('sticker-grid-container');
    const editBtn = document.getElementById('edit-stickers-btn');
    const modal = document.getElementById('add-sticker-modal');
    const urlInput = document.getElementById('sticker-url-input');
    const nameInput = document.getElementById('sticker-name-input');
    const confirmBtn = document.getElementById('confirm-add-sticker');
    const cancelBtn = document.getElementById('cancel-add-sticker');
    
    const defaultTitle = document.getElementById('default-title');
    const editModeActions = document.getElementById('edit-mode-actions');
    const backBtn = document.getElementById('back-btn');
    const moveTopBtn = document.getElementById('move-top-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');

    let isEditMode = false;
    let selectedStickers = new Set();

    async function renderStickers() {
        gridContainer.innerHTML = '';
        
        const addButton = document.createElement('div');
        addButton.className = 'sticker-grid-item border-2 border-dashed border-gray-300';
        addButton.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="currentColor" class="text-gray-400" viewBox="0 0 16 16"><path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/></svg>`;
        addButton.addEventListener('click', () => {
            if (isEditMode) return;
            urlInput.value = '';
            nameInput.value = '';
            modal.style.display = 'flex';
        });
        gridContainer.appendChild(addButton);

        const stickers = await db.userStickers.orderBy('order').reverse().toArray();
        stickers.forEach(sticker => {
            const stickerEl = createStickerElement(sticker);
            gridContainer.appendChild(stickerEl);
        });
    }
    
    function createStickerElement(sticker) {
        const stickerEl = document.createElement('div');
        stickerEl.className = 'sticker-grid-item relative group';
        stickerEl.dataset.id = sticker.id;
        stickerEl.innerHTML = `
            <img src="${sticker.url}" alt="${sticker.name}" class="pointer-events-none w-full h-full object-contain">
            <div class="absolute inset-0 bg-black/20 hidden items-center justify-center edit-mode-item">
                <input type="checkbox" class="absolute top-2 right-2 w-5 h-5 accent-pink-500 pointer-events-none">
            </div>
        `;
        return stickerEl;
    }

    function toggleEditMode() {
        isEditMode = !isEditMode;
        
        // 切换UI状态
        defaultTitle.classList.toggle('hidden', isEditMode);
        backBtn.classList.toggle('hidden', isEditMode);
        editModeActions.classList.toggle('hidden', !isEditMode);
        editBtn.textContent = isEditMode ? '完成' : '编辑';
        gridContainer.classList.toggle('edit-mode', isEditMode);

        // 退出编辑模式时清空选择
        if (!isEditMode) {
            selectedStickers.clear();
            renderStickers(); // 刷新以清除勾选框状态
        }
    }
    
    // --- 事件监听 ---
    editBtn.addEventListener('click', toggleEditMode);

    moveTopBtn.addEventListener('click', async () => {
        if (selectedStickers.size === 0) return alert('请先选择要操作的表情。');
        const highestOrder = await db.userStickers.orderBy('order').last();
        const newOrder = (highestOrder?.order || 0) + 1;
        const updates = Array.from(selectedStickers).map(id => ({
            key: id,
            changes: { order: newOrder }
        }));
        await db.userStickers.bulkUpdate(updates);
        toggleEditMode(); // 退出编辑模式并刷新
    });

    deleteSelectedBtn.addEventListener('click', async () => {
        if (selectedStickers.size === 0) return alert('请先选择要操作的表情。');
        if (confirm(`确定要删除选中的 ${selectedStickers.size} 个表情吗？`)) {
            await db.userStickers.bulkDelete(Array.from(selectedStickers));
            toggleEditMode(); // 退出编辑模式并刷新
        }
    });

    cancelBtn.addEventListener('click', () => modal.style.display = 'none');
    confirmBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        const name = nameInput.value.trim();
        if (!url || !name) return alert('URL和描述都不能为空！');
        
        try {
            const highestOrder = await db.userStickers.orderBy('order').last();
            const newOrder = (highestOrder?.order || 0) + 1;
            await db.userStickers.add({ url, name, order: newOrder });
            modal.style.display = 'none';
            await renderStickers();
        } catch (e) {
            alert(e.name === 'ConstraintError' ? '这个表情已经添加过了！' : '添加失败，请检查URL。');
        }
    });

    gridContainer.addEventListener('click', (e) => {
        if (!isEditMode) return;
        const stickerItem = e.target.closest('.sticker-grid-item[data-id]');
        if (!stickerItem) return;

        const stickerId = parseInt(stickerItem.dataset.id);
        const checkbox = stickerItem.querySelector('input[type="checkbox"]');
        
        // 手动切换勾选状态并更新Set
        checkbox.checked = !checkbox.checked;
        if (checkbox.checked) {
            selectedStickers.add(stickerId);
        } else {
            selectedStickers.delete(stickerId);
        }
    });

    renderStickers();
});