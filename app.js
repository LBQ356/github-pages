/* 校园印吧 · 前端（零构建 ES Module，浅色/深色主题） */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const yuan = (cents) => `¥${(Number(cents || 0) / 100).toFixed(2)}`;
const fmtTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—';
const fmtClock = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, hour: '2-digit', minute: '2-digit' }) : '—';

const STATUS_LABEL = {
  UNPAID: '待支付',
  WAIT_ACCEPT: '待接单',
  ACCEPTED: '已接单',
  PRINTING: '打印中',
  READY_PICKUP: '待取件',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  REJECTED: '已拒单',
  CLOSED: '已关闭',
  PRINT_EXCEPTION: '打印异常',
};

const URGENCY_LABEL = { overdue: '已超时', urgent: '1 小时内', soon: '3 小时内', normal: '正常' };

const FONT_OPTIONS = [
  { value: '"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif', label: '系统默认（自适应）' },
  { value: 'SimSun,"Songti SC",serif', label: '宋体' },
  { value: 'SimHei,"Heiti SC",sans-serif', label: '黑体' },
  { value: 'KaiTi,"Kaiti SC",serif', label: '楷体' },
  { value: 'DengXian,"Microsoft YaHei",sans-serif', label: '等线' },
];

const state = {
  user: null,
  wallet: null,
  quota: null,
  pricing: null,
  view: 'home',
  docs: [],
  orders: [],
  print: { docId: null, doc: null, render: null, settings: null, preview: null, order: null, busy: false },
  editor: { doc: null, render: null, inspection: null, selected: null, tab: 'outline', rtab: 'props', save: 'saved', timer: 0, saving: false },
  merchant: { shopId: null, workspace: [], orders: [], analytics: null, q: '', status: '' },
  events: null,
  uploading: false,
};

class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const API_BASE = '/api/v1';

async function request(method, url, body, headers = {}) {
  if (url.startsWith('/')) url = API_BASE + url;
  const init = { method, headers: { ...headers }, credentials: 'same-origin' };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { code: 'BAD_RESPONSE', message: text.slice(0, 160) };
  }
  if (!response.ok) throw new ApiError(payload?.code ?? 'ERROR', payload?.message ?? `请求失败 ${response.status}`, response.status);
  return payload?.data ?? null;
}
const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  put: (url, body) => request('PUT', url, body ?? {}),
  del: (url) => request('DELETE', url),
};

/* ---------------- 主题 ---------------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const button = $('#theme-toggle');
  if (button) button.textContent = theme === 'dark' ? '☀' : '☾';
  try {
    localStorage.setItem('cp-theme', theme);
  } catch {
    /* 忽略隐私模式 */
  }
}
$('#theme-toggle').onclick = () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
};
applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

/* ---------------- 提示与弹层 ---------------- */

function toast(message, kind = '') {
  const node = document.createElement('div');
  node.className = `toast ${kind}`;
  node.textContent = message;
  $('#toast').appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

function openModal({ title, body, footer, wide = false, onMount }) {
  const root = $('#modal-root');
  root.innerHTML = `
    <div class="modal-mask" data-close="1"></div>
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
      <div class="modal-head"><h2>${esc(title)}</h2><span class="spacer"></span><button class="btn ghost sm" data-close="1">关闭</button></div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  root.classList.add('open');
  root.onclick = (event) => {
    if (event.target.dataset.close) closeModal();
  };
  onMount?.(root);
}

function closeModal() {
  const root = $('#modal-root');
  root.classList.remove('open');
  root.innerHTML = '';
}

/* ---------------- 路由与外壳 ---------------- */

const ROUTES = {
  '': 'home',
  home: 'home',
  files: 'files',
  print: 'print',
  orders: 'orders',
  wallet: 'wallet',
  merchant: 'merchant',
  'merchant/workspace': 'workspace',
  'merchant/orders': 'merchant-orders',
  'merchant/analytics': 'analytics',
  'merchant/redeem': 'redeem',
  'merchant/pricing': 'merchant-pricing',
  admin: 'admin',
  'admin/reconcile': 'reconcile',
};

function parseHash() {
  const raw = (location.hash || '#/').slice(2);
  const [path, queryString = ''] = raw.split('?');
  return { path: path.replace(/\/$/, ''), query: new URLSearchParams(queryString) };
}

function isStaff() {
  return Boolean(state.user?.shops?.length);
}

function isAdmin() {
  return Boolean(state.user?.isAdmin);
}

function navItems() {
  const items = [];
  if (isStaff()) {
    items.push({ label: '打印店', items: [
      { key: 'merchant', href: '#/merchant', icon: '▦', label: '概览' },
      { key: 'workspace', href: '#/merchant/workspace', icon: '▶', label: '打印工作区', badge: state.merchantWorkspaceCount },
      { key: 'merchant-orders', href: '#/merchant/orders', icon: '☰', label: '订单管理' },
      { key: 'analytics', href: '#/merchant/analytics', icon: '◔', label: '数据分析' },
      { key: 'redeem', href: '#/merchant/redeem', icon: '✓', label: '取件核销' },
      ...(state.user?.shops?.some((shop) => shop.role === 'MANAGER')
        ? [{ key: 'merchant-pricing', href: '#/merchant/pricing', icon: '¥', label: '价格设置' }]
        : []),
    ]});
  }
  items.push({ label: '我的', items: [
    { key: 'home', href: '#/', icon: '⌂', label: '工作台' },
    { key: 'print', href: '#/print', icon: '⎙', label: '在线打印' },
    { key: 'files', href: '#/files', icon: '▤', label: '我的文件' },
    { key: 'orders', href: '#/orders', icon: '▣', label: '我的订单' },
    { key: 'wallet', href: '#/wallet', icon: '◈', label: '钱包' },
  ]});
  if (isAdmin()) {
    items.push({ label: '平台', items: [
      { key: 'admin', href: '#/admin', icon: '⚙', label: '运行状态' },
      { key: 'reconcile', href: '#/admin/reconcile', icon: '≡', label: '对账与清理' },
    ]});
  }
  return items;
}

function renderSidebar() {
  const sidebar = $('#sidebar');
  const groups = navItems();
  sidebar.innerHTML = `${groups
    .map(
      (group) => `
      <div class="nav-section">
        <div class="nav-label">${group.label}</div>
        ${group.items
          .map(
            (item) => `<a class="nav-item ${state.view === item.key ? 'active' : ''}" href="${item.href}">
              <span class="ico">${item.icon}</span>${item.label}
              ${item.badge ? `<span class="nav-badge">${item.badge}</span>` : ''}
            </a>`,
          )
          .join('')}
      </div>`,
    )
    .join('')}
  `;
}

function updateChrome() {
  const user = state.user;
  $('#user-chip').hidden = !user;
  $('#btn-logout').hidden = !user;
  $('#wallet-chip').hidden = !user;
  $('#btn-upload-top').hidden = !user;
  if (!user) return;
  $('#user-name').textContent = user.displayName;
  $('#user-role').textContent = user.studentNo ? `学号 ${user.studentNo}` : isStaff() ? '打印店' : '';
  $('#avatar').textContent = (user.displayName || '?').slice(0, 1);
  if (state.wallet) $('#wallet-chip').textContent = `余额 ${yuan(state.wallet.balanceCents)}`;
}

async function loadWallet() {
  try {
    state.wallet = (await api.get('/wallet')).wallet;
    updateChrome();
  } catch {
    /* 未登录 */
  }
}

async function route() {
  const { path, query } = parseHash();
  let view = ROUTES[path] ?? 'home';
  if (path.startsWith('editor/')) view = 'editor';
  state.view = view;
  if (!state.user) return viewAuth();
  updateChrome();
  $('#sidebar').style.display = '';
  renderSidebar();
  try {
    if (view === 'home') return await viewHome();
    if (view === 'files') return await viewFiles();
    if (view === 'print') return await viewPrint(query);
    if (view === 'orders') return await viewOrders();
    if (view === 'wallet') return await viewWallet();
    if (path.startsWith('editor/')) return await viewEditor(Number(path.split('/')[1]));
    if (view === 'merchant') return await viewMerchantHome();
    if (view === 'workspace') return await viewWorkspace();
    if (view === 'merchant-orders') return await viewMerchantOrders();
    if (view === 'analytics') return await viewAnalytics();
    if (view === 'redeem') return await viewRedeem();
    if (view === 'merchant-pricing') return await viewMerchantPricing();
    if (view === 'admin') return await viewAdmin();
    if (view === 'reconcile') return await viewReconcile();
    return await viewHome();
  } catch (error) {
    if (error.status === 401) return viewAuth();
    console.error(error);
    toast(error.message, 'error');
    $('#view').innerHTML = `<div class="page"><div class="empty"><b>页面加载失败</b>${esc(error.message)}</div></div>`;
  }
}

window.addEventListener('hashchange', route);
$('#wallet-chip').onclick = () => openTopup();
$('#btn-upload-top').onclick = () => openUpload();
$('#btn-logout').onclick = async () => {
  await api.post('/auth/logout');
  state.user = null;
  state.events?.close();
  state.events = null;
  location.hash = '#/';
  viewAuth();
};

/* ---------------- 登录 ---------------- */

function viewAuth(mode = 'login') {
  updateChrome();
  $('#sidebar').innerHTML = '';
  $('#sidebar').style.display = 'none';
  $('#view').innerHTML = `
    <div class="auth">
      <div class="auth-card">
        <img class="auth-logo" src="assets/logo.jpg" alt="江西师范大学科学技术学院校徽">
        <h1>${mode === 'login' ? '登录校园印吧' : '创建账号'}</h1>
        <p class="sub">江西师范大学科学技术学院 · 上传 · 修改 · 实时计价 · 取件</p>
        <div class="auth-tabs">
          <button data-mode="login" class="${mode === 'login' ? 'active' : ''}">登录</button>
          <button data-mode="register" class="${mode === 'register' ? 'active' : ''}">注册</button>
        </div>
        <div class="field" style="margin-bottom:10px"><label>账号</label><input class="input" id="auth-username" placeholder="student1"></div>
        <div class="field" style="margin-bottom:10px"><label>口令</label><input class="input" id="auth-password" type="password" placeholder="至少 8 位"></div>
        ${mode === 'register' ? '<div class="field" style="margin-bottom:10px"><label>显示名</label><input class="input" id="auth-name" placeholder="张同学"></div><div class="field" style="margin-bottom:10px"><label>学号（可选）</label><input class="input" id="auth-student-no" placeholder="20240101"></div>' : ''}
        <div class="auth-error" id="auth-error"></div>
        <button class="btn primary block" id="auth-submit">${mode === 'login' ? '登录' : '注册并登录'}</button>
        <div class="auth-demo">
          学生 <code>student1 / Student@123</code><br>
          打印店 <code>staff1 / Staff@1234</code> · <code>manager1 / Manager@1234</code><br>
          管理员 <code>admin1 / Admin@12345</code>
        </div>
      </div>
    </div>`;
  $$('.auth-tabs button').forEach((button) => {
    button.onclick = () => viewAuth(button.dataset.mode);
  });
  const submit = async () => {
    const username = $('#auth-username').value.trim();
    const password = $('#auth-password').value;
    const displayName = $('#auth-name')?.value.trim();
    const studentNo = $('#auth-student-no')?.value.trim();
    $('#auth-error').textContent = '';
    try {
      const data = await api.post(mode === 'login' ? '/auth/login' : '/auth/register', { username, password, displayName, studentNo });
      state.user = { ...data.user, shops: data.shops };
      await loadWallet();
      updateChrome();
      connectEvents();
      location.hash = '#/';
      await route();
    } catch (error) {
      $('#auth-error').textContent = error.message;
    }
  };
  $('#auth-submit').onclick = submit;
  $('#auth-password').onkeydown = (event) => {
    if (event.key === 'Enter') submit();
  };
}

/* ---------------- 上传 ---------------- */

function openUpload() {
  const quota = state.quota;
  openModal({
    title: '上传文件',
    body: `
      <div class="dropzone" id="dropzone">
        <b>点击选择，或把文件拖到这里</b>
        DOCX · Markdown · TXT（可编修）与 PDF（直接打印），单个 ≤ 20 MiB
      </div>
      <input type="file" id="file-input" accept=".docx,.md,.markdown,.txt,.pdf" hidden>
      <p class="hint" style="margin-top:10px">
        ${quota ? `每人最多 ${quota.maxFiles} 个文件，已用 ${quota.used}；文件保留 ${quota.retentionDays} 天，到期自动归档。` : ''}
      </p>
      <div id="upload-progress"></div>`,
    footer: '<button class="btn" data-close="1">取消</button>',
  });
  const input = $('#file-input');
  const zone = $('#dropzone');
  zone.onclick = () => input.click();
  zone.ondragover = (event) => {
    event.preventDefault();
    zone.classList.add('over');
  };
  zone.ondragleave = () => zone.classList.remove('over');
  zone.ondrop = (event) => {
    event.preventDefault();
    zone.classList.remove('over');
    if (event.dataTransfer.files[0]) upload(event.dataTransfer.files[0]);
  };
  input.onchange = () => input.files[0] && upload(input.files[0]);

  async function upload(file) {
    if (state.uploading) return;
    state.uploading = true;
    const progress = $('#upload-progress');
    progress.innerHTML = '<p class="hint" style="margin-top:8px">正在上传与解析…</p>';
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const asset = await api.post('/assets', form);
      const mode = file.name.toLowerCase().endsWith('.pdf') ? 'PDF_DIRECT' : 'EDITABLE';
      const created = await api.post('/documents', { assetId: asset.asset.id, mode });
      toast('上传成功', 'ok');
      closeModal();
      state.quota = null;
      location.hash = `#/print?doc=${created.document.id}`;
    } catch (error) {
      progress.innerHTML = `<div class="notice rose" style="margin-top:8px">${esc(error.message)}</div>`;
    } finally {
      state.uploading = false;
    }
  }
}

