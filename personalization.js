// settings.js
// Import the shared database instance from db.js
import { db, isDbReady } from './db.js';


document.addEventListener('DOMContentLoaded', async () => {
    // --- DB & State ---
    await isDbReady();

    let state = {
        globalSettings: {},
        wallpaperPresets: []
    };
    
    let currentWallpaperValue = '';
    let currentThemeColor = '#3b82f6';
    let longPressTimer = null;         
    let longPressJustFinished = false;

    // --- DOM Elements ---
    const preview = document.getElementById('wallpaper-preview');
    const urlInput = document.getElementById('wallpaper-url');
    const applyUrlBtn = document.getElementById('apply-wallpaper-url');
    const presetContainer = document.getElementById('preset-container');
    const saveAllBtn = document.getElementById('save-all-btn');
    const customColorMaker = document.getElementById('custom-color-maker');
    const color1Input = document.getElementById('color1');
    const color2Input = document.getElementById('color2');
    const themeColorPicker = document.getElementById('theme-color-picker');
    const saveCustomPresetBtn = document.getElementById('save-custom-preset');
    const fontUrlInput = document.getElementById('font-url-input');
    const fontPreviewBox = document.getElementById('font-preview');
    const resetFontBtn = document.getElementById('reset-font-btn');
    
    // Create a dynamic style tag for applying the font
    const dynamicFontStyle = document.createElement('style');
    dynamicFontStyle.id = 'dynamic-font-style';
    document.head.appendChild(dynamicFontStyle);

    // --- Functions ---

    /**
     * Applies the custom font to the page body and preview box.
     * @param {string} fontUrl - The URL of the font file.
     * @param {boolean} isPreviewOnly - If true, only applies to the preview box.
     */
    function applyFontForPreview(fontUrl) {
        if (!fontUrl) {
            fontPreviewBox.style.fontFamily = '';
            return;
        }
        const fontName = 'preview-user-font';
        let styleTag = document.getElementById('preview-font-style');
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.id = 'preview-font-style';
            document.head.appendChild(styleTag);
        }
        styleTag.textContent = `
            @font-face {
                font-family: '${fontName}';
                src: url('${fontUrl}');
                font-display: swap;
            }`;
        fontPreviewBox.style.fontFamily = `'${fontName}', 'Inter', sans-serif`;
    }

    /**
     * Loads all settings from the database and updates the UI.
     */
    async function loadSettings() {
        const settings = await db.globalSettings.get('main');
        state.globalSettings = settings || {
            id: 'main',
            wallpaper: '',
            themeColor: '#3b82f6',
            fontUrl: '',
            wallpaperPresets: defaultPresets
        };
        
        // Load wallpaper & theme
        currentWallpaperValue = state.globalSettings.wallpaper || `linear-gradient(to top, #a18cd1, #fbc2eb)`;
        currentThemeColor = state.globalSettings.themeColor || '#3b82f6';
        state.wallpaperPresets = state.globalSettings.wallpaperPresets || defaultPresets;
        
        updateWallpaperPreview(currentWallpaperValue);
        themeColorPicker.value = currentThemeColor;
        renderPresets();
        setActiveSwatch(currentWallpaperValue);

        // Load font URL into the input and update the preview box
        fontUrlInput.value = state.globalSettings.fontUrl || '';
        applyFontForPreview(state.globalSettings.fontUrl);
    }

    async function saveAllSettingsToDB() {
        saveAllBtn.textContent = '保存中...';
        saveAllBtn.disabled = true;

        try {
            // 我们将创建一个包含ID的完整设置对象
            const settingsToSave = {
                id: 'main', // 明确指定记录的ID
                wallpaper: currentWallpaperValue,
                themeColor: currentThemeColor,
                fontUrl: fontUrlInput.value.trim(),
                wallpaperPresets: state.wallpaperPresets
            };

            // 使用 .put() 来确保记录无论是否存在都会被正确写入
            await db.globalSettings.put(settingsToSave);

            presetContainer.classList.remove('edit-mode'); 
            
            alert('个性化设置已保存！');

        } catch (error) {
            console.error("保存设置失败:", error);
            alert("保存失败，请查看控制台获取错误信息。");
        } finally {
            saveAllBtn.textContent = '保存';
            saveAllBtn.disabled = false;
        }
    }
    
    // --- Other UI and Helper Functions ---
    const defaultPresets = [
        { name: '紫霞', gradient: ['#a18cd1', '#fbc2eb'], theme: '#9333ea' },
        { name: '清新', gradient: ['#84fab0', '#8fd3f4'], theme: '#0ea5e9' },
        { name: '暖阳', gradient: ['#ffecd2', '#fcb69f'], theme: '#f97316' },
        { name: '深海', gradient: ['#2E3192', '#1BFFFF'], theme: '#1BFFFF' },
        { name: '甜桃', gradient: ['#ff9a9e', '#fecfef'], theme: '#f43f5e' },
    ];

    function renderPresets() {
        presetContainer.innerHTML = '';
        state.wallpaperPresets.forEach((preset, index) => {
            const swatchWrapper = document.createElement('div');
            swatchWrapper.className = 'relative';

            const swatch = document.createElement('div');
            swatch.className = 'swatch h-12 rounded-lg cursor-pointer border-2 border-transparent transition-all';
            
            const styleValue = `linear-gradient(to top, ${preset.gradient[0]}, ${preset.gradient[1]})`;
            swatch.style.background = styleValue;
            swatch.dataset.wallpaper = styleValue;
            swatch.dataset.theme = preset.theme;
            swatch.dataset.index = index;

            const deleteBtn = document.createElement('div');
            deleteBtn.className = 'delete-btn';
            deleteBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-circle-fill" viewBox="0 0 16 16">
                <path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0M5.354 4.646a.5.5 0 1 0-.708.708L7.293 8l-2.647 2.646a.5.5 0 0 0 .708.708L8 8.707l2.646 2.647a.5.5 0 0 0 .708-.708L8.707 8l2.647-2.646a.5.5 0 0 0-.708-.708L8 7.293z"/>
                </svg>`;
            deleteBtn.title = '删除预设';
            
            swatchWrapper.appendChild(swatch);
            swatchWrapper.appendChild(deleteBtn);
            presetContainer.appendChild(swatchWrapper);
        });

        const customButtonWrapper = document.createElement('div');
        customButtonWrapper.className = 'relative';
        const customButton = document.createElement('div');
        customButton.className = 'custom-btn h-12 rounded-lg cursor-pointer border-2 border-dashed border-gray-300 flex items-center justify-center hover:bg-gray-50 transition-all';
        customButton.id = 'custom-swatch-btn';
        customButton.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-gear" viewBox="0 0 16 16">
            <path d="M8 4.754a3.246 3.246 0 1 0 0 6.492 3.246 3.246 0 0 0 0-6.492M5.754 8a2.246 2.246 0 1 1 4.492 0 2.246 2.246 0 0 1-4.492 0"/>
            <path d="M9.796 1.343c-.527-1.79-3.065-1.79-3.592 0l-.094.319a.873.873 0 0 1-1.255.52l-.292-.16c-1.64-.892-3.433.902-2.54 2.541l.159.292a.873.873 0 0 1-.52 1.255l-.319.094c-1.79.527-1.79 3.065 0 3.592l.319.094a.873.873 0 0 1 .52 1.255l-.16.292c-.892 1.64.901 3.434 2.541 2.54l.292-.159a.873.873 0 0 1 1.255.52l.094.319c.527 1.79 3.065 1.79 3.592 0l.094-.319a.873.873 0 0 1 1.255-.52l.292.16c1.64.893 3.434-.902 2.54-2.541l-.159-.292a.873.873 0 0 1 .52-1.255l.319-.094c1.79-.527 1.79-3.065 0-3.592l-.319-.094a.873.873 0 0 1-.52-1.255l.16-.292c.893-1.64-.902-3.433-2.541-2.54l-.292.159a.873.873 0 0 1-1.255-.52zm-2.633.283c.246-.835 1.428-.835 1.674 0l.094.319a1.873 1.873 0 0 0 2.693 1.115l.291-.16c.764-.415 1.6.42 1.184 1.185l-.159.292a1.873 1.873 0 0 0 1.116 2.692l.318.094c.835.246.835 1.428 0 1.674l-.319.094a1.873 1.873 0 0 0-1.115 2.693l.16.291c.415.764-.42 1.6-1.185 1.184l-.291-.159a1.873 1.873 0 0 0-2.693 1.116l-.094.318c-.246.835-1.428.835-1.674 0l-.094-.319a1.873 1.873 0 0 0-2.692-1.115l-.292.16c-.764.415-1.6-.42-1.184-1.185l.159-.291A1.873 1.873 0 0 0 1.945 8.93l-.319-.094c-.835-.246-.835-1.428 0-1.674l.319-.094A1.873 1.873 0 0 0 3.06 4.377l-.16-.292c-.415-.764.42-1.6 1.185-1.184l.292.159a1.873 1.873 0 0 0 2.692-1.115z"/>
        </svg>`;
        customButtonWrapper.appendChild(customButton);
        presetContainer.appendChild(customButtonWrapper);
    }
    
    function applyThemeColor(color) {
        currentThemeColor = color;
        const root = document.documentElement;
        root.style.setProperty('--theme-color', color);
        const hoverColor = shadeColor(color, -20);
        root.style.setProperty('--theme-color-hover', hoverColor);
    }

    function shadeColor(color, percent) {
        let R = parseInt(color.substring(1,3),16);
        let G = parseInt(color.substring(3,5),16);
        let B = parseInt(color.substring(5,7),16);
        R = parseInt(R * (100 + percent) / 100);
        G = parseInt(G * (100 + percent) / 100);
        B = parseInt(B * (100 + percent) / 100);
        R = (R<255)?R:255;  
        G = (G<255)?G:255;  
        B = (B<255)?B:255;  
        const RR = ((R.toString(16).length==1)?"0"+R.toString(16):R.toString(16));
        const GG = ((G.toString(16).length==1)?"0"+G.toString(16):G.toString(16));
        const BB = ((B.toString(16).length==1)?"0"+B.toString(16):B.toString(16));
        return "#"+RR+GG+BB;
    }

    function updateWallpaperPreview(style) {
        if (!style || typeof style !== 'string') return;
        currentWallpaperValue = style;
        if (style.startsWith('url') || style.startsWith('linear-gradient')) {
            preview.style.setProperty('--preview-bg-image', style);
            preview.style.setProperty('--preview-bg-color', 'transparent');
        } else {
            preview.style.setProperty('--preview-bg-image', 'none');
            preview.style.setProperty('--preview-bg-color', style);
        }
    }

    function setActiveSwatch(style) {
        presetContainer.querySelectorAll('.active-swatch').forEach(el => el.classList.remove('active-swatch'));
        if (style && !style.startsWith('url')) {
            try {
                const swatch = presetContainer.querySelector(`[data-wallpaper="${style}"]`);
                if (swatch) swatch.classList.add('active-swatch');
            } catch(e) { console.error("Could not set active swatch for style:", style, e); }
        }
    }
    
    function handleCustomColorChange() {
        const gradient = `linear-gradient(to top, ${color1Input.value}, ${color2Input.value})`;
        updateWallpaperPreview(gradient);
        applyThemeColor(themeColorPicker.value);
        setActiveSwatch(null);
    }

    // --- Event Listeners ---
    saveAllBtn.addEventListener('click', saveAllSettingsToDB);
    
    // Wallpaper & Theme Listeners
    applyUrlBtn.addEventListener('click', () => {
        const url = urlInput.value.trim();
        if (url && (url.startsWith('http') || url.startsWith('data:'))) {
            updateWallpaperPreview(`url("${url}")`);
            setActiveSwatch(null);
            customColorMaker.classList.add('hidden');
        } else {
            alert("请输入一个有效的图片URL。");
        }
    });

    function cancelLongPress() {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    }

    presetContainer.addEventListener('mousedown', (e) => {
        const swatch = e.target.closest('[data-wallpaper]');
        if (swatch) {
            longPressJustFinished = false; // 按下时，重置“刚刚长按过”的状态
            cancelLongPress(); // 清除任何可能存在的旧计时器
            longPressTimer = setTimeout(() => {
                presetContainer.classList.add('edit-mode'); // 进入编辑模式
                longPressJustFinished = true; // 标记长按已完成
            }, 700);
        }
    });
    presetContainer.addEventListener('mouseup', cancelLongPress);
    presetContainer.addEventListener('mouseleave', cancelLongPress);

    presetContainer.addEventListener('touchstart', (e) => {
        const swatch = e.target.closest('[data-wallpaper]');
        if (swatch) {
            longPressJustFinished = false; // 按下时，重置“刚刚长按过”的状态
            cancelLongPress();
            longPressTimer = setTimeout(() => {
                presetContainer.classList.add('edit-mode');
                longPressJustFinished = true;
            }, 700);
        }
    }, { passive: true });


    presetContainer.addEventListener('touchend', cancelLongPress);
    presetContainer.addEventListener('touchmove', cancelLongPress);

    presetContainer.addEventListener('click', (e) => {
        const swatch = e.target.closest('[data-wallpaper]');
        const customBtn = e.target.closest('#custom-swatch-btn');
        const deleteBtn = e.target.closest('.delete-btn');

        // 如果在编辑模式下，任何点击都应该先退出编辑模式
        if (longPressJustFinished) {
            longPressJustFinished = false; // 消耗掉这次标志，下次点击恢复正常
            return; // 阻止后续逻辑，不让本次点击关闭编辑模式
        }

        if (presetContainer.classList.contains('edit-mode') && !deleteBtn) {
            presetContainer.classList.remove('edit-mode');
            e.stopPropagation();
            return;
        }

        if (deleteBtn) {
            e.stopPropagation();
            const indexToDelete = parseInt(deleteBtn.parentElement.querySelector('[data-wallpaper]').dataset.index);
            if(confirm(`确定要删除预设 "${state.wallpaperPresets[indexToDelete].name}" 吗？`)) {
                state.wallpaperPresets.splice(indexToDelete, 1);
                renderPresets();
                setActiveSwatch(currentWallpaperValue);
            }
            return;
        }

        if (swatch) {
            const wallpaperStyle = swatch.dataset.wallpaper;
            setActiveSwatch(wallpaperStyle);
            updateWallpaperPreview(wallpaperStyle);
            applyThemeColor(swatch.dataset.theme);
            themeColorPicker.value = swatch.dataset.theme;
            customColorMaker.classList.add('hidden');
        } else if (customBtn) {
            customColorMaker.classList.toggle('hidden');
            if (!customColorMaker.classList.contains('hidden')) handleCustomColorChange();
        }
    });

    saveCustomPresetBtn.addEventListener('click', () => {
        const newPresetName = prompt("为你的新预设命名：", "我的方案");
        if (newPresetName && newPresetName.trim()) {
            state.wallpaperPresets.push({
                name: newPresetName.trim(),
                gradient: [color1Input.value, color2Input.value],
                theme: themeColorPicker.value
            });
            renderPresets();
            alert('预设已保存！将在下次点击"保存"按钮后生效。');
        }
    });
    
    [color1Input, color2Input, themeColorPicker].forEach(input => {
        input.addEventListener('input', handleCustomColorChange);
    });

    // Font Listeners
    fontUrlInput.addEventListener('input', () => {
        applyCustomFont(fontUrlInput.value.trim(), true);
    });

    resetFontBtn.addEventListener('click', async () => {
        if (confirm("确定要恢复默认字体吗？")) {
            fontUrlInput.value = '';
            applyCustomFont(''); // Apply reset immediately
            // The change will be persisted on the next "Save All" click
            alert("已恢复默认字体。请点击顶部的“保存”按钮以应用更改。");
        }
    });
    
    // --- Initialization ---
    loadSettings();
});