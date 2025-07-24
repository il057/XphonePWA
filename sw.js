// 1. 引入Dexie库，让Service Worker能访问IndexedDB
importScripts('./dexie.min.js'); 


// 2. 重新定义数据库结构。
// 这是在Service Worker环境下的必要步骤，因为无法直接`import` ES模块。
const db = new Dexie('ChatDB');
db.version(29).stores({
    chats: '&id, isGroup, groupId, realName, lastIntelUpdateTime, unreadCount, &blockStatus',
    apiConfig: '&id',
    globalSettings: '&id',
    userStickers: '++id, &url, name, order',
    worldBooks: '&id, name',
    musicLibrary: '&id',
    personaPresets: '++id, name, avatar, gender, birthday, persona', 
    xzoneSettings: '&id',
    xzonePosts: '++id, timestamp, authorId',
    xzoneAlbums: '++id, name, createdAt',
    xzonePhotos: '++id, albumId',
    favorites: '++id, [type+content.id], type, timestamp, chatId',
    memories: '++id, chatId, [chatId+isImportant], authorName, isImportant, timestamp, type, targetDate',
    bubbleThemePresets: '&name',
    globalAlbum: '++id, url',
    userAvatarLibrary: '++id, &url, name',
    xzoneGroups: '++id, name, worldBookIds', 
    relationships: '++id, [sourceCharId+targetCharId], sourceCharId, targetCharId', 
    eventLog: '++id, timestamp, type, groupId, processedBy',
    offlineSummary: '&id, timestamp'
});


// 3. 创建一个广播频道，用于向所有打开的页面发送通知
const notificationChannel = new BroadcastChannel('xphone_notifications');

// 4. 监听来自页面的消息（任务委托）
self.addEventListener('message', (event) => {
    const task = event.data;
    if (!task || !task.type) return;

    console.log(`[SW] 收到任务: ${task.type}`);

    // 使用 event.waitUntil() 确保Service Worker在异步任务完成前保持活动状态
    switch (task.type) {
        case 'RUN_OFFLINE_SIMULATION':
            event.waitUntil(runOfflineSimulation());
            break;
        case 'TRIGGER_INACTIVE_AI_ACTION':
            event.waitUntil(handleInactiveAiAction(task.charId));
            break;
        case 'TRIGGER_INACTIVE_GROUP_AI_ACTION':
            event.waitUntil(handleInactiveGroupAiAction(task.actor, task.group));
            break;
        case 'TRIGGER_AI_FRIEND_APPLICATION':
            event.waitUntil(handleAiFriendApplication(task.chatId));
            break;
    }
});

// --- 后台任务处理函数 (这些函数现在运行在Service Worker中) ---

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

/**
 * @description (在SW中) 处理私聊角色的独立行动。
 */