/* ---------------- 共享组件 ---------------- */

async function ensurePricing() {
  if (!state.pricing) state.pricing = await api.get('/pricing');
  return state.pricing;
}

function paperGroups(shop) {
  const groups = new Map();
  for (const price of shop.prices) {
    if (!groups.has(price.sku)) {
      groups.set(price.sku, { sku: price.sku, paper: price.paperName, size: `${price.widthMm}×${price.heightMm}`, binding: price.bindingPriceCents, bw: null, color: null });
    }
    const group = groups.get(price.sku);
    if (price.colorMode === 'BW') group.bw = price;
    else group.color = price;
  }
  return [...groups.values()];
}

function discountNote(prices) {
  const discounts = prices.flatMap((price) => price.discounts ?? []);
  if (!discounts.length) return '';
  const best = discounts[discounts.length - 1];
  return `满 ${discounts[0].minImpressions} 面 ${Math.round((1 - discounts[0].factor) * 100)} 折`;
}

function priceCard() {
  const shop = state.pricing?.shops?.[0];
  if (!shop) return '';
  const groups = paperGroups(shop);
  return `
    <div class="price-card">
      <div class="head"><h3>价目表</h3><span class="chip">${esc(shop.name)}</span></div>
      ${groups
        .map(
          (group) => `
        <div class="price-row">
          <span class="p-name">${esc(group.paper)}</span>
          <span class="p-bw">黑白 <b>${group.bw ? yuan(group.bw.tiers[0].unitPriceCents) : '—'}</b></span>
          <span class="p-color">彩 <b>${group.color ? yuan(group.color.tiers[0].unitPriceCents) : '—'}</b></span>
        </div>`,
        )
        .join('')}
      <div class="price-note">装订 ${yuan(groups[0]?.binding ?? 0)}/份 · ${discountNote(shop.prices) || '无量大折扣'}</div>
    </div>`;
}

function fileIcon(doc) {
  const kind = doc.mode === 'PDF_DIRECT' ? 'PDF' : (doc.title.split('.').pop() || 'DOC').slice(0, 3).toUpperCase();
  return `<span class="file-ico ${doc.mode === 'PDF_DIRECT' ? 'pdf' : 'md'}">${kind === 'DOCX' ? 'DOC' : kind}</span>`;
}

function docsTable(docs, { compact = false } = {}) {
  if (!docs.length) return '<div class="empty"><b>还没有文件</b>上传后就出现在这里</div>';
  const sort = state.filesSort ?? { key: 'updated', dir: 'desc' };
  const header = (key, label) => {
    if (compact) return `<th>${label}</th>`;
    const active = sort.key === key;
    const caret = active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕';
    return `<th class="sortable ${active ? 'sorted' : ''}"><button data-sort="${key}">${label}<span class="caret">${caret}</span></button></th>`;
  };
  return `
    <table class="table">
      <thead><tr>${header('name', '文件')}${header('format', '格式')}${compact ? '' : '<th>版本</th>'}${header('updated', '更新时间')}${header('expiry', '剩余时长')}<th></th></tr></thead>
      <tbody>${docs
        .map((doc) => {
          const quotaDoc = state.quota?.documents?.find((item) => item.id === doc.id);
          const left = quotaDoc?.daysLeft ?? state.quota?.retentionDays ?? 0;
          return `<tr>
            <td><div class="file-name">${fileIcon(doc)}<div><b>${esc(doc.title)}</b><span>${doc.pinned ? '置顶 · ' : ''}${doc.stats?.characters ?? 0} 字 · ${doc.stats?.paragraphs ?? 0} 段</span></div></div></td>
            <td>${doc.mode === 'PDF_DIRECT' ? 'PDF' : '可编修'}</td>
            ${compact ? '' : `<td>rev ${doc.revision}</td>`}
            <td class="hint">${fmtTime(doc.updatedAt)}</td>
            <td><span class="expiry ${left <= 2 ? 'warn' : ''}">${left} 天</span></td>
            <td><div class="actions">
              <button class="btn sm" data-pin="${doc.id}" title="置顶">${doc.pinned ? '★' : '☆'}</button>
              ${doc.mode === 'EDITABLE' ? `<button class="btn sm" data-edit="${doc.id}">编辑</button>` : `<button class="btn sm" data-convert="${doc.id}">转可编辑</button>`}
              <button class="btn sm primary" data-print="${doc.id}">打印</button>
              <button class="btn sm danger" data-del="${doc.id}">删除</button>
            </div></td>
          </tr>`;
        })
        .join('')}</tbody>
    </table>`;
}

function wireDocActions() {
  $$('[data-pin]').forEach((button) => {
    button.onclick = async () => {
      const doc = state.docs.find((item) => item.id === Number(button.dataset.pin));
      await api.post(`/documents/${button.dataset.pin}/pin`, { pinned: !doc?.pinned });
      toast(doc?.pinned ? '已取消置顶' : '已置顶', 'ok');
      await route();
    };
  });
  $$('[data-convert]').forEach((button) => {
    button.onclick = async () => {
      try {
        const result = await api.post(`/documents/${button.dataset.convert}/convert`, {});
        toast(`已转为可编辑（提取 ${result.extracted.paragraphs} 段）`, 'ok');
        location.hash = `#/editor/${result.document.id}`;
      } catch (error) {
        toast(error.message, 'error');
      }
    };
  });
  $$('[data-edit]').forEach((button) => {
    button.onclick = () => (location.hash = `#/editor/${button.dataset.edit}`);
  });
  $$('[data-print]').forEach((button) => {
    button.onclick = () => (location.hash = `#/print?doc=${button.dataset.print}`);
  });
  $$('[data-del]').forEach((button) => {
    button.onclick = () => confirmDelete(Number(button.dataset.del));
  });
}

function confirmDelete(docId) {
  openModal({
    title: '删除文件',
    body: '<p class="hint">删除后归档并释放额度；已进入生产流程的订单不受影响。</p>',
    footer: '<button class="btn" data-close="1">取消</button><button class="btn danger" id="confirm-del">确认删除</button>',
  });
  $('#confirm-del').onclick = async () => {
    try {
      await api.del(`/documents/${docId}`);
      closeModal();
      toast('已删除', 'ok');
      await route();
    } catch (error) {
      toast(error.message, 'error');
    }
  };
}

function orderRow(order) {
  return `<tr>
    <td><span class="status ${order.status}">${STATUS_LABEL[order.status] ?? order.status}</span></td>
    <td class="mono">${esc(order.orderNo)}</td>
    <td>${order.student?.name ?? state.user.displayName}<span class="hint"> ${esc(order.student?.studentNo ?? '')}</span></td>
    <td>${order.items.length} 个文件</td>
    <td class="mono">${fmtTime(order.pickupWindow ? null : order.createdAt)}</td>
    <td>${yuan(order.totalCents)}</td>
    <td><div class="actions"><button class="btn sm" data-detail="${order.id}">明细</button></div></td>
  </tr>`;
}

/* ---------------- 首页工作台 ---------------- */

async function loadQuota() {
  state.quota = (await api.get('/quota')).quota;
  return state.quota;
}

async function viewHome() {
  const [quota, docsData, orderData] = await Promise.all([loadQuota(), api.get('/documents'), api.get('/orders')]);
  await ensurePricing();
  state.docs = docsData.documents;
  state.orders = orderData.orders;
  const active = state.orders.filter((order) => !['COMPLETED', 'CANCELLED', 'REJECTED', 'CLOSED'].includes(order.status));
  const unpaid = state.orders.filter((order) => order.payStatus === 'UNPAID' && order.status === 'UNPAID');
  $('#view').innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>工作台</h1><div class="sub">${esc(state.user.displayName)}${state.user.studentNo ? ` · 学号 ${esc(state.user.studentNo)}` : ''}，文件保留 ${quota.retentionDays} 天</div></div>
        <div class="spacer"></div>
        <button class="btn primary" id="home-upload">＋ 上传文件</button>
      </div>

      <div class="kpi-grid">
        <div class="kpi"><div class="label">文件额度</div><div class="value">${quota.used}<span class="hint"> / ${quota.maxFiles}</span></div><div class="sub">剩余 ${quota.remaining} 个</div></div>
        <div class="kpi"><div class="label">进行中订单</div><div class="value">${active.length}</div><div class="sub">待接单 / 打印 / 待取</div></div>
        <div class="kpi"><div class="label">待支付</div><div class="value">${unpaid.length}</div><div class="sub">${unpaid.length ? '尽快支付以免关闭' : '没有待支付订单'}</div></div>
        <div class="kpi"><div class="label">钱包余额</div><div class="value">${state.wallet ? yuan(state.wallet.balanceCents) : '—'}</div><div class="sub">演示余额</div></div>
      </div>

      <div class="layout-2" style="margin-top:18px">
        <div>
          <div class="panel">
            <div class="panel-head"><h2>我的文件</h2><span class="chip">${state.docs.length}</span><span class="spacer"></span><a class="btn sm" href="#/files">全部文件</a></div>
            ${docsTable(state.docs.slice(0, 5), { compact: true })}
          </div>
          <div class="panel" style="margin-top:16px">
            <div class="panel-head"><h2>最近订单</h2><span class="spacer"></span><a class="btn sm" href="#/orders">全部订单</a></div>
            ${active.length || state.orders.length ? `<table class="table"><tbody>${state.orders.slice(0, 5).map((order) => `<tr><td><span class="status ${order.status}">${STATUS_LABEL[order.status]}</span></td><td class="mono">${esc(order.orderNo)}</td><td class="hint">${fmtTime(order.createdAt)}</td><td style="text-align:right"><b>${yuan(order.totalCents)}</b></td></tr>`).join('')}</tbody></table>` : '<div class="panel-body hint">还没有订单，去「在线打印」选文件下单。</div>'}
          </div>
        </div>
        <div class="rail">
          ${priceCard()}
          <div class="panel">
            <div class="panel-body">
              <div class="section-head" style="margin:0 0 8px"><h2 style="font-size:13px">快捷操作</h2></div>
              <div class="row" style="flex-wrap:wrap;gap:8px">
                <a class="btn sm" href="#/print">在线打印</a>
                <a class="btn sm" href="#/files">文件管理</a>
                <a class="btn sm" href="#/orders">订单进度</a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  $('#home-upload').onclick = openUpload;
  wireDocActions();
  $$('[data-detail]').forEach((button) => (button.onclick = () => showOrderDetail(Number(button.dataset.detail))));
}

function docFormat(doc) {
  if (doc.mode === 'PDF_DIRECT') return 'pdf';
  const ext = (doc.title.split('.').pop() || 'doc').toLowerCase();
  return ext === 'markdown' ? 'md' : ext;
}

function daysLeft(doc) {
  const quotaDoc = state.quota?.documents?.find((item) => item.id === doc.id);
  return quotaDoc?.daysLeft ?? state.quota?.retentionDays ?? 0;
}

