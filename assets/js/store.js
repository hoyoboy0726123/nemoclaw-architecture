'use strict';
/* NemoClaw 電路實驗室 — IndexedDB 極簡 key-value 存放層
 * 用於重新整理後還原：工作狀態（app/editor）與助手對話（chat）。
 * 無痕模式或 IDB 不可用時全部靜默降級，不影響功能。
 */
window.CF = window.CF || {};

CF.Store = (function () {
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise(resolve => {
        try {
          const rq = indexedDB.open('nemoclaw-lab', 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
          rq.onsuccess = () => resolve(rq.result);
          rq.onerror = () => resolve(null);
          rq.onblocked = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    }
    return dbPromise;
  }

  async function get(key) {
    const db = await open();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const rq = db.transaction('kv').objectStore('kv').get(key);
        rq.onsuccess = () => resolve(rq.result ?? null);
        rq.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }

  async function set(key, value) {
    const db = await open();
    if (!db) return;
    return new Promise(resolve => {
      try {
        const rq = db.transaction('kv', 'readwrite').objectStore('kv').put(value, key);
        rq.onsuccess = () => resolve();
        rq.onerror = () => resolve();
      } catch (e) { resolve(); }
    });
  }

  async function del(key) {
    const db = await open();
    if (!db) return;
    return new Promise(resolve => {
      try {
        const rq = db.transaction('kv', 'readwrite').objectStore('kv').delete(key);
        rq.onsuccess = () => resolve();
        rq.onerror = () => resolve();
      } catch (e) { resolve(); }
    });
  }

  return { get, set, del };
})();
