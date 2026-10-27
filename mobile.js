/* 移动端增强：底部标签栏、更多抽屉、表格卡片化。仅在窄屏生效。 */
(() => {
  const MQ = window.matchMedia('(max-width: 820px)');
  const PRIMARY_STUDENT = ['#/', '#/print', '#/files', '#/orders'];
  const PRIMARY_MERCHANT = ['#/merchant', '#/merchant/workspace', '#/merchant/orders', '#/merchant/analytics'];

  let tabbar = null;
  let sheet = null;
  let annotating = false;

  const isMobile = () => MQ.matches;
  const currentHash = () => location.hash || '#/';

  function sidebarLinks() {
    return [...document.querySelectorAll('#sidebar .nav-item')];
  }

  function isMerchant() {
    return sidebarLinks().some((link) => link.getAttribute('href') === '#/merchant');
  }

  function buildTabbar() {
    if (!isMobile()) {
      tabbar?.remove();
      tabbar = null;
      return;
    }
    if (tabbar) return;
    tabbar = document.createElement('nav');
    tabbar.className = 'm-tabbar';
    tabbar.setAttribute('aria-label', '主导航');
    document.body.appendChild(tabbar);
    tabbar.addEventListener('click', (event) => {
      const tab = event.target.closest('.m-tab');
      if (!tab) return;
      if (tab.dataset.action === 'more') {
        openSheet();
        return;
      }
      const href = tab.dataset.href;
      if (href) {
        location.hash = href;
        closeSheet();
      }
    });
  }

  let lastTabs = '';

  function renderTabbar() {
    if (!isMobile()) return;
    buildTabbar();
    if (!tabbar) return;
    const links = sidebarLinks();
    if (!links.length) {
      tabbar.remove();
      tabbar = null;
      return;
    }
    const primary = (isMerchant() ? PRIMARY_MERCHANT : PRIMARY_STUDENT)
      .map((href) => links.find((link) => link.getAttribute('href') === href))
      .filter(Boolean);
    const activeHash = currentHash().replace(/\?.*$/, '');
    const html =
      primary
        .map((link) => {
          const href = link.getAttribute('href');
          const icon = link.querySelector('.ico')?.textContent?.trim() ?? '•';
          const label = link.textContent.trim().replace(icon, '').trim() || link.textContent.trim();
          const active = href === activeHash || (href !== '#/' && activeHash.startsWith(href));
          return `<button class="m-tab ${active ? 'active' : ''}" data-href="${href}"><span class="ico">${icon}</span><span>${label}</span></button>`;
        })
        .join('') + `<button class="m-tab" data-action="more"><span class="ico">⋯</span><span>更多</span></button>`;
    if (html !== lastTabs) {
      lastTabs = html;
      tabbar.innerHTML = html;
    }
  }

  function openSheet() {
    if (!isMobile()) return;
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'm-sheet';
      document.body.appendChild(sheet);
      sheet.addEventListener('click', (event) => {
        if (event.target.dataset.close === '1') return closeSheet();
        const item = event.target.closest('.m-sheet-item');
        if (!item) return;
        const action = item.dataset.action;
        if (action === 'theme') {
          document.querySelector('#theme-toggle')?.click();
          renderSheet();
          return;
        }
        if (action === 'logout') {
          document.querySelector('#btn-logout')?.click();
          return closeSheet();
        }
        if (item.dataset.href) {
          location.hash = item.dataset.href;
          closeSheet();
        }
      });
    }
    renderSheet();
    sheet.classList.add('open');
  }

  function closeSheet() {
    sheet?.classList.remove('open');
  }

  function renderSheet() {
    if (!sheet) return;
    const groups = [...document.querySelectorAll('#sidebar .nav-section')];
    const activeHash = currentHash().replace(/\?.*$/, '');
    const theme = document.documentElement.dataset.theme === 'dark' ? '☀ 日间模式' : '☾ 夜间模式';
    const groupsHtml = groups
      .map((group) => {
        const label = group.querySelector('.nav-label')?.textContent?.trim() ?? '';
        const items = [...group.querySelectorAll('.nav-item')];
        if (!items.length) return '';
        return `<h4>${label}</h4><div class="m-sheet-grid">${items
          .map((link) => {
            const href = link.getAttribute('href');
            const icon = link.querySelector('.ico')?.textContent?.trim() ?? '•';
            const text = link.textContent.replace(icon, '').trim();
            const active = href === activeHash;
            return `<button class="m-sheet-item ${active ? 'active' : ''}" data-href="${href}"><span>${icon}</span><span>${text}</span></button>`;
          })
          .join('')}</div>`;
      })
      .join('');
    sheet.innerHTML = `
      <div class="m-sheet-mask" data-close="1"></div>
      <div class="m-sheet-panel" role="dialog" aria-label="更多">
        <div class="m-sheet-handle"></div>
        ${groupsHtml}
        <h4>设置</h4>
        <div class="m-sheet-grid">
          <button class="m-sheet-item" data-action="theme"><span>◐</span><span>${theme}</span></button>
          <button class="m-sheet-item" data-action="logout"><span>⏻</span><span>退出登录</span></button>
        </div>
      </div>`;
  }

  function annotateTables() {
    if (!isMobile()) return;
    annotating = true;
    document.querySelectorAll('table.table').forEach((table) => {
      const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      table.classList.add('cards');
      if (!headers.length) {
        table.classList.add('plain');
        return;
      }
      table.querySelectorAll('tbody tr').forEach((row) => {
        [...row.children].forEach((cell, index) => {
          if (!(cell instanceof HTMLElement)) return;
          if (!cell.dataset.label) cell.dataset.label = headers[index] ?? '';
        });
      });
    });
    annotating = false;
  }

  let pending = 0;

  function scheduleRefresh() {
    if (pending) return;
    pending = window.setTimeout(() => {
      pending = 0;
      refresh();
    }, 60);
  }

  function refresh() {
    if (!isMobile()) {
      tabbar?.remove();
      tabbar = null;
      closeSheet();
      document.body.classList.remove('m-ready');
      document.querySelectorAll('table.cards').forEach((table) => table.classList.remove('cards'));
      return;
    }
    document.body.classList.add('m-ready');
    renderTabbar();
    annotateTables();
  }

  window.addEventListener('hashchange', () => {
    observe();
    scheduleRefresh();
    closeSheet();
  });

  const observer = new MutationObserver(() => {
    if (annotating) return;
    scheduleRefresh();
  });

  function observe() {
    const sidebar = document.querySelector('#sidebar');
    const view = document.querySelector('#view');
    if (sidebar) observer.observe(sidebar, { childList: true });
    if (view) observer.observe(view, { childList: true });
  }

  document.addEventListener('DOMContentLoaded', () => {
    observe();
    const avatar = document.querySelector('#user-chip');
    avatar?.addEventListener('click', () => openSheet());
    refresh();
  });

  window.addEventListener('resize', () => refresh());
  MQ.addEventListener?.('change', () => refresh());
})();