async function handleInactiveAiAction(charId) {
    // 这里的全部逻辑都与您之前 simulationEngine.js 中的 triggerInactiveAiAction 函数几乎完全相同。
    // 关键区别是：它现在运行在Service Worker的独立环境中，并且使用本文件顶部的 `db` 实例。
    try {
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
        
            let recentPostsSummary = "";
            const lastMessage = chat.history.length > 0 ? chat.history[chat.history.length - 1] : null;

            // 优先检查最新的消息是否是动态提及
            if (lastMessage && lastMessage.type === 'user_post_mention') {
                const match = lastMessage.content.match(/动态ID: (\d+)/);
                if (match && match[1]) {
                    const postId = parseInt(match[1]);
                    const specificPost = await db.xzonePosts.get(postId);

                    if (specificPost) {
                        const authorChat = await db.chats.get(specificPost.authorId);
                        const authorName = authorChat ? authorChat.name : '用户';
                        const hasLiked = specificPost.likes.includes(charId);
                        const commentsText = specificPost.comments.length > 0
                            ? '已有评论:\n' + specificPost.comments.map(c => {
                                const commentAuthor = allChatsArray.find(chat => chat.id === c.author);
                                return `    - ${commentAuthor ? commentAuthor.name : c.author}: "${c.text}"`;
                            }).join('\n')
                            : '还没有评论。';
                        
                        recentPostsSummary = `
        # 决策参考：你需要优先处理的社交动态
        你刚刚被 ${authorName} 在新动态中@了，这是该动态的详细信息：
        - **动态ID**: ${specificPost.id}
        - **发布者**: ${authorName}
        - **内容**: "${specificPost.publicText || specificPost.content}"
        - **你的点赞状态**: 你 ${hasLiked ? '已经点赞过' : '还没有点赞'}。
        - **评论区**:
        ${commentsText}

        **你的任务**: 请基于以上信息，并结合你的人设和与发布者的关系，决定是否要点赞或发表一条【新的、不重复的】评论。
        `;
                    }
                }
            } else {
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
                } else{
                    recentPostsSummary = "最近没有你关心的动态。";
                }
            }

            const allCharsInDB = await db.chats.toArray();
            const groupMates = charGroupId ? allCharsInDB.filter(c => c.groupId === charGroupId && c.id !== charId && !c.isGroup) : [];
            let mentionableFriendsPrompt = "## 4.5 可@的同伴\n";
            const userDisplayName = xzoneSettings.nickname || '我';
            
            // 始终将用户添加为可@对象
            mentionableFriendsPrompt += `- ${userDisplayName} (ID: user)\n`;

            if (groupMates.length > 0) {
                mentionableFriendsPrompt += groupMates.map(m => `- ${m.name} (ID: ${m.id})`).join('\n');
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
                - **【【【行动铁律】】】**: 在“response”数组中，你可以返回【零个、一个或多个】动作。如果根据你的人设和当前情景，你觉得此时应该保持沉默，就返回一个空的 \`[]\` 数组。

                
                # PART 2: 你的内在状态 (请在行动前思考)
                在决定做什么之前，请先根据你的人设和参考情报，在内心构思：
                1.  **你此刻的心理状态是什么？** (例如：无聊、开心、有点想念用户、对某条动态感到好奇...)
                2.  **你现在最想达成的短期目标是什么？** (例如：想找人聊聊天、想分享一个有趣的发现、想反驳某个观点...)
                
                      
                # 2.1 社交互动指南
                在点赞或评论动态前，你【务必】参考你和发布者的关系及好感度。
                - **点赞 (Like)**: 这是一种常见的、低成本的社交认可。当你觉得动态内容不错，但又不想长篇大论评论时，点赞是绝佳的选择。特别是对好感度高的朋友，一个及时的赞能有效维系关系。
                - **评论 (Comment)**: 当你对动态内容有具体的想法或情绪想要表达时，使用评论。
                - **避免重复**: 在行动前，你【必须】检查该动态下是否已有你的点赞或评论。如果已有，你【绝对不能】重复操作，除非是回复他人的新评论。

                
                # 2.2 你的可选行动 (请根据你的人设【选择一项】最合理的执行):
                1.  **主动发消息**: 如果你现在有话想对用户说。
                2.  **发布动态**: 如果你此刻有感而发，想分享给所有人。
                3.  **与动态互动**: 如果你对看到的某条动态更感兴趣，你可以选择：
                    a. **点赞动态**: 如果你只是想表达一个简单的支持或认可。
                    b. **评论动态**: 如果你对此有话要说。
                
                # PART 3: 可用后台工具箱 (请选择一项)
                -   主动发消息给用户: \`[{"type": "text", "content": "你想对用户说的话..."}]\`
                -   发布文字动态: \`[{"type": "create_post", "postType": "text", "content": "动态的文字内容...", "mentionIds": ["(可选)要@的角色ID"]}]\`
                -   发布图片动态: \`[{"type": "create_post", "postType": "image", "publicText": "(可选)配图文字", "imageDescription": "对图片的详细描述", "mentionIds": ["(可选)要@的角色ID"]}]\`
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
                
                ${mentionableFriendsPrompt}

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
                **保持沉默示例:**
                \`\`\`json
                {
                "actions": []
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
                if (responseArray.length === 0) {
                    console.log(`[SW] 角色 "${chat.name}" 决定保持沉默。`);
                    return;
                }
        
                for (const action of responseArray) {
                    const actorName = action.name || chat.name;
                     switch (action.type) {
                        case 'text':
                            if (!action.content) {
                                console.warn(`[SW] 角色 "${chat.name}" 尝试发送空消息，已跳过。`, action);
                                break; // 使用 break 来代替 continue，因为我们在 switch 语句中
                            }
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
                            const chatToUpdate = await db.chats.get(charId); // 确保我们有最新的chat数据
                              if (chatToUpdate) {
                                  const notificationTitle = `${chatToUpdate.name}给你发来一条新消息`;
                                  const notificationOptions = {
                                      body: action.content,
                                      // 最佳实践：使用一个本地缓存的图标作为通知图标
                                      icon: chatToUpdate.settings?.aiAvatar || './icons/icon-192x192.png',
                                      tag: `xphone-message-${charId}`, // tag可以防止相同角色的消息产生多条通知
                                      renotify: true, // 如果tag相同，允许重新通知用户
                                      data: { // 可以附加一些数据，比如点击通知后跳转的URL
                                          url: `./chatRoom.html?id=${charId}`
                                      }
                                  };
                                  // 发起通知
                                  self.registration.showNotification(notificationTitle, notificationOptions);
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
                            console.log(`[SW] 后台活动: 角色 "${actorName}" 发布了动态`);
                            if (postData.mentionIds && postData.mentionIds.length > 0) {
                                for (const mentionedId of postData.mentionIds) {
                                    // 确保不通知用户自己
                                    if (mentionedId === 'user') continue;
                                    
                                    const mentionedChat = await db.chats.get(mentionedId);
                                    if (mentionedChat) {
                                        const systemMessage = {
                                            role: 'system',
                                            type: 'user_post_mention', // 复用这个类型
                                            content: `[系统提示：${actorName} 在一条新动态中 @提到了你。请你查看并决定是否需要回应。动态ID: ${newPostId}]`,
                                            timestamp: new Date(Date.now() + 1),
                                            isHidden: true
                                        };
                                        mentionedChat.history.push(systemMessage);
                                        await db.chats.put(mentionedChat);
                                    }
                                }
                            }
                            const postAuthorChat = await db.chats.get(charId);
                            if (postAuthorChat) {
                                const notificationTitle = `${actorName} 发布了新动态`;
                                const postText = action.publicText || action.content;
                                const notificationBody = postText 
                                    ? postText.substring(0, 100) + (postText.length > 100 ? '...' : '')
                                    : (action.postType === 'image' ? '分享了一张照片' : '分享了新鲜事');

                                self.registration.showNotification(notificationTitle, {
                                    body: notificationBody,
                                    icon: postAuthorChat.settings?.aiAvatar || './icons/icon-192x192.png',
                                    tag: `xphone-post-${Date.now()}`, // 使用时间戳确保每条动态都是新通知
                                    data: {
                                        url: './moments.html' // 点击通知后打开动态页面
                                    }
                                });
                            }
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
    } catch (error) {
        console.error(`[SW] 处理角色[${charId}]的独立行动时出错:`, error);
    }
}

/**
 * @description (在SW中) 处理群聊角色的独立行动。
 * @param {object} actor - 执行动作的成员对象。
 * @param {object} group - 该成员所在的群聊对象。
 */
async function handleInactiveGroupAiAction(actor, group) {
    try {
        const apiConfig = await db.apiConfig.get('main');
        if (!apiConfig?.proxyUrl || !apiConfig?.apiKey || !apiConfig.model) {
            console.error("[SW-Group] API配置不完整，无法执行群聊任务。");
            return;
        }

        const currentTime = new Date().toLocaleString('zh-CN', { dateStyle: 'full', timeStyle: 'short' });
        const userNickname = group.settings.myNickname || '我';
        
        // 寻找当前活跃的用户人格
        const personaPresets = await db.personaPresets.toArray();
        const globalSettings = await db.globalSettings.get('main');
        let activeUserPersona = null;
        if (personaPresets && globalSettings?.defaultPersonaId) {
             activeUserPersona = personaPresets.find(p => p.id === globalSettings.defaultPersonaId);
        }
        const userPersona = activeUserPersona?.persona || '用户的角色设定未知。';

        const membersList = group.members.map(m => `- **${m.name}**: ${m.settings?.aiPersona || '无特定人设'}`).join('\n');
        
        const recentHistory = group.history.filter(m => !m.isHidden).slice(-15);
        let recentContextSummary = "群里最近很安静。";
        if (recentHistory.length > 0) {
            recentContextSummary = recentHistory.map(msg => {
                const sender = msg.role === 'user' ? userNickname : msg.senderName;
                // 使用一个辅助函数来格式化不同类型的消息预览
                const contentPreview = (msg.type === 'text' || !msg.type) ? `"${String(msg.content).substring(0, 40)}..."` : `[发送了${msg.type}]`;
                return `${sender}: ${contentPreview}`;
            }).join('\n');
        }

        // 重构后的、更健壮的Prompt
        const systemPrompt = `
# PART 1: 核心角色与使命
你是一个高级群聊AI，你的使命是扮演群聊【${group.name}】中的角色 **“${actor.name}”**。这是一个后台独立行动，你需要根据当前情景，决定是否以及如何发言或行动，让群聊充满生机。

# 核心规则
1.  **身份铁律**: 你只能扮演 **“${actor.name}”**。绝对禁止扮演用户(“${userNickname}”)或其他任何AI角色。
2.  **第一人称铁律**: 你的所有发言内容都必须使用第一人称(“我”)。
3.  **格式铁律**: 你的回复**必须**是一个完整的JSON对象，结构为 \`{"response": [ ... actions ... ]}\`。
4.  **行动铁律**: 在“response”数组中，你可以返回【零个、一个或多个】动作。如果根据你的人设和当前情景，你觉得此时应该保持沉默，就返回一个空的 \`[]\` 数组。

# PART 2: 你的角色档案
- **姓名**: ${actor.name}
- **人设**: ${actor.persona || '一个普通的群友。'}

# PART 3: 剧本与情景
- **当前时间**: ${currentTime}。你的行动必须符合这个时间。
- **群聊名称**: ${group.name}
- **群成员列表**:
${membersList}
- **最近的群聊内容**:
${recentContextSummary}

# PART 4: 可用工具箱 (你的所有行动都必须从这里选择)
- **发消息**: \`{"type": "text", "content": "你想说的话..."}\`
- **@某人**: \`{"type": "text", "content": "@张三 我觉得..."}\`
- **发表情**: \`{"type": "send_sticker", "stickerName": "表情描述"}\`
- **发红包**: \`{"type": "red_packet", "packetType": "lucky", "amount": 8.88, "count": 3, "greeting": "来抢！"}\`
- **发起外卖**: \`{"type": "waimai_request", "productInfo": "一份麻辣烫", "amount": 30}\`

# PART 5: 最终输出格式 (必须严格遵守)
你的回复必须是单一的JSON对象，包含一个名为 "response" 的键，其值是一个动作数组。
**发言示例:**
\`\`\`json
{
  "response": [
    {
      "type": "text",
      "content": "大家晚上好啊，有人在吗？"
    }
  ]
}
\`\`\`
**保持沉默示例:**
\`\`\`json
{
  "response": []
}
\`\`\`
`;

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
        const aiResponseContent = JSON.parse(data.choices[0].message.content);

        const responseArray = aiResponseContent.response;

        if (!Array.isArray(responseArray)) {
             console.error(`[SW-Group] AI返回的response不是一个数组`, aiResponseContent);
             return;
        }
        if (responseArray.length === 0) {
            console.log(`[SW-Group] 角色 "${actor.name}" 决定保持沉默。`);
            return;
        }

        // 使用 for...of 循环来处理异步操作
        for (const action of responseArray) {
            const message = {
                role: 'assistant',
                senderName: actor.name,
                type: action.type,
                timestamp: Date.now(),
                ...(action.type === 'text' && { content: action.content }),
                ...(action.type === 'send_sticker' && { content: "一个表情", meaning: action.stickerName }),
                ...(action.type === 'red_packet' && { ...action }),
                ...(action.type === 'waimai_request' && { ...action, status: 'pending' }),
            };
            
            //在循环内部获取最新的group数据进行更新
            const groupToUpdate = await db.chats.get(group.id);
            if (groupToUpdate) {
                if (action.type === 'send_sticker') {
                      if (!action.stickerName) {
                          console.warn(`[SW-Group] AI ${actor.name} 尝试发送表情但缺少名称。`, action);
                          continue;
                      }
                      
                      const stickerToSend = await db.userStickers.where('name').equals(action.stickerName).first();
                      
                      const message = stickerToSend 
                          ? {
                              role: 'assistant', 
                              senderName: actor.name, 
                              type: 'sticker',
                              content: stickerToSend.url, 
                              meaning: stickerToSend.name, 
                              timestamp: Date.now()
                            }
                          : {
                              role: 'assistant', 
                              senderName: actor.name, 
                              type: 'text',
                              content: `[表情：${action.stickerName}]`, 
                              timestamp: Date.now()
                            };

                      groupToUpdate.history.push(message);
                  } else if (action.type === 'red_packet') {
                      // 1. 验证红包金额
                      const packetAmount = parseFloat(action.amount);
                      if (isNaN(packetAmount) || packetAmount <= 0) {
                          console.warn(`[SW-Group] AI ${actor.name} 尝试发送无效红包，已跳过。`, action);
                          continue; // 跳过此动作
                      }
                      const message = {
                          role: 'assistant', senderName: actor.name, type: 'red_packet', packetType: action.packetType,
                          timestamp: new Date(), totalAmount: packetAmount, count: action.count || 1,
                          greeting: action.greeting, receiverName: action.receiverName,
                          claimedBy: {}, isFullyClaimed: false,
                      };
                      groupToUpdate.history.push(message);
                      
                  } else if (action.type === 'open_red_packet') {
                      // 2. 实现AI领取红包的逻辑
                      const packet = groupToUpdate.history.find(m => toMillis(m.timestamp) === action.packet_timestamp);
                      if (packet && packet.type === 'red_packet') {
                          const hasClaimed = packet.claimedBy && packet.claimedBy[actor.name];
                          const isFullyClaimed = packet.count <= Object.keys(packet.claimedBy || {}).length;
                          const isForMe = packet.packetType !== 'direct' || packet.receiverName === actor.name;

                          if (!isFullyClaimed && !hasClaimed && isForMe) {
                              const remainingCount = packet.count - Object.keys(packet.claimedBy || {}).length;
                              const remainingAmount = packet.totalAmount - Object.values(packet.claimedBy || {}).reduce((s, v) => s + (v.amount || 0), 0);
                              let claimedAmount = (remainingCount === 1) ? remainingAmount : parseFloat((Math.random() * (remainingAmount / remainingCount * 1.5) + 0.01).toFixed(2));
                              
                              if (!packet.claimedBy) packet.claimedBy = {};
                              //保存领取时间和金额
                              packet.claimedBy[actor.name] = { amount: Math.max(0.01, claimedAmount), timestamp: Date.now() };

                              if (Object.keys(packet.claimedBy).length >= packet.count) packet.isFullyClaimed = true;
                              const systemMessage = {
                                  role: 'system',
                                  content: `[系统提示：${actorName} 领取了 ${packet.senderName} 的红包。]`,
                                  timestamp: new Date(messageTimestamp++),
                                  isHidden: true
                              };
                              currentChat.history.push(systemMessage);
                          }
                      }
                      // 领取红包是一个静默动作，不需要在聊天中添加新消息
                      
                  } else {
                      // 3. 处理其他类型的消息
                      const message = {
                          role: 'assistant', senderName: actor.name, type: action.type, timestamp: Date.now(),
                          ...(action.type === 'text' && { content: action.content }),
                          ...(action.type === 'waimai_request' && { ...action, status: 'pending' }),
                      };
                      groupToUpdate.history.push(message);
                  }
                groupToUpdate.unreadCount = (groupToUpdate.unreadCount || 0) + 1;
                await db.chats.put(groupToUpdate);
                
                console.log(`[SW-Group] 后台群聊活动: "${actor.name}" 在 "${group.name}" 中执行了 ${action.type} 动作。`);
                // 只对用户能感知到的消息类型发送通知
                if (['text', 'send_sticker', 'red_packet', 'waimai_request'].includes(action.type)) {
                    let notificationBody = '发来一条新消息';
                    switch(action.type) {
                        case 'text':
                            notificationBody = action.content;
                            break;
                        case 'send_sticker':
                            notificationBody = `[${action.stickerName || '表情'}]`;
                            break;
                        case 'red_packet':
                            notificationBody = `[红包] ${action.greeting || '恭喜发财，大吉大利！'}`;
                            break;
                        case 'waimai_request':
                            notificationBody = `想吃 ${action.productInfo}，发起了代付请求`;
                            break;
                    }

                    self.registration.showNotification(`${actor.name} 在 ${group.name} 中:`, {
                        body: notificationBody.substring(0, 100) + (notificationBody.length > 100 ? '...' : ''),
                        icon: actor.avatar || './icons/icon-192x192.png',
                        tag: `xphone-group-${group.id}`, // 将同一群聊的通知聚合
                        renotify: true, // 允许同一聚合标签的通知再次提醒用户
                        data: {
                            url: `./chatRoom.html?id=${group.id}`
                        }
                    });
                }
              }
        }
        
        // 所有消息都处理完后，发送一次广播
        notificationChannel.postMessage({ type: 'new_message' });

    } catch (error) {
        console.error(`角色 "${actor.name}" 在群聊 "${group.name}" 的独立行动失败:`, error.message, error.stack);
    }
}

