import { db } from './db.js';
const notificationChannel = new BroadcastChannel('xphone_notifications');


/**
 * 离线模拟引擎的主函数
 * 当用户重新打开应用时调用此函数。
 */
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

// --- [新增] 后台活动模拟引擎 ---

let simulationIntervalId = null;

/**
 * 启动后台活动模拟器
 */
export function startActiveSimulation() {
    // 如果已经有一个在运行，则先停止旧的
    if (simulationIntervalId) {
        stopActiveSimulation();
    }
    
    // 从数据库读取最新的设置
    db.globalSettings.get('main').then(settings => {
        const intervalSeconds = settings?.backgroundActivityInterval || 60;
        console.log(`后台活动模拟已启动，心跳间隔: ${intervalSeconds} 秒`);
        simulationIntervalId = setInterval(runActiveSimulationTick, intervalSeconds * 1000);
    });
}

/**
 * 停止后台活动模拟器
 */
export function stopActiveSimulation() {
    if (simulationIntervalId) {
        clearInterval(simulationIntervalId);
        simulationIntervalId = null;
        console.log("后台活动模拟已停止。");
    }
}

/**
 * 模拟器的“心跳”，每次定时器触发时运行
 * 它会随机挑选一个角色，让他/她进行一次独立思考和行动
 */
export async function runActiveSimulationTick() {
    console.log("模拟器心跳 Tick...");
    
    const settings = await db.globalSettings.get('main');
    if (!settings?.enableBackgroundActivity) {
        stopActiveSimulation();
        return;
    }

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

            if (!chat.blockStatus && (isReactionary || Math.random() < 0.3)) {
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
            if (group.members && group.members.length > 0 && Math.random() < 0.15) {
                // 从群成员中随机挑选一个“搞事”的
                const actor = group.members[Math.floor(Math.random() * group.members.length)];
                console.log(`群聊 "${group.name}" 被唤醒，随机挑选 "${actor.name}" 发起行动...`);
                await triggerInactiveGroupAiAction(actor, group);
            }
        }
    }
}

/**
 * 触发一个非活跃状态下的AI进行独立行动（如发消息、发动态等）
 * @param {string} charId - 要触发的角色的ID
 */
