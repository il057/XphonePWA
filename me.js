import { db } from './db.js';

document.addEventListener('DOMContentLoaded', async () => {
    await db.open(); // 确保数据库已打开
    // --- STATE ---
    let activePersonaIdForAvatar = null;
    let activePersonaIdForChats = null;

    // --- DOM ELEMENTS ---
    const userNameMain = document.getElementById('user-name-main');
    const userAvatarMain = document.getElementById('user-avatar-main');
    
    // Settings Modal
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('persona-settings-modal');
    const closeSettingsModalBtn = document.getElementById('close-settings-modal-btn');
    const personaListContainer = document.getElementById('persona-list-container');
    const addNewPersonaBtn = document.getElementById('add-new-persona-btn');

    // Avatar Modal
    const avatarModal = document.getElementById('avatar-library-modal');
    const avatarGrid = document.getElementById('avatar-grid');
    const addAvatarBtn = document.getElementById('add-avatar-btn');
    const closeAvatarModalBtn = document.getElementById('close-avatar-modal-btn');

    // Chat Picker Modal
    const chatPickerModal = document.getElementById('chat-picker-modal');
    const chatPickerList = document.getElementById('chat-picker-list');
    const confirmChatPickerBtn = document.getElementById('confirm-chat-picker-btn');
    const cancelChatPickerBtn = document.getElementById('cancel-chat-picker-btn');

    const defaultAvatar = 'https://files.catbox.moe/kkll8p.svg';

    // --- INITIALIZATION ---
    async function initializePage() {
        // NEW LOGIC: Load user display from the default persona
        const settings = await db.globalSettings.get('main');
        let displayPersona = null;

        if (settings && settings.defaultPersonaId) {
            displayPersona = await db.personaPresets.get(settings.defaultPersonaId);
        }

        if (displayPersona) {
            userNameMain.textContent = displayPersona.name;
            userAvatarMain.src = displayPersona.avatar || defaultAvatar;
        } else {
            // Fallback if no default is set
            userNameMain.textContent = '请设置默认人格';
            userAvatarMain.src = defaultAvatar;
        }
        userAvatarMain.onerror = () => { userAvatarMain.src = defaultAvatar; };
        
    }

    // --- PERSONA MODAL ---
    async function openSettingsModal() {
        await renderPersonaList();
        settingsModal.classList.remove('hidden');
    }

    function closeSettingsModal() {
        settingsModal.classList.add('hidden');
    }

    async function renderPersonaList() {
        const [personas, settings] = await Promise.all([
             db.personaPresets.toArray(),
             db.globalSettings.get('main')
        ]);
        const defaultPersonaId = settings?.defaultPersonaId;

        personaListContainer.innerHTML = ''; // Clear previous list

        if (personas.length === 0) {
            personaListContainer.innerHTML = `<p class="text-center text-gray-500">还没有创建人格预设哦。</p>`;
        }

        personas.forEach(persona => {
            const isDefault = persona.id === defaultPersonaId;
            const personaElement = document.createElement('div');
            personaElement.className = 'bg-gray-50 p-3 rounded-lg';
            
            const defaultBadge = isDefault ? '<span class="text-xs font-bold theme-text-accent bg-blue-100 px-2 py-1 rounded-full">默认</span>' : '';

            personaElement.innerHTML = `
                <div class="flex items-center justify-between cursor-pointer" data-persona-id="${persona.id}">
                    <div class="flex items-center gap-3">
                        <img src="${persona.avatar || defaultAvatar}" class="w-12 h-12 rounded-full object-cover">
                        <span class="font-semibold">${persona.name}</span>
                        ${defaultBadge}
                    </div>
                    <svg class="w-5 h-5 text-gray-400 transition-transform" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd"></path></svg>
                </div>
                <div class="persona-editor" data-editor-id="${persona.id}">
                    <div class="space-y-4">
                        <div class="flex flex-col items-center">
                            <img src="${persona.avatar || defaultAvatar}" class="w-20 h-20 rounded-full object-cover shadow-lg mb-3" data-avatar-preview-id="${persona.id}">
                            <button class="text-sm theme-text-link" data-change-avatar-id="${persona.id}">更换头像</button>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">名字</label>
                            <input type="text" value="${persona.name}" data-input-name-id="${persona.id}" class="form-input mt-1 block w-full rounded-md border-gray-300 p-2">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">生日</label>
                            <input type="date" value="${persona.birthday || ''}" data-input-birthday-id="${persona.id}" class="form-input mt-1 block w-full rounded-md border-gray-300 p-2">
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">性别</label>
                            <select data-input-gender-id="${persona.id}" class="form-input mt-1 block w-full rounded-md border-gray-300 p-2">
                                <option value="unspecified" ${persona.gender === 'unspecified' ? 'selected' : ''}>未设置</option>
                                <option value="male" ${persona.gender === 'male' ? 'selected' : ''}>男</option>
                                <option value="female" ${persona.gender === 'female' ? 'selected' : ''}>女</option>
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-gray-700">人设 (Persona)</label>
                            <textarea rows="4" data-input-persona-id="${persona.id}" class="form-input mt-1 block w-full rounded-md border-gray-300 p-2">${persona.persona || ''}</textarea>
                        </div>
                        <div>
                             <button data-visible-chats-id="${persona.id}" class="w-full mt-2 p-2 rounded-lg font-semibold secondary-btn">可见分组/群聊</button>
                        </div>
                        <div class="pt-4 mt-4 border-t grid grid-cols-3 gap-3">
                            <button data-setdefault-id="${persona.id}" class="w-full p-2 rounded-lg font-semibold secondary-btn" ${isDefault ? 'disabled' : ''}>${isDefault ? '已设默认' : '设为默认'}</button>
                            <button data-save-id="${persona.id}" class="w-full p-2 rounded-lg text-white font-semibold primary-btn">保存</button>
                            <button data-delete-id="${persona.id}" class="w-full p-2 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700">删除</button>
                        </div>
                    </div>
                </div>
            `;
            personaListContainer.appendChild(personaElement);
        });

        addPersonaEventListeners();
    }

    function addPersonaEventListeners() {
        document.querySelectorAll('[data-persona-id]').forEach(header => {
            header.addEventListener('click', (e) => {
                if (e.target.closest('button')) return; 
                const personaId = header.dataset.personaId;
                const editor = document.querySelector(`[data-editor-id="${personaId}"]`);
                const arrow = header.querySelector('svg');
                if (editor) {
                    const isVisible = editor.style.display === 'block';
                    editor.style.display = isVisible ? 'none' : 'block';
                    arrow.style.transform = isVisible ? 'rotate(0deg)' : 'rotate(180deg)';
                }
            });
        });

        document.querySelectorAll('[data-setdefault-id]').forEach(btn => btn.addEventListener('click', () => handleSetDefaultPersona(btn.dataset.setdefaultId)));
        document.querySelectorAll('[data-save-id]').forEach(btn => btn.addEventListener('click', () => handleSavePersona(btn.dataset.saveId)));
        document.querySelectorAll('[data-delete-id]').forEach(btn => btn.addEventListener('click', () => handleDeletePersona(btn.dataset.deleteId)));
        document.querySelectorAll('[data-change-avatar-id]').forEach(btn => btn.addEventListener('click', () => openAvatarModal(btn.dataset.changeAvatarId)));
        document.querySelectorAll('[data-visible-chats-id]').forEach(btn => btn.addEventListener('click', () => openChatPicker(btn.dataset.visibleChatsId)));
    }

    async function handleSetDefaultPersona(id) {
        const personaId = parseInt(id);
        
        // 1. 安全地获取或创建设置对象
        let settings = await db.globalSettings.get('main');
        if (!settings) {
            settings = { id: 'main' };
        }

        // 2. 更新属性
        settings.defaultPersonaId = personaId;
        
        // 3. 使用 .put() 保存，该方法会自动处理新建或更新
        await db.globalSettings.put(settings);
        
        alert('默认人格设置成功！');
        
        // 刷新主界面和模态框列表
        await initializePage();
        await renderPersonaList();
    }

    async function handleSavePersona(id) {
        const personaId = parseInt(id);
        const updatedData = {
            name: document.querySelector(`[data-input-name-id="${personaId}"]`).value.trim(),
            avatar: document.querySelector(`[data-avatar-preview-id="${personaId}"]`).src,
            birthday: document.querySelector(`[data-input-birthday-id="${personaId}"]`).value,
            gender: document.querySelector(`[data-input-gender-id="${personaId}"]`).value,
            persona: document.querySelector(`[data-input-persona-id="${personaId}"]`).value.trim(),
        };
    
        if (!updatedData.name) {
            alert('名字不能为空！');
            return;
        }
        
        await db.personaPresets.update(personaId, updatedData);
        
        // If the saved persona is the default one, update the main display
        const settings = await db.globalSettings.get('main');
        if (settings && settings.defaultPersonaId === personaId) {
            await initializePage();
        }

        alert('保存成功！');
        await renderPersonaList();
    }

    async function handleDeletePersona(id) {
        const personaId = parseInt(id);
        const persona = await db.personaPresets.get(personaId);
        if (confirm(`确定要删除人格预设 “${persona.name}” 吗？`)) {
            await db.personaPresets.delete(personaId);
            
            // Check if the deleted persona was the default
            const settings = await db.globalSettings.get('main');
            if(settings && settings.defaultPersonaId === personaId) {
                // Remove the default setting
                await db.globalSettings.update('main', { defaultPersonaId: null });
                await initializePage(); // Update main display to fallback
            }

            await renderPersonaList();
        }
    }
    
    async function handleAddNewPersona() {
        const newPersona = {
            name: '新的人格',
            avatar: defaultAvatar,
            birthday: '',
            gender: 'unspecified',
            persona: '',
            appliedChats: []
        };
        const newId = await db.personaPresets.add(newPersona);
        
        // If this is the very first persona, set it as default automatically
        const allPersonas = await db.personaPresets.toArray();
        if(allPersonas.length === 1) {
             await handleSetDefaultPersona(newId);
        } else {
             await renderPersonaList();
        }

        // Automatically open the new persona's editor
        const newEditor = document.querySelector(`[data-editor-id="${newId}"]`);
        if(newEditor) {
            newEditor.style.display = 'block';
            const arrow = newEditor.previousElementSibling.querySelector('svg');
            if(arrow) arrow.style.transform = 'rotate(180deg)';
        }
    }


    // --- AVATAR MODAL LOGIC (adapted from charEditProfile.js) ---
    async function openAvatarModal(personaId) {
        activePersonaIdForAvatar = parseInt(personaId);
        await renderAvatarLibrary();
        avatarModal.classList.remove('hidden');
    }

    async function renderAvatarLibrary() {
        avatarGrid.innerHTML = '';
        const userAvatars = await db.userAvatarLibrary.toArray();
        if (userAvatars.length === 0) {
            avatarGrid.innerHTML = '<p class="col-span-4 text-center text-gray-500">头像库是空的，快去添加吧。</p>';
            return;
        }

        userAvatars.forEach(avatar => {
            const imgContainer = document.createElement('div');
            imgContainer.className = 'relative group';
            imgContainer.innerHTML = `
                <img src="${avatar.url}" class="w-full h-full object-cover rounded-lg cursor-pointer border-2 border-transparent group-hover:border-blue-500">
                <button data-avatar-id="${avatar.id}" class="absolute top-0 right-0 bg-red-500 text-white rounded-full w-5 h-5 text-xs font-bold hidden group-hover:block">×</button>
            `;
            // Set as current avatar for the active persona
            imgContainer.querySelector('img').addEventListener('click', () => {
                const previewImg = document.querySelector(`[data-avatar-preview-id="${activePersonaIdForAvatar}"]`);
                if (previewImg) previewImg.src = avatar.url;
                avatarModal.classList.add('hidden');
            });
            // Delete from global library
            imgContainer.querySelector('button').addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`确定要从全局头像库删除这个头像吗？`)) {
                    await db.userAvatarLibrary.delete(avatar.id);
                    await renderAvatarLibrary();
                }
            });
            avatarGrid.appendChild(imgContainer);
        });
    }

    async function handleAddAvatar() {
        const url = prompt("请输入头像的图片URL");
        if (!url || !url.trim().startsWith('http')) {
            if (url) alert("请输入有效的图片URL！");
            return;
        }
        await db.userAvatarLibrary.add({ url: url.trim() });
        await renderAvatarLibrary();
    }

    // --- CHAT PICKER MODAL ---
    async function openChatPicker(personaId) {
        activePersonaIdForChats = parseInt(personaId);
        const persona = await db.personaPresets.get(activePersonaIdForChats);
        if (!persona) return;
        
        await renderChatPicker(persona.appliedChats || []);
        chatPickerModal.classList.remove('hidden');
    }

    async function renderChatPicker(appliedIds) {
        chatPickerList.innerHTML = '';
        const appliedIdSet = new Set((appliedIds || []).map(String)); // 确保所有ID都为字符串以便比较

        // 获取通讯录分组
        const contactGroups = await db.xzoneGroups.toArray();
        // 获取所有群聊
        const groupChats = await db.chats.where('isGroup').equals(1).toArray();

        // 渲染通讯录分组
        if (contactGroups.length > 0) {
            chatPickerList.innerHTML += `<h4 class="font-semibold text-gray-500 text-sm mb-2 border-b pb-1">通讯录分组</h4>`;
            contactGroups.forEach(group => {
                const div = document.createElement('div');
                div.className = 'flex items-center py-1';
                const isChecked = appliedIdSet.has(String(group.id));
                div.innerHTML = `
                    <input type="checkbox" id="picker-item-${group.id}" value="${group.id}" class="h-4 w-4 rounded" ${isChecked ? 'checked' : ''}>
                    <label for="picker-item-${group.id}" class="ml-2">${group.name}</label>
                `;
                chatPickerList.appendChild(div);
            });
        }

        // 渲染群聊
        if (groupChats.length > 0) {
            chatPickerList.innerHTML += `<h4 class="font-semibold text-gray-500 text-sm mt-4 mb-2 border-b pb-1">群聊</h4>`;
            groupChats.forEach(chat => {
                const div = document.createElement('div');
                div.className = 'flex items-center py-1';
                const isChecked = appliedIdSet.has(String(chat.id));
                div.innerHTML = `
                    <input type="checkbox" id="picker-item-${chat.id}" value="${chat.id}" class="h-4 w-4 rounded" ${isChecked ? 'checked' : ''}>
                    <label for="picker-item-${chat.id}" class="ml-2">${chat.name}</label>
                `;
                chatPickerList.appendChild(div);
            });
        }

        if (contactGroups.length === 0 && groupChats.length === 0) {
            chatPickerList.innerHTML = '<p class="text-center text-gray-500">没有可用的分组或群聊</p>';
        }
    }

    async function handleConfirmChatPicker() {
        if (activePersonaIdForChats === null) return;

        // 从checkbox获取的value都是字符串，这正是我们需要的
        const selectedIds = Array.from(chatPickerList.querySelectorAll('input:checked')).map(cb => cb.value);

        const allPersonas = await db.personaPresets.toArray();

        // 这个逻辑确保一个分组/群聊同时只能被分配给一个人格
        for (const persona of allPersonas) {
            // 将所有ID转换为字符串以进行可靠的比较
            let currentApplied = (persona.appliedChats || []).map(String);

            if (persona.id === activePersonaIdForChats) {
                // 为当前编辑的人格设置新的应用范围
                persona.appliedChats = selectedIds;
            } else {
                // 从其他所有人格中移除本次选中的分组/群聊
                persona.appliedChats = currentApplied.filter(id => !selectedIds.includes(id));
            }
        }

        // 批量更新所有修改过的人格
        await db.personaPresets.bulkPut(allPersonas);

        chatPickerModal.classList.add('hidden');
    }


    // --- EVENT LISTENERS ---
    settingsBtn.addEventListener('click', openSettingsModal);
    closeSettingsModalBtn.addEventListener('click', closeSettingsModal);
    addNewPersonaBtn.addEventListener('click', handleAddNewPersona);
    
    // Avatar Modal listeners
    addAvatarBtn.addEventListener('click', handleAddAvatar);
    closeAvatarModalBtn.addEventListener('click', () => avatarModal.classList.add('hidden'));

    // Chat Picker listeners
    confirmChatPickerBtn.addEventListener('click', handleConfirmChatPicker);
    cancelChatPickerBtn.addEventListener('click', () => chatPickerModal.classList.add('hidden'));

    // --- START ---
    initializePage();
});