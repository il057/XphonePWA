// db.js
// Centralized Dexie DB definition to be shared across the application.
// All other modules will import the 'db' instance from this file.

// Initialize Dexie with the database name.
export const db = new Dexie('ChatDB');

// Define the database schema. This should be the single source of truth for the database structure.
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

// This object will manage access to the AI API to prevent conflicts.
export const apiLock = {
    _lock: 'idle', // 'idle', 'user_chat', 'offline_sim', 'background_tick'
    _priorityOrder: {
        'user_chat': 3,
        'offline_sim': 2,
        'background_tick': 1,
        'idle': 0
    },

    /**
     * Checks if the API is currently locked by ANY process.
     * @returns {boolean}
     */
    isLocked() {
        return this._lock !== 'idle';
    },

    /**
     * Gets the name of the current process holding the lock.
     * @returns {string}
     */
    getCurrentLock() {
        return this._lock;
    },

    /**
     * Attempts to acquire the lock for a process with a given priority.
     * Lower priority processes will fail if a higher priority one is running.
     * @param {string} priority - The priority level of the requesting process.
     * @returns {Promise<boolean>} - True if the lock was acquired, false otherwise.
     */
    async acquire(priority) {
        // A higher priority task (user_chat) can always interrupt lower ones.
        // We will wait for a short period to see if a higher priority lock is released.
        const startTime = Date.now();
        while (this._priorityOrder[this.getCurrentLock()] > this._priorityOrder[priority]) {
            // If we wait for more than 2 seconds, give up.
            if (Date.now() - startTime > 2000) {
                 console.warn(`Lock request for '${priority}' timed out waiting for '${this.getCurrentLock()}'`);
                 return false;
            }
            await new Promise(resolve => setTimeout(resolve, 100)); // Wait and check again
        }

        // If another process is running, even with the same priority, wait for it to finish.
        if (this.isLocked()) {
            return false;
        }

        console.log(`Lock Acquired: ${priority}`);
        this._lock = priority;
        return true;
    },

    /**
     * Releases the lock, making the API available for other processes.
     */
    release(priority) {
        // Only the process that acquired the lock can release it.
        if (this._lock === priority) {
            console.log(`Lock Released: ${priority}`);
            this._lock = 'idle';
        }
    }
};