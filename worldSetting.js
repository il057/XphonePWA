// phone/worldSetting.js
import { db } from './db.js';

document.addEventListener('DOMContentLoaded', async () => {
    await db.open(); // 确保数据库已打开
    // --- DOM Elements ---
    const saveSettingsBtn = document.getElementById('save-settings-btn');
    const offlineSimHoursInput = document.getElementById('offline-sim-hours');
    const infoScanRangeInput = document.getElementById('info-scan-range');
    const intelCooldownInput = document.getElementById('intel-cooldown-minutes');
    const groupsContainer = document.getElementById('groups-management-container');
    const worldbookModal = document.getElementById('worldbook-modal');
    const worldbookList = document.getElementById('worldbook-list');
    const modalGroupName = document.getElementById('modal-group-name');
    const cancelWorldbookBtn = document.getElementById('cancel-worldbook-btn');
    const saveWorldbookBtn = document.getElementById('save-worldbook-btn');

    // --- State ---
    let globalSettings = {};
    let allGroups = [];
    let allWorldBooks = [];
    let editingGroupId = null;

    // --- Functions ---
    async function loadData() {
        [globalSettings, allGroups, allWorldBooks] = await Promise.all([
            db.globalSettings.get('main'), // 直接获取
            db.xzoneGroups.toArray(),
            db.worldBooks.toArray()
        ]);
        // [修复] 如果数据库中没有设置，确保 globalSettings 是一个空对象而不是 null
        if (!globalSettings) {
            globalSettings = {};
        }
    }

    function populateUI() {
        // Populate simulation settings
        offlineSimHoursInput.value = globalSettings.offlineSimHours || 1;
        infoScanRangeInput.value = globalSettings.infoScanRange || 50;
        intelCooldownInput.value = globalSettings.intelCooldownMinutes || 5; // [修复] 在这一行末尾加上了分号

        // Populate groups management
        groupsContainer.innerHTML = '';
        allGroups.forEach(group => {
            const groupEl = document.createElement('div');
            groupEl.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg';
            groupEl.innerHTML = `
                <span class="font-medium">${group.name}</span>
                <button data-group-id="${group.id}" class="manage-books-btn text-sm text-blue-600 hover:underline">关联世界书</button>
            `;
            groupsContainer.appendChild(groupEl);
        });
        
        // Add event listeners to new buttons
        document.querySelectorAll('.manage-books-btn').forEach(btn => {
            btn.addEventListener('click', handleOpenWorldbookModal);
        });
    }

    function handleOpenWorldbookModal(event) {
        editingGroupId = parseInt(event.target.dataset.groupId);
        const group = allGroups.find(g => g.id === editingGroupId);
        if (!group) return;

        modalGroupName.textContent = group.name;
        const associatedBookIds = new Set(group.worldBookIds || []);
        
        worldbookList.innerHTML = '';
        allWorldBooks.forEach(book => {
            const isChecked = associatedBookIds.has(book.id);
            worldbookList.innerHTML += `
                <div class="flex items-center mb-2">
                    <input type="checkbox" id="book-${book.id}" value="${book.id}" class="h-4 w-4" ${isChecked ? 'checked' : ''}>
                    <label for="book-${book.id}" class="ml-2">${book.name}</label>
                </div>
            `;
        });
        
        worldbookModal.classList.remove('hidden');
    }

    async function handleSaveSettings() {
        // [修复] 在操作 globalSettings 前，确保它是一个对象
        if (!globalSettings) {
            globalSettings = {}; 
        }
        
        // Save global settings
        globalSettings.id = 'main';
        globalSettings.offlineSimHours = parseFloat(offlineSimHoursInput.value);
        globalSettings.infoScanRange = parseInt(infoScanRangeInput.value);
        globalSettings.intelCooldownMinutes = parseInt(intelCooldownInput.value);
        await db.globalSettings.put(globalSettings);

        alert('世界设定已保存！');
    }

    async function handleSaveWorldbookAssociation() {
        if (editingGroupId === null) return;

        const selectedCheckboxes = worldbookList.querySelectorAll('input[type="checkbox"]:checked');
        const selectedBookIds = Array.from(selectedCheckboxes).map(cb => cb.value);

        await db.xzoneGroups.update(editingGroupId, { worldBookIds: selectedBookIds });

        // Refresh local data and UI
        await loadData();
        populateUI();
        
        worldbookModal.classList.add('hidden');
        editingGroupId = null;
    }

    // --- Event Listeners ---
    saveSettingsBtn.addEventListener('click', handleSaveSettings);
    cancelWorldbookBtn.addEventListener('click', () => worldbookModal.classList.add('hidden'));
    saveWorldbookBtn.addEventListener('click', handleSaveWorldbookAssociation);

    // --- Initial Load ---
    await loadData();
    populateUI();
});