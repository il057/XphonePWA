import { db, apiLock } from './db.js';
const notificationChannel = new BroadcastChannel('xphone_notifications');


/**
 * 离线模拟引擎的主函数
 * 当用户重新打开应用时调用此函数。

export async function runOfflineSimulation() {
    const apiConfig = await db.apiConfig.get('main');
    const globalSettings = await db.globalSettings.get('main') || {};
    const lastOnline = globalSettings.lastOnlineTime || Date.now();
    const now = Date.now();
    const elapsedHours = (now - lastOnline) / (1000 * 60 * 60);
    const simThreshold = globalSettings.offlineSimHours || 1;

    // 计算一周前的时间戳
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    // 删除所有时间戳早于一周前的简报记录
    await db.offlineSummary.where('timestamp').below(oneWeekAgo).delete();

    // 如果离线时间未达到阈值，则不执行模拟
    if (elapsedHours < simThreshold) {
        console.log(`离线时间 ${elapsedHours.toFixed(2)} 小时，未达到模拟阈值 ${simThreshold} 小时。`);
        return;
    }

    console.log(`离线 ${elapsedHours.toFixed(2)} 小时，开始模拟...`);

    // 1. 按分组获取所有角色
    const allChats = await db.chats.toArray();
    const allGroups = await db.xzoneGroups.toArray();
    const allWorldBooks = await db.worldBooks.toArray();
    const groupsMap = new Map(allGroups.map(g => [g.id, g]));
    const charsByGroup = {};

    allChats.forEach(c => {
        if (!c.isGroup && c.groupId) {
            if (!charsByGroup[c.groupId]) charsByGroup[c.groupId] = [];
            charsByGroup[c.groupId].push(c);
        }
    });

    // 2. 遍历每个分组，独立进行模拟
    for (const groupId in charsByGroup) {
        const group = groupsMap.get(parseInt(groupId));
        const groupName = groupsMap.get(parseInt(groupId))?.name || `分组${groupId}`;
        const groupMembers = charsByGroup[groupId];
        if (groupMembers.length < 2) continue; // 至少需要2个角色才能有互动

        console.log(`正在模拟【${groupName}】...`);

        // 3. 准备调用AI所需的数据
        // 获取该组内所有角色的关系
        const memberIds = groupMembers.map(m => m.id);
        const relationships = await db.relationships
            .where('sourceCharId').anyOf(memberIds)
            .and(r => memberIds.includes(r.targetCharId))
            .toArray();
        
        // 简化关系描述
        const relationsSnapshot = relationships.map(r => {
            const sourceName = allChats.find(c=>c.id === r.sourceCharId)?.name;
            const targetName = allChats.find(c=>c.id === r.targetCharId)?.name;
            return `${sourceName} 与 ${targetName} 的关系是 ${r.type}, 好感度 ${r.score}。`;
        }).join('\n');

        // 获取角色性格
        const personas = groupMembers.map(m => `- ${m.name}: ${m.settings.aiPersona}`).join('\n');

        // 4. 构建Prompt
        const systemPrompt = `
你是一个世界模拟器。距离上次模拟已经过去了 ${elapsedHours.toFixed(1)} 小时。
请基于以下信息，模拟并总结在这段时间内，【${groupName}】这个社交圈子里发生的【1-3件】最重要的互动或关系变化。

【当前世界状态】
1. 角色关系快照:
${relationsSnapshot || '角色之间还没有建立明确的关系。'}

2. 角色性格与动机:
${personas}

【你的任务】
模拟并总结这 ${elapsedHours.toFixed(1)} 小时内可能发生的互动。重点关注会导致关系变化的事件。

【输出要求】
请严格按照以下JSON格式返回你的模拟结果，不要有任何多余的文字：
{
    "relationship_updates": [
    { "char1_name": "角色名1", "char2_name": "角色名2", "score_change": -5, "reason": "模拟出的具体事件或原因。" }
    ],
  "new_events_summary": [
    "用一句话总结发生的关键事件1。",
    "用一句话总结发生的关键事件2。"
    ]
    "personal_milestones": [
    { "character_name": "角色名", "milestone": "在TA的个人追求上取得的进展、挫折或发现。例如：'在研究古代遗迹时，有了一个惊人的发现。'" }
]
}
        `;

        try {
            const response = await fetch(`${apiConfig.proxyUrl}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: 'system', content: systemPrompt }],
                    temperature: 0.8,
                    response_format: { type: "json_object" }
                })
            });

            if (!response.ok) throw new Error(`API for group ${groupName} failed.`);
            
            const result = await response.json();
            const simulationData = JSON.parse(result.choices[0].message.content);

            // 5. 应用模拟结果
            // 更新关系分数
            for (const update of simulationData.relationship_updates) {
                const char1 = allChats.find(c => c.name === update.char1_name);
                const char2 = allChats.find(c => c.name === update.char2_name);
                if (char1 && char2) {
                    await updateRelationshipScore(char1.id, char2.id, update.score_change);
                }
            }
            // 记录事件日志
            for (const summary of simulationData.new_events_summary) {
                await db.eventLog.add({
                    timestamp: Date.now(),
                    type: 'simulation',
                    content: summary,
                    groupId: parseInt(groupId)
                });
            }
            if (simulationData.new_events_summary && simulationData.new_events_summary.length > 0) {
                // 写入离线总结
                await db.offlineSummary.put({
                    id: groupName,
                    events: simulationData.new_events_summary,
                    timestamp: Date.now()
                });

                // 查找并更新《编年史》
                if (group && group.worldBookIds) {
                    const associatedBooks = allWorldBooks.filter(wb => group.worldBookIds.includes(wb.id));
                    const chronicleBook = associatedBooks.find(wb => wb.name.includes('编年史'));
                    
                    if (chronicleBook) {
                        // 1. 获取更精确的时间
                        const eventDateTime = new Date().toLocaleString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                        
                        // 2. 格式化好感度变化
                        let relationshipChangesSummary = '';
                        if (simulationData.relationship_updates && simulationData.relationship_updates.length > 0) {
                            relationshipChangesSummary = simulationData.relationship_updates.map(update => 
                                `- ${update.char1_name} 与 ${update.char2_name} 的关系发生了变化 (好感度 ${update.score_change > 0 ? '+' : ''}${update.score_change})，因为: ${update.reason}`
                            ).join('\n');
                        }

                        // 3. 格式化主要事件
                        const mainEventsSummary = simulationData.new_events_summary.map(event => `- ${event}`).join('\n');

                        // 4. 组合成新的、更详细的条目
                        const chronicleEntry = `\n\n【${eventDateTime}】\n` +
                                            `${relationshipChangesSummary ? `\n[关系变化]\n${relationshipChangesSummary}\n` : ''}` +
                                            `\n[主要事件]\n${mainEventsSummary}`;

                        await db.worldBooks.update(chronicleBook.id, {
                            content: (chronicleBook.content || '') + chronicleEntry
                        });
                        console.log(`已将详细事件更新至《${chronicleBook.name}》。`);
                    }
                }
            }

        } catch (error) {
            console.error(`模拟分组【${groupName}】时出错:`, error);
        }
    }

    // 6. 模拟结束后，更新最后在线时间
    await db.globalSettings.update('main', { lastOnlineTime: now });
    console.log("离线模拟完成，已更新最后在线时间。");
}
 */

