/* 浏览器内演示后端：拦截 /api/v1/*，数据存 localStorage。仅用于静态部署演示。 */
(() => {
  const KEY = 'campus-print-mock-v1';
  const SESSION = 'campus-print-session';
  const nowIso = () => new Date().toISOString();
  const iso = (offsetMinutes = 0) => new Date(Date.now() + offsetMinutes * 60000).toISOString();
  const uid = (() => { let n = 1000; return () => ++n; })();

  const TIERS = [{ limit: 100, unit: 10 }, { limit: 300, unit: 8 }, { limit: null, unit: 6 }];
  const CTIERS = [{ limit: 50, unit: 60 }, { limit: 200, unit: 50 }, { limit: null, unit: 40 }];
  const DISCOUNTS = [{ minImpressions: 400, factor: 0.95 }, { minImpressions: 1000, factor: 0.9 }];
  const PAPERS = [
    { sku: 'A4-80G', name: 'A4 80g 复印纸', sheet: 5, binding: 20, w: 210, h: 297 },
    { sku: 'A4-70G', name: 'A4 70g 复印纸', sheet: 4, binding: 20, w: 210, h: 297 },
    { sku: 'A3-80G', name: 'A3 80g 复印纸', sheet: 9, binding: 30, w: 297, h: 420 },
    { sku: 'B5-80G', name: 'B5 80g 复印纸', sheet: 4, binding: 20, w: 182, h: 257 },
    { sku: 'K16-70G', name: '16K 70g 复印纸', sheet: 3, binding: 20, w: 195, h: 270 },
    { sku: 'A4-COLOR', name: 'A4 80g 彩色纸', sheet: 6, binding: 20, w: 210, h: 297 },
  ];
  let OVERRIDES = {};
  const RETENTION_DAYS = 14;
  const MAX_FILES = 50;

  const paperOf = (sku) => PAPERS.find((p) => p.sku === sku) ?? PAPERS[0];
  const money = (cents) => Number(cents || 0);

  function packing(logicalPages, pps, duplex, copies) {
    const pages = Math.max(1, logicalPages);
    const impressionsPerCopy = Math.ceil(pages / pps);
    const sheetsPerCopy = duplex ? Math.ceil(impressionsPerCopy / 2) : impressionsPerCopy;
    return {
      logicalPages: pages,
      pagesPerSide: pps,
      copies,
      impressionsPerCopy,
      impressions: impressionsPerCopy * copies,
      sheetsPerCopy,
      paperSheets: sheetsPerCopy * copies,
      blankBackPerCopy: duplex && impressionsPerCopy % 2 === 1 ? 1 : 0,
    };
  }

  function tierFee(impressions, tiers) {
    let fee = 0;
    let prev = 0;
    for (const tier of tiers) {
      const limit = tier.limit ?? Infinity;
      const band = Math.min(impressions, limit) - prev;
      if (band > 0) fee += band * tier.unit;
      prev = limit;
      if (impressions <= limit) break;
    }
    return fee;
  }

  function priceOf(pack, sku, colorMode, bindingType, sheetOverride) {
    const paper = paperOf(sku);
    const overrideRow = OVERRIDES[`${sku}:${colorMode}`];
    const sheetPrice = overrideRow?.sheet ?? paper.sheet;
    const bindingPrice = overrideRow?.binding ?? paper.binding;
    const p = { ...pack };
    if (sheetOverride) p.paperSheets = sheetOverride * p.copies;
    const paperFee = p.paperSheets * sheetPrice;
    const printFee = tierFee(p.impressions, colorMode === 'COLOR' ? CTIERS : TIERS);
    const bindingFee = bindingType === 'NONE' ? 0 : bindingPrice * p.copies;
    const hit = DISCOUNTS.filter((d) => p.impressions >= d.minImpressions).pop();
    const discount = hit ? Math.round((paperFee + printFee) * (1 - hit.factor)) : 0;
    return {
      pack: p,
      paperFeeCents: money(paperFee),
      printFeeCents: money(printFee),
      bindingFeeCents: money(bindingFee),
      discountCents: money(discount),
      totalCents: money(paperFee + printFee + bindingFee - discount),
    };
  }

  function docStats(content) {
    const nodes = content?.nodes ?? [];
    const characters = nodes.reduce((sum, node) => sum + String(node.text ?? '').length, 0);
    return { characters, paragraphs: nodes.filter((node) => node.type === 'paragraph' || node.type === 'heading').length };
  }

  const DEFAULT_CONFIG = {
    paperSize: 'A4',
    marginTopMm: 25,
    marginBottomMm: 25,
    marginLeftMm: 25,
    marginRightMm: 20,
    bindingMm: 5,
    baseFontSizePt: 11,
    lineHeight: 1.6,
    fontFamily: '"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif',
  };

  function nodesFromText(title, text) {
    const lines = String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
    return lines.map((line, index) => {
      const heading = /^#{1,4}\s/.test(line);
      if (heading) {
        const level = (line.match(/^#+/) ?? ['#'])[0].length;
        return { id: `n_${index}_${Math.random().toString(36).slice(2, 7)}`, type: 'heading', level, text: line.replace(/^#+\s*/, '') };
      }
      return { id: `n_${index}_${Math.random().toString(36).slice(2, 7)}`, type: 'paragraph', text: line };
    });
  }

  const COURSE_TEXT = `课程设计说明书
本说明书用于演示在线编修与打印流程。
第一章 需求分析
系统需要支持文档上传、在线修改、自动保存与实时计价。
第二章 打印规格
支持 1 合 1、2 合 1 与 4 合 1，单双面可选，装订方式可配置。
第三章 取件
下单后选择取件时段，凭取件码到文印中心取件。`;

  function seedState() {
    const users = [
      { id: 1, username: 'student1', password: 'Student@123', displayName: '张同学', studentNo: '20240101', isAdmin: false, shops: [] },
      { id: 2, username: 'liu2024', password: 'Student@123', displayName: '李同学', studentNo: '20240102', isAdmin: false, shops: [] },
      { id: 3, username: 'chen2023', password: 'Student@123', displayName: '陈同学', studentNo: '20231015', isAdmin: false, shops: [] },
      { id: 4, username: 'wang2023', password: 'Student@123', displayName: '王同学', studentNo: '20230507', isAdmin: false, shops: [] },
      { id: 5, username: 'staff1', password: 'Staff@1234', displayName: '李店员', studentNo: null, isAdmin: false, shops: [{ shopId: 1, role: 'CLERK' }] },
      { id: 6, username: 'manager1', password: 'Manager@1234', displayName: '王店长', studentNo: null, isAdmin: false, shops: [{ shopId: 1, role: 'MANAGER' }] },
      { id: 7, username: 'admin1', password: 'Admin@12345', displayName: '平台管理员', studentNo: null, isAdmin: true, shops: [] },
    ];
    const slots = [30, 100, 300, 1560].map((minutes, index) => ({
      id: index + 1,
      startAt: iso(10),
      endAt: iso(minutes),
      remainingUnits: 200,
    }));

    const docs = [];
    const addDoc = (userId, title, mode, options = {}) => {
      const id = docs.length + 1;
      const content = options.content ?? { schemaVersion: 1, nodes: nodesFromText(title, options.text ?? COURSE_TEXT) };
      const pages = options.pages ?? Math.max(1, Math.ceil(docStats(content).characters / 900));
      const renderId = options.render === false ? null : 900 + id;
      const doc = {
        id,
        userId,
        title,
        mode,
        revision: 1,
        content,
        pageConfig: { ...DEFAULT_CONFIG },
        versions: [{ id: 500 + id, versionNo: 1, reason: 'IMPORT' }],
        pinned: Boolean(options.pinned),
        createdAt: iso(-60 * 24 * 3),
        updatedAt: iso(-60 * (8 - (id % 7))),
        renderId,
        pageCount: pages,
        status: 'ACTIVE',
      };
      docs.push(doc);
      return doc;
    };

    addDoc(1, '课程设计说明书（40 页）', 'PDF_DIRECT', { pages: 40 });
    addDoc(1, '数据结构课程论文', 'PDF_DIRECT', { pages: 12 });
    addDoc(1, '实验报告三：缓存实验', 'PDF_DIRECT', { pages: 5 });
    addDoc(1, '社团招新海报说明', 'PDF_DIRECT', { pages: 2 });
    addDoc(1, '线性代数作业', 'EDITABLE');
    addDoc(1, '英语四级作文模板', 'EDITABLE', { pinned: true, text: '英语四级作文模板\n开头句\n主体段\n结尾句' });
    addDoc(1, '课程打印需求说明（草稿）', 'EDITABLE', { render: false });
    addDoc(1, '高数公式速查（A3）', 'PDF_DIRECT', { pages: 3 });
    addDoc(2, '社会实践报告', 'PDF_DIRECT', { pages: 8 });
    addDoc(2, '个人简历（可编辑）', 'EDITABLE');
    addDoc(2, '暑期实践总结', 'PDF_DIRECT', { pages: 4 });
    addDoc(3, '毕业论文开题报告', 'PDF_DIRECT', { pages: 15 });
    addDoc(3, '实验数据表', 'PDF_DIRECT', { pages: 2 });
    addDoc(4, '微积分练习册', 'PDF_DIRECT', { pages: 6 });
    addDoc(4, '社团活动策划', 'EDITABLE');

    const orders = [];
    const addOrder = (userId, docId, options) => {
      const doc = docs.find((item) => item.id === docId);
      const specs = {
        pagesPerSide: options.pps ?? 1,
        duplexMode: options.duplex ?? 'SINGLE',
        colorMode: options.color ?? 'BW',
        bindingType: options.binding ?? 'NONE',
        copies: options.copies ?? 1,
        paperSku: options.sku ?? 'A4-80G',
        sheetOverride: options.sheetOverride ?? null,
      };
      const pack = packing(doc.pageCount, specs.pagesPerSide, specs.duplexMode !== 'SINGLE', specs.copies);
      const fees = priceOf(pack, specs.paperSku, specs.colorMode, specs.bindingType, specs.sheetOverride);
      const id = orders.length + 1;
      const status = options.status ?? 'WAIT_ACCEPT';
      const order = {
        id,
        orderNo: `CP2026${String(100000 + id)}`,
        userId,
        shopId: 1,
        status,
        payStatus: status === 'UNPAID' ? 'UNPAID' : 'PAID',
        totalCents: fees.totalCents,
        revision: 1,
        createdAt: iso(-120 * (orders.length + 1)),
        pickupWindow: `${new Date(iso(options.slotEnd ?? 30)).toLocaleString('zh-CN', { hour12: false })}`,
        pickupDeadline: iso(options.slotEnd ?? 30),
        note: options.note ?? '',
        items: [
          {
            id: id * 10,
            planId: 700 + id,
            logicalPages: doc.pageCount,
            impressions: pack.impressions,
            paperSheets: fees.pack.paperSheets,
            subtotalCents: fees.totalCents,
            productionAssetId: 800 + id,
            settings: {
              ...specs,
              paperName: paperOf(specs.paperSku).name,
              sheetOverride: specs.sheetOverride ?? undefined,
              discountCents: fees.discountCents,
            },
          },
        ],
        events: [{ at: iso(-120 * (orders.length + 1)), type: 'ORDER_CREATED' }],
        student: {
          name: users.find((user) => user.id === userId).displayName,
          studentNo: users.find((user) => user.id === userId).studentNo,
        },
        changeRequests: [],
      };
      orders.push(order);
      return order;
    };

    addOrder(1, 1, { pps: 2, duplex: 'DUPLEX_LONG', copies: 20, binding: 'GLUE', note: '胶装，量大可享折扣', status: 'PRINT_EXCEPTION', slotEnd: 30 });
    addOrder(1, 2, { pps: 2, duplex: 'DUPLEX_LONG', copies: 2, binding: 'STAPLE', note: '双面打印，封面单面', status: 'WAIT_ACCEPT', slotEnd: 100 });
    addOrder(1, 3, { pps: 1, duplex: 'SINGLE', status: 'ACCEPTED', slotEnd: 300 });
    addOrder(1, 4, { pps: 2, duplex: 'DUPLEX_LONG', copies: 6, binding: 'STAPLE', color: 'COLOR', status: 'PRINTING', slotEnd: 1560 });
    addOrder(1, 5, { pps: 1, duplex: 'DUPLEX_LONG', copies: 3, status: 'READY_PICKUP', slotEnd: 100 });
    addOrder(1, 6, { pps: 1, duplex: 'SINGLE', status: 'UNPAID', slotEnd: 300 });
    addOrder(2, 9, { pps: 2, duplex: 'DUPLEX_LONG', copies: 2, binding: 'STAPLE', note: '社会实践材料，需装订', status: 'WAIT_ACCEPT', slotEnd: 30 });
    addOrder(2, 10, { pps: 1, duplex: 'SINGLE', color: 'COLOR', status: 'ACCEPTED', slotEnd: 100 });
    addOrder(2, 11, { pps: 2, duplex: 'DUPLEX_LONG', status: 'PRINTING', slotEnd: 300 });
    addOrder(3, 12, { pps: 2, duplex: 'DUPLEX_LONG', copies: 3, binding: 'GLUE', note: '开题报告，胶装两份', status: 'READY_PICKUP', slotEnd: 1560 });
    addOrder(3, 13, { pps: 4, duplex: 'DUPLEX_LONG', copies: 10, binding: 'STAPLE', status: 'WAIT_ACCEPT', slotEnd: 100 });
    addOrder(4, 14, { pps: 2, duplex: 'DUPLEX_LONG', copies: 5, binding: 'STAPLE', status: 'ACCEPTED', slotEnd: 300 });
    addOrder(4, 15, { pps: 1, duplex: 'DUPLEX_LONG', copies: 2, sheetOverride: 3, note: '每份多留一张空白页做笔记', status: 'PRINTING', slotEnd: 30 });
    addOrder(4, 14, { pps: 1, duplex: 'SINGLE', status: 'COMPLETED', slotEnd: 1560 });

    return {
      users,
      docs,
      orders,
      slots,
      wallets: users.map((user) => ({ userId: user.id, balanceCents: user.id <= 4 ? 60000 : 0 })),
      ledger: [
        { userId: 1, at: iso(-300), direction: 'CREDIT', amountCents: 60000, balanceAfterCents: 60000, memo: '演示充值（支付宝 · 非真实资金）' },
      ],
      assets: [],
      audits: orders.map((order) => ({ id: order.id, at: order.createdAt, action: 'ORDER_CREATED', resourceType: 'print_order', resourceId: String(order.id), actorUserId: order.userId })),
      requests: [],
      pricingOverrides: {},
      nextDocId: docs.length + 1,
      nextAssetId: 2000,
      nextOrderId: orders.length + 1,
    };
  }

  let state = (() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (error) {
      /* 忽略损坏数据 */
    }
    const fresh = seedState();
    localStorage.setItem(KEY, JSON.stringify(fresh));
    return fresh;
  })();

  OVERRIDES = state.pricingOverrides ?? {};
  const persist = () => localStorage.setItem(KEY, JSON.stringify(state));
  const ok = (data, status = 200) => new Response(JSON.stringify({ data }), { status, headers: { 'content-type': 'application/json' } });
  const fail = (status, code, message) => new Response(JSON.stringify({ code, message }), { status, headers: { 'content-type': 'application/json' } });
  const currentUserId = () => Number(localStorage.getItem(SESSION) || 0);
  const currentUser = () => state.users.find((user) => user.id === currentUserId()) ?? null;

  const shopShape = () => ({
    id: 1,
    name: '中心校区文印中心',
    address: '图书馆一层东侧',
    timezone: 'Asia/Shanghai',
    status: 'OPEN',
    capabilities: {
      paperSkus: PAPERS.map((paper) => paper.sku),
      colorModes: ['BW', 'COLOR'],
      duplexModes: ['SINGLE', 'DUPLEX_LONG', 'DUPLEX_SHORT'],
      pagesPerSide: [1, 2, 4],
      bindingTypes: ['NONE', 'STAPLE', 'GLUE'],
      maxSheetsPerBinding: 300,
    },
    slots: state.slots.map((slot) => ({
      id: slot.id,
      startAt: slot.startAt,
      endAt: slot.endAt,
      remainingUnits: slot.remainingUnits,
    })),
  });

  const pricesShape = () =>
    PAPERS.flatMap((paper) =>
      ['BW', 'COLOR'].map((mode) => {
        const override = state.pricingOverrides[`${paper.sku}:${mode}`];
        return {
          sku: paper.sku,
          paperName: paper.name,
          widthMm: paper.w,
          heightMm: paper.h,
          inventoryId: PAPERS.indexOf(paper) + 1,
          colorMode: mode,
          sheetPriceCents: override?.sheet ?? paper.sheet,
          bindingPriceCents: override?.binding ?? paper.binding,
          tiers: (mode === 'COLOR' ? CTIERS : TIERS).map((tier) => ({ limit: tier.limit, unitPriceCents: tier.unit })),
          discounts: DISCOUNTS.map((item) => ({ minImpressions: item.minImpressions, factor: item.factor })),
        };
      }),
    );

  const docShape = (doc) => ({
    id: doc.id,
    title: doc.title,
    mode: doc.mode,
    revision: doc.revision,
    stats: docStats(doc.content),
    updatedAt: doc.updatedAt,
    createdAt: doc.createdAt,
    pinned: Boolean(doc.pinned),
    pinnedAt: doc.pinned ? doc.updatedAt : null,
  });

  const docDetail = (doc) => ({
    document: {
      ...docShape(doc),
      content: doc.content,
      pageConfig: doc.pageConfig,
      versions: doc.versions,
    },
  });

  const orderShape = (order) => ({
    ...order,
    student: order.student ?? {
      name: state.users.find((user) => user.id === order.userId).displayName,
      studentNo: state.users.find((user) => user.id === order.userId).studentNo,
    },
  });

  const minutesLeft = (deadline) => Math.round((Date.parse(deadline) - Date.now()) / 60000);
  const urgencyOf = (minutes) => (minutes <= 0 ? 'overdue' : minutes <= 60 ? 'urgent' : minutes <= 180 ? 'soon' : 'normal');

  function workspaceOrders() {
    return state.orders
      .filter((order) => ['WAIT_ACCEPT', 'ACCEPTED', 'PRINTING', 'PRINT_EXCEPTION', 'READY_PICKUP'].includes(order.status))
      .map((order) => {
        const left = minutesLeft(order.pickupDeadline);
        return {
          ...orderShape(order),
          impressions: order.items.reduce((sum, item) => sum + item.impressions, 0),
          sheets: order.items.reduce((sum, item) => sum + item.paperSheets, 0),
          minutesLeft: left,
          urgency: urgencyOf(left),
          priorityScore: left - order.items.reduce((sum, item) => sum + item.impressions, 0) / 50,
        };
      })
      .sort((a, b) => a.priorityScore - b.priorityScore);
  }

  function analyticsShape() {
    const rows = workspaceOrders();
    const counts = { waitAccept: 0, accepted: 0, printing: 0, ready: 0, exception: 0, completed: 0 };
    for (const order of state.orders) {
      if (order.status === 'WAIT_ACCEPT') counts.waitAccept += 1;
      if (order.status === 'ACCEPTED') counts.accepted += 1;
      if (order.status === 'PRINTING') counts.printing += 1;
      if (order.status === 'READY_PICKUP') counts.ready += 1;
      if (order.status === 'PRINT_EXCEPTION') counts.exception += 1;
      if (order.status === 'COMPLETED') counts.completed += 1;
    }
    const today = state.orders.filter((order) => order.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10));
    const series = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(Date.now() - (6 - index) * 86400000).toISOString().slice(0, 10);
      const hit = state.orders.filter((order) => order.createdAt.slice(0, 10) === day);
      return { day, orders: hit.length, impressions: hit.reduce((sum, order) => sum + order.items.reduce((s, item) => s + item.impressions, 0), 0) };
    });
    const hourlyMap = new Map();
    for (const order of state.orders) {
      const hour = `${String(new Date(order.pickupDeadline).getHours()).padStart(2, '0')}:00`;
      hourlyMap.set(hour, (hourlyMap.get(hour) ?? 0) + order.items.reduce((sum, item) => sum + item.impressions, 0));
    }
    const priority = rows.slice(0, 8).map((order) => ({
      orderId: order.id,
      orderNo: order.orderNo,
      student: order.student,
      status: order.status,
      pickupDeadline: order.pickupDeadline,
      minutesLeft: order.minutesLeft,
      impressions: order.impressions,
      sheets: order.sheets,
      urgency: order.urgency,
      reason:
        order.minutesLeft <= 0
          ? '已过取件时间，需立即处理或联系学生'
          : order.minutesLeft <= 60
            ? '不足 1 小时取件，建议立即排产'
            : order.impressions >= 200
              ? '印量大，建议提前占用设备'
              : '按取件顺序处理',
    }));
    const totalImpressions = rows.filter((order) => order.status !== 'READY_PICKUP').reduce((sum, order) => sum + order.impressions, 0);
    const urgent = rows.filter((order) => order.status !== 'READY_PICKUP' && order.minutesLeft <= 60).length;
    return {
      shopId: 1,
      generatedAt: nowIso(),
      counts,
      today: { orders: today.length, revenueCents: today.reduce((sum, order) => sum + order.totalCents, 0) },
      window: {
        days: 7,
        orders: state.orders.length,
        impressions: state.orders.reduce((sum, order) => sum + order.items.reduce((s, item) => s + item.impressions, 0), 0),
        sheets: state.orders.reduce((sum, order) => sum + order.items.reduce((s, item) => s + item.paperSheets, 0), 0),
      },
      series,
      hourly: [...hourlyMap.entries()].sort().map(([hour, impressions]) => ({ hour, impressions })),
      priority,
      loadSuggestion:
        urgent > 0
          ? `有 ${urgent} 单将在 1 小时内取件，建议先打印这 ${urgent} 单（合计 ${totalImpressions} 面），其余订单顺延。`
          : `待打印 ${rows.length} 单、约 ${totalImpressions} 面，可按取件时间顺序连续打印。`,
    };
  }

  /* ------------------------------ PDF / 资源 ------------------------------ */

  const assetUrlCache = new Map();
  function buildPdf(title, pages) {
    const esc = (text) => String(text).replace(/([()\\])/g, '\\$1');
    const lines = [title, '', `Demo PDF - ${pages} page(s)`, 'Generated locally in your browser.'];
    const content = lines.map((line, index) => `BT /F1 14 Tf 60 ${780 - index * 26} Td (${esc(line.replace(/[^\x20-\x7e]/g, '?'))}) Tj ET`).join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((body, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach((offset) => {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return new Blob([pdf], { type: 'application/pdf' });
  }

  function assetUrl(assetId) {
    if (assetUrlCache.has(assetId)) return assetUrlCache.get(assetId);
    const order = state.orders.find((item) => item.items.some((line) => line.productionAssetId === Number(assetId)));
    const doc = state.docs.find((item) => item.id === Number(assetId) % 100);
    const title = order ? `Order ${order.orderNo}` : (doc?.title ?? 'CampusPrint Demo');
    const url = URL.createObjectURL(buildPdf(title, order ? order.items[0].logicalPages : (doc?.pageCount ?? 1)));
    assetUrlCache.set(Number(assetId), url);
    return url;
  }

  function rewriteAssetLinks(root = document) {
    root.querySelectorAll('iframe[src*="/api/v1/assets/"]').forEach((frame) => {
      const match = frame.getAttribute('src').match(/assets\/(\d+)\//);
      if (match && !frame.dataset.patched) {
        frame.dataset.patched = '1';
        frame.src = assetUrl(match[1]);
      }
    });
    root.querySelectorAll('a[href*="/api/v1/assets/"]').forEach((link) => {
      const match = link.getAttribute('href').match(/assets\/(\d+)\//);
      if (match && !link.dataset.patched) {
        link.dataset.patched = '1';
        link.href = assetUrl(match[1]);
        link.target = '_blank';
      }
    });
  }

  const observer = new MutationObserver(() => rewriteAssetLinks());
  document.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
  });

  /* ------------------------------ 路由 ------------------------------ */

  async function bodyOf(init) {
    if (!init?.body) return {};
    if (init.body instanceof FormData) {
      const form = init.body;
      const file = form.get('file');
      return { form, file };
    }
    try {
      return JSON.parse(init.body);
    } catch {
      return {};
    }
  }

  function renderShape(doc) {
    return doc.renderId
      ? { id: doc.renderId, documentId: doc.id, status: 'READY', pageCount: doc.pageCount, pdfAssetId: 800 + doc.id }
      : null;
  }

  function computePreview(input) {
    const doc = input.documentId ? state.docs.find((item) => item.id === Number(input.documentId)) : null;
    const byRender = input.renderId ? state.docs.find((item) => item.renderId === Number(input.renderId)) : null;
    const pages = (byRender ?? doc)?.pageCount ?? 1;
    const pps = Number(input.pagesPerSide ?? 1);
    const copies = Number(input.copies ?? 1);
    const duplex = (input.duplexMode ?? 'SINGLE') !== 'SINGLE';
    const pack = packing(pages, pps, duplex, copies);
    const override = input.sheetOverride ? Number(input.sheetOverride) : null;
    const auto = pack.sheetsPerCopy;
    if (override && (override < auto || override > auto + 50)) {
      return { error: `每份张数需在 ${auto}—${auto + 50} 之间（按页数自动计算为 ${auto} 张/份）` };
    }
    const fees = priceOf(pack, input.paperSku ?? 'A4-80G', input.colorMode ?? 'BW', input.bindingType ?? 'NONE', override);
    return {
      logicalPages: pack.logicalPages,
      impressions: pack.impressions,
      impressionsPerCopy: pack.impressionsPerCopy,
      paperSheets: fees.pack.paperSheets,
      sheetsPerCopy: pack.sheetsPerCopy,
      autoSheetsPerCopy: auto,
      sheetOverride: override,
      blankSheets: override ? (override - auto) * copies : 0,
      blankBackPerCopy: pack.blankBackPerCopy,
      paperFeeCents: fees.paperFeeCents,
      printFeeCents: fees.printFeeCents,
      bindingFeeCents: fees.bindingFeeCents,
      discountCents: fees.discountCents,
      totalCents: fees.totalCents,
      available: true,
      settings: { paperSku: input.paperSku ?? 'A4-80G', paperName: paperOf(input.paperSku ?? 'A4-80G').name },
    };
  }

  async function handle(path, init) {
    const method = (init.method ?? 'GET').toUpperCase();
    const [pathname, queryString = ''] = path.split('?');
    const query = new URLSearchParams(queryString);
    const body = await bodyOf(init);
    const user = currentUser();

    /* 认证 */
    if (pathname === '/auth/login' && method === 'POST') {
      const found = state.users.find((item) => item.username === body.username && item.password === body.password);
      if (!found) return fail(401, 'INVALID_CREDENTIALS', '账号或口令不正确');
      localStorage.setItem(SESSION, String(found.id));
      return ok({ user: publicUser(found), shops: shopsOf(found), isAdmin: found.isAdmin });
    }
    if (pathname === '/auth/register' && method === 'POST') {
      if (state.users.some((item) => item.username === body.username)) return fail(409, 'USERNAME_TAKEN', '账号已存在');
      const created = {
        id: state.users.length + 1,
        username: String(body.username),
        password: String(body.password),
        displayName: String(body.displayName || body.username),
        studentNo: body.studentNo ? String(body.studentNo) : null,
        isAdmin: false,
        shops: [],
      };
      state.users.push(created);
      state.wallets.push({ userId: created.id, balanceCents: 0 });
      persist();
      localStorage.setItem(SESSION, String(created.id));
      return ok({ user: publicUser(created), shops: [], isAdmin: false });
    }
    if (pathname === '/auth/logout' && method === 'POST') {
      localStorage.removeItem(SESSION);
      return ok({});
    }
    if (pathname === '/auth/me') {
      if (!user) return fail(401, 'UNAUTHENTICATED', '未登录');
      return ok({ user: publicUser(user), shops: shopsOf(user), isAdmin: user.isAdmin });
    }
    if (!user) return fail(401, 'UNAUTHENTICATED', '未登录');

    /* 网点与价格 */
    if (pathname === '/shops') return ok({ shops: [shopShape()] });
    if (pathname === '/pricing') return ok({ shops: [{ ...shopShape(), prices: pricesShape() }] });
    if (pathname === '/quota') {
      const docs = state.docs.filter((doc) => doc.userId === user.id && doc.status === 'ACTIVE');
      return ok({
        quota: {
          used: docs.length,
          maxFiles: MAX_FILES,
          remaining: MAX_FILES - docs.length,
          retentionDays: RETENTION_DAYS,
          documents: docs.map((doc) => ({ id: doc.id, daysLeft: RETAIN_DAYS(doc) })),
        },
      });
    }
    if (pathname === '/price-preview' && method === 'POST') {
      const preview = computePreview({ ...body, documentId: body.documentId });
      if (preview.error) return fail(422, 'INVALID_SHEET_OVERRIDE', preview.error);
      return ok({ preview });
    }

    /* 钱包 */
    if (pathname === '/wallet') {
      const wallet = state.wallets.find((item) => item.userId === user.id) ?? { userId: user.id, balanceCents: 0 };
      const ledger = state.ledger
        .filter((row) => row.userId === user.id)
        .slice(-30)
        .reverse()
        .map((row) => ({ at: row.at, direction: row.direction, amountCents: row.amountCents, balanceAfterCents: row.balanceAfterCents, memo: row.memo }));
      return ok({ wallet: { balanceCents: wallet.balanceCents, ledger } });
    }
    if (pathname === '/wallet/demo-credit' && method === 'POST') {
      const amount = Number(body.amountCents);
      if (!Number.isInteger(amount) || amount < 100 || amount > 200000) return fail(422, 'INVALID_AMOUNT', '充值金额需为 1—2000 元');
      const wallet = state.wallets.find((item) => item.userId === user.id);
      wallet.balanceCents += amount;
      state.ledger.push({
        userId: user.id,
        at: nowIso(),
        direction: 'CREDIT',
        amountCents: amount,
        balanceAfterCents: wallet.balanceCents,
        memo: `演示充值（${body.channel === 'WECHAT' ? '微信' : body.channel === 'WALLET' ? '钱包' : '支付宝'} · 非真实资金）`,
      });
      persist();
      return ok({ wallet: { balanceCents: wallet.balanceCents } });
    }

    /* 文档 */
    if (pathname === '/documents' && method === 'GET') {
      const docs = state.docs
        .filter((doc) => doc.userId === user.id && doc.status === 'ACTIVE')
        .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return ok({ documents: docs.map(docShape) });
    }
    if (pathname === '/documents' && method === 'POST') {
      const docs = state.docs.filter((doc) => doc.userId === user.id && doc.status === 'ACTIVE');
      if (docs.length >= MAX_FILES) return fail(422, 'FILE_QUOTA_EXCEEDED', '文件数量已达上限');
      const existingAsset = state.assets.find((item) => item.id === Number(body.assetId));
      const asset = existingAsset ?? { id: state.nextAssetId++, name: 'upload.pdf', mime: 'application/pdf', text: '' };
      if (!existingAsset) state.assets.push(asset);
      const newDocId = state.nextDocId++;
      const doc = {
        id: newDocId,
        userId: user.id,
        title: asset.name.replace(/\.[^.]+$/, '') || '新文件',
        mode: body.mode === 'PDF_DIRECT' ? 'PDF_DIRECT' : 'EDITABLE',
        revision: 1,
        content: { schemaVersion: 1, nodes: nodesFromText('新文件', '上传的文件内容由打印店按原件打印。\n（静态演示版不解析 DOCX 内容，可在编辑器中直接改写。）') },
        pageConfig: { ...DEFAULT_CONFIG },
        versions: [{ id: uid(), versionNo: 1, reason: 'IMPORT' }],
        pinned: false,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        renderId: 900 + newDocId,
        pageCount: 2,
        status: 'ACTIVE',
      };
      state.docs.push(doc);
      persist();
      return ok({ document: docShape(doc) });
    }
    const docMatch = pathname.match(/^\/documents\/(\d+)$/);
    if (docMatch && method === 'GET') {
      const doc = state.docs.find((item) => item.id === Number(docMatch[1]) && item.userId === user.id);
      if (!doc) return fail(404, 'NOT_FOUND', '文档不存在');
      return ok(docDetail(doc));
    }
    if (docMatch && method === 'DELETE') {
      const doc = state.docs.find((item) => item.id === Number(docMatch[1]) && item.userId === user.id);
      if (!doc) return fail(404, 'NOT_FOUND', '文档不存在');
      doc.status = 'ARCHIVED';
      persist();
      return ok({ archived: true });
    }
    const pinMatch = pathname.match(/^\/documents\/(\d+)\/pin$/);
    if (pinMatch && method === 'POST') {
      const doc = state.docs.find((item) => item.id === Number(pinMatch[1]) && item.userId === user.id);
      if (!doc) return fail(404, 'NOT_FOUND', '文档不存在');
      doc.pinned = Boolean(body.pinned);
      persist();
      return ok({ id: doc.id, pinned: doc.pinned });
    }
    const convertMatch = pathname.match(/^\/documents\/(\d+)\/convert$/);
    if (convertMatch && method === 'POST') {
      const doc = state.docs.find((item) => item.id === Number(convertMatch[1]) && item.userId === user.id);
      if (!doc) return fail(404, 'NOT_FOUND', '文档不存在');
      if (doc.mode === 'EDITABLE') return fail(409, 'ALREADY_EDITABLE', '该文档已经是可编修文档');
      const created = {
        ...doc,
        id: state.nextDocId++,
        mode: 'EDITABLE',
        title: doc.title,
        content: { schemaVersion: 1, nodes: nodesFromText(doc.title, `${doc.title}\n由 PDF 提取的示例段落，可在编辑器中直接修改。`) },
        renderId: 900 + state.nextDocId,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        pinned: false,
        versions: [{ id: uid(), versionNo: 1, reason: 'IMPORT' }],
      };
      state.docs.push(created);
      persist();
      return ok({ document: docShape(created), extracted: { paragraphs: created.content.nodes.length, pages: doc.pageCount } });
    }
    const draftMatch = pathname.match(/^\/documents\/(\d+)\/draft$/);
    if (draftMatch && method === 'PUT') {
      const doc = state.docs.find((item) => item.id === Number(draftMatch[1]) && item.userId === user.id);
      if (!doc) return fail(404, 'NOT_FOUND', '文档不存在');
      doc.content = body.content ?? doc.content;
      doc.pageConfig = body.pageConfig ?? doc.pageConfig;
      doc.revision += 1;
      doc.updatedAt = nowIso();
      doc.pageCount = Math.max(1, Math.ceil(docStats(doc.content).characters / 900));
      persist();
      return ok(docDetail(doc));
    }
    const versionsMatch = pathname.match(/^\/documents\/(\d+)\/versions$/);
    if (versionsMatch && method === 'POST') {
      const doc = state.docs.find((item) => item.id === Number(versionsMatch[1]) && item.userId === user.id);
      if (!doc) return fail(404, 'NOT_FOUND', '文档不存在');
      doc.versions.push({ id: uid(), versionNo: doc.versions.length + 1, reason: 'MANUAL' });
      persist();
      return ok({ version: doc.versions[doc.versions.length - 1] });
    }
    const rollbackMatch = pathname.match(/^\/documents\/(\d+)\/rollback$/);
    if (rollbackMatch && method === 'POST') {
      const doc = state.docs.find((item) => item.id === Number(rollbackMatch[1]) && item.userId === user.id);
      if (!doc) return fail(404, 'NOT_FOUND', '文档不存在');
      doc.revision += 1;
      doc.updatedAt = nowIso();
      persist();
      return ok(docDetail(doc));
    }
    const renderLatest = pathname.match(/^\/documents\/(\d+)\/renders\/latest$/);
    if (renderLatest) {
      const doc = state.docs.find((item) => item.id === Number(renderLatest[1]) && item.userId === user.id);
      if (!doc) return fail(404, 'NOT_FOUND', '文档不存在');
      return ok({ render: renderShape(doc) });
    }
    const renderCreate = pathname.match(/^\/documents\/(\d+)\/renders$/);
    if (renderCreate && method === 'POST') {
      const doc = state.docs.find((item) => item.id === Number(renderCreate[1]) && item.userId === user.id);
      if (!doc) return fail(404, 'NOT_FOUND', '文档不存在');
      doc.pageCount = Math.max(1, Math.ceil(docStats(doc.content).characters / 900));
      doc.renderId = doc.renderId ?? 900 + doc.id;
      persist();
      return ok({ render: renderShape(doc) });
    }
    const renderMatch = pathname.match(/^\/renders\/(\d+)$/);
    if (renderMatch) {
      const doc = state.docs.find((item) => item.renderId === Number(renderMatch[1]));
      if (!doc) return fail(404, 'NOT_FOUND', '渲染不存在');
      return ok({ render: renderShape(doc) });
    }
    const renderConfirm = pathname.match(/^\/renders\/(\d+)\/confirm$/);
    if (renderConfirm && method === 'POST') return ok({});
    const inspectMatch = pathname.match(/^\/documents\/(\d+)\/inspections$/);
    if (inspectMatch && method === 'POST') {
      return ok({
        inspection: {
          id: uid(),
          status: 'DONE',
          issues: [
            {
              id: 1,
              severity: 'WARNING',
              issueType: 'PUNCTUATION',
              description: '检测到连续句号「。。」，建议改为单个句号。',
              status: 'OPEN',
              requiresConfirmation: false,
              fixAction: 'FIX_PUNCTUATION',
            },
            {
              id: 2,
              severity: 'INFO',
              issueType: 'EMPTY_PARAGRAPH',
              description: '存在 1 个空段落，可删除以节省纸张。',
              status: 'OPEN',
              requiresConfirmation: false,
              fixAction: 'REMOVE_EMPTY',
            },
          ],
        },
      });
    }
    const fixMatch = pathname.match(/^\/documents\/(\d+)\/fixes\/apply$/);
    if (fixMatch && method === 'POST') {
      const doc = state.docs.find((item) => item.id === Number(fixMatch[1]) && item.userId === user.id);
      if (!doc) return fail(404, 'NOT_FOUND', '文档不存在');
      doc.content.nodes.forEach((node) => {
        node.text = String(node.text ?? '').replace(/。。+/g, '。');
      });
      doc.revision += 1;
      doc.updatedAt = nowIso();
      persist();
      return ok({ document: { ...docShape(doc), content: doc.content, pageConfig: doc.pageConfig, versions: doc.versions }, renderId: null });
    }

    /* 上传 */
    if (pathname === '/assets' && method === 'POST') {
      const file = body.file ?? (body.form?.get('file') ?? null);
      const name = file?.name ?? 'upload.pdf';
      const asset = { id: state.nextAssetId++, name, mime: file?.type ?? 'application/pdf', text: '' };
      state.assets.push(asset);
      persist();
      return ok({ asset: { id: asset.id, name, mime: asset.mime, size: file?.size ?? 0 } });
    }
    const downloadMatch = pathname.match(/^\/assets\/(\d+)\/download$/);
    if (downloadMatch) {
      return new Response(assetUrl(downloadMatch[1]), { status: 200, headers: { 'content-type': 'application/pdf' } });
    }

    /* 方案 / 报价 / 订单 */
    if (pathname === '/print-plans' && method === 'POST') {
      const doc = state.docs.find((item) => item.renderId === Number(body.renderId));
      const preview = computePreview({ ...body, documentId: doc?.id });
      if (preview.error) return fail(422, 'INVALID_SHEET_OVERRIDE', preview.error);
      const plan = {
        id: uid(),
        renderId: Number(body.renderId),
        shopId: Number(body.shopId ?? 1),
        documentId: doc?.id,
        status: 'CONFIRMED',
        settings: {
          paperSku: body.paperSku ?? 'A4-80G',
          colorMode: body.colorMode ?? 'BW',
          duplexMode: body.duplexMode ?? 'SINGLE',
          pagesPerSide: Number(body.pagesPerSide ?? 1),
          bindingType: body.bindingType ?? 'NONE',
          copies: Number(body.copies ?? 1),
          sheetOverride: body.sheetOverride ?? null,
        },
        totals: preview,
        pageCount: doc?.pageCount ?? 1,
      };
      state.plans = state.plans ?? [];
      state.plans.push(plan);
      persist();
      return ok({ plan });
    }
    if (pathname === '/quotes' && method === 'POST') {
      const planIds = (body.planIds ?? []).map(Number);
      const plans = (state.plans ?? []).filter((plan) => planIds.includes(plan.id));
      if (!plans.length) return fail(404, 'PLAN_NOT_FOUND', '印前方案不存在');
      const totalCents = plans.reduce((sum, plan) => sum + plan.totals.totalCents, 0);
      const quote = { id: uid(), slotId: Number(body.slotId ?? 1), planIds, totalCents };
      state.quotes = state.quotes ?? [];
      state.quotes.push(quote);
      persist();
      return ok({ quote });
    }
    if (pathname === '/orders' && method === 'POST') {
      const quote = (state.quotes ?? []).find((item) => item.id === Number(body.quoteId));
      if (!quote) return fail(404, 'QUOTE_NOT_FOUND', '报价不存在');
      const plans = (state.plans ?? []).filter((plan) => quote.planIds.includes(plan.id));
      const slot = state.slots.find((item) => item.id === quote.slotId) ?? state.slots[0];
      const id = state.nextOrderId++;
      const order = {
        id,
        orderNo: `CP2026${String(100000 + id)}`,
        userId: user.id,
        shopId: 1,
        status: 'UNPAID',
        payStatus: 'UNPAID',
        totalCents: quote.totalCents,
        revision: 0,
        createdAt: nowIso(),
        pickupWindow: `${new Date(slot.startAt).toLocaleString('zh-CN', { hour12: false })} — ${new Date(slot.endAt).toLocaleString('zh-CN', { hour12: false })}`,
        pickupDeadline: slot.endAt,
        note: String(body.note ?? ''),
        items: plans.map((plan) => {
          const doc = state.docs.find((item) => item.id === plan.documentId);
          return {
            id: uid(),
            planId: plan.id,
            logicalPages: doc?.pageCount ?? plan.pageCount,
            impressions: plan.totals.impressions,
            paperSheets: plan.totals.paperSheets,
            subtotalCents: plan.totals.totalCents,
            productionAssetId: 800 + id,
            settings: { ...plan.settings, paperName: paperOf(plan.settings.paperSku).name, discountCents: plan.totals.discountCents },
          };
        }),
        events: [{ at: nowIso(), type: 'ORDER_CREATED' }],
        student: { name: user.displayName, studentNo: user.studentNo },
        changeRequests: [],
      };
      state.orders.push(order);
      persist();
      return ok({ order: orderShape(order) });
    }
    if (pathname === '/orders' && method === 'GET') {
      const orders = state.orders.filter((order) => order.userId === user.id).reverse();
      return ok({ orders: orders.map(orderShape) });
    }
    const orderMatch = pathname.match(/^\/orders\/(\d+)$/);
    if (orderMatch && method === 'GET') {
      const order = state.orders.find((item) => item.id === Number(orderMatch[1]) && item.userId === user.id);
      if (!order) return fail(404, 'NOT_FOUND', '订单不存在');
      return ok({ order: orderShape(order) });
    }
    const payMatch = pathname.match(/^\/orders\/(\d+)\/payments$/);
    if (payMatch && method === 'POST') {
      const order = state.orders.find((item) => item.id === Number(payMatch[1]) && item.userId === user.id);
      if (!order) return fail(404, 'NOT_FOUND', '订单不存在');
      if (order.payStatus === 'PAID') return fail(409, 'ORDER_ALREADY_PAID', '订单已支付');
      const method2 = body.method ?? 'WALLET';
      if (method2 === 'WALLET') {
        const wallet = state.wallets.find((item) => item.userId === user.id);
        if (wallet.balanceCents < order.totalCents) return fail(409, 'INSUFFICIENT_BALANCE', '演示钱包余额不足');
        wallet.balanceCents -= order.totalCents;
        state.ledger.push({
          userId: user.id,
          at: nowIso(),
          direction: 'DEBIT',
          amountCents: order.totalCents,
          balanceAfterCents: wallet.balanceCents,
          memo: '钱包支付订单',
        });
      }
      order.payStatus = 'PAID';
      order.status = 'WAIT_ACCEPT';
      order.revision += 1;
      order.events.push({ at: nowIso(), type: 'ORDER_PAID' });
      persist();
      return ok({ order: orderShape(order), payment: { id: uid(), amountCents: order.totalCents, status: 'SUCCEEDED', channelTxnNo: `${method2}-${Date.now()}` } });
    }
    const cancelMatch = pathname.match(/^\/orders\/(\d+)\/cancel$/);
    if (cancelMatch && method === 'POST') {
      const order = state.orders.find((item) => item.id === Number(cancelMatch[1]) && item.userId === user.id);
      if (!order) return fail(404, 'NOT_FOUND', '订单不存在');
      order.status = 'CANCELLED';
      order.revision += 1;
      order.events.push({ at: nowIso(), type: 'ORDER_CANCELLED' });
      persist();
      return ok({ order: orderShape(order) });
    }
    const pickupMatch = pathname.match(/^\/orders\/(\d+)\/pickup$/);
    if (pickupMatch) {
      const order = state.orders.find((item) => item.id === Number(pickupMatch[1]) && item.userId === user.id);
      if (!order) return fail(404, 'NOT_FOUND', '订单不存在');
      return ok({ pickup: { displayCode: `A8-${String(order.id).padStart(4, '0')}`, pickupDate: todayText(), pickupWindow: order.pickupWindow } });
    }
    const qrMatch = pathname.match(/^\/orders\/(\d+)\/pickup\/qr$/);
    if (qrMatch) {
      return ok({ qr: { token: `demo-token-${qrMatch[1]}`, expiresAt: iso(120) } });
    }
    const changeOwnerMatch = pathname.match(/^\/orders\/(\d+)\/change-requests$/);
    if (changeOwnerMatch && method === 'GET') {
      const order = state.orders.find((item) => item.id === Number(changeOwnerMatch[1]) && item.userId === user.id);
      if (!order) return fail(404, 'NOT_FOUND', '订单不存在');
      return ok({ requests: order.changeRequests ?? [] });
    }
    const changeResolveMatch = pathname.match(/^\/orders\/(\d+)\/change-requests\/(\d+)\/resolve$/);
    if (changeResolveMatch && method === 'POST') {
      const order = state.orders.find((item) => item.id === Number(changeResolveMatch[1]) && item.userId === user.id);
      if (!order) return fail(404, 'NOT_FOUND', '订单不存在');
      const request = (order.changeRequests ?? []).find((item) => item.id === Number(changeResolveMatch[2]));
      if (!request) return fail(404, 'NOT_FOUND', '改稿请求不存在');
      if (request.status !== 'PENDING') return fail(409, 'REQUEST_RESOLVED', '该请求已处理');
      request.status = body.approve ? 'APPROVED' : 'REJECTED';
      request.resolvedAt = nowIso();
      persist();
      return ok({ request, approved: Boolean(body.approve) });
    }

    /* 打印店 */
    if (pathname === '/merchant/workspace') return ok({ workspace: { orders: workspaceOrders() } });
    if (pathname === '/merchant/analytics') return ok({ analytics: analyticsShape() });
    if (pathname === '/merchant/orders' && method === 'GET') {
      const q = String(query.get('q') ?? '').toLowerCase();
      const status = query.get('status');
      let orders = state.orders.slice().reverse();
      if (status) {
        const set = status.split(',');
        orders = orders.filter((order) => set.includes(order.status));
      }
      if (q) {
        orders = orders.filter((order) => {
          const student = state.users.find((item) => item.id === order.userId);
          return (
            order.orderNo.toLowerCase().includes(q) ||
            (student?.displayName ?? '').toLowerCase().includes(q) ||
            (student?.studentNo ?? '').includes(q)
          );
        });
      }
      return ok({ orders: orders.map(orderShape) });
    }
    const ticketMatch = pathname.match(/^\/merchant\/orders\/(\d+)\/ticket$/);
    if (ticketMatch) {
      const order = state.orders.find((item) => item.id === Number(ticketMatch[1]));
      if (!order) return fail(404, 'NOT_FOUND', '订单不存在');
      return ok({
        ticket: {
          orderNo: order.orderNo,
          status: order.status,
          note: order.note ?? '',
          notes: [`取件时段：${order.pickupWindow}`, `共 ${order.items.length} 个文件`],
          items: order.items,
        },
      });
    }
    const printJobMatch = pathname.match(/^\/merchant\/orders\/(\d+)\/print$/);
    if (printJobMatch && method === 'POST') {
      const order = state.orders.find((item) => item.id === Number(printJobMatch[1]));
      if (!order) return fail(404, 'NOT_FOUND', '订单不存在');
      if (!['ACCEPTED', 'PRINTING', 'PRINT_EXCEPTION'].includes(order.status)) return fail(409, 'ORDER_NOT_PRINTABLE', '当前状态不可发起打印');
      return ok({
        job: {
          orderId: order.id,
          orderNo: order.orderNo,
          note: order.note ?? '',
          files: order.items.map((item, index) => ({
            index: index + 1,
            planId: item.planId,
            assetId: item.productionAssetId,
            name: `order-${order.id}-${index + 1}.pdf`,
            hash: `demo-${item.productionAssetId}`,
            pages: item.logicalPages,
            impressions: item.impressions,
            sheets: item.paperSheets,
            downloadUrl: `/api/v1/assets/${item.productionAssetId}/download`,
          })),
          totals: {
            files: order.items.length,
            impressions: order.items.reduce((sum, item) => sum + item.impressions, 0),
            sheets: order.items.reduce((sum, item) => sum + item.paperSheets, 0),
          },
          openedAt: nowIso(),
        },
      });
    }
    const merchantChangeMatch = pathname.match(/^\/merchant\/orders\/(\d+)\/change-requests$/);
    if (merchantChangeMatch && method === 'POST') {
      const order = state.orders.find((item) => item.id === Number(merchantChangeMatch[1]));
      if (!order) return fail(404, 'NOT_FOUND', '订单不存在');
      order.changeRequests = order.changeRequests ?? [];
      const pending = order.changeRequests.find((item) => item.status === 'PENDING');
      const reason = String(body.reason ?? '').slice(0, 200);
      if (!reason) return fail(422, 'INVALID_REASON', '请填写改稿原因');
      if (pending) return ok({ request: pending, existing: true });
      const request = { id: uid(), reason, status: 'PENDING', requester: user.displayName, createdAt: nowIso() };
      order.changeRequests.push(request);
      persist();
      return ok({ request, existing: false });
    }
    if (merchantChangeMatch && method === 'GET') {
      const order = state.orders.find((item) => item.id === Number(merchantChangeMatch[1]));
      if (!order) return fail(404, 'NOT_FOUND', '订单不存在');
      return ok({ requests: order.changeRequests ?? [] });
    }
    const transitionMatch = pathname.match(/^\/merchant\/orders\/(\d+)\/(accept|start-print|ready|reject|exception)$/);
    if (transitionMatch && method === 'POST') {
      const order = state.orders.find((item) => item.id === Number(transitionMatch[1]));
      if (!order) return fail(404, 'NOT_FOUND', '订单不存在');
      const action = transitionMatch[2];
      const next = { accept: 'ACCEPTED', 'start-print': 'PRINTING', ready: 'READY_PICKUP', reject: 'REJECTED', exception: 'PRINT_EXCEPTION' }[action];
      order.status = next;
      order.revision += 1;
      order.events.push({ at: nowIso(), type: `ORDER_${next}` });
      persist();
      return ok(orderShape(order));
    }
    if (pathname === '/merchant/pickups/redeem' && method === 'POST') {
      const code = String(body.code ?? '');
      const order = state.orders.find((item) => `A8-${String(item.id).padStart(4, '0')}` === code);
      if (!order) return fail(404, 'PICKUP_NOT_FOUND', '取件码不存在');
      order.status = 'COMPLETED';
      order.revision += 1;
      persist();
      return ok({ order: orderShape(order), alreadyRedeemed: false });
    }
    if (pathname === '/merchant/pricing' && method === 'PUT') {
      const staff = user.shops.find((shop) => shop.shopId === 1);
      if (!staff || staff.role !== 'MANAGER') return fail(403, 'FORBIDDEN', '只有店长可以修改价格');
      const key = `${body.sku}:${body.colorMode}`;
      state.pricingOverrides[key] = { sheet: Number(body.sheetPriceCents), binding: Number(body.bindingPriceCents) };
      OVERRIDES = state.pricingOverrides;
      persist();
      return ok({ rule: { version: 2, sheetPriceCents: Number(body.sheetPriceCents), bindingPriceCents: Number(body.bindingPriceCents) } });
    }

    /* 管理 */
    if (pathname === '/admin/tasks') return ok({ tasks: [] });
    if (pathname === '/admin/audits') return ok({ audits: state.audits.slice(-40).reverse() });
    if (pathname === '/admin/reconcile') {
      const names = ['ORDER_AMOUNT_MATCH', 'WALLET_LEDGER_BALANCE', 'PAYMENT_ORDER_STATE', 'PICKUP_SINGLE_ACTIVE', 'INVENTORY_RESERVED', 'SLOT_CAPACITY', 'RENDER_READY_WITHOUT_PDF', 'DOC_ACTIVE_ORDER', 'OUTBOX_UNPUBLISHED', 'QUOTE_SNAPSHOT_MATCH'];
      return ok({ report: { ok: true, checkedAt: nowIso(), checks: names.map((name) => ({ name, title: name, count: 0 })) } });
    }
    if (pathname === '/admin/cleanup' && method === 'POST') return ok({ archivedDocuments: 0, cleanup: { deleted: 0 } });

    return fail(404, 'NOT_FOUND', '资源不存在');
  }

  function shopsOf(user) {
    return (user.shops ?? []).map((shop) => ({ shop_id: shop.shopId, role: shop.role, name: '中心校区文印中心' }));
  }

  function publicUser(user) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      studentNo: user.studentNo,
      isAdmin: user.isAdmin,
    };
  }

  function todayText() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function RETAIN_DAYS(doc) {
    const created = Date.parse(doc.createdAt);
    const left = Math.ceil((created + RETENTION_DAYS * 86400000 - Date.now()) / 86400000);
    return Math.max(0, Math.min(RETENTION_DAYS, left));
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const marker = '/api/v1';
    if (url.includes(marker)) {
      const path = url.slice(url.indexOf(marker) + marker.length);
      return handle(path, init).catch((error) => {
        console.error('[mock]', error);
        return fail(500, 'MOCK_ERROR', String(error?.message ?? error));
      });
    }
    return realFetch(input, init);
  };

  class MockEventSource {
    constructor() {
      this.readyState = 1;
    }
    addEventListener() {}
    removeEventListener() {}
    close() {
      this.readyState = 2;
    }
  }
  window.EventSource = MockEventSource;

  window.__resetMockData = () => {
    localStorage.removeItem(KEY);
    localStorage.removeItem(SESSION);
    location.reload();
  };
})();
