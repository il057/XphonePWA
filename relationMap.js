// phone/relationMap.js
import { db } from './db.js';

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('relation-network');
    if (!container) return;

    // --- 1. 加载数据 ---
    const [allChats, allRelations, globalSettings, allPersonas, allGroups] = await Promise.all([
        db.chats.filter(c => !c.isGroup).toArray(),
        db.relationships.toArray(),
        db.globalSettings.get('main'),
        db.personaPresets.toArray(), 
        db.xzoneGroups.toArray()      
    ]);

    // 应用主题色
    const themeColor = globalSettings?.themeColor || '#3b82f6';

    // ---  Create a map to link a character ID to its specific Persona ID ---
    const charIdToPersonaId = new Map();
    allPersonas.forEach(persona => {
        if (persona.appliedChats && persona.appliedChats.length > 0) {
            const appliedSet = new Set(persona.appliedChats.map(String)); // Ensure all IDs are strings for comparison
            allChats.forEach(chat => {
                const chatGroupIdStr = chat.groupId ? String(chat.groupId) : null;
                // A character belongs to a persona if its ID or its GroupID is in the persona's applied list
                if (appliedSet.has(chat.id) || (chatGroupIdStr && appliedSet.has(chatGroupIdStr))) {
                    charIdToPersonaId.set(chat.id, persona.id);
                }
            });
        }
    });


    // --- 2. 准备节点 (Nodes) ---
    const nodes = new vis.DataSet();
    
    // 添加 User 节点
    allPersonas.forEach(persona => {
        nodes.add({
            id: `persona_${persona.id}`, // 使用带前缀的唯一ID
            label: persona.name,
            shape: 'image',
            image: persona.avatar || 'https://files.catbox.moe/kkll8p.svg',
            color: { background: '#ffffff', border: themeColor },
            borderWidth: 4, // 边框更粗以区分
            size: 50, // 节点更大
            font: { color: themeColor, face: 'Inter', size: 16, strokeWidth: 1, strokeColor: 'white' }
        });
    });

    // 添加角色节点
    allChats.forEach(chat => {
        nodes.add({
            id: chat.id,
            label: chat.name,
            shape: 'circularImage',
            image: chat.settings.aiAvatar || 'https://files.catbox.moe/kkll8p.svg',
            font: { face: 'Inter' }
        });
    });