function filterAndSortDocs(docs) {
  const q = (state.filesQuery || '').trim().toLowerCase();
  const list = docs.filter((doc) => !q || doc.title.toLowerCase().includes(q) || docFormat(doc).includes(q));
  const sort = state.filesSort ?? { key: 'updated', dir: 'desc' };
  const dir = sort.dir === 'asc' ? 1 : -1;
  const pinnedFirst = (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
  const compare = (a, b) => {
    if (sort.key === 'name') return dir * a.title.localeCompare(b.title, 'zh-CN');
    if (sort.key === 'format') return dir * (docFormat(a).localeCompare(docFormat(b)) || a.title.localeCompare(b.title, 'zh-CN'));
    if (sort.key === 'expiry') return dir * (daysLeft(a) - daysLeft(b));
    return dir * String(a.updatedAt ?? '').localeCompare(String(b.updatedAt ?? ''));
  };
  return [...list].sort((a, b) => pinnedFirst(a, b) || compare(a, b));
}

function currentFiles() {
  return filterAndSortDocs(state.docs);
}

function paintFilesTable() {
  const table = $('#files-table');
  if (!table) return;
  table.innerHTML = docsTable(currentFiles());
  const count = $('#files-count');
  if (count) count.textContent = `${currentFiles().length} 个文件 · 点表头排序`;
  $$('[data-sort]').forEach((button) => {
    button.onclick = () => {
      const key = button.dataset.sort;
      if (state.filesSort?.key === key) state.filesSort.dir = state.filesSort.dir === 'asc' ? 'desc' : 'asc';
      else state.filesSort = { key, dir: key === 'name' || key === 'format' ? 'asc' : 'desc' };
      paintFilesTable();
    };
  });
  wireDocActions();
}

async function viewFiles() {
  const [docsData, quota] = await Promise.all([api.get('/documents'), loadQuota()]);
  state.docs = docsData.documents;
  $('#view').innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>我的文件</h1><div class="sub">${quota.used}/${quota.maxFiles} 个 · 保留 ${quota.retentionDays} 天</div></div>
        <div class="spacer"></div>
        <button class="btn primary" id="files-upload">＋ 上传文件</button>
      </div>
      <div class="panel">
        <div class="panel-body tight">
          <div class="row" style="flex-wrap:wrap">
            <input class="input" id="doc-search" style="max-width:280px" placeholder="搜索文件名 / 格式" value="${esc(state.filesQuery ?? '')}">
            <span class="hint">点击「文件 / 格式 / 更新时间 / 剩余时长」表头排序，点第二次反向</span>
            <span class="hint" style="margin-left:auto" id="files-count"></span>
          </div>
        </div>
        <div id="files-table"></div>
      </div>
    </div>`;
  $('#files-upload').onclick = openUpload;
  paintFilesTable();
  $('#doc-search').oninput = () => {
    state.filesQuery = $('#doc-search').value;
    clearTimeout(viewFiles.timer);
    viewFiles.timer = setTimeout(paintFilesTable, 220);
  };
}

/* ---------------- 打印页 ---------------- */

function defaultSettings(shop) {
  const caps = shop.capabilities;
  return {
    shopId: shop.id,
    slotId: shop.slots?.[0]?.id ?? null,
    paperSku: caps.paperSkus[0],
    colorMode: caps.colorModes[0],
    duplexMode: caps.duplexModes.includes('DUPLEX_LONG') ? 'DUPLEX_LONG' : caps.duplexModes[0],
    pagesPerSide: caps.pagesPerSide.includes(2) ? 2 : caps.pagesPerSide[0],
    bindingType: caps.bindingTypes.includes('STAPLE') ? 'STAPLE' : caps.bindingTypes[0],
    copies: 1,
    pageRange: '',
    sheetOverride: null,
    note: '',
  };
}

async function viewPrint(query) {
  const docs = (await api.get('/documents')).documents;
  await loadQuota();
  const pricing = await ensurePricing();
  const shops = pricing.shops;
  if (!docs.length) {
    $('#view').innerHTML = `<div class="page"><div class="empty"><b>还没有可打印的文件</b>先上传一份文档。<div style="margin-top:12px"><button class="btn primary" id="empty-upload">上传文件</button></div></div></div>`;
    $('#empty-upload').onclick = openUpload;
    return;
  }
  const requested = Number(query.get('doc'));
  let current = requested ? docs.find((doc) => doc.id === requested) : null;
  if (!current && state.print.docId) current = docs.find((doc) => doc.id === state.print.docId);
  if (!current) {
    // 默认优先选已有定稿 PDF 的文件，避免一进打印页就要求先生成
    const candidates = docs.slice(0, 5);
    const latestList = await Promise.all(
      candidates.map((doc) => api.get(`/documents/${doc.id}/renders/latest`).then((res) => res.render).catch(() => null)),
    );
    const readyIndex = latestList.findIndex((render) => render?.status === 'READY');
    current = readyIndex >= 0 ? candidates[readyIndex] : docs[0];
  }
  if (state.print.docId !== current.id || !state.print.settings) {
    state.print = { ...state.print, docId: current.id, settings: defaultSettings(shops[0]), preview: null, order: null };
  }
  state.print.doc = current;

  $('#view').innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>在线打印</h1><div class="sub">选择文件与规格，费用实时计算</div></div>
        <div class="spacer"></div>
        <button class="btn" id="print-upload">＋ 上传</button>
      </div>
      <div class="layout-2">
        <div>
          <div class="panel">
            <div class="panel-head"><h2>选择文件</h2><span class="chip">${docs.length}</span></div>
            <div class="panel-body">
              <div class="pick-list">
                ${docs.map((doc) => `<button class="pick-item ${doc.id === current.id ? 'active' : ''}" data-pick="${doc.id}">
                  ${fileIcon(doc)}
                  <span><b>${esc(doc.title)}</b><span>${doc.mode === 'PDF_DIRECT' ? 'PDF 直打' : '可编修'} · rev ${doc.revision}</span></span>
                </button>`).join('')}
              </div>
            </div>
          </div>

          <div class="panel" style="margin-top:14px">
            <div class="panel-head">
              <h2>打印规格</h2><span class="spacer"></span>
              ${current.mode === 'EDITABLE'
                ? `<a class="btn sm" id="jump-edit" href="#/editor/${current.id}">编辑此文件</a>`
                : `<button class="btn sm" id="convert-doc">转为可编辑</button>`}
            </div>
            <div class="panel-body">
              <div id="spec"></div>
              <div id="doc-state"></div>
            </div>
          </div>
        </div>
        <div class="rail">
          <div class="panel">
            <div class="panel-head"><h2>费用</h2></div>
            <div id="price"></div>
          </div>
          <div class="panel"><div class="panel-body tight">
            <div class="steps"><span class="step done">① 选文件</span><span class="step active">② 规格</span><span class="step">③ 下单</span></div>
            <p class="hint" style="margin-top:8px">双面按整张计；2 合 1 省一半印刷面；量大自动折扣。</p>
          </div></div>
        </div>
      </div>
    </div>`;

  $('#print-upload').onclick = openUpload;
  $$('[data-pick]').forEach((button) => {
    button.onclick = () => {
      state.print.docId = Number(button.dataset.pick);
      state.print.settings = defaultSettings(shops[0]);
      state.print.preview = null;
      state.print.order = null;
      location.hash = `#/print?doc=${state.print.docId}`;
    };
  });
  const convertButton = $('#convert-doc');
  if (convertButton) {
    convertButton.onclick = async () => {
      convertButton.disabled = true;
      try {
        const result = await api.post(`/documents/${current.id}/convert`, {});
        toast(`已转为可编辑（提取 ${result.extracted.paragraphs} 段）`, 'ok');
        location.hash = `#/editor/${result.document.id}`;
      } catch (error) {
        toast(error.message, 'error');
        convertButton.disabled = false;
      }
    };
  }
  const latest = await api.get(`/documents/${current.id}/renders/latest`);
  state.print.render = latest.render;
  renderSpec();
  renderDocState();
  if (latest.render?.status === 'READY') updatePreview();
  else renderNeedsRender();
}

function renderSpec() {
  const shop = state.pricing.shops.find((item) => item.id === state.print.settings.shopId) ?? state.pricing.shops[0];
  const caps = shop.capabilities;
  const settings = state.print.settings;
  const slots = shop.slots ?? [];
  if (!slots.find((slot) => slot.id === settings.slotId)) settings.slotId = slots[0]?.id ?? null;
  const duplexLabel = { SINGLE: '单面', DUPLEX_LONG: '双面·长边', DUPLEX_SHORT: '双面·短边' };
  $('#spec').innerHTML = `
    <div class="spec-grid">
      <div class="field"><label>网点</label><select class="input" id="f-shop">${state.pricing.shops.map((item) => `<option value="${item.id}" ${item.id === settings.shopId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></div>
      <div class="field"><label>取件时段</label><select class="input" id="f-slot">${slots.map((slot) => `<option value="${slot.id}" ${slot.id === settings.slotId ? 'selected' : ''}>${fmtTime(slot.startAt)} — ${fmtClock(slot.endAt)}（余 ${slot.remainingUnits}）</option>`).join('')}</select></div>
      <div class="field"><label>纸张</label><select class="input" id="f-sku">${caps.paperSkus.map((sku) => `<option value="${sku}" ${sku === settings.paperSku ? 'selected' : ''}>${esc(shop.prices.find((price) => price.sku === sku)?.paperName ?? sku)}</option>`).join('')}</select></div>
      <div class="field"><label>色彩</label><select class="input" id="f-color">${caps.colorModes.map((mode) => `<option value="${mode}" ${mode === settings.colorMode ? 'selected' : ''}>${mode === 'BW' ? '黑白' : '彩色'}</option>`).join('')}</select></div>
      <div class="field"><label>单双面</label><select class="input" id="f-duplex">${caps.duplexModes.map((mode) => `<option value="${mode}" ${mode === settings.duplexMode ? 'selected' : ''}>${duplexLabel[mode] ?? mode}</option>`).join('')}</select></div>
      <div class="field"><label>每面页数</label><select class="input" id="f-pps">${caps.pagesPerSide.map((n) => `<option value="${n}" ${n === settings.pagesPerSide ? 'selected' : ''}>${n} 合 1</option>`).join('')}</select></div>
      <div class="field"><label>装订</label><select class="input" id="f-binding">${caps.bindingTypes.map((type) => `<option value="${type}" ${type === settings.bindingType ? 'selected' : ''}>${type === 'NONE' ? '不装订' : type === 'STAPLE' ? '骑马钉' : '胶装'}</option>`).join('')}</select></div>
      <div class="field"><label>份数</label><input class="input" id="f-copies" type="number" min="1" max="200" value="${settings.copies}"></div>
      <div class="field span2"><label>页范围（留空为全部）</label><input class="input" id="f-range" placeholder="如 1-3,5" value="${esc(settings.pageRange)}"></div>
    </div>
    <div class="divider"></div>
    <div class="section-head" style="margin:0 0 8px"><h2 style="font-size:12.5px">自动识别与自定义</h2></div>
    <div id="auto-info" class="notice info">正在识别页数与张数…</div>
    <div class="field" style="margin-top:10px"><label>每份张数（留空 = 自动）</label><input class="input" id="f-sheets" type="number" min="1" max="200" value="${settings.sheetOverride ?? ''}" placeholder="自动"></div>
    <div class="field" style="margin-top:10px"><label>订单备注（打印店可见）</label><textarea class="input" id="f-note" rows="2" maxlength="200" placeholder="如：双面打印、最后一页留白、需要装订成册">${esc(settings.note ?? '')}</textarea></div>`;
  const bind = (id, key, cast = String) => {
    const el = $(`#${id}`);
    if (!el) return;
    el.onchange = () => {
      state.print.settings[key] = cast(el.value);
      if (key === 'shopId') {
        state.print.settings = defaultSettings(state.pricing.shops.find((shopItem) => shopItem.id === Number(el.value)));
        renderSpec();
      }
      schedulePreview();
    };
  };
  bind('f-shop', 'shopId', Number);
  bind('f-slot', 'slotId', Number);
  bind('f-sku', 'paperSku');
  bind('f-color', 'colorMode');
  bind('f-duplex', 'duplexMode');
  bind('f-pps', 'pagesPerSide', Number);
  bind('f-binding', 'bindingType');
  bind('f-copies', 'copies', Number);
  bind('f-range', 'pageRange');
  const sheets = $('#f-sheets');
  if (sheets) {
    sheets.onchange = () => {
      const value = sheets.value.trim();
      state.print.settings.sheetOverride = value === '' ? null : Number(value);
      schedulePreview();
    };
  }
  const note = $('#f-note');
  if (note) note.oninput = () => {
    state.print.settings.note = note.value;
  };
}

function renderDocState() {
  const doc = state.print.doc;
  const el = $('#doc-state');
  if (!el) return;
  if (doc.mode === 'PDF_DIRECT') {
    el.innerHTML = `<div class="notice info" style="margin-top:12px">PDF 直打：按原文件打印${state.print.render ? `，共 ${state.print.render.pageCount} 页` : ''}。</div>`;
    return;
  }
  el.innerHTML = `<div class="notice info" style="margin-top:12px">可编修文件：编辑后自动保存并重渲染，返回本页即使用最新版本${state.print.render ? `（${state.print.render.pageCount} 页）` : ''}。</div>`;
}

function renderNeedsRender() {
  $('#price').innerHTML = `<div class="panel-body"><div class="notice warn">尚未生成定稿 PDF，无法计算页数与价格。</div><button class="btn primary block" id="make-render" style="margin-top:10px">生成定稿 PDF</button></div>`;
  $('#make-render').onclick = async () => {
    const button = $('#make-render');
    button.disabled = true;
    try {
      const created = await api.post(`/documents/${state.print.doc.id}/renders`, {});
      const render = await waitRender(created.render.id);
      state.print.render = render;
      renderDocState();
      await updatePreview();
      toast(`PDF 已生成（${render.pageCount} 页）`, 'ok');
    } catch (error) {
      toast(error.message, 'error');
      button.disabled = false;
    }
  };
}

let previewTimer = 0;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 240);
}

