'use strict';
/* NemoClaw 電路實驗室 — 全域即時通知（toast）
 * 事故／跳脫／完成等關鍵事件同步浮現在操作區上方，自動收回、可點掉。
 * 事件紀錄（右欄 LOG）仍保留完整歷史；toast 只負責「即時看見」。
 */
window.CF = window.CF || {};

CF.Toast = (function () {
  let host = null;
  const recent = new Map();                                  // 同文去重（保護動作常連發兩則相同訊息）
  const TTL = { err: 7000, warn: 5000, ok: 3500, info: 3500 };
  const ICON = { err: '⚡', warn: '⚠', ok: '✅', info: 'ℹ' };

  function ensureHost() {
    if (host && host.isConnected) return host;
    host = document.createElement('div');
    host.id = 'toastHost';
    document.body.appendChild(host);
    return host;
  }

  function push(kind, text) {
    try {
      if (!document.body) return;
      kind = TTL[kind] ? kind : 'info';
      text = String(text || '').trim();
      if (!text) return;
      if (text.length > 150) text = text.slice(0, 150) + '…';
      const now = Date.now();
      if ((recent.get(text) || 0) > now - 2500) return;
      recent.set(text, now);
      if (recent.size > 40) recent.delete(recent.keys().next().value);

      const h = ensureHost();
      while (h.children.length >= 4) h.firstChild.remove();   // 最多疊 4 則
      const el = document.createElement('div');
      el.className = 'toast toast-' + kind;
      el.textContent = `${ICON[kind]} ${text}`;
      el.title = '點一下關閉';
      const timer = setTimeout(dismiss, TTL[kind]);
      function dismiss() {
        clearTimeout(timer);
        if (!el.parentNode) return;
        el.classList.add('toast-out');
        setTimeout(() => el.remove(), 260);
      }
      el.addEventListener('click', dismiss);
      h.appendChild(el);
    } catch (e) { /* 通知失敗不可影響模擬本體 */ }
  }

  /* 由事件紀錄文字自動分級（各模組的 pushLog 共用）——一般操作紀錄不彈，只彈關鍵事件 */
  function fromLog(text) {
    const t = String(text || '');
    if (/^載入情境|^已開始|^放置|^移除/.test(t)) return;   // 載入／建構類雜訊不彈
    if (/✅|任務完成/.test(t)) push('ok', t.replace(/^✅\s*/, ''));   // 完成類優先（內文可能提到「跳脫」等字）
    else if (/⚡⚡|事故|短路！|閃絡|燒毀|滅弧失敗|開關損壞/.test(t)) push('err', t.replace(/^⚡⚡\s*/, ''));
    else if (/跳脫|熔斷|拒動|越級|^⚠|停電|失壓|過電流|故障！/.test(t)) push('warn', t.replace(/^[⚠⚡]\s*/, ''));
  }

  return { push, fromLog };
})();
