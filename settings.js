// settings.js
// Import the shared database instance from db.js
import { db } from './db.js';

document.addEventListener('DOMContentLoaded', () => {

    // 状态变量，用于存储从数据库加载的设置
    let state = {
        apiConfig: {},
        globalSettings: {}
    };

    const privateChatProbSlider = document.getElementById('private-chat-prob-slider');
    const privateChatProbDisplay = document.getElementById('private-chat-prob-display');
    const groupChatProbSlider = document.getElementById('group-chat-prob-slider');
    const groupChatProbDisplay = document.getElementById('group-chat-prob-display');



    /**
     * 从数据库加载API和全局设置
     */
    async function loadSettings() {
        const [apiConfig, globalSettings] = await Promise.all([
            db.apiConfig.get('main'),
            db.globalSettings.get('main')
        ]);

        state.apiConfig = apiConfig || { id: 'main', proxyUrl: '', apiKey: '', model: '' };
        state.globalSettings = globalSettings || {
            id: 'main',
            enableBackgroundActivity: false,
            backgroundActivityInterval: 60,
            blockCooldownHours: 1,
            activeSimTickProb: 0.3,
            groupActiveSimTickProb: 0.15
        };
    }

    /**
     * 将加载的设置填充到UI界面
     */
    function populateUI() {
        document.getElementById('proxy-url').value = state.apiConfig.proxyUrl || '';
        document.getElementById('api-key').value = state.apiConfig.apiKey || '';

        const modelSelect = document.getElementById('model-select');
        modelSelect.innerHTML = ''; // 清空
        if (state.apiConfig.model) {
            modelSelect.innerHTML = `<option value="${state.apiConfig.model}" selected>${state.apiConfig.model}</option>`;
        }

        document.getElementById('background-activity-switch').checked = state.globalSettings.enableBackgroundActivity || false;
        document.getElementById('background-interval-input').value = state.globalSettings.backgroundActivityInterval || 60;
        document.getElementById('block-cooldown-input').value = state.globalSettings.blockCooldownHours || 1;
    
        const privateProb = (state.globalSettings.activeSimTickProb || 0.3) * 100;
        const groupProb = (state.globalSettings.groupActiveSimTickProb || 0.15) * 100;
        
        privateChatProbSlider.value = privateProb;
        privateChatProbDisplay.textContent = privateProb;
        groupChatProbSlider.value = groupProb;
        groupChatProbDisplay.textContent = groupProb;
    }

    /**
     * 保存所有设置到数据库
     */
    async function saveAllSettings() {
        const saveBtn = document.getElementById('save-all-settings-btn');
        saveBtn.textContent = '保存中...';
        saveBtn.disabled = true;

        try {
            // 保存API设置
            state.apiConfig.proxyUrl = document.getElementById('proxy-url').value.trim();
            state.apiConfig.apiKey = document.getElementById('api-key').value.trim();
            state.apiConfig.model = document.getElementById('model-select').value;
            await db.apiConfig.put(state.apiConfig);

            // 保存后台活动设置
            const oldEnableState = state.globalSettings.enableBackgroundActivity || false;
            const newEnableState = document.getElementById('background-activity-switch').checked;

            if (newEnableState && !oldEnableState) {
                const userConfirmed = confirm(
                    "【高费用警告】\n\n您正在启用“后台角色活动”功能。\n\n这会使您的AI角色们在您不和他们聊天时，也能“独立思考”并主动给您发消息或进行社交互动，极大地增强沉浸感。\n\n但请注意：这会【在后台自动、定期地调用API】，即使您不进行任何操作。根据您的角色数量和检测间隔，这可能会导致您的API费用显著增加。\n\n您确定要开启吗？"
                );

                if (!userConfirmed) {
                    document.getElementById('background-activity-switch').checked = false;
                    return;
                }
            }

            state.globalSettings.enableBackgroundActivity = newEnableState;
            state.globalSettings.backgroundActivityInterval = parseInt(document.getElementById('background-interval-input').value) || 60;
            state.globalSettings.blockCooldownHours = parseFloat(document.getElementById('block-cooldown-input').value) || 1;
            state.globalSettings.activeSimTickProb = parseInt(privateChatProbSlider.value) / 100;
            state.globalSettings.groupActiveSimTickProb = parseInt(groupChatProbSlider.value) / 100;
            // 如果启用了后台活动，启动模拟引擎
            await db.globalSettings.put(state.globalSettings);

            alert('设置已成功保存！');
        } catch (error) {
            console.error("保存设置失败:", error);
            alert("保存失败，请查看控制台获取错误信息。");
        } finally {
            saveBtn.textContent = '保存';
            saveBtn.disabled = false;
        }
    }

    /**
     * 从API拉取可用模型列表
     */
    async function fetchModels() {
        const url = document.getElementById('proxy-url').value.trim();
        const key = document.getElementById('api-key').value.trim();
        if (!url || !key) {
            alert('请先填写反代地址和密钥');
            return;
        }

        const fetchBtn = document.getElementById('fetch-models-btn');
        fetchBtn.textContent = '拉取中...';
        fetchBtn.disabled = true;

        try {
            const response = await fetch(`${url}/v1/models`, {
                headers: { 'Authorization': `Bearer ${key}` }
            });
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData?.error?.message || '无法获取模型列表');
            }
            const data = await response.json();
            const modelSelect = document.getElementById('model-select');
            modelSelect.innerHTML = '';
            data.data.forEach(model => {
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = model.id;
                if (model.id === state.apiConfig.model) {
                    option.selected = true;
                }
                modelSelect.appendChild(option);
            });
            alert('模型列表已更新');
        } catch (error) {
            alert(`拉取模型失败: ${error.message}`);
        } finally {
            fetchBtn.textContent = '拉取';
            fetchBtn.disabled = false;
        }
    }

    /**
     * 导出完整备份数据
     */
    async function exportBackup() {
        if (!confirm("确定要导出所有数据吗？这将生成一个包含您所有聊天记录和设置的JSON文件。")) return;
        try {
            const backupData = {
                version: 29, // 与DB版本号对应
                timestamp: Date.now()
            };

            const tableNames = db.tables.map(t => t.name);
            const tableData = await Promise.all(
                tableNames.map(name => db.table(name).toArray())
            );

            tableNames.forEach((name, i) => {
                if (['apiConfig', 'globalSettings', 'musicLibrary', 'xzoneSettings'].includes(name)) {
                    backupData[name] = tableData[i][0] || null;
                } else {
                    backupData[name] = tableData[i];
                }
            });

            const blob = new Blob(
                [JSON.stringify(backupData, null, 2)],
                { type: 'application/json' }
            );
            const url = URL.createObjectURL(blob);
            const link = Object.assign(document.createElement('a'), {
                href: url,
                download: `XPhone-Backup-${new Date().toISOString().split('T')[0]}.json`
            });
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            alert('导出成功！已将备份文件下载到您的设备。');

        } catch (error) {
            console.error("导出数据时出错:", error);
            alert(`导出失败: ${error.message}`);
        }
    }

    /**
     * 导入备份文件
     * @param {File} file - 用户选择的JSON文件
     */
    async function importBackup(file) {
        if (!file) return;

        const confirmed = confirm(
            '【严重警告】\n\n导入备份将完全覆盖您当前的所有数据，包括聊天、动态、设置等。此操作不可撤销！\n\n您确定要继续吗？'
        );

        if (!confirmed) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);
            
            const singleObjectTables = ['apiConfig', 'globalSettings', 'musicLibrary', 'xzoneSettings'];

            await db.transaction('rw', db.tables, async () => {
                // 清空所有表
                for (const table of db.tables) {
                    await table.clear();
                }

                // 导入数据
                for (const tableName in data) {
                    // 跳过元数据字段，不把它们当作表来处理
                    if (tableName === 'version' || tableName === 'timestamp') {
                        continue;
                    }
                    
                    if (db.table(tableName)) {
                        if (singleObjectTables.includes(tableName)) {
                            if (data[tableName]) {
                                await db.table(tableName).put(data[tableName]);
                            }
                        } else {
                            if (Array.isArray(data[tableName]) && data[tableName].length > 0) {
                                await db.table(tableName).bulkPut(data[tableName]);
                            }
                        }
                    }
                }
            });

            alert('导入成功！所有数据已成功恢复！页面即将刷新以应用所有更改。');

            setTimeout(() => {
                window.location.reload();
            }, 1500);

        } catch (error) {
            console.error("导入数据时出错:", error);
            alert(`导入失败: 文件格式不正确或数据已损坏: ${error.message}`);
        }
    }

    function handleEnableNotifications() {
        if (!("Notification" in window)) {
            alert("抱歉，您的浏览器不支持桌面通知。");
            return;
        }

        if (Notification.permission === "granted") {
            alert("通知权限已经开启！");
            new Notification("通知测试", { body: "如果看到这条消息，说明通知功能一切正常。" });
        } else if (Notification.permission !== "denied") {
            Notification.requestPermission().then(permission => {
                if (permission === "granted") {
                    alert("通知权限已成功开启！");
                    new Notification("通知测试", { body: "您将会在后台收到角色的消息提醒。" });
                } else {
                    alert("您拒绝了通知权限，将无法收到后台消息提醒。");
                }
            });
        } else {
            alert("通知权限已被禁用。请在您的浏览器设置中手动开启本网站的通知权限。");
        }
    }


    // --- 初始化流程 ---
    async function main() {
        await loadSettings();
        populateUI();

        // --- 绑定事件监听器 ---
        document.getElementById('save-all-settings-btn').addEventListener('click', saveAllSettings);
        document.getElementById('enable-notifications-btn').addEventListener('click', handleEnableNotifications); 
        document.getElementById('fetch-models-btn').addEventListener('click', fetchModels);
        document.getElementById('export-data-btn').addEventListener('click', exportBackup);
        document.getElementById('import-btn').addEventListener('click', () => document.getElementById('import-data-input').click());
        document.getElementById('import-data-input').addEventListener('change', e => importBackup(e.target.files[0]));
        
        privateChatProbSlider.addEventListener('input', () => {
            privateChatProbDisplay.textContent = privateChatProbSlider.value;
        });
        groupChatProbSlider.addEventListener('input', () => {
            groupChatProbDisplay.textContent = groupChatProbSlider.value;
        });
    }

    main();
});