/**
 * 更新两个角色之间的关系分数
 * @param {string} char1Id - 角色1的ID
 * @param {string} char2Id - 角色2的ID
 * @param {number} scoreChange - 分数变化值 (可正可负)
 */
export async function updateRelationshipScore(char1Id, char2Id, scoreChange) {
    // 确保顺序一致，方便查询
    const [sourceId, targetId] = [char1Id, char2Id].sort();

    const existingRelation = await db.relationships.get({
        sourceCharId: sourceId,
        targetCharId: targetId
    });

    if (existingRelation) {
        const newScore = Math.max(-1000, Math.min(1000, (existingRelation.score || 0) + scoreChange));
        await db.relationships.update(existingRelation.id, { score: newScore });
    } else {
        await db.relationships.add({
            sourceCharId: sourceId,
            targetCharId: targetId,
            score: scoreChange,
            type: 'stranger' // 默认为陌生人关系
        });
    }
}

// --- 后台活动模拟引擎 ---


/**
 * @description 一个将任务委托给Service Worker的辅助函数。
 * @param {object} task - 要发送给Service Worker的任务对象。
 */
function delegateToServiceWorker(task) {
    if ('serviceWorker' in navigator) {
        // 使用 .ready 确保我们与一个已激活的Service Worker通信
        navigator.serviceWorker.ready.then(registration => {
            if (registration.active) {
                registration.active.postMessage(task);
            } else {
                 console.error('Service Worker已注册但未激活，无法委派任务:', task);
            }
        }).catch(error => {
            console.error('获取Service Worker registration失败:', error);
        });
    } else {
        console.error('浏览器不支持Service Worker，无法委派后台任务:', task);
    }
}

/**
 * @description 将AI独立行动的任务委托给Service Worker。
 * @param {string} charId - 要触发的角色的ID。
 */
export async function triggerInactiveAiAction(charId) {
    console.log(`[Engine] 正在委派角色 [${charId}] 的独立行动任务...`);
    delegateToServiceWorker({
        type: 'TRIGGER_INACTIVE_AI_ACTION',
        charId: charId
    });
}

/**
 * @description 将群聊中的AI行动任务委托给Service Worker。
 * @param {object} actor - 执行动作的成员对象。
 * @param {object} group - 该成员所在的群聊对象。
 */
export async function triggerInactiveGroupAiAction(actor, group) {
    console.log(`[Engine] 正在委派群聊 [${group.name}] 中角色 [${actor.name}] 的行动任务...`);
    delegateToServiceWorker({
        type: 'TRIGGER_INACTIVE_GROUP_AI_ACTION',
        actor: actor,
        group: group
    });
}