// --- 3. 准备边 (Edges) ---
    const edges = new vis.DataSet();
    
    // 定义关系类型到颜色的映射
    const relationTypeColors = {
        lover: '#e91e63',   // 粉色
        friend: '#4caf50',  // 绿色
        family: '#2196f3',  // 蓝色
        rival: '#ff9800',   // 橙色
        stranger: '#9e9e9e' // 灰色
    };

    // --- MODIFIED: 处理角色与人格之间的关系 ---
    const userRelations = allRelations.filter(r => r.targetCharId === 'user');
    userRelations.forEach(rel => {
        const charId = rel.sourceCharId;
        const charNode = nodes.get(charId);
        if (!charNode) return; // 如果角色节点不存在，则跳过

        // Find the correct persona for this character using our map
        const personaId = charIdToPersonaId.get(charId);
        if (!personaId) {
            // This is expected if a character with a user relationship isn't assigned to a persona
            return; 
        }

        const score = rel.score;
        const type = rel.type || 'stranger';
        const color = relationTypeColors[type] || '#9e9e9e';
        const width = Math.max(0.5, (Math.abs(score) / 1000) * 5);

        // Get the specific persona this character should connect to
        const personaNodeId = `persona_${personaId}`;
        const persona = allPersonas.find(p => p.id === personaId);
        
        // Create a single edge to the correct persona
        if (persona) {
            edges.add({
                from: charId,
                to: personaNodeId,
                width: width,
                color: { color: color, highlight: themeColor },
                smooth: { type: 'continuous' }, // 角色到人格的线使用直线
                title: `${charNode.label} → ${persona.name}<br>关系: ${type}<br>好感度: ${score}`
            });
        }
    });

    // --- 处理角色与角色之间的关系 ---
    const processedRelations = new Set();
    allRelations.forEach(relA => {
        // 跳过与旧'user'节点的关系
        if (relA.sourceCharId === 'user' || relA.targetCharId === 'user') return;

        const sourceId = relA.sourceCharId;
        const targetId = relA.targetCharId;
        
        // 跳过无效节点或已处理的关系
        if (!nodes.get(sourceId) || !nodes.get(targetId) || processedRelations.has(`${sourceId}-${targetId}`)) {
            return;
        }

        // 找到反向关系 B -> A
        const relB = allRelations.find(r => r.sourceCharId === targetId && r.targetCharId === sourceId);

        // --- 绘制 A -> B 的弧线 ---
        const scoreA = relA.score;
        const typeA = relA.type || 'stranger';
        const colorA = relationTypeColors[typeA] || '#9e9e9e';
        const widthA = Math.max(0.5, (Math.abs(scoreA) / 1000) * 5);
        edges.add({
            from: sourceId,
            to: targetId,
            width: widthA,
            color: { color: colorA, highlight: themeColor },
            smooth: { type: 'curvedCW', roundness: 0.2 }, // 顺时针弧线
            title: `${nodes.get(sourceId).label} → ${nodes.get(targetId).label}<br>关系: ${typeA}<br>好感度: ${scoreA}`
        });

        // --- 如果存在反向关系，则绘制 B -> A 的弧线 ---
        if (relB) {
            const scoreB = relB.score;
            const typeB = relB.type || 'stranger';
            const colorB = relationTypeColors[typeB] || '#9e9e9e';
            const widthB = Math.max(0.5, (Math.abs(scoreB) / 1000) * 5);
            edges.add({
                from: targetId,
                to: sourceId,
                width: widthB,
                color: { color: colorB, highlight: themeColor },
                smooth: { type: 'curvedCCW', roundness: 0.2 }, // 逆时针弧线，确保不重叠
                title: `${nodes.get(targetId).label} → ${nodes.get(sourceId).label}<br>关系: ${typeB}<br>好感度: ${scoreB}`
            });
        }
        
        // 标记这对关系（双向）已处理
        processedRelations.add(`${sourceId}-${targetId}`);
        processedRelations.add(`${targetId}-${sourceId}`);
    });
    // --- 4. 配置选项 ---
    const options = {
        nodes: {
            borderWidth: 2,
            size: 40,
            color: {
                border: '#222222',
                background: '#666666'
            },
            font: { color: '#000000', size: 12, face: 'Inter' }
        },
        edges: {
            arrows: {
                to: { enabled: true, scaleFactor: 0.7 } // 默认启用箭头
            },
            smooth: {
                type: 'curvedCW', // 默认曲线类型
                roundness: 0.2    // 曲线弧度
            }
        },
        physics: {
            barnesHut: {
                gravitationalConstant: -15000,
                springConstant: 0.04,
                springLength: 200
            },
            minVelocity: 0.75
        },
        interaction: {
            tooltipDelay: 200,
            hideEdgesOnDrag: true
        }
    };

    // --- 5. 创建网络 ---
    const data = { nodes: nodes, edges: edges };
    new vis.Network(container, data, options);

    const network = new vis.Network(container, data, options);

    // 存储原始边的颜色，以便取消选择时恢复
    const originalEdgeColors = {};
    edges.get().forEach(edge => {
        originalEdgeColors[edge.id] = edge.color;
    });

    network.on("selectNode", function (params) {
        const selectedNodeId = params.nodes[0];
        const updatedEdges = [];

        edges.forEach(edge => {
            // 如果边的起点或终点是选中的节点
            if (edge.from === selectedNodeId || edge.to === selectedNodeId) {
                updatedEdges.push({
                    id: edge.id,
                    color: originalEdgeColors[edge.id].color, // 保持原始颜色
                    width: 5, // 将宽度增加到5以高亮
                    opacity: 1 // 确保完全不透明
                });
            } else {
                // 其他无关的线
                updatedEdges.push({
                    id: edge.id,
                    color: '#cccccc', // 设为灰色
                    width: 1, // 设为标准宽度
                    opacity: 0.5 // 设为半透明
                });
            }
        });
        edges.update(updatedEdges);
    });

    // 确保您的 deselectNode 函数也恢复了透明度
    network.on("deselectNode", function (params) {
        const updatedEdges = [];
        edges.forEach(edge => {
            const originalColor = originalEdgeColors[edge.id];
            const originalWidth = 1 + (Math.abs(edge.value * 10) / 100) * 4;
            updatedEdges.push({ id: edge.id, color: originalColor, width: originalWidth, opacity: 1 });
        });
        edges.update(updatedEdges);
    });
});