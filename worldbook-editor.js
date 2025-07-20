// settings.js
// Import the shared database instance from db.js
import { db } from './db.js';


document.addEventListener('DOMContentLoaded', () => {

    const editorTitle = document.getElementById('editor-title');
    const nameInput = document.getElementById('world-book-name-input');
    const contentInput = document.getElementById('world-book-content-input');
    const saveBtn = document.getElementById('save-world-book-btn');

    let editingBookId = null;

    /**
     * 初始化编辑器页面
     */
    async function initializeEditor() {
        const urlParams = new URLSearchParams(window.location.search);
        const bookId = urlParams.get('id');

        if (bookId) {
            // 编辑模式
            editingBookId = bookId;
            const book = await db.worldBooks.get(bookId);
            if (book) {
                editorTitle.textContent = '编辑世界书';
                nameInput.value = book.name;
                contentInput.value = book.content || '';
            } else {
                alert('找不到要编辑的世界书！');
                window.location.href = 'worldbook.html';
            }
        } else {
            // 新建模式
            editorTitle.textContent = '新建世界书';
        }
    }

    /**
     * 保存世界书
     */
    async function saveWorldBook() {
        const name = nameInput.value.trim();
        const content = contentInput.value.trim();

        if (!name) {
            alert('世界书的名字不能为空！');
            return;
        }
        
        saveBtn.textContent = '保存中...';
        saveBtn.disabled = true;

        try {
            if (editingBookId) {
                // 更新现有的
                await db.worldBooks.update(editingBookId, { name, content });
            } else {
                // 创建新的
                const newBook = {
                    id: 'wb_' + Date.now(),
                    name: name,
                    content: content
                };
                await db.worldBooks.add(newBook);
            }
            alert('保存成功！');
            window.location.href = 'worldbook.html';

        } catch (error) {
            console.error('保存世界书失败:', error);
            alert('保存失败，详情请看控制台。');
        } finally {
            saveBtn.textContent = '保存';
            saveBtn.disabled = false;
        }
    }

    // 初始化
    initializeEditor();
    
    saveBtn.addEventListener('click', saveWorldBook);
});