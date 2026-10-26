(() => {
  'use strict';
  if (window.top !== window || !['www.facebook.com', 'web.facebook.com'].includes(location.hostname)) return;
  let task = null, lastEditor = null;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const editable = node => node instanceof HTMLElement &&
    (node.tagName === 'TEXTAREA' || node.getAttribute('contenteditable') === 'true');
  const editorText = node => node.tagName === 'TEXTAREA' ? node.value : node.textContent || '';
  const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';

  function textRange(editor, oldLink) {
    const nodes = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node, full = '';
    while ((node = walker.nextNode())) { nodes.push({ node, start: full.length }); full += node.textContent; }
    const index = full.indexOf(oldLink);
    if (index < 0) throw new Error('ไม่พบลิงก์เดิมในช่องแก้ไข');
    let start = null, end = null;
    for (const part of nodes) {
      if (!start && index >= part.start && index < part.start + part.node.textContent.length)
        start = { node: part.node, offset: index - part.start };
      if (!end && index + oldLink.length > part.start && index + oldLink.length <= part.start + part.node.textContent.length)
        end = { node: part.node, offset: index + oldLink.length - part.start };
    }
    if (!start || !end) throw new Error('ช่องแก้ไขนี้แทนลิงก์อัตโนมัติไม่ได้ กรุณาคัดลอกลิงก์ไปวางเอง');
    const range = document.createRange();
    range.setStart(start.node, start.offset); range.setEnd(end.node, end.offset);
    return range;
  }
  function findEditor() {
    const matches = [...document.querySelectorAll('textarea,[contenteditable="true"]')]
      .filter(node => editable(node) && visible(node) && editorText(node).includes(task.oldLink));
    if (lastEditor && matches.includes(lastEditor)) return lastEditor;
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error('พบหลายช่องแก้ไข กรุณาคลิกช่องที่ต้องการก่อนกดเติมลิงก์');
    throw new Error('เปิดเมนู “แก้ไขโพสต์” หรือ “แก้ไขคอมเมนต์” บน Facebook ก่อน');
  }
  function createPanel() {
    const host = document.createElement('div');
    host.id = 'aff-edit-assistant-root';
    document.documentElement.appendChild(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `<style>
      :host { all: initial; }
      .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: min(370px, calc(100vw - 32px)); max-height: min(78vh, 650px); overflow: auto; box-sizing: border-box; padding: 16px; border-radius: 18px; background: #fffaf5; border: 1px solid #facda9; box-shadow: 0 18px 55px #16203345; color: #172235; font: 14px/1.5 system-ui,"Segoe UI",sans-serif; direction: ltr; }
      .tag { color:#b54d0b; font-size:11px; font-weight:800; letter-spacing:.08em; }
      h2 { font-size:18px; margin:6px 0 4px; }
      p { margin:6px 0 12px; color:#455269; }
      .url { display:block; overflow-wrap:anywhere; background:#fff; padding:8px; border:1px solid #ead9ca; border-radius:8px; font-size:11px; margin:7px 0; }
      .url strong { display:block; font-size:11px; color:#ad4d0c; }
      .steps { margin:12px 0; padding-left:22px; font-size:12px; color:#36445e; }
      button { font:inherit; cursor:pointer; border:0; border-radius:10px; padding:9px 12px; background:#f97316; color:white; font-weight:700; margin:4px 4px 4px 0; }
      button.secondary { background:#e9eef7; color:#1e3a60; }
      #status { min-height:25px; padding:9px; border-radius:9px; background:#fff0e0; font-size:12px; }
      #status.error { background:#ffe6e6; color:#a02525; }
    </style>
    <section class="box" aria-label="AFF ตัวช่วยแก้ลิงก์">
      <span class="tag">AFF · EDIT POST</span>
      <h2>ช่วยแก้ลิงก์โพสต์</h2>
      <p>ตรวจให้แน่ใจว่าเป็นโพสต์และเพจที่ถูกต้อง</p>
      <div class="url"><strong>ลิงก์เดิม</strong><span id="old"></span></div>
      <div class="url"><strong>ลิงก์ใหม่</strong><span id="fresh"></span></div>
      <ol class="steps"><li>เปิดเมนู Facebook แล้วเลือกแก้ไขโพสต์หรือคอมเมนต์</li><li>คลิกในช่องแก้ไข แล้วกด “เติมลิงก์ใหม่”</li><li>ตรวจข้อความและกดบันทึกบน Facebook ด้วยตนเอง</li></ol>
      <button id="fill" type="button">เติมลิงก์ใหม่ในช่องแก้ไข</button>
      <button id="copy" class="secondary" type="button">คัดลอกลิงก์ใหม่</button>
      <button id="verify" class="secondary" type="button">ตรวจหน้าหลังบันทึก</button>
      <button id="done" class="secondary" type="button">ปิดงานช่วยแก้</button>
      <div id="status" role="status" aria-live="polite">รอให้เปิดช่องแก้ไขบน Facebook</div>
    </section>`;
    const $ = id => shadow.getElementById(id);
    $('old').textContent = task.oldLink;
    $('fresh').textContent = task.newLink;
    const setStatus = (value, error = false) => {
      $('status').textContent = value;
      $('status').classList.toggle('error', error);
    };
    document.addEventListener('focusin', event => {
      const node = event.target.closest?.('textarea,[contenteditable="true"]');
      if (editable(node)) lastEditor = node;
    });
    $('fill').addEventListener('click', () => {
      try {
        const editor = findEditor();
        const original = editorText(editor);
        const expected = AFFEditCore.replaceOne(original, task.oldLink, task.newLink);
        const index = original.indexOf(task.oldLink);
        if (editor.tagName === 'TEXTAREA') {
          editor.focus();
          editor.setRangeText(task.newLink, index, index + task.oldLink.length, 'end');
          editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: task.newLink }));
        } else {
          const range = textRange(editor, task.oldLink);
          editor.focus();
          const selection = window.getSelection();
          selection.removeAllRanges(); selection.addRange(range);
          if (!document.execCommand('insertText', false, task.newLink)) throw new Error('ช่องแก้ไขไม่รับการแทนข้อความ กรุณาคัดลอกไปวางเอง');
        }
        if (editorText(editor) !== expected) throw new Error('ข้อความในช่องอาจเปลี่ยน กรุณาตรวจลิงก์ก่อนกดบันทึก');
        setStatus('เติมลิงก์แล้ว · ตรวจทั้งข้อความและเพจ จากนั้นกดบันทึกบน Facebook');
      } catch (error) { setStatus(error.message || 'เติมลิงก์ไม่สำเร็จ', true); }
    });
    $('copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(task.newLink); setStatus('คัดลอกลิงก์ใหม่แล้ว'); }
      catch { setStatus('คัดลอกอัตโนมัติไม่ได้ กรุณาคัดลอกลิงก์ที่แสดงด้านบน', true); }
    });
    $('verify').addEventListener('click', () => {
      const text = document.body.innerText || '';
      if (text.includes(task.newLink) && !text.includes(task.oldLink))
        setStatus('หน้า Facebook แสดงลิงก์ใหม่แล้ว · ตรวจโพสต์จริงอีกครั้งก่อนติ๊กงานบน AFF');
      else if (text.includes(task.oldLink)) setStatus('ยังพบลิงก์เดิมบนหน้านี้ ตรวจข้อความโพสต์และคอมเมนต์อีกครั้ง', true);
      else setStatus('ยังยืนยันจากข้อความที่แสดงไม่ได้ ลองรีเฟรชโพสต์และตรวจเอง', true);
    });
    $('done').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'AFF_EDIT_CLEAR' }).catch(() => {});
      host.remove();
    });
  }
  (async () => {
    for (let i = 0; i < 12; i++) {
      try { task = (await chrome.runtime.sendMessage({ type: 'AFF_EDIT_GET_TASK' }))?.task; }
      catch { return; }
      if (task) break;
      await pause(350);
    }
    if (task) createPanel();
  })();
})();