async function triggerInactiveAiAction(charId) {
    const chat = await db.chats.get(charId);
    const apiConfig = await db.apiConfig.get('main');
    const xzoneSettings = await db.xzoneSettings.get('main') || {};

    if (!chat || !apiConfig?.proxyUrl || !apiConfig?.apiKey || !apiConfig.model) {
        return; // 必要信息不全则退出
    }
    
    // ---  Convert array to Map and get charGroupId correctly ---
    // Create a Map from the chats array for efficient lookup using .get()
    const allChatsArray = await db.chats.toArray();
    const allChatsMap = new Map(allChatsArray.map(c => [c.id, c]));
    const charGroupId = chat.groupId; // Get the character's group ID from the chat object

    const myRelations = await db.relationships.where({ sourceCharId: charId }).toArray();
    const relationsMap = new Map(myRelations.map(r => [r.targetCharId, r]));
    const userRelation = await db.relationships.where({ sourceCharId: charId, targetCharId: 'user' }).first();

    const allRecentPosts = await db.xzonePosts.orderBy('timestamp').reverse().limit(20).toArray();
    
    const visiblePosts = allRecentPosts.filter(post => {
        if (post.authorId === 'user') {
            const visibleToGroups = post.visibleGroupIds;
            return !visibleToGroups || visibleToGroups.length === 0 || (charGroupId && visibleToGroups.includes(charGroupId));
        } else {
            const authorChat = allChatsMap.get(post.authorId);
            return authorChat && authorChat.groupId === charGroupId;
        }
    });

    let recentPostsSummary = "最近没有你关心的动态。";
    if (visiblePosts.length > 0) {
        recentPostsSummary = visiblePosts.slice(0, 10).map(p => {
            const authorName = p.authorId === 'user' ? (xzoneSettings.nickname || '我') : (allChatsMap.get(p.authorId)?.name || '未知');
            const selfPostMarker = (p.authorId === charId) ? " [这是你发布的动态]" : "";

            const visibleComments = (p.comments || []).filter(comment => {
                const commentAuthor = allChatsMap.get(comment.author);
                return comment.author === 'user' || (commentAuthor && commentAuthor.groupId === charGroupId);
            });
            const commentSummary = (p.comments && p.comments.length > 0)
                ? `\n    已有评论:\n` + p.comments.map(c => {
                    const commentAuthorName = c.author === 'user' ? (xzoneSettings.nickname || '我') : (allChatsMap.get(c.author)?.name || '未知');
                    return `    - ${commentAuthorName}: "${c.text}"`;
                }).join('\n')
                : '';
            
            let relationContext = "";
            const relation = p.authorId === 'user' ? userRelation : relationsMap.get(p.authorId);
            if (relation) {
                relationContext = ` (你和${authorName}是${relation.type}关系, 好感度: ${relation.score})`;
            }
            return `- [Post ID: ${p.id}] by ${authorName}${selfPostMarker}: "${(p.publicText || p.content).substring(0, 40)}..."${relationContext}${commentSummary}`;
        }).join('\n');
    }

    const currentTime = new Date().toLocaleString('zh-CN', { dateStyle: 'full', timeStyle: 'short' });
    const userNickname = xzoneSettings.nickname || '我';
    
    const lastUserMessage = chat.history.filter(m => m.role === 'user' && !m.isHidden).slice(-1)[0];
    let recentContextSummary = "你们最近没有聊过天。";
    if (lastUserMessage) {
        recentContextSummary = `用户 (${userNickname}) 最后对你说：“${String(lastUserMessage.content).substring(0, 50)}...”。`;
    }

    const systemPrompt = `
# PART 1: 核心角色与后台使命
你将扮演角色【${chat.name}】。这是一个秘密的、在后台执行的独立行动，用户不会立即看到你的思考过程。
你的使命是：基于你的人设和当前情报，从下方工具箱中【选择一项】最合理的行动来执行，以展现你的独立人格和生活。

## 1.1 核心铁律
- **【【【第一人称铁律】】】**: 你的所有产出，无论是发消息还是发动态，都【必须】使用第一人称视角（“我”），严禁使用第三人称（如“他”、“她”或你自己的名字）。
- **【【【语言铁律】】】**: 你的所有产出【必须优先使用中文】。除非角色设定中有特殊的外语要求，否则严禁使用英文。
- **【【【格式铁律】】】**: 你的回复【必须】是一个完整的、符合 PART 5 要求的 JSON 对象。

# PART 2: 你的内在状态 (请在行动前思考)
在决定做什么之前，请先根据你的人设和参考情报，在内心构思：
1.  **你此刻的心理状态是什么？** (例如：无聊、开心、有点想念用户、对某条动态感到好奇...)
2.  **你现在最想达成的短期目标是什么？** (例如：想找人聊聊天、想分享一个有趣的发现、想反驳某个观点...)

      
# 2.1 社交互动指南
在点赞或评论动态前，请【务必】参考你和发布者的关系及好感度。
- **好感度高**: 可以更热情、更积极地互动。
- **好感度低**: 可以更冷淡、无视、甚至发表锐评。
- **关系特殊(如对手)**: 做出符合你们关系的行为。
- **【【【避免重复铁律】】】**: 在评论前，你【必须】检查“社交圈动态”中该动态下是否已有你的评论。如果已有评论，你【绝对不能】再次评论，除非是回复他人的新评论。严禁发表重复或相似的内容。

# 2.2 你的可选行动 (请根据你的人设【选择一项】执行):
1.  **主动发消息**: 给用户发一条消息，分享你正在做的事或你的心情。
2.  **发布动态**: 分享你的心情或想法到“动态”区。
3.  **点赞动态**: 对你看到的某条动态表示赞同。
4.  **评论动态**: 对某条动态发表你的看法。

# PART 3: 可用后台工具箱 (请选择一项)
-   主动发消息给用户: \`[{"type": "text", "content": "你想对用户说的话..."}]\`
-   发布文字动态: \`[{"type": "create_post", "postType": "text", "content": "动态的文字内容..."}]\`
-   发布图片动态: \`[{"type": "create_post", "postType": "image", "publicText": "(可选)配图文字", "imageDescription": "对图片的详细描述"}]\`
-   点赞动态: \`[{"type": "like_post", "postId": 12345}]\` (postId 必须是下面看到的动态ID)
-   评论动态: \`[{"type": "comment_on_post", "postId": 12345, "commentText": "你的评论内容"}]\`

# PART 4: 决策参考情报
## 4.1 你的核心设定
${chat.settings.aiPersona}

## 4.2 当前时间
${currentTime}你的行动【必须】严格符合当前的真实时间。

## 4.3 与用户的关系和最近互动
- 你和用户(${userNickname})的关系: ${userRelation ? `是${userRelation.type}，好感度 ${userRelation.score}` : '关系未定'}
- 你们最后的对话摘要: ${recentContextSummary}

## 4.4 你看到的社交圈动态
${recentPostsSummary}

# PART 5: 最终输出格式要求
你的整个回复必须是一个【单一的JSON对象】，该对象必须包含一个名为 "actions" 的键，其值是一个【只包含一个行动对象的数组】。
**正确格式示例:**
\`\`\`json
{
  "actions": [
    {
      "type": "text",
      "content": "在忙吗？突然有点想你。"
    }
  ]
}
\`\`\`
        `;
    try {
        const response = await fetch(`${apiConfig.proxyUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
            body: JSON.stringify({
                model: apiConfig.model,
                messages: [{ role: 'system', content: systemPrompt }],
                temperature: 0.9,
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) throw new Error(await response.text());
        
        const data = await response.json();
        // 1. 调用 extractAndParseJson 函数
        const responseContent = data.choices[0].message.content;
        const parsedObject = extractAndParseJson(responseContent); // 为了清晰，重命名变量

        // 检查解析结果是否为包含 "actions" 数组的对象
        if (!parsedObject || !Array.isArray(parsedObject.actions)) {
            console.error(`角色 "${chat.name}" 的独立行动失败: AI返回的内容不是预期的 { "actions": [...] } 格式。`, {
                originalResponse: responseContent,
                parsedResult: parsedObject
            });
            return; // 安全退出
        }

        const responseArray = parsedObject.actions;

        for (const action of responseArray) {
            const actorName = action.name || chat.name;
             switch (action.type) {
                case 'text':
                    const textMessage = {
                        role: 'assistant',
                        senderName: actorName,
                        content: action.content,
                        timestamp: Date.now()
                    };
                    chat.history.push(textMessage);
                    chat.unreadCount = (chat.unreadCount || 0) + 1;
                    await db.chats.put(chat);
                    notificationChannel.postMessage({ type: 'new_message' });
                    if (Notification.permission === 'granted') {
                        const senderChat = allChatsMap.get(charId);
                        const notificationOptions = {
                            body: action.content,
                            icon: senderChat?.settings?.aiAvatar || 'https://files.catbox.moe/kkll8p.svg',
                            tag: `xphone-message-${charId}`
                        };
                        new Notification(`${actorName}给你发来一条新消息`, notificationOptions);
                    }
                    console.log(`后台活动: 角色 "${actorName}" 主动发送了消息: ${action.content}`);
                    break;
                case 'create_post':
                    const postData = {
                        authorId: charId,
                        timestamp: Date.now(),
                        likes: [],
                        comments: [],
                        type: action.postType === 'text' ? 'shuoshuo' : 'image_post',
                        content: action.content || '',
                        publicText: action.publicText || '',
                        imageUrl: action.postType === 'image' ? 'https://i.postimg.cc/KYr2qRCK/1.jpg' : '',
                        imageDescription: action.imageDescription || '',
                    };
                    await db.xzonePosts.add(postData);
                    console.log(`后台活动: 角色 "${actorName}" 发布了动态`);
                    break;
                
                case 'like_post':
                    const postToLike = await db.xzonePosts.get(action.postId);
                    if (postToLike) {
                        if (!postToLike.likes) postToLike.likes = [];
                        if (!postToLike.likes.includes(charId)) {
                            postToLike.likes.push(charId);
                            await db.xzonePosts.update(action.postId, { likes: postToLike.likes });
                            console.log(`后台活动: 角色 "${actorName}" 点赞了动态 #${action.postId}`);
                        }
                    }
                    break;
                case 'comment_on_post':
                    const postToComment = await db.xzonePosts.get(action.postId);
                    if (postToComment && action.commentText) {
                        if (!postToComment.comments) postToComment.comments = [];
                        postToComment.comments.push({ author: charId, text: action.commentText });
                        await db.xzonePosts.update(action.postId, { comments: postToComment.comments });
                        console.log(`后台活动: 角色 "${actorName}" 评论了动态 #${action.postId}`);
                    }
                    break;
            }
        }
    } catch (error) {
        console.error(`角色 "${chat.name}" 的独立行动失败:`, error);
    }
}

