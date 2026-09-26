(() => {
  const page = document.getElementById('autoSyncPage');
  if (!page) return;

  const connectionGrid = document.getElementById('autoSyncConnections');
  const tableBody = document.getElementById('autoSyncTableBody');
  const emptyEl = document.getElementById('autoSyncEmpty');
  const setupEl = document.getElementById('autoSyncSetup');
  const refreshBtn = document.getElementById('autoSyncRefresh');
  const PLATFORM_LABELS = { facebook: 'Facebook Ads', lazada: 'Lazada', shopee: 'Shopee' };
  const STATUS_LABELS = {
    not_configured: 'ยังไม่ตั้งค่า', connected: 'เชื่อมแล้ว', expired: 'หมดอายุ',
    error: 'มีข้อผิดพลาด', pending_approval: 'รออนุมัติ API'
  };

  function money(value) {
    return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 2 }).format(Number(value || 0));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  }

  async function sessionToken() {
    if (!window.supabaseClient && !window.__affSupabaseClient) return '';
    const client = window.__affSupabaseClient || window.supabaseClient;
    const { data } = await client.auth.getSession();
    return data?.session?.access_token || '';
  }

  async function api(path, options = {}) {
    const token = await sessionToken();
    if (!token) throw new Error('กรุณาเข้าสู่ระบบ Google ก่อน');
    const response = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const error = new Error(data.message || `API error ${response.status}`);
      error.code = data.error;
      error.details = data.details;
      throw error;
    }
    return data;
  }

  function renderConnections(connections) {
    connectionGrid.innerHTML = connections.map((connection) => {
      const platform = connection.platform;
      const status = connection.status || 'not_configured';
      const syncReady = status === 'connected';
      return `<article class="auto-sync-card">
        <div class="auto-sync-status" data-status="${escapeHtml(status)}">${escapeHtml(STATUS_LABELS[status] || status)}</div>
        <h3>${escapeHtml(PLATFORM_LABELS[platform] || platform)}</h3>
        <div class="auto-sync-note">${connection.account_label ? escapeHtml(connection.account_label) : 'ยังไม่มีบัญชีที่เชื่อม'}</div>
        <div class="auto-sync-note">Sync ล่าสุด: ${connection.last_sync_at ? new Date(connection.last_sync_at).toLocaleString('th-TH') : '—'}</div>
        ${connection.last_error ? `<div class="auto-sync-alert">${escapeHtml(connection.last_error)}</div>` : ''}
        <div class="auto-sync-actions">
          <button class="btn auto-sync-sync-btn" type="button" disabled title="จะเปิดใช้ในเฟส API ของแพลตฟอร์ม">${syncReady ? 'Sync now (เฟสถัดไป)' : 'ยัง Sync ไม่ได้'}</button>
        </div>
      </article>`;
    }).join('');
  }

  function renderRows(rows) {
    tableBody.innerHTML = rows.map((row) => `<tr>
      <td>${escapeHtml(row.sub_id2 || 'ไม่มี SUP')}</td>
      <td>${escapeHtml(row.person_code || '—')}</td>
      <td>${Number(row.orders || 0).toLocaleString('th-TH')}</td>
      <td>${money(row.shopee_commission)}</td>
      <td>${money(row.lazada_commission)}</td>
      <td>${money(row.revenue)}</td>
      <td>${money(row.ad_spend)}</td>
      <td>${money(row.profit)}</td>
      <td>${row.roas == null ? '—' : Number(row.roas).toFixed(2)}</td>
      <td>${row.roi_pct == null ? '—' : `${Number(row.roi_pct).toFixed(1)}%`}</td>
    </tr>`).join('');
    emptyEl.hidden = rows.length > 0;
  }

  async function refresh() {
    setupEl.className = 'auto-sync-alert';
    setupEl.textContent = 'กำลังโหลด Auto Sync...';
    try {
      const [connections, reconciliation] = await Promise.all([
        api('/api/connections'),
        api('/api/reconciliation')
      ]);
      renderConnections(connections.connections || []);
      renderRows(reconciliation.rows || []);
      setupEl.className = 'auto-sync-alert good';
      setupEl.textContent = 'Foundation พร้อมใช้งาน: ตารางใหม่, dedup import และ SUP reconciliation เชื่อมแล้ว';
    } catch (error) {
      renderConnections(['facebook','lazada','shopee'].map((platform) => ({ platform, status:'not_configured' })));
      renderRows([]);
      setupEl.className = 'auto-sync-alert';
      setupEl.textContent = error.message + (error.code === 'not_team_member' ? ' — ต้องเพิ่ม user_id ลง team_members ก่อน' : '');
    }
  }

  async function readWorkbook(file) {
    if (!window.XLSX) throw new Error('ตัวอ่าน Excel ยังไม่พร้อม');
    const bytes = await file.arrayBuffer();
    const workbook = XLSX.read(bytes, { type:'array', cellDates:true, dateNF:'yyyy-mm-dd' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = XLSX.utils.sheet_to_json(sheet, { header:1, raw:true, defval:'' });
    if (matrix.length < 2) throw new Error('ไฟล์ไม่มีข้อมูล');
    const headers = matrix[0].map((value, index) => String(value || `Column_${index + 1}`).trim());
    const rows = matrix.slice(1).filter((row) => row.some((value) => String(value ?? '').trim() !== '')).map((row) => {
      const object = {};
      headers.forEach((header, index) => { object[header] = row[index] ?? ''; });
      return object;
    });
    return { headers, rows };
  }

  async function importFile(platform, inputId, statusId) {
    const input = document.getElementById(inputId);
    const status = document.getElementById(statusId);
    const accountId=document.getElementById('importAccount_'+platform).value;
    if(!accountId){status.textContent='กรุณาเลือกบัญชีต้นทางก่อน';return;}
    const file = input.files?.[0];
    if (!file) { status.textContent = 'กรุณาเลือกไฟล์ก่อน'; return; }
    status.textContent = 'กำลังอ่าน header และตรวจข้อมูล...';
    try {
      const workbook = await readWorkbook(file);
      const result = await api('/api/import/affiliate', {
        method:'POST',
        body: JSON.stringify({ accountId, platform, fileName:file.name, headers:workbook.headers, rows:workbook.rows })
      });
      if (result.duplicate) {
        status.textContent = `ไฟล์นี้เคยนำเข้าแล้ว ระบบไม่บวกยอดซ้ำ ✅`;
      } else {
        status.textContent = `สำเร็จ ${result.rowCount.toLocaleString('th-TH')} แถว · ไม่มี SUP ${result.unmatched} · SUP parse ไม่ผ่าน ${result.parseFailed}`;
      }
      input.value = '';
      document.dispatchEvent(new Event('aff:import:complete'));
      await refresh();
    } catch (error) {
      if (error.code === 'mapping_required' && error.details) {
        const required = error.details.required?.join(', ') || '';
        status.textContent = `${error.message} (ต้องมี: ${required})`;
      } else {
        status.textContent = error.message;
      }
    }
  }

  document.getElementById('autoImportShopee').addEventListener('click', () => importFile('shopee', 'autoShopeeFile', 'autoShopeeStatus'));
  document.getElementById('autoImportLazada').addEventListener('click', () => importFile('lazada', 'autoLazadaFile', 'autoLazadaStatus'));
  refreshBtn.addEventListener('click', refresh);
  document.addEventListener('aff:auto-sync:open', refresh);
  if (!page.hidden) refresh();
})();