/**
 * @description (在SW中) 处理被拉黑角色的好友申请逻辑。
 */
async function handleAiFriendApplication(chatId) {
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
 * @description 新增: 专门为后台同步使用的“心跳”函数。
 * (这是从 simulationEngine.js 复制并适配过来的)
 */
async function runActiveSimulationTickForSync() {
    console.log("[SW Sync] 模拟器心跳 Tick...");
    // 检查全局设置，是否启用后台活动
    const settings = await db.globalSettings.get('main');
    if (!settings?.enableBackgroundActivity) {
        return;
    }

    const privateChatProbability = settings.activeSimTickProb || 0.3;
    const groupChatProbability = settings.groupActiveSimTickProb || 0.15;

    const allSingleChats = await db.chats.where('isGroup').equals(0).toArray();
    const eligibleChats = allSingleChats.filter(chat => !chat.blockStatus || (chat.blockStatus.status !== 'blocked_by_ai' && chat.blockStatus.status !== 'blocked_by_user'));
    if (eligibleChats.length > 0) {
        eligibleChats.sort(() => 0.5 - Math.random());
        const chatsToWake = eligibleChats.slice(0, Math.min(eligibleChats.length, 2)); 
        for (const chat of chatsToWake) {
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
           } else {
                const lastMessage = chat.history.slice(-1)[0];
                let isReactionary = false;
                if (lastMessage && lastMessage.isHidden && lastMessage.role === 'system' && lastMessage.content.includes('[系统提示：')) {
                    isReactionary = true;
                }

                if (!chat.blockStatus && (isReactionary || Math.random() < privateChatProbability)) {
                    console.log(`角色 "${chat.name}" 被唤醒 (原因: ${isReactionary ? '动态互动' : '随机'})，准备行动...`);
                    await handleInactiveAiAction(chat.id);
                }
           }
        }
    }
    const allGroupChats = await db.chats.where('isGroup').equals(1).toArray();
    if (allGroupChats.length > 0) {
        for (const group of allGroupChats) {
            if (group.members && group.members.length > 0 && Math.random() < groupChatProbability) {
                const actor = group.members[Math.floor(Math.random() * group.members.length)];
                await handleInactiveGroupAiAction(actor, group);
            }
        }
    }
}
/**
 * 离线模拟引擎的主函数
 * 当用户重新打开应用时调用此函数。
 */