async function updatePreview() {
  const { render, settings } = state.print;
  if (!render || render.status !== 'READY') return;
  const target = $('#price');
  if (!target) return;
  try {
    const preview = (
      await api.post('/price-preview', {
        renderId: render.id,
        shopId: settings.shopId,
        pageRange: settings.pageRange,
        paperSku: settings.paperSku,
        colorMode: settings.colorMode,
        duplexMode: settings.duplexMode,
        pagesPerSide: settings.pagesPerSide,
        bindingType: settings.bindingType,
        copies: settings.copies,
        sheetOverride: settings.sheetOverride,
      })
    ).preview;
    state.print.preview = preview;
    const shopName = state.pricing.shops.find((item) => item.id === settings.shopId)?.name ?? '';
    const paperName = state.pricing.shops
      .find((item) => item.id === settings.shopId)
      ?.prices.find((price) => price.sku === settings.paperSku)?.paperName ?? settings.paperSku;
    const auto = $('#auto-info');
    if (auto) {
      auto.className = preview.blankSheets > 0 ? 'notice warn' : 'notice info';
      auto.innerHTML = `自动识别：${preview.logicalPages} 逻辑页 · 每份 ${preview.autoSheetsPerCopy} 张 · ${settings.copies} 份 → 共 ${preview.paperSheets} 张` +
        (preview.blankSheets > 0 ? `<br>自定义每份 ${preview.sheetOverride} 张：其中 ${preview.blankSheets} 张为空白纸（会额外计纸张费）` : '');
    }
    target.innerHTML = `
      <div class="panel-body" style="padding-bottom:6px">
        <div class="price-line"><span>纸张</span><b>${esc(shopName)} · ${esc(paperName)}</b></div>
        <div class="price-line"><span>逻辑页</span><b>${preview.logicalPages} 页</b></div>
        <div class="price-line"><span>印刷面（${settings.pagesPerSide} 合 1 · ${settings.copies} 份）</span><b>${preview.impressions} 面</b></div>
        <div class="price-line"><span>用纸</span><b>${preview.paperSheets} 张</b></div>
        <div class="price-line"><span>纸张费</span><b>${yuan(preview.paperFeeCents)}</b></div>
        <div class="price-line"><span>印刷费</span><b>${yuan(preview.printFeeCents)}</b></div>
        <div class="price-line"><span>装订费</span><b>${yuan(preview.bindingFeeCents)}</b></div>
        ${preview.discountCents ? `<div class="price-line discount"><span>量大折扣</span><b>-${yuan(preview.discountCents)}</b></div>` : ''}
      </div>
      <div class="price-box">
        <div class="price-total"><span class="muted">合计</span><b><small>¥</small>${(preview.totalCents / 100).toFixed(2)}</b></div>
        ${preview.available ? '' : '<div class="notice rose" style="margin-top:8px">纸张库存不足，请减少份数</div>'}
        <button class="btn primary block" id="submit" style="margin-top:10px" ${preview.available ? '' : 'disabled'}>提交订单</button>
        <p class="hint" style="margin-top:6px">提交时按最新规则重新校价。</p>
      </div>`;
    $('#submit').onclick = submitOrder;
  } catch (error) {
    target.innerHTML = `<div class="panel-body"><div class="notice rose">${esc(error.message)}</div></div>`;
  }
}

async function waitRender(renderId, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const data = await api.get(`/renders/${renderId}`);
    if (data.render.status === 'READY') {
      await api.post(`/renders/${renderId}/confirm`, {});
      return data.render;
    }
    if (data.render.status === 'FAILED') throw new Error(data.render.error ?? '渲染失败');
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  throw new Error('渲染超时');
}

async function submitOrder() {
  if (state.print.busy) return;
  state.print.busy = true;
  try {
    const { render, settings } = state.print;
    const plan = await api.post('/print-plans', {
      renderId: render.id,
      shopId: settings.shopId,
      pageRange: settings.pageRange,
      paperSku: settings.paperSku,
      orientation: 'PORTRAIT',
      colorMode: settings.colorMode,
      duplexMode: settings.duplexMode,
      pagesPerSide: settings.pagesPerSide,
      bindingType: settings.bindingType,
      copies: settings.copies,
      sheetOverride: settings.sheetOverride,
    });
    await api.post(`/print-plans/${plan.plan.id}/confirm`, {});
    const quote = await api.post('/quotes', { planIds: [plan.plan.id], slotId: settings.slotId });
    const order = await request('POST', '/orders', { quoteId: quote.quote.id, note: settings.note || '' }, { 'idempotency-key': `web-${Date.now()}` });
    state.print.order = order.order;
    renderOrderPanel();
    toast('订单已创建，请支付', 'ok');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.print.busy = false;
  }
}

function renderOrderPanel() {
  const order = state.print.order;
  const target = $('#price');
  if (!order || !target) return;
  const paid = ['PAID', 'REFUNDING', 'REFUNDED'].includes(order.payStatus);
  target.innerHTML = `
    <div class="panel-body">
      <div class="price-line"><span>订单号</span><b class="mono">${esc(order.orderNo)}</b></div>
      <div class="price-line"><span>状态</span><b>${STATUS_LABEL[order.status]}</b></div>
      <div class="price-line"><span>金额</span><b>${yuan(order.totalCents)}</b></div>
      <div class="price-line"><span>取件</span><b>${esc(order.pickupWindow)}</b></div>
      ${paid
        ? '<button class="btn block" id="code" style="margin-top:10px">查看取件码</button>'
        : `<div class="row" style="margin-top:10px;gap:6px">
            <button class="btn primary grow" data-method="WALLET">钱包</button>
            <button class="btn grow" data-method="ALIPAY">支付宝</button>
            <button class="btn grow" data-method="WECHAT">微信</button>
          </div><p class="hint" style="margin-top:6px">三种方式价格一致；支付宝/微信为演示通道。</p>`}
      <a class="btn ghost block" href="#/orders" style="margin-top:6px">订单进度</a>
    </div>`;
  if (paid) $('#code').onclick = () => showPickup(order.id);
  else
    $$('#price [data-method]').forEach((button) => {
      button.onclick = () => payPrintOrder(button.dataset.method);
    });
}

async function payPrintOrder(method = 'WALLET') {
  const order = state.print.order;
  try {
    const data = await request('POST', `/orders/${order.id}/payments`, { method }, { 'idempotency-key': `web-pay-${Date.now()}` });
    state.print.order = data.order;
    await loadWallet();
    renderOrderPanel();
    toast(method === 'WALLET' ? '钱包支付成功' : '演示在线支付成功', 'ok');
  } catch (error) {
    if (error.code === 'INSUFFICIENT_BALANCE') {
      toast('钱包余额不足，可改用支付宝/微信，或先充值', 'error');
      return;
    }
    toast(error.message, 'error');
  }
}

/* ---------------- 订单 ---------------- */

async function viewOrders() {
  const data = await api.get('/orders');
  state.orders = data.orders;
  await loadWallet();
  $('#view').innerHTML = `
    <div class="page tight">
      <div class="page-head">
        <div><h1>我的订单</h1><div class="sub">支付后等待打印店接单，凭取件码取件</div></div>
        <div class="spacer"></div>
        <button class="btn sm" id="topup">充值</button>
      </div>
      ${state.orders.length ? state.orders.map(orderCard).join('') : '<div class="empty"><b>还没有订单</b>去在线打印选文件下单</div>'}
    </div>`;
  $('#topup').onclick = async () => {
    await api.post('/wallet/demo-credit', { amountCents: 5000, eventId: `web-topup-${Date.now()}` });
    await loadWallet();
    await viewOrders();
    toast('已充值', 'ok');
  };
  $$('[data-pay]').forEach((button) => (button.onclick = () => choosePayment(Number(button.dataset.pay))));
  $$('[data-cancel]').forEach((button) => (button.onclick = () => cancelOrder(Number(button.dataset.cancel), Number(button.dataset.rev))));
  $$('[data-pickup]').forEach((button) => (button.onclick = () => showPickup(Number(button.dataset.pickup))));
  $$('[data-detail]').forEach((button) => (button.onclick = () => showOrderDetail(Number(button.dataset.detail))));
  $$('[data-change-requests]').forEach((button) => (button.onclick = () => showChangeRequests(Number(button.dataset.changeRequests), 'student')));
}

function orderCard(order) {
  const steps = ['UNPAID', 'WAIT_ACCEPT', 'ACCEPTED', 'PRINTING', 'READY_PICKUP', 'COMPLETED'];
  const index = steps.indexOf(order.status);
  return `
    <div class="order-card">
      <div class="order-head">
        <span class="status ${order.status}">${STATUS_LABEL[order.status] ?? order.status}</span>
        <span class="no">${esc(order.orderNo)}</span>
        <span class="hint">${fmtTime(order.createdAt)}</span>
        <span class="spacer"></span>
        <b>${yuan(order.totalCents)}</b>
      </div>
      <div class="order-body">
        <div>
          <div class="order-kv"><span>支付</span><span>${order.payStatus}</span></div>
          <div class="order-kv"><span>取件窗口</span><span>${esc(order.pickupWindow)}</span></div>
          <div class="order-kv"><span>印刷面 / 用纸</span><span>${order.items.reduce((s, i) => s + i.impressions, 0)} 面 / ${order.items.reduce((s, i) => s + i.paperSheets, 0)} 张</span></div>
          <div class="row" style="margin-top:10px;flex-wrap:wrap;gap:6px">
            ${order.status === 'UNPAID' ? `<button class="btn sm primary" data-pay="${order.id}">支付</button>` : ''}
            ${['UNPAID', 'WAIT_ACCEPT'].includes(order.status) ? `<button class="btn sm danger" data-cancel="${order.id}" data-rev="${order.revision}">取消</button>` : ''}
            ${order.status === 'READY_PICKUP' ? `<button class="btn sm" data-pickup="${order.id}">取件码</button>` : ''}
            ${['ACCEPTED', 'PRINTING', 'READY_PICKUP'].includes(order.status) ? `<button class="btn sm" data-change-requests="${order.id}">改稿请求</button>` : ''}
            <button class="btn sm ghost" data-detail="${order.id}">明细</button>
          </div>
        </div>
        <div class="timeline">
          ${steps.map((step, i) => `<div class="row ${index >= i ? 'done' : ''}"><i></i><span>${STATUS_LABEL[step]}</span></div>`).join('')}
        </div>
      </div>
    </div>`;
}

function choosePayment(orderId) {
  openModal({
    title: '支付订单',
    body: '<p class="hint">钱包、支付宝、微信三种方式金额一致；支付宝/微信为演示通道，不产生真实扣款。</p>',
    footer: `<button class="btn" data-close="1">取消</button>
      <button class="btn" data-method="WALLET">钱包</button>
      <button class="btn" data-method="ALIPAY">支付宝</button>
      <button class="btn primary" data-method="WECHAT">微信</button>`,
  });
  $$('#modal-root [data-method]').forEach((button) => {
    button.onclick = async () => {
      try {
        await request('POST', `/orders/${orderId}/payments`, { method: button.dataset.method }, { 'idempotency-key': `web-pay-${Date.now()}` });
        closeModal();
        await loadWallet();
        await viewOrders();
        toast('支付成功', 'ok');
      } catch (error) {
        if (error.code === 'INSUFFICIENT_BALANCE') return toast('钱包余额不足，请改用支付宝/微信或先充值', 'error');
        toast(error.message, 'error');
      }
    };
  });
}