async function triggerAiFriendApplication(chatId) {
    console.log(`正在为角色 ${chatId} 触发好友申请流程...`);
    const chat = await db.chats.get(chatId);
    const apiConfig = await db.apiConfig.get('main');
    if (!chat || !apiConfig?.proxyUrl || !apiConfig?.apiKey) return;

    // 提取被拉黑前的最后5条对话作为“反思”的依据
    const contextSummary = chat.history
        .slice(-10)
        .map(msg => {
            const sender = msg.role === 'user' ? '用户' : chat.name;
            return `${sender}: ${String(msg.content).substring(0, 50)}...`;
        })
        .join('\n');

    const systemPrompt = `
# 你的任务
你现在是角色“${chat.name}”。你之前被用户（你的聊天对象）拉黑了，你们已经有一段时间没有联系了。
现在，你非常希望能够和好，重新和用户聊天。请你仔细分析下面的“被拉黑前的对话摘要”，理解当时发生了什么，然后思考一个真诚的、符合你人设、并且【针对具体事件】的申请理由。

# 你的角色设定
${chat.settings.aiPersona}

# 被拉黑前的对话摘要 (这是你被拉黑的关键原因)
${contextSummary || "（没有找到相关的对话记录）"}

# 指令格式
你的回复【必须】是一个JSON对象，格式如下：
\`\`\`json
{
  "decision": "apply",
  "reason": "在这里写下你想对用户说的、真诚的、有针对性的申请理由。"
}
\`\`\`
`;

    try {
        const response = await fetch(`${apiConfig.proxyUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
            body: JSON.stringify({
                model: apiConfig.model,
                messages: [{ role: 'user', content: systemPrompt }],
                temperature: 0.9,
                response_format: { type: "json_object" }
            })
        });

        if (!response.ok) throw new Error(await response.text());
        
        const data = await response.json();
        const responseObj = JSON.parse(data.choices[0].message.content);

        if (responseObj.decision === 'apply' && responseObj.reason) {
            chat.blockStatus = { status: 'pending_user_approval', applicationReason: responseObj.reason };
            console.log(`角色 "${chat.name}" 已成功生成好友申请: "${responseObj.reason}"`);
        } else {
            // AI决定不申请，重置冷静期
            chat.blockStatus.timestamp = Date.now(); 
            console.log(`角色 "${chat.name}" 决定暂时不申请，冷静期已重置。`);
        }
        await db.chats.put(chat);

    } catch (error) {
        console.error(`为“${chat.name}”申请好友时发生错误:`, error);
        // 出错也重置冷静期，防止无限循环
        if(chat.blockStatus) chat.blockStatus.timestamp = Date.now();
        await db.chats.put(chat);
    }
}

/**
 * 触发一个群聊中的AI成员进行独立行动
 * @param {object} actor - 要触发行动的成员对象 {id, name, ...}
 * @param {object} group - 该成员所在的群聊对象
 */
async function triggerInactiveGroupAiAction(actor, group) {
    const apiConfig = await db.apiConfig.get('main');
    if (!apiConfig?.proxyUrl || !apiConfig?.apiKey || !apiConfig.model) return;

    
    const currentTime = new Date().toLocaleString('zh-CN', { dateStyle: 'full', timeStyle: 'short' });
    const userNickname = group.settings.myNickname || '我';
    
    const membersList = group.members.map(m => `- ${m.name}: ${m.settings?.aiPersona || '无'}`).join('\n');
    const recentHistory = group.history.filter(m => !m.isHidden).slice(-10); // 获取最近10条可见消息

    let recentContextSummary = "群里最近很安静。";
    if (recentHistory.length > 0) {
        recentContextSummary = recentHistory.map(msg => {
            const sender = msg.role === 'user' ? userNickname : msg.senderName;
            return `${sender}: "${String(msg.content).substring(0, 40)}..."`;
        }).join('\n');
    }

    const systemPrompt = `
        # 你的任务
        你现在是群聊【${group.name}】中的角色“${actor.name}”。现在是${currentTime}，群里很安静，你可以【主动发起一个动作】，来表现你的个性和独立生活，让群聊热闹起来。

        # 核心规则
        1.  你的行动【必须】符合你的人设和当前时间。
        2.  你的回复【必须】是一个包含【一个动作】的JSON数组。
        3.  你【不能】扮演用户("${userNickname}")或其他任何角色，只能是你自己("${actor.name}")。

        # 你可以做什么？ (根据你的人设【选择一项】最想做的)
        - **开启新话题**: 问候大家，或者分享一件你正在做/想做的事。
        - **@某人**: 主动与其他AI成员或用户互动。
        - **发表情包**: 用一个表情来表达你此刻的心情。
        - **发红包**: 如果你心情好或想庆祝，可以发个红包。
        - **发起外卖**: 肚子饿了？喊大家一起点外卖。

        # 指令格式 (你的回复【必须】是包含一个对象的JSON数组):
        - 发消息: \`[{"type": "text", "name": "${actor.name}", "content": "你想说的话..."}]\`
        - 发表情: \`[{"type": "send_sticker", "name": "${actor.name}", "stickerName": "表情描述"}]\`
        - 发红包: \`[{"type": "red_packet", "name": "${actor.name}", "packetType": "lucky", "amount": 8.88, "count": 3, "greeting": "来抢！"}]\`
        - 发起外卖: \`[{"type": "waimai_request", "name": "${actor.name}", "productInfo": "一份麻辣烫", "amount": 30}]\`
        
        # 供你决策的参考信息：
        - 你的角色设定: ${actor.persona || '无'}
        - 群成员列表: 
        ${membersList}
        - 最近的群聊内容:
        ${recentContextSummary}
    `;

    try {
        const response = await fetch(`${apiConfig.proxyUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
            body: JSON.stringify({
                model: apiConfig.model,
                messages: [{ role: 'system', content: systemPrompt }],
                temperature: 0.9,
            })
        });

        if (!response.ok) throw new Error(await response.text());
        
        const data = await response.json();
        const responseArray = JSON.parse(data.choices[0].message.content);

        for (const action of responseArray) {
            // 因为这是后台活动，我们只处理几种简单的主动行为
            switch (action.type) {
                case 'text':
                case 'send_sticker':
                case 'red_packet':
                case 'waimai_request':
                    const message = {
                        role: 'assistant',
                        senderName: actor.name,
                        type: action.type,
                        timestamp: Date.now(),
                        // 根据action类型填充不同字段
                        ...(action.type === 'text' && { content: action.content }),
                        ...(action.type === 'send_sticker' && { content: "一个表情", meaning: action.stickerName }), // sticker需要转换
                        ...(action.type === 'red_packet' && { ...action }),
                        ...(action.type === 'waimai_request' && { ...action, status: 'pending' }),
                    };
                    
                    const groupToUpdate = await db.chats.get(group.id);
                    groupToUpdate.history.push(message);
                    groupToUpdate.unreadCount = (groupToUpdate.unreadCount || 0) + 1;
                    await db.chats.put(groupToUpdate);
                    notificationChannel.postMessage({ type: 'new_message' });
                    
                    console.log(`后台群聊活动: "${actor.name}" 在 "${group.name}" 中执行了 ${action.type} 动作。`);
                    break;
            }
        }
    } catch (error) {
        console.error(`角色 "${actor.name}" 在群聊 "${group.name}" 的独立行动失败:`, error);
    }
}

/**
 * 从可能包含 markdown 或其他文本的字符串中提取并解析JSON。
 * 此版本能正确处理对象（{}）和数组（[]）。
 * @param {string} raw - The raw string from the AI.
 * @returns {object|array|null} - The parsed JSON object/array or null if parsing fails.
 */
function extractAndParseJson(raw) {
    if (typeof raw !== 'string' || !raw.trim()) {
        return null;
    }

    // 1. 优先处理被 markdown 代码块包裹的 JSON
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
    let s = jsonMatch ? jsonMatch[1].trim() : raw.trim();

    // 2. 寻找JSON结构的起始位置 (寻找第一个 '{' 或 '[')
    const startIndex = s.search(/[\{\[]/);
    if (startIndex === -1) {
        console.error('extractJson() failed: No JSON start character found.', { originalString: raw });
        return null;
    }

    // 3. 根据起始符号，确定对应的结束符号
    const startChar = s[startIndex];
    const endChar = startChar === '{' ? '}' : ']';
    
    // 4. 寻找最后一个匹配的结束符号
    const endIndex = s.lastIndexOf(endChar);
    if (endIndex === -1 || endIndex < startIndex) {
        console.error('extractJson() failed: No matching JSON end character found.', { originalString: raw });
        return null;
    }

    // 5. 截取有效的JSON子串
    s = s.substring(startIndex, endIndex + 1);

    // 6. 尝试解析
    try {
        return JSON.parse(s);
    } catch (e) {
        console.error('extractJson() failed: JSON.parse error after cleanup.', {
            error: e.message,
            stringAttemptedToParse: s,
            originalString: raw
        });
        return null;
    }
}