async function runOfflineSimulation() {
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

        console.log(`[SW] 正在模拟【${groupName}】...`);

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
            console.error(`[SW] 模拟分组【${groupName}】时出错:`, error);
        }
    }

     // 6. 模拟结束后，更新最后在线时间
    await db.globalSettings.update('main', { lastOnlineTime: now });
    console.log("[SW] 离线模拟完成，已更新最后在线时间。");

    // 7. (可选) 通知所有页面模拟已完成
    notificationChannel.postMessage({ type: 'offline_simulation_complete' });
}


self.addEventListener('notificationclick', event => {
    event.notification.close(); // 关闭通知

    const urlToOpen = event.notification.data.url;

    // event.waitUntil() 确保在窗口打开前，service worker 不会终止
    event.waitUntil(
        clients.matchAll({
            type: 'window',
            includeUncontrolled: true
        }).then(clientList => {
            // 如果已经有页面打开，就聚焦到那个页面并导航
            for (const client of clientList) {
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus();
                }
            }
            // 如果没有页面打开，就新开一个
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});

self.addEventListener('periodicsync', (event) => {
    // 检查我们注册的任务标签
    if (event.tag === 'run-simulation-tick') {
        console.log('[SW] 定期同步事件触发，开始执行后台心跳...');
        // 使用 waitUntil 确保在心跳函数完成前，Service Worker 不会被终止
        event.waitUntil(runActiveSimulationTickForSync());
    }
});

// --- Service Worker 生命周期事件---

const CACHE_NAME = 'xphone-cache-v5';
const urlsToCache = [
  './',
  './index.html',
  './dexie.min.js',
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

// install 事件用于预缓存核心文件**
self.addEventListener('install', event => {
    console.log('[SW] Install event');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('[SW] Caching app shell');
                return cache.addAll(urlsToCache);
            })
    );
});

// 安装 Service Worker 并缓存文件
self.addEventListener('activate', event => {
    console.log('[SW] Activate event');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => {
            console.log('[SW] Claiming clients');
            return self.clients.claim();
        })
    );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // 如果缓存中有匹配的响应，则返回它
        if (response) {
          return response;
        }
        // 否则，正常发起网络请求，并将其添加到缓存中
        return fetch(event.request).then(
            function(response) {
              // 检查我们是否收到了有效的响应
              if(!response || response.status !== 200 || response.type !== 'basic') {
                return response;
              }
    
              // 克隆响应。响应是一个流，只能被消费一次。
              // 我们需要一份给浏览器用，一份给缓存用。
              var responseToCache = response.clone();
    
              caches.open(CACHE_NAME)
                .then(function(cache) {
                  cache.put(event.request, responseToCache);
                });
    
              return response;
            }
          );
      })
  );
});