async function cancelOrder(orderId, revision) {
  try {
    await api.post(`/orders/${orderId}/cancel`, { expectedRevision: revision });
    await viewOrders();
    toast('已取消，已支付金额退回钱包', 'ok');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function showPickup(orderId) {
  try {
    const data = await api.get(`/orders/${orderId}/pickup`);
    const qr = await api.get(`/orders/${orderId}/pickup/qr`);
    openModal({
      title: '取件凭证',
      body: `
        <div class="pickup-code">${esc(data.pickup.displayCode)}</div>
        <p class="hint" style="text-align:center">${esc(data.pickup.pickupDate)} · ${esc(data.pickup.pickupWindow ?? '')}</p>
        <div class="divider"></div>
        <div class="field"><label>二维码令牌</label><input class="input mono" readonly value="${esc(qr.qr.token)}"></div>`,
    });
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function showOrderDetail(orderId) {
  const order = (await api.get(`/orders/${orderId}`)).order;
  openModal({
    title: `订单 ${order.orderNo}`,
    wide: true,
    body: `
      <table class="table"><thead><tr><th>文件</th><th>规格</th><th>面</th><th>张</th><th>小计</th></tr></thead>
      <tbody>${order.items
        .map((item) => `<tr><td>#${item.planId}</td><td>${esc(item.settings.paperName ?? item.settings.paperSku)} · ${item.settings.pagesPerSide} 合 1 · ${item.settings.duplexMode} · ${item.settings.copies} 份</td><td>${item.impressions}</td><td>${item.paperSheets}</td><td>${yuan(item.subtotalCents)}</td></tr>`)
        .join('')}</tbody></table>
      <div class="divider"></div>
      <div class="timeline">${order.events.map((event) => `<div class="row done"><i></i><span>${fmtTime(event.at)} · ${esc(event.type)}</span></div>`).join('')}</div>`,
  });
}

/* ---------------- 钱包 ---------------- */

async function viewWallet() {
  const data = await api.get('/wallet');
  state.wallet = data.wallet;
  updateChrome();
  $('#view').innerHTML = `
    <div class="page tight">
      <div class="page-head"><div><h1>钱包</h1><div class="sub">演示余额，不接真实资金</div></div></div>
      <div class="kpi-grid">
        <div class="kpi"><div class="label">当前余额</div><div class="value">${yuan(data.wallet.balanceCents)}</div><div class="sub">用于支付演示订单</div></div>
        <div class="kpi"><div class="label">操作</div><div class="value" style="font-size:14px;margin-top:8px"><button class="btn sm primary" id="w-topup">充值</button></div></div>
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="panel-head"><h2>账本</h2></div>
        <table class="table"><thead><tr><th>时间</th><th>方向</th><th>金额</th><th>余额</th><th>摘要</th></tr></thead>
        <tbody>${data.wallet.ledger
          .map((row) => `<tr><td class="mono">${fmtTime(row.at)}</td><td>${row.direction === 'DEBIT' ? '支出' : '收入'}</td><td>${row.direction === 'DEBIT' ? '-' : '+'}${yuan(row.amountCents)}</td><td>${yuan(row.balanceAfterCents)}</td><td>${esc(row.memo)}</td></tr>`)
          .join('')}</tbody></table>
      </div>
    </div>`;
  $('#w-topup').onclick = () => openTopup();
}

function openTopup() {
  openModal({
    title: '充值',
    body: `
      <div class="field" style="margin-bottom:10px"><label>金额（元）</label><input class="input" id="topup-amount" type="number" min="1" max="2000" step="1" value="50"></div>
      <div class="field" style="margin-bottom:10px"><label>支付方式</label>
        <select class="input" id="topup-channel">
          <option value="ALIPAY">支付宝（演示）</option>
          <option value="WECHAT">微信（演示）</option>
          <option value="WALLET">仅记账</option>
        </select>
      </div>
      <div class="row" style="gap:6px">
        ${[20, 50, 100, 200].map((amount) => `<button class="btn sm" data-amount="${amount}">¥${amount}</button>`).join('')}
      </div>
      <p class="hint" style="margin-top:10px">也可不充值，下单时直接选择支付宝/微信在线支付（价格一致）。</p>`,
    footer: '<button class="btn" data-close="1">取消</button><button class="btn primary" id="topup-submit">确认充值</button>',
  });
  $$('#modal-root [data-amount]').forEach((button) => {
    button.onclick = () => ($('#topup-amount').value = button.dataset.amount);
  });
  $('#topup-submit').onclick = async () => {
    const amount = Number($('#topup-amount').value);
    if (!Number.isFinite(amount) || amount < 1 || amount > 2000) return toast('金额需在 1—2000 元', 'error');
    try {
      await api.post('/wallet/demo-credit', {
        amountCents: Math.round(amount * 100),
        eventId: 'topup-' + Date.now(),
        channel: $('#topup-channel').value,
      });
      closeModal();
      await loadWallet();
      toast('充值成功', 'ok');
      if (state.view === 'wallet') viewWallet();
    } catch (error) {
      toast(error.message, 'error');
    }
  };
}

async function showWallet() {
  await viewWallet();
}

/* ---------------- 编辑页 ---------------- */

async function viewEditor(docId) {
  const doc = (await api.get(`/documents/${docId}`)).document;
  if (doc.mode === 'PDF_DIRECT') {
    toast('PDF 直打文件不支持正文编辑', 'error');
    location.hash = `#/print?doc=${doc.id}`;
    return;
  }
  state.editor = { doc, render: null, inspection: null, selected: null, tab: 'outline', rtab: 'props', save: 'saved', timer: 0, saving: false };
  const latest = await api.get(`/documents/${doc.id}/renders/latest`);
  state.editor.render = latest.render;

  $('#view').innerHTML = `
    <div class="editor">
      <div class="editor-bar">
        <a class="btn ghost sm" href="#/print?doc=${doc.id}">← 返回打印</a>
        <span class="editor-title">${esc(doc.title)}</span>
        <span class="save-pill" id="save-pill">已保存</span>
        <span class="spacer"></span>
        <button class="btn sm" id="btn-version">保存版本</button>
        <button class="btn sm" id="btn-diagnose">诊断</button>
        <button class="btn sm" id="btn-pdf">预览 PDF</button>
        <button class="btn sm primary" id="btn-render">更新 PDF</button>
      </div>
      <div class="editor-main">
        <aside class="editor-left">
          <div class="tabs"><button data-tab="outline" class="active">大纲</button><button data-tab="versions">版本</button></div>
          <div class="tab-body" id="left-body"></div>
        </aside>
        <section class="canvas-area">
          <div class="canvas-tools">
            <span class="chip brand">编辑预览</span><span class="hint">正式分页以定稿 PDF 为准</span>
            <span style="margin-left:auto"></span>
            <select class="input" id="zoom" style="width:88px"><option value="0.7">70%</option><option value="1" selected>100%</option><option value="1.25">125%</option></select>
          </div>
          <div class="canvas-scroll"><div class="paper" id="paper" data-paper="${doc.pageConfig.paperSize}"></div></div>
        </section>
        <aside class="editor-right">
          <div class="tabs"><button data-rtab="props" class="active">属性</button><button data-rtab="issues">诊断</button></div>
          <div class="tab-body" id="right-body"></div>
        </aside>
      </div>
    </div>`;

  $$('[data-tab]').forEach((button) => {
    button.onclick = () => {
      state.editor.tab = button.dataset.tab;
      $$('[data-tab]').forEach((item) => item.classList.toggle('active', item === button));
      renderEditorLeft();
    };
  });
  $$('[data-rtab]').forEach((button) => {
    button.onclick = () => {
      state.editor.rtab = button.dataset.rtab;
      $$('[data-rtab]').forEach((item) => item.classList.toggle('active', item === button));
      renderEditorRight();
    };
  });
  $('#zoom').onchange = () => {
    $('#paper').style.transform = `scale(${$('#zoom').value})`;
  };
  $('#btn-version').onclick = async () => {
    await api.post(`/documents/${doc.id}/versions`, { reason: 'MANUAL' });
    await refreshEditor();
    toast('已保存版本', 'ok');
  };
  $('#btn-diagnose').onclick = runDiagnosis;
  $('#btn-pdf').onclick = () => {
    if (state.editor.render?.status === 'READY') showPdf(state.editor.render);
    else toast('还没有定稿 PDF', 'error');
  };
  $('#btn-render').onclick = renderFromEditor;

  renderEditorLeft();
  renderEditorRight();
  renderPaper();
  paintSave();
}

function markDirty() {
  state.editor.save = 'dirty';
  paintSave();
  clearTimeout(state.editor.timer);
  state.editor.timer = setTimeout(saveEditor, 1000);
}

function paintSave() {
  const pill = $('#save-pill');
  if (!pill) return;
  const map = { saved: ['已保存', 'saved'], dirty: ['未保存', 'dirty'], saving: ['保存中…', ''], conflict: ['版本冲突', 'dirty'], error: ['保存失败', 'dirty'] };
  const [label, cls] = map[state.editor.save] ?? map.saved;
  pill.textContent = label;
  pill.className = `save-pill ${cls}`;
}

async function saveEditor() {
  const doc = state.editor.doc;
  if (!doc || state.editor.saving) return;
  state.editor.saving = true;
  state.editor.save = 'saving';
  paintSave();
  try {
    const saved = await api.put(`/documents/${doc.id}/draft`, { baseRevision: doc.revision, content: doc.content, pageConfig: doc.pageConfig });
    state.editor.doc = saved.document;
    state.editor.save = 'saved';
    paintSave();
    if (state.editor.render?.status === 'READY') autoRender();
  } catch (error) {
    if (error.status === 409) {
      state.editor.save = 'conflict';
      toast('文档已在其他窗口更新，已重新加载', 'error');
      await refreshEditor();
    } else {
      state.editor.save = 'error';
      toast(error.message, 'error');
    }
    paintSave();
  } finally {
    state.editor.saving = false;
  }
}

async function autoRender() {
  try {
    const created = await api.post(`/documents/${state.editor.doc.id}/renders`, {});
    state.editor.render = await waitRender(created.render.id);
  } catch {
    /* 后台同步失败不阻塞编辑 */
  }
}

async function renderFromEditor() {
  const button = $('#btn-render');
  button.disabled = true;
  try {
    const created = await api.post(`/documents/${state.editor.doc.id}/renders`, {});
    state.editor.render = await waitRender(created.render.id);
    toast(`PDF 已更新（${state.editor.render.pageCount} 页）`, 'ok');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

function renderEditorLeft() {
  const body = $('#left-body');
  if (!body) return;
  const doc = state.editor.doc;
  if (state.editor.tab === 'outline') {
    const headings = doc.content.nodes.filter((node) => node.type === 'heading');
    body.innerHTML = headings.length
      ? `<div class="mini-list">${headings.map((node) => `<button class="mini-item" data-goto="${node.id}" style="padding-left:${6 + (node.level - 1) * 12}px"><span class="dot"></span>${esc(node.text || '（空标题）')}</button>`).join('')}</div>`
      : '<p class="hint">还没有标题。在右侧把段落设为 1—4 级标题。</p>';
    $$('[data-goto]').forEach((button) => {
      button.onclick = () => {
        const block = $(`.blk[data-id="${button.dataset.goto}"]`);
        if (block) {
          block.scrollIntoView({ block: 'center', behavior: 'smooth' });
          block.focus();
        }
      };
    });
    return;
  }
  body.innerHTML = `
    <button class="btn sm block" id="new-version">＋ 保存当前版本</button>
    <div class="mini-list" style="margin-top:8px">
      ${(doc.versions ?? []).map((version) => `<div class="mini-item"><span class="dot"></span><span>v${version.versionNo}</span><span class="right">${esc(version.reason)}</span><button class="btn ghost sm" data-rollback="${version.id}">回滚</button></div>`).join('')}
    </div>`;
  $('#new-version').onclick = async () => {
    await api.post(`/documents/${doc.id}/versions`, { reason: 'MANUAL' });
    await refreshEditor();
  };
  $$('[data-rollback]').forEach((button) => {
    button.onclick = async () => {
      await api.post(`/documents/${doc.id}/rollback`, { versionId: Number(button.dataset.rollback) });
      await refreshEditor();
      toast('已回滚', 'ok');
    };
  });
}

function renderEditorRight() {
  const body = $('#right-body');
  if (!body) return;
  if (state.editor.rtab === 'issues') return renderIssues(body);
  const doc = state.editor.doc;
  const config = doc.pageConfig;
  const node = doc.content.nodes.find((item) => item.id === state.editor.selected);
  body.innerHTML = `
    <div class="field" style="margin-bottom:8px"><label>纸张</label><select class="input" id="p-paper">${['A4', 'A3', 'B5'].map((size) => `<option ${config.paperSize === size ? 'selected' : ''}>${size}</option>`).join('')}</select></div>
    <div class="field" style="margin-bottom:8px"><label>字体（自适应，导入后统一为可用字体）</label>
      <select class="input" id="p-font">${FONT_OPTIONS.map((font) => `<option value='${font.value}' ${config.fontFamily === font.value ? 'selected' : ''}>${font.label}</option>`).join('')}</select>
    </div>
    <div class="field" style="margin-bottom:8px"><label>页边距 (mm) 上 / 下</label><div class="row"><input class="input" id="p-top" type="number" min="5" max="60" value="${config.marginTopMm}"><input class="input" id="p-bottom" type="number" min="5" max="60" value="${config.marginBottomMm}"></div></div>
    <div class="field" style="margin-bottom:8px"><label>左 / 右</label><div class="row"><input class="input" id="p-left" type="number" min="5" max="60" value="${config.marginLeftMm}"><input class="input" id="p-right" type="number" min="5" max="60" value="${config.marginRightMm}"></div></div>
    <div class="field" style="margin-bottom:8px"><label>装订边 (mm)</label><input class="input" id="p-binding" type="number" min="0" max="40" value="${config.bindingMm}"></div>
    <div class="row" style="gap:8px;margin-bottom:10px">
      <div class="field grow"><label>字号 (pt)</label><input class="input" id="p-size" type="number" min="7" max="36" step="0.5" value="${config.baseFontSizePt}"></div>
      <div class="field grow"><label>行距</label><input class="input" id="p-line" type="number" min="1" max="3" step="0.05" value="${config.lineHeight}"></div>
    </div>
    <div class="divider"></div>
    <div class="section-head" style="margin:0 0 8px"><h2 style="font-size:12.5px">当前段落</h2></div>
    ${
      node
        ? `<div class="row" style="gap:4px;margin-bottom:8px">${[1, 2, 3].map((level) => `<button class="btn sm ${node.level === level ? 'primary' : ''}" data-level="${level}">H${level}</button>`).join('')}<button class="btn sm ${node.type !== 'heading' ? 'primary' : ''}" data-level="0">正文</button></div>
        <div class="row"><div class="field grow"><label>字号</label><input class="input" id="n-size" type="number" min="7" max="36" value="${node.style?.fontSizePt ?? config.baseFontSizePt}"></div>
        <div class="field grow"><label>字重</label><select class="input" id="n-weight"><option value="normal" ${node.style?.fontWeight !== 'bold' ? 'selected' : ''}>常规</option><option value="bold" ${node.style?.fontWeight === 'bold' ? 'selected' : ''}>加粗</option></select></div></div>`
        : '<p class="hint">点选画布中的段落可设置标题级别与字号。</p>'
    }
    <div class="row" style="margin-top:10px"><button class="btn sm grow" id="add-para">＋ 段落</button><button class="btn sm grow" id="add-break">＋ 分页</button></div>`;

  const apply = () => {
    Object.assign(config, {
      paperSize: $('#p-paper').value,
      marginTopMm: Number($('#p-top').value),
      marginBottomMm: Number($('#p-bottom').value),
      marginLeftMm: Number($('#p-left').value),
      marginRightMm: Number($('#p-right').value),
      bindingMm: Number($('#p-binding').value),
      baseFontSizePt: Number($('#p-size').value),
      lineHeight: Number($('#p-line').value),
      fontFamily: $('#p-font').value,
    });
    renderPaper();
    markDirty();
  };
  ['p-paper', 'p-top', 'p-bottom', 'p-left', 'p-right', 'p-binding', 'p-size', 'p-line', 'p-font'].forEach((id) => {
    const el = $(`#${id}`);
    if (el) el.onchange = apply;
  });
  $$('[data-level]').forEach((button) => {
    button.onclick = () => {
      const target = doc.content.nodes.find((item) => item.id === state.editor.selected);
      if (!target) return toast('先选择一个段落');
      if (button.dataset.level === '0') {
        target.type = 'paragraph';
        delete target.level;
      } else {
        target.type = 'heading';
        target.level = Number(button.dataset.level);
      }
      renderPaper();
      renderEditorRight();
      markDirty();
    };
  });
  if (node) {
    $('#n-size').onchange = () => {
      node.style = { ...(node.style ?? {}), fontSizePt: Number($('#n-size').value) };
      renderPaper();
      markDirty();
    };
    $('#n-weight').onchange = () => {
      node.style = { ...(node.style ?? {}), fontWeight: $('#n-weight').value };
      renderPaper();
      markDirty();
    };
  }
  $('#add-para').onclick = () => insertNode({ type: 'paragraph', text: '' });
  $('#add-break').onclick = () => insertNode({ type: 'pageBreak' });
}

function insertNode(partial) {
  const doc = state.editor.doc;
  const id = `n_${Math.random().toString(36).slice(2, 12)}`;
  const index = doc.content.nodes.findIndex((node) => node.id === state.editor.selected);
  doc.content.nodes.splice(index + 1, 0, { id, ...partial });
  renderPaper();
  markDirty();
}

function renderIssues(body) {
  const inspection = state.editor.inspection;
  const issues = inspection?.issues ?? [];
  body.innerHTML = `
    <button class="btn sm primary block" id="run-inspect">运行规则诊断</button>
    <p class="hint" style="margin:8px 0 12px">检查空段、标题层级、标点与装订净空；不伪造页码级结论。</p>
    ${!inspection ? '<p class="hint">尚未诊断。</p>' : issues.length === 0 ? '<div class="notice info">没有发现问题。</div>' : issues.map((issue) => `
      <div class="issue-item">
        <div class="top"><span class="sev ${issue.severity}">${issue.severity}</span><span class="type">${esc(issue.issueType)}</span></div>
        <div class="desc">${esc(issue.description)}</div>
        <div class="actions">${issue.fixAction && issue.status === 'OPEN' ? `<button class="btn sm" data-fix="${issue.id}">应用</button>` : ''}${issue.requiresConfirmation ? '<span class="hint">需确认</span>' : ''}</div>
      </div>`).join('')}`;
  $('#run-inspect').onclick = runDiagnosis;
  $$('[data-fix]').forEach((button) => (button.onclick = () => applyFix(Number(button.dataset.fix))));
}

async function runDiagnosis() {
  const doc = state.editor.doc;
  try {
    const data = await api.post(`/documents/${doc.id}/inspections`, { mode: 'RULES' });
    state.editor.inspection = data.inspection;
    state.editor.rtab = 'issues';
    $$('[data-rtab]').forEach((item) => item.classList.toggle('active', item.dataset.rtab === 'issues'));
    renderEditorRight();
    renderPaper();
    toast(`诊断完成：${data.inspection.issues.length} 条建议`, 'ok');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function applyFix(issueId, confirmed = false) {
  const doc = state.editor.doc;
  try {
    const data = await api.post(`/documents/${doc.id}/fixes/apply`, {
      baseRevision: doc.revision,
      issueIds: [issueId],
      confirmedRiskyActions: confirmed ? [issueId] : [],
    });
    state.editor.doc = data.document;
    state.editor.inspection = null;
    renderPaper();
    renderEditorRight();
    paintSave();
    toast('修复已应用', 'ok');
    if (data.renderId) state.editor.render = await waitRender(data.renderId);
  } catch (error) {
    if (error.code === 'CONFIRMATION_REQUIRED' && confirm('该修复会修改内容，确认应用？')) return applyFix(issueId, true);
    if (error.status === 409) return runDiagnosis();
    toast(error.message, 'error');
  }
}

function renderPaper() {
  const doc = state.editor.doc;
  const paper = $('#paper');
  if (!paper || !doc) return;
  const config = doc.pageConfig;
  paper.dataset.paper = config.paperSize;
  paper.style.padding = `${config.marginTopMm * 3.7795}px ${config.marginRightMm * 3.7795}px ${config.marginBottomMm * 3.7795}px ${(config.marginLeftMm + config.bindingMm) * 3.7795}px`;
  paper.style.fontSize = `${config.baseFontSizePt}pt`;
  paper.style.lineHeight = String(config.lineHeight);
  paper.style.fontFamily = config.fontFamily;
  paper.innerHTML =
    doc.content.nodes
      .map((node) => {
        if (node.type === 'pageBreak') return `<div class="blk" data-id="${node.id}" data-type="pageBreak"></div>`;
        const style = `${node.style?.fontSizePt ? `font-size:${node.style.fontSizePt}pt;` : ''}${node.style?.fontWeight ? `font-weight:${node.style.fontWeight};` : ''}`;
        return `<div class="blk" contenteditable="true" spellcheck="false" data-id="${node.id}" data-type="${node.type}" data-level="${node.level ?? ''}" style="${style}">${esc(node.text ?? '')}</div>`;
      })
      .join('') + `<div class="paper-foot">${esc(doc.title)}</div>`;
  wireBlocks();
}

function wireBlocks() {
  $$('.blk[contenteditable]').forEach((block) => {
    block.onfocus = () => {
      state.editor.selected = block.dataset.id;
      if (state.editor.rtab === 'props') renderEditorRight();
    };
    block.oninput = () => {
      const node = state.editor.doc.content.nodes.find((item) => item.id === block.dataset.id);
      if (node) node.text = block.textContent;
      markDirty();
    };
    block.onkeydown = (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        insertNode({ type: 'paragraph', text: '' });
      }
    };
  });
}

async function refreshEditor() {
  state.editor.doc = (await api.get(`/documents/${state.editor.doc.id}`)).document;
  renderEditorLeft();
  renderEditorRight();
  renderPaper();
  paintSave();
}

function showPdf(render) {
  openModal({ title: `定稿 PDF · ${render.pageCount} 页`, wide: true, body: `<iframe class="preview-frame" src="/api/v1/assets/${render.pdfAssetId}/download?inline=1"></iframe>` });
}

/* ---------------- 打印店 ---------------- */

async function merchantShop() {
  const shops = state.user.shops ?? [];
  if (!state.merchant.shopId || !shops.some((shop) => shop.shop_id === state.merchant.shopId)) {
    state.merchant.shopId = shops[0]?.shop_id ?? null;
  }
  return shops;
}

async function viewMerchantHome() {
  const shops = await merchantShop();
  if (!shops.length) return ($('#view').innerHTML = '<div class="page"><div class="empty">当前账号不是打印店员工</div></div>');
  const data = await api.get(`/merchant/analytics?shopId=${state.merchant.shopId}&days=7`);
  const analytics = data.analytics;
  state.merchant.analytics = analytics;
  $('#view').innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>打印店概览</h1><div class="sub">${esc(shops.find((shop) => shop.shop_id === state.merchant.shopId)?.name ?? '')}</div></div>
        <div class="spacer"></div>
        <select class="input" id="shop-select" style="width:200px">${shops.map((shop) => `<option value="${shop.shop_id}" ${shop.shop_id === state.merchant.shopId ? 'selected' : ''}>${esc(shop.name)}</option>`).join('')}</select>
        <a class="btn primary" href="#/merchant/workspace">进入打印工作区</a>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><div class="label">待接单</div><div class="value">${analytics.counts.waitAccept}</div><div class="sub">需尽快确认</div></div>
        <div class="kpi"><div class="label">待打印 / 打印中</div><div class="value">${analytics.counts.accepted + analytics.counts.printing}</div><div class="sub">含异常 ${analytics.counts.exception}</div></div>
        <div class="kpi"><div class="label">待取件</div><div class="value">${analytics.counts.ready}</div><div class="sub">等待核销</div></div>
        <div class="kpi"><div class="label">今日营收</div><div class="value">${yuan(analytics.today.revenueCents)}</div><div class="sub">${analytics.today.orders} 单</div></div>
      </div>
      <div class="layout-2" style="margin-top:16px">
        <div>
          <div class="suggest">${esc(analytics.loadSuggestion)}</div>
          <div class="section-head"><h2>优先处理</h2><a class="hint" href="#/merchant/analytics">查看分析</a></div>
          <div class="priority-list">
            ${analytics.priority.length ? analytics.priority.map((item) => `
              <div class="priority-item">
                <span class="urgency ${item.urgency}">${URGENCY_LABEL[item.urgency]}</span>
                <span class="no">${esc(item.orderNo)}</span>
                <span class="who">${esc(item.student.name)} ${esc(item.student.studentNo)}</span>
                <span class="reason">${item.impressions} 面 · ${esc(item.reason)}</span>
              </div>`).join('') : '<div class="panel-body hint">暂无待处理订单</div>'}
          </div>
        </div>
        <div class="rail">
          <div class="panel"><div class="panel-head"><h2>今日时间分配</h2></div><div class="panel-body">
            ${analytics.hourly.length ? `<div class="bars">${analytics.hourly.map((item) => `<div class="bar-wrap"><div class="bar" style="height:${Math.max(6, (item.impressions / Math.max(...analytics.hourly.map((h) => h.impressions))) * 100)}%"></div><div class="label">${item.hour}</div></div>`).join('')}</div>` : '<p class="hint">暂无取件时段数据</p>'}
          </div></div>
        </div>
      </div>
    </div>`;
  $('#shop-select').onchange = (event) => {
    state.merchant.shopId = Number(event.target.value);
    viewMerchantHome();
  };
}

async function viewWorkspace() {
  const shops = await merchantShop();
  const data = await api.get(`/merchant/workspace?shopId=${state.merchant.shopId}`);
  const orders = data.workspace.orders;
  state.merchant.workspace = orders;
  state.merchantWorkspaceCount = orders.filter((order) => !['READY_PICKUP'].includes(order.status)).length;
  renderSidebar();
  $('#view').innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>打印工作区</h1><div class="sub">按取件时间排序，越紧急越靠前</div></div>
        <div class="spacer"></div>
        <select class="input" id="shop-select" style="width:190px">${shops.map((shop) => `<option value="${shop.shop_id}" ${shop.shop_id === state.merchant.shopId ? 'selected' : ''}>${esc(shop.name)}</option>`).join('')}</select>
        <button class="btn" id="refresh">刷新</button>
      </div>
      ${orders.length === 0 ? '<div class="empty"><b>当前没有待处理订单</b>接单后会出现在这里</div>' : `
      <div class="panel">
        <table class="table">
          <thead><tr><th>紧急度</th><th>订单</th><th>学生</th><th>取件时间</th><th>量</th><th>状态</th><th style="text-align:right">操作</th></tr></thead>
          <tbody>${orders.map((order) => `
            <tr>
              <td><span class="urgency ${order.urgency}">${URGENCY_LABEL[order.urgency]}${order.minutesLeft !== null ? ` · ${order.minutesLeft} 分` : ''}</span></td>
              <td class="mono">${esc(order.orderNo)}</td>
              <td>${esc(order.student.name)}<div class="hint">${esc(order.student.studentNo || '未填学号')}</div></td>
              <td>${fmtTime(order.pickupDeadline)}</td>
              <td>${order.impressions} 面<br><span class="hint">${order.sheets} 张</span></td>
              <td><span class="status ${order.status}">${STATUS_LABEL[order.status]}</span></td>
              <td><div class="actions">
                ${order.status === 'ACCEPTED' ? `<button class="btn sm primary" data-start="${order.id}" data-rev="${order.revision}">开始打印</button>` : ''}
                ${['ACCEPTED', 'PRINTING', 'PRINT_EXCEPTION'].includes(order.status) ? `<button class="btn sm" data-printjob="${order.id}">一键打印</button>` : ''}
                ${['ACCEPTED', 'PRINTING', 'PRINT_EXCEPTION', 'READY_PICKUP'].includes(order.status) ? `<button class="btn sm" data-preview-order="${order.id}">预览</button>` : ''}
                <button class="btn sm" data-ticket="${order.id}">工单</button>
                ${['ACCEPTED', 'PRINTING'].includes(order.status) ? `<button class="btn sm" data-request-change="${order.id}">请求改稿</button>` : ''}
                ${['PRINTING', 'PRINT_EXCEPTION'].includes(order.status) ? `<button class="btn sm" data-ready="${order.id}" data-rev="${order.revision}">待取件</button>` : ''}
              </div></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>`}
      <p class="hint" style="margin-top:10px">「一键打印」会打开该订单的全部生产 PDF 并记录打印尝试；在浏览器打印对话框中选择打印机即可。</p>
    </div>`;
  $('#shop-select').onchange = (event) => {
    state.merchant.shopId = Number(event.target.value);
    viewWorkspace();
  };
  $('#refresh').onclick = () => viewWorkspace();
  wireMerchantActions();
}

function wireMerchantActions() {
  $$('[data-start]').forEach((button) => {
    button.onclick = async () => {
      try {
        await api.post(`/merchant/orders/${button.dataset.start}/start-print`, { expectedRevision: Number(button.dataset.rev) });
        toast('已开始打印', 'ok');
        await route();
      } catch (error) {
        toast(error.message, 'error');
      }
    };
  });
  $$('[data-ready]').forEach((button) => {
    button.onclick = async () => {
      try {
        await api.post(`/merchant/orders/${button.dataset.ready}/ready`, { expectedRevision: Number(button.dataset.rev), window: '今天 18:00—19:00' });
        toast('已标记待取件', 'ok');
        await route();
      } catch (error) {
        toast(error.message, 'error');
      }
    };
  });
  $$('[data-printjob]').forEach((button) => {
    button.onclick = () => openPrintJob(Number(button.dataset.printjob));
  });
  $$('[data-ticket]').forEach((button) => {
    button.onclick = () => showTicket(Number(button.dataset.ticket));
  });
  $$('[data-request-change]').forEach((button) => {
    button.onclick = () => requestChange(Number(button.dataset.requestChange));
  });
  wirePreviewButtons();
}

function wirePreviewButtons() {
  $$('[data-preview-order]').forEach((button) => {
    button.onclick = () => previewOrderFiles(Number(button.dataset.previewOrder));
  });
}

async function openPrintJob(orderId) {
  try {
    const job = (await api.post(`/merchant/orders/${orderId}/print`, {})).job;
    openModal({
      title: `打印 ${job.orderNo}`,
      wide: true,
      body: `
        <div class="notice info">共 ${job.totals.files} 个文件 · ${job.totals.impressions} 面 · ${job.totals.sheets} 张。点击下方按钮会打开全部 PDF，浏览器随后弹出打印对话框。</div>
        <table class="table" style="margin-top:10px">
          <thead><tr><th>#</th><th>文件</th><th>页</th><th>面</th><th>张</th><th>哈希</th><th></th></tr></thead>
          <tbody>${job.files.map((file) => `<tr><td>${file.index}</td><td>${esc(file.name)}</td><td>${file.pages}</td><td>${file.impressions}</td><td>${file.sheets}</td><td class="mono">${esc(file.hash.slice(0, 10))}…</td><td><a class="btn sm" href="${file.downloadUrl}" target="_blank">打开</a></td></tr>`).join('')}</tbody>
        </table>`,
      footer: `<button class="btn" data-close="1">关闭</button><button class="btn primary" id="open-all">打开全部并打印</button>`,
    });
    $('#open-all').onclick = () => {
      for (const file of job.files) window.open(`${API_BASE}${file.downloadUrl.replace('/api/v1', '')}`, '_blank');
      toast('已打开文件，请在打印对话框中选择打印机', 'ok');
    };
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function viewMerchantOrders() {
  const shops = await merchantShop();
  const params = new URLSearchParams({ shopId: String(state.merchant.shopId) });
  if (state.merchant.q) params.set('q', state.merchant.q);
  if (state.merchant.status) params.set('status', state.merchant.status);
  const data = await api.get(`/merchant/orders?${params.toString()}`);
  state.merchant.orders = data.orders;
  $('#view').innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>订单管理</h1><div class="sub">按学号、姓名或订单号筛选</div></div>
        <div class="spacer"></div>
        <select class="input" id="shop-select" style="width:180px">${shops.map((shop) => `<option value="${shop.shop_id}" ${shop.shop_id === state.merchant.shopId ? 'selected' : ''}>${esc(shop.name)}</option>`).join('')}</select>
      </div>
      <div class="panel">
        <div class="panel-body tight">
          <div class="row" style="flex-wrap:wrap">
            <input class="input" id="m-q" style="max-width:260px" placeholder="学号 / 姓名 / 订单号" value="${esc(state.merchant.q)}">
            <select class="input" id="m-status" style="max-width:170px">
              <option value="">全部状态</option>
              ${Object.entries(STATUS_LABEL).filter(([key]) => key !== 'COMPLETED' || true).map(([key, label]) => `<option value="${key}" ${state.merchant.status === key ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
            <button class="btn primary" id="m-search">筛选</button>
            <button class="btn ghost" id="m-clear">清空</button>
            <span class="hint" style="margin-left:auto">${state.merchant.orders.length} 条</span>
          </div>
        </div>
        ${state.merchant.orders.length ? `<table class="table">
          <thead><tr><th>状态</th><th>订单号</th><th>学生</th><th>文件</th><th>创建</th><th>金额</th><th style="text-align:right"></th></tr></thead>
          <tbody>${state.merchant.orders.map((order) => `
            <tr>
              <td><span class="status ${order.status}">${STATUS_LABEL[order.status]}</span></td>
              <td class="mono">${esc(order.orderNo)}</td>
              <td>${esc(order.student.name)}<div class="hint">${esc(order.student.studentNo || '未填学号')}</div></td>
              <td>${order.items.length}</td>
              <td class="hint">${fmtTime(order.createdAt)}</td>
              <td>${yuan(order.totalCents)}</td>
              <td><div class="actions">
                ${['ACCEPTED', 'PRINTING', 'PRINT_EXCEPTION', 'READY_PICKUP'].includes(order.status) ? `<button class="btn sm" data-preview-order="${order.id}">预览</button>` : ''}
                <button class="btn sm" data-detail="${order.id}">明细</button>
                <button class="btn sm" data-ticket="${order.id}">工单</button>
              </div></td>
            </tr>`).join('')}</tbody>
        </table>` : '<div class="panel-body hint">没有匹配的订单</div>'}
      </div>
    </div>`;
  $('#shop-select').onchange = (event) => {
    state.merchant.shopId = Number(event.target.value);
    viewMerchantOrders();
  };
  $('#m-search').onclick = () => {
    state.merchant.q = $('#m-q').value.trim();
    state.merchant.status = $('#m-status').value;
    viewMerchantOrders();
  };
  $('#m-clear').onclick = () => {
    state.merchant.q = '';
    state.merchant.status = '';
    viewMerchantOrders();
  };
  $$('[data-ticket]').forEach((button) => (button.onclick = () => showTicket(Number(button.dataset.ticket))));
  $$('[data-detail]').forEach((button) => (button.onclick = () => showOrderDetail(Number(button.dataset.detail))));
  wirePreviewButtons();
}

async function viewAnalytics() {
  const shops = await merchantShop();
  const analytics = (await api.get(`/merchant/analytics?shopId=${state.merchant.shopId}&days=7`)).analytics;
  const maxDay = Math.max(1, ...analytics.series.map((item) => item.impressions));
  $('#view').innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>数据分析</h1><div class="sub">近 7 天订单量、工作量与时间分配</div></div>
        <div class="spacer"></div>
        <select class="input" id="shop-select" style="width:190px">${shops.map((shop) => `<option value="${shop.shop_id}" ${shop.shop_id === state.merchant.shopId ? 'selected' : ''}>${esc(shop.name)}</option>`).join('')}</select>
      </div>
      <div class="kpi-grid">
        <div class="kpi"><div class="label">7 天订单</div><div class="value">${analytics.window.orders}</div><div class="sub">今日 ${analytics.today.orders}</div></div>
        <div class="kpi"><div class="label">7 天印刷面</div><div class="value">${analytics.window.impressions}</div><div class="sub">用纸 ${analytics.window.sheets} 张</div></div>
        <div class="kpi"><div class="label">今日营收</div><div class="value">${yuan(analytics.today.revenueCents)}</div><div class="sub">演示钱包</div></div>
        <div class="kpi"><div class="label">待处理</div><div class="value">${analytics.counts.waitAccept + analytics.counts.accepted + analytics.counts.printing}</div><div class="sub">异常 ${analytics.counts.exception}</div></div>
      </div>

      <div class="layout-2" style="margin-top:16px">
        <div>
          <div class="panel">
            <div class="panel-head"><h2>每日工作量（印刷面）</h2></div>
            <div class="panel-body">
              <div class="bars">${analytics.series.map((item) => `<div class="bar-wrap"><div class="bar" style="height:${Math.max(4, (item.impressions / maxDay) * 100)}%"></div><div class="label">${item.day.slice(5)}</div><div class="label">${item.orders} 单</div></div>`).join('')}</div>
            </div>
          </div>
          <div class="panel" style="margin-top:14px">
            <div class="panel-head"><h2>取件时段分布</h2></div>
            <div class="panel-body">
              ${analytics.hourly.length ? `<div class="bars">${analytics.hourly.map((item) => `<div class="bar-wrap"><div class="bar" style="height:${Math.max(6, (item.impressions / Math.max(...analytics.hourly.map((h) => h.impressions))) * 100)}%"></div><div class="label">${item.hour}</div></div>`).join('')}</div>` : '<p class="hint">暂无数据</p>'}
            </div>
          </div>
        </div>
        <div class="rail">
          <div class="suggest">${esc(analytics.loadSuggestion)}</div>
          <div class="panel"><div class="panel-head"><h2>优先级建议</h2></div><div class="panel-body" style="padding:10px">
            ${analytics.priority.length ? analytics.priority.map((item) => `<div class="priority-item" style="margin-bottom:6px"><span class="urgency ${item.urgency}">${URGENCY_LABEL[item.urgency]}</span><span class="no">${esc(item.orderNo)}</span><span class="reason">${esc(item.reason)}</span></div>`).join('') : '<p class="hint">暂无待处理订单</p>'}
          </div></div>
        </div>
      </div>
    </div>`;
  $('#shop-select').onchange = (event) => {
    state.merchant.shopId = Number(event.target.value);
    viewAnalytics();
  };
}

async function viewRedeem() {
  const shops = await merchantShop();
  $('#view').innerHTML = `
    <div class="page tight">
      <div class="page-head"><div><h1>取件核销</h1><div class="sub">短码在网点+日期内唯一，重复核销返回原结果</div></div></div>
      <div class="panel"><div class="panel-body">
        <div class="row" style="flex-wrap:wrap;align-items:flex-end">
          <div class="field" style="flex:1;min-width:220px"><label>取件码</label><input class="input" id="code" placeholder="如 A8-3921"></div>
          <div class="field"><label>日期</label><input class="input" id="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
          <button class="btn primary" id="redeem">核销</button>
        </div>
        <p class="hint" id="redeem-result" style="margin-top:10px"></p>
      </div></div>
    </div>`;
  $('#redeem').onclick = async () => {
    try {
      const result = await api.post('/merchant/pickups/redeem', {
        shopId: state.merchant.shopId,
        code: $('#code').value.trim(),
        pickupDate: $('#date').value,
      });
      $('#redeem-result').textContent = `${result.order.orderNo} ${result.alreadyRedeemed ? '此前已核销' : '核销完成'}`;
      toast('核销成功', 'ok');
    } catch (error) {
      $('#redeem-result').textContent = error.message;
      toast(error.message, 'error');
    }
  };
}

async function showTicket(orderId) {
  const [ticketData, requestData] = await Promise.all([
    api.get(`/merchant/orders/${orderId}/ticket`),
    api.get(`/merchant/orders/${orderId}/change-requests`).catch(() => ({ requests: [] })),
  ]);
  const ticket = ticketData.ticket;
  const requests = requestData.requests ?? [];
  openModal({
    title: `工单 ${ticket.orderNo}`,
    wide: true,
    body: `
      ${ticket.note ? `<div class="notice warn" style="margin-bottom:10px">备注：${esc(ticket.note)}</div>` : ''}
      <div class="notice info">${ticket.notes.map((note) => esc(note)).join('<br>')}</div>
      <table class="table" style="margin-top:10px"><thead><tr><th>文件</th><th>页</th><th>面</th><th>张</th><th>规格</th><th>份</th><th>操作</th></tr></thead>
      <tbody>${ticket.items
        .map(
          (item) => `<tr><td>#${item.planId}</td><td>${item.logicalPages}</td><td>${item.impressions}</td><td>${item.paperSheets}</td>
            <td>${esc(item.settings.paperName ?? item.settings.paperSku)} · ${item.settings.pagesPerSide} 合 1 · ${esc(item.settings.duplexMode)}${item.settings.sheetOverride ? ` · 自定义 ${item.settings.sheetOverride} 张/份` : ''}</td>
            <td>${item.settings.copies}</td>
            <td><div class="actions">
              <button class="btn sm" data-preview="${item.productionAssetId}">预览</button>
              <a class="btn sm" href="/api/v1/assets/${item.productionAssetId}/download" target="_blank">下载</a>
            </div></td></tr>`,
        )
        .join('')}</tbody></table>
      <div class="divider"></div>
      <div class="section-head" style="margin:0 0 8px"><h2 style="font-size:13px">改稿请求</h2></div>
      ${requests.length
        ? requests
            .map(
              (item) => `<div class="priority-item" style="margin-bottom:6px"><span class="status ${item.status === 'APPROVED' ? 'COMPLETED' : item.status === 'REJECTED' ? 'PRINT_EXCEPTION' : 'WAIT_ACCEPT'}">${item.status}</span><span class="who">${esc(item.reason)}</span><span class="reason">${fmtTime(item.createdAt)}</span></div>`,
            )
            .join('')
        : '<p class="hint">暂无改稿请求。店家只能查看文件并申请改稿，不能直接修改。</p>'}`,
    footer: `<button class="btn" data-close="1">关闭</button>${['ACCEPTED', 'PRINTING'].includes(ticket.status) ? `<button class="btn primary" data-ask-change="${orderId}">请求改稿</button>` : ''}`,
  });
  $$('#modal-root [data-preview]').forEach((button) => {
    button.onclick = () => {
      openModal({
        title: '打印文件预览（只读）',
        wide: true,
        body: `<iframe class="preview-frame" src="/api/v1/assets/${button.dataset.preview}/download?inline=1"></iframe>`,
      });
    };
  });
  const ask = $('#modal-root [data-ask-change]');
  if (ask) ask.onclick = () => requestChange(Number(ask.dataset.askChange));
}

/* ---------------- 管理 ---------------- */

async function viewAdmin() {
  const [tasks, audits] = await Promise.all([api.get('/admin/tasks'), api.get('/admin/audits')]);
  $('#view').innerHTML = `
    <div class="page">
      <div class="page-head"><div><h1>运行状态</h1><div class="sub">任务与审计</div></div></div>
      <div class="panel"><div class="panel-head"><h2>异步任务</h2></div>
        <table class="table"><thead><tr><th>ID</th><th>类型</th><th>状态</th><th>尝试</th><th>错误</th></tr></thead>
        <tbody>${tasks.tasks.map((task) => `<tr><td class="mono">${task.id}</td><td>${task.type}</td><td><span class="status ${task.status === 'SUCCEEDED' ? 'COMPLETED' : ''}">${task.status}</span></td><td>${task.attempts}</td><td class="mono">${esc(task.errorCode ?? '')}</td></tr>`).join('')}</tbody></table>
      </div>
      <div class="panel" style="margin-top:14px"><div class="panel-head"><h2>审计</h2></div>
        <table class="table"><thead><tr><th>时间</th><th>动作</th><th>资源</th><th>操作者</th></tr></thead>
        <tbody>${audits.audits.map((row) => `<tr><td class="mono">${fmtTime(row.at)}</td><td>${esc(row.action)}</td><td class="mono">${esc(row.resourceType)}#${esc(row.resourceId)}</td><td>${row.actorUserId ?? '—'}</td></tr>`).join('')}</tbody></table>
      </div>
    </div>`;
}

async function viewReconcile() {
  $('#view').innerHTML = `
    <div class="page tight">
      <div class="page-head"><div><h1>对账与清理</h1><div class="sub">10 项一致性检查；清理过期文件</div></div>
        <div class="spacer"></div><button class="btn sm" id="run-reconcile">运行对账</button><button class="btn sm" id="run-cleanup">清理过期文件</button></div>
      <div id="result"></div>
    </div>`;
  $('#run-reconcile').onclick = async () => {
    const report = (await api.get('/admin/reconcile')).report;
    $('#result').innerHTML = `<div class="panel"><div class="panel-head"><h2>${report.ok ? '全部一致' : '发现不一致'}</h2><span class="chip">${fmtTime(report.checkedAt)}</span></div>
      <table class="table"><tbody>${report.checks.map((check) => `<tr><td>${check.count === 0 ? '✓' : '✗'}</td><td>${esc(check.name)}</td><td>${esc(check.title)}</td><td>${check.count}</td></tr>`).join('')}</tbody></table></div>`;
  };
  $('#run-cleanup').onclick = async () => {
    const result = await api.post('/admin/cleanup', { retentionDays: 7 });
    toast(`归档 ${result.archivedDocuments} 个文件，删除 ${result.cleanup.deleted} 个资产`, 'ok');
  };
}

/* 打印店价格设置（店长） */
async function viewMerchantPricing() {
  const shops = await merchantShop();
  if (!state.user.shops.some((shop) => shop.role === 'MANAGER')) {
    $('#view').innerHTML = '<div class="page"><div class="empty">只有店长可以修改价格</div></div>';
    return;
  }
  const pricing = await api.get('/pricing');
  const shop = pricing.shops.find((item) => item.id === state.merchant.shopId) ?? pricing.shops[0];
  const groups = paperGroups(shop);
  const rows = [];
  for (const group of groups) {
    for (const price of [group.bw, group.color]) {
      if (!price) continue;
      rows.push(`
        <tr>
          <td>${esc(group.paper)}</td>
          <td>${price.colorMode === 'BW' ? '黑白' : '彩色'}</td>
          <td><input class="input" style="width:110px" id="sheet-${price.inventoryId}-${price.colorMode}" type="number" min="0" step="0.01" value="${(price.sheetPriceCents / 100).toFixed(2)}"></td>
          <td class="hint">${price.tiers.map((tier) => `${tier.limit === null ? '∞' : tier.limit} 面 ${(tier.unitPriceCents / 100).toFixed(2)}`).join(' · ')}</td>
          <td><input class="input" style="width:110px" id="binding-${price.inventoryId}-${price.colorMode}" type="number" min="0" step="0.01" value="${(price.bindingPriceCents / 100).toFixed(2)}"></td>
          <td class="hint">${(price.discounts ?? []).map((item) => `满 ${item.minImpressions} 面 ${Math.round((1 - item.factor) * 100)} 折`).join('；') || '无'}</td>
          <td><button class="btn sm primary" data-save="${price.inventoryId}:${price.colorMode}">保存（新版本）</button></td>
        </tr>`);
    }
  }
  $('#view').innerHTML = `
    <div class="page">
      <div class="page-head">
        <div><h1>价格设置</h1><div class="sub">${esc(shop.name)} · 保存会生成新的价格版本，历史订单不受影响</div></div>
        <div class="spacer"></div>
        <select class="input" id="shop-select" style="width:190px">${shops.map((item) => `<option value="${item.shop_id}" ${item.shop_id === shop.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select>
      </div>
      <div class="panel">
        <table class="table">
          <thead><tr><th>纸张</th><th>类型</th><th>纸张单价（元/张）</th><th>印刷阶梯</th><th>装订（元/份）</th><th>量大折扣</th><th></th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
      <p class="hint" style="margin-top:10px">阶梯与折扣由平台规则维护；修改单价不会改动历史版本与已支付订单。</p>
    </div>`;
  $('#shop-select').onchange = (event) => {
    state.merchant.shopId = Number(event.target.value);
    viewMerchantPricing();
  };
  $$('[data-save]').forEach((button) => {
    button.onclick = async () => {
      const [inventoryId, colorMode] = button.dataset.save.split(':');
      const price = shop.prices.find((item) => item.inventoryId === Number(inventoryId) && item.colorMode === colorMode);
      try {
        await api.put('/merchant/pricing', {
          shopId: shop.id,
          inventoryId: Number(inventoryId),
          colorMode,
          sheetPriceCents: Math.round(Number($(`#sheet-${inventoryId}-${colorMode}`).value) * 100),
          bindingPriceCents: Math.round(Number($(`#binding-${inventoryId}-${colorMode}`).value) * 100),
          tiers: price.tiers,
          discounts: price.discounts ?? [],
        });
        toast('价格已更新为新版本', 'ok');
        state.pricing = null;
        await viewMerchantPricing();
      } catch (error) {
        toast(error.message, 'error');
      }
    };
  });
}

async function previewOrderFiles(orderId) {
  try {
    const ticket = (await api.get(`/merchant/orders/${orderId}/ticket`)).ticket;
    const items = ticket.items;
    const frameId = 'preview-frame';
    openModal({
      title: `预览 ${ticket.orderNo}`,
      wide: true,
      body: `
        <div class="notice info">只读预览，打印店不能修改文件；需要修改请点「请求改稿」，由学生确认后自行修改。</div>
        ${ticket.note ? `<div class="notice warn" style="margin-top:8px">备注：${esc(ticket.note)}</div>` : ''}
        <div class="row" style="gap:6px;margin:10px 0;flex-wrap:wrap">
          ${items.map((item, index) => `<button class="btn sm ${index === 0 ? 'primary' : ''}" data-prev="${item.productionAssetId}">文件 ${index + 1} · ${item.logicalPages} 页</button>`).join('')}
          ${items.map((item, index) => `<a class="btn sm ghost" href="/api/v1/assets/${item.productionAssetId}/download" target="_blank">下载 ${index + 1}</a>`).join('')}
        </div>
        <iframe class="preview-frame" id="${frameId}" src="/api/v1/assets/${items[0]?.productionAssetId}/download?inline=1"></iframe>
        <p class="hint" style="margin-top:8px">${items.map((item, index) => `文件 ${index + 1}：${esc(item.settings.paperName ?? item.settings.paperSku)} · ${item.settings.pagesPerSide} 合 1 · ${esc(item.settings.duplexMode)} · ${item.settings.copies} 份 · ${item.paperSheets} 张`).join('；')}</p>`,
    });
    $$('#modal-root [data-prev]').forEach((button) => {
      button.onclick = () => {
        $$('#modal-root [data-prev]').forEach((item) => item.classList.remove('primary'));
        button.classList.add('primary');
        $('#' + frameId).src = `/api/v1/assets/${button.dataset.prev}/download?inline=1`;
      };
    });
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* 改稿请求：店家只能申请，学生确认 */
async function requestChange(orderId) {
  const reason = prompt('改稿原因（会通知学生确认）', '需要调整页眉 / 字体 / 空白页');
  if (!reason) return;
  try {
    await api.post(`/merchant/orders/${orderId}/change-requests`, { reason });
    toast('已发送改稿请求', 'ok');
    await route();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function showChangeRequests(orderId, side = 'student') {
  try {
    const data = await api.get(`${side === 'merchant' ? '/merchant' : ''}/orders/${orderId}/change-requests`);
    const requests = data.requests ?? [];
    openModal({
      title: '改稿请求',
      body: requests.length
        ? `<div class="priority-list">${requests
            .map(
              (item) => `<div class="priority-item">
                <span class="status ${item.status === 'APPROVED' ? 'COMPLETED' : item.status === 'REJECTED' ? 'PRINT_EXCEPTION' : 'WAIT_ACCEPT'}">${item.status}</span>
                <span class="who">${esc(item.reason)}</span>
                <span class="reason">${esc(item.requester)} · ${fmtTime(item.createdAt)}</span>
                ${item.status === 'PENDING' && side === 'student' ? `<button class="btn sm primary" data-approve="${item.id}">同意</button><button class="btn sm" data-reject="${item.id}">拒绝</button>` : ''}
              </div>`,
            )
            .join('')}</div>`
        : '<p class="hint">目前没有改稿请求。打印店只能查看与申请，不能直接修改你的文件。</p>',
    });
    $$('#modal-root [data-approve]').forEach((button) => {
      button.onclick = () => resolveChange(orderId, Number(button.dataset.approve), true);
    });
    $$('#modal-root [data-reject]').forEach((button) => {
      button.onclick = () => resolveChange(orderId, Number(button.dataset.reject), false);
    });
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function resolveChange(orderId, requestId, approve) {
  try {
    await api.post(`/orders/${orderId}/change-requests/${requestId}/resolve`, { approve });
    closeModal();
    toast(approve ? '已同意改稿，请编辑后重新下单' : '已拒绝改稿请求', 'ok');
    await route();
  } catch (error) {
    toast(error.message, 'error');
  }
}

/* ---------------- 事件与启动 ---------------- */

const EVENT_LABELS = {
  'order.created': '订单已创建',
  'order.paid': '支付成功',
  'order.accepted': '打印店已接单',
  'order.printing': '开始打印',
  'order.ready': '可取件',
  'order.completed': '已取件',
  'order.refunded': '已退款',
  'order.change_requested': '打印店请求改稿',
  'order.change_approved': '改稿请求已同意',
  'order.change_rejected': '改稿请求已拒绝',
};

let refreshTimer = 0;
function connectEvents() {
  if (state.events || !state.user) return;
  const source = new EventSource(`${API_BASE}/events/stream`);
  state.events = source;
  const handler = (event) => {
    let payload = {};
    try {
      payload = JSON.parse(event.data);
    } catch {
      /* ignore */
    }
    toast(`${EVENT_LABELS[event.type] ?? event.type}${payload.orderNo ? `：${payload.orderNo}` : ''}`, 'ok');
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (['orders', 'merchant', 'workspace', 'merchant-orders', 'analytics'].includes(state.view)) route();
      loadWallet();
    }, 700);
  };
  for (const type of Object.keys(EVENT_LABELS)) source.addEventListener(type, handler);
}

async function boot() {
  try {
    const data = await api.get('/auth/me');
    state.user = { ...data.user, shops: data.shops, isAdmin: data.isAdmin };
    await loadWallet();
    updateChrome();
    connectEvents();
    await route();
  } catch {
    viewAuth();
  }
}

boot();
