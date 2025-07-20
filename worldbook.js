// settings.js
// Import the shared database instance from db.js
import { db } from './db.js';


document.addEventListener('DOMContentLoaded', () => {

    const listContainer = document.getElementById('world-book-list');

    /**
     * 渲染世界书列表
     */
    async function renderWorldBookList() {
        if (!listContainer) return;

        const books = await db.worldBooks.toArray();
        listContainer.innerHTML = '';

        if (books.length === 0) {
            listContainer.innerHTML = '<p class="text-center text-gray-500 mt-10">点击右上角“+”创建你的第一本世界书</p>';
            return;
        }

        const ul = document.createElement('ul');
        ul.className = 'divide-y divide-gray-200';

        books.forEach(book => {
            const li = document.createElement('li');
            li.className = 'list-item p-4 cursor-pointer';
            
            li.innerHTML = `
                <h3 class="font-semibold text-gray-800">${book.name}</h3>
                <p class="text-sm text-gray-500 mt-1 truncate">${(book.content || '暂无内容...').replace(/\n/g, ' ')}</p>
            `;

            // 单击事件：跳转到编辑器
            li.addEventListener('click', () => {
                window.location.href = `worldbook-editor.html?id=${book.id}`;
            });

            // 长按事件：删除
            let pressTimer;
            li.addEventListener('mousedown', (e) => {
                pressTimer = window.setTimeout(async () => {
                    e.preventDefault();
                    const confirmed = confirm(`确定要删除世界书《${book.name}》吗？\n此操作不可撤销。`);
                    if (confirmed) {
                        try {
                            await db.worldBooks.delete(book.id);
                            // TODO: 还需要更新所有关联了此世界书的聊天设置
                            alert('删除成功！');
                            renderWorldBookList();
                        } catch (error) {
                            console.error('删除世界书失败:', error);
                            alert('删除失败，详情请看控制台。');
                        }
                    }
                }, 500); // 500毫秒触发长按
            });
            li.addEventListener('mouseup', () => clearTimeout(pressTimer));
            li.addEventListener('mouseleave', () => clearTimeout(pressTimer));

            ul.appendChild(li);
        });

        listContainer.appendChild(ul);
    }

    // 初始化
    renderWorldBookList();
});