/**
 * @description 修改后: 此函数现在将好友申请的任务委托给Service Worker。
 * @param {string} chatId - 角色的聊天ID。
 */
export async function triggerAiFriendApplication(chatId) {
    console.log(`[Engine] 正在委派角色 [${chatId}] 的好友申请任务...`);
    delegateToServiceWorker({
        type: 'TRIGGER_AI_FRIEND_APPLICATION',
        chatId: chatId
    });
}

/**
 * 启动后台活动模拟器
 */
export function startActiveSimulation() {
    console.log("[Engine] 请求 Service Worker 启动前台模拟...");
    delegateToServiceWorker({ type: 'START_FOREGROUND_SIMULATION' });
}
/**
 * 停止后台活动模拟器
 */
export function stopActiveSimulation() {
    console.log("[Engine] 请求 Service Worker 停止前台模拟...");
    delegateToServiceWorker({ type: 'STOP_FOREGROUND_SIMULATION' });
}
/**
 * 模拟器的“心跳”，每次定时器触发时运行
 * 它会随机挑选一个角色，让他/她进行一次独立思考和行动

export async function runActiveSimulationTick() {
    // If the API is locked by a higher or equal priority task, skip this tick entirely.
    if (apiLock.getCurrentLock() !== 'idle') {
        // console.log(`API is locked by '${apiLock.getCurrentLock()}', skipping background tick.`);
        return;
    }

    // Attempt to acquire the lowest priority lock.
    if (!(await apiLock.acquire('background_tick'))) {
        // This means another task took the lock while we were checking.
        // console.log("Could not acquire 'background_tick' lock, another process became active.");
        return;
    }
    try {
        console.log("模拟器心跳 Tick...");
        
        const settings = await db.globalSettings.get('main');
        if (!settings?.enableBackgroundActivity) {
            stopActiveSimulation();
            return;
        }

        const privateChatProbability = settings.activeSimTickProb || 0.3;
        const groupChatProbability = settings.groupActiveSimTickProb || 0.15;

        // --- 处理私聊 ---
        const allSingleChats = await db.chats.where('isGroup').equals(0).toArray();
        // 筛选出可以进行后台活动的角色（未被拉黑）
        const eligibleChats = allSingleChats.filter(chat => !chat.blockStatus || (chat.blockStatus.status !== 'blocked_by_ai' && chat.blockStatus.status !== 'blocked_by_user'));

        if (eligibleChats.length > 0) {
            // 随机打乱数组
            eligibleChats.sort(() => 0.5 - Math.random());
            // 每次心跳只唤醒1到2个角色，避免API过载
            const chatsToWake = eligibleChats.slice(0, Math.min(eligibleChats.length, 2)); 
            console.log(`本次唤醒 ${chatsToWake.length} 个角色:`, chatsToWake.map(c => c.name).join(', '));

            for (const chat of chatsToWake) {
            // 1. 处理被用户拉黑的角色
                if (chat.blockStatus?.status === 'blocked_by_user') {
                    const blockedTimestamp = chat.blockStatus.timestamp;
                    if (!blockedTimestamp) continue;

                    const cooldownHours = settings.blockCooldownHours || 1;
                    const cooldownMilliseconds = cooldownHours * 60 * 60 * 1000;
                    const timeSinceBlock = Date.now() - blockedTimestamp;

                    if (timeSinceBlock > cooldownMilliseconds) {
                        console.log(`角色 "${chat.name}" 的冷静期已过...`);
                        chat.blockStatus.status = 'pending_system_reflection';
                        await db.chats.put(chat);
                        triggerAiFriendApplication(chat.id);
                    }
                    continue;
                }
                
                // 2. 处理正常好友的随机活动
                const lastMessage = chat.history.slice(-1)[0];
                let isReactionary = false;
                if (lastMessage && lastMessage.isHidden && lastMessage.role === 'system' && lastMessage.content.includes('[系统提示：')) {
                    isReactionary = true;
                }

                if (!chat.blockStatus && (isReactionary || Math.random() < privateChatProbability)) {
                    console.log(`角色 "${chat.name}" 被唤醒 (原因: ${isReactionary ? '动态互动' : '随机'})，准备行动...`);
                    await triggerInactiveAiAction(chat.id);
                }
            }
        }

        // --- 处理群聊 ---
        const allGroupChats = await db.chats.where('isGroup').equals(1).toArray();
        if (allGroupChats.length > 0) {
            for (const group of allGroupChats) {
                // 每个心跳周期，每个群聊有 15% 的几率发生一次主动行为
                if (group.members && group.members.length > 0 && Math.random() < groupChatProbability) {
                    // 从群成员中随机挑选一个“搞事”的
                    const actor = group.members[Math.floor(Math.random() * group.members.length)];
                    console.log(`群聊 "${group.name}" 被唤醒，随机挑选 "${actor.name}" 发起行动...`);
                    await triggerInactiveGroupAiAction(actor, group);
                }
            }
        }
    } finally {
        apiLock.release('background_tick');
    }
} */