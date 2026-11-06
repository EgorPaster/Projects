window.App = window.App || {};

(function () {
  'use strict';

  // ===== Constants =====
  const STORAGE_KEY = 'custplay-v1';
  const LEGACY_KEY = 'dnd-tracker-v1';
  const CARD_TYPES = ['counter', 'skill', 'stat', 'formula', 'spell', 'currency', 'perk', 'inventory', 'note'];
  const MIN_W = 220, MIN_H = 110;   // минимальный размер карточки: чтобы влезали кнопки/содержимое

  // ===== Helpers =====
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  function fmt(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return '—';
    if (Number.isInteger(n)) return String(n);
    return String(Math.round(n * 100) / 100);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dieLabel(sides) { return sides ? 'd' + sides : ''; }
  function bonusStr(b) {
    b = num(b);
    if (!b) return '';
    return (b > 0 ? ' + ' : ' − ') + Math.abs(b);
  }
  function isDesktop() {
    return window.matchMedia('(min-width: 721px)').matches;
  }
  function nameExample(type) {
    return ({ counter: 'Здоровье', skill: 'Акробатика', stat: 'Сила', formula: 'КБ', spell: 'Огненный шар', currency: 'Деньги', perk: 'Вдохновение', inventory: 'Снаряжение', note: 'Заметка' })[type] || '';
  }

  // ===== State =====
  function defaultState() {
    return {
      version: 1,
      activeCharacterId: null,
      characters: [],
      settings: { language: 'ru' },
      log: []
    };
  }

  function load() {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) { localStorage.setItem(STORAGE_KEY, legacy); raw = legacy; }
      }
      if (!raw) return defaultState();
      const s = JSON.parse(raw);
      return Object.assign(defaultState(), s);
    } catch (e) {
      return defaultState();
    }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  let state = load();
  App.state = state;

  let undoStack = [];
  let redoStack = [];
  const MAX_UNDO = 50;
  let editMode = false;
  let editScratch = { units: null, items: null, tokens: null, formulaCard: null, uiAlign: '' };

  let formulaMemo = {};
  let formulaVisiting = new Set();

  function snapshot() {
    return JSON.parse(JSON.stringify({ characters: state.characters, activeCharacterId: state.activeCharacterId }));
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }
  function commit() {
    computeFormulas();
    save();
    render();
  }
  function mutate(fn) {
    pushUndo();
    fn();
    commit();
  }

  // ===== Character / card helpers =====
  function activeChar() {
    return state.characters.find(function (c) { return c.id === state.activeCharacterId; }) || null;
  }

  // ===== Pages (полотна внутри персонажа) =====
  function ensurePages(ch) {
    if (!ch) return;
    if (!Array.isArray(ch.pages) || !ch.pages.length) {
      ch.pages = [{ id: uid(), name: App.t('pageDefault') }];
      ch.cards.forEach(function (c) { if (!c.page) c.page = ch.pages[0].id; });
    }
    ch.cards.forEach(function (c) {
      if (!ch.pages.some(function (p) { return p.id === c.page; })) c.page = ch.pages[0].id;
    });
    if (!ch.lastPage || !ch.pages.some(function (p) { return p.id === ch.lastPage; })) ch.lastPage = ch.pages[0].id;
  }
  function curPageId(ch) {
    ch = ch || activeChar();
    ensurePages(ch);
    return ch ? ch.lastPage : null;
  }
  function defaultPageName(ch) {
    const base = App.t('pageBase');
    let i = ch.pages.length + 1, name;
    do { name = base + ' ' + i; i++; } while (ch.pages.some(function (p) { return p.name === name; }));
    return name;
  }
  function openPageRename() {
    const ch = activeChar();
    if (!ch) return;
    const page = ch.pages.find(function (p) { return p.id === ch.lastPage; });
    openModal(App.t('renamePage'),
      '<div class="field"><label>' + esc(App.t('pageName')) + '</label>' +
      '<input id="p-name" type="text" value="' + esc(page.name) + '" placeholder="' + esc(App.t('pageNameHint')) + '"></div>',
      [
        { label: App.t('cancel') },
        { label: App.t('save'), cls: 'primary', onClick: function () {
            const nm = document.getElementById('p-name').value.trim();
            if (!nm) return false;
            mutate(function () { page.name = nm; });
          } }
      ]
    );
    const inp = document.getElementById('p-name');
    if (inp) { inp.focus(); inp.select(); }
  }
  function deletePage(pageId) {
    const ch = activeChar();
    if (!ch) return;
    if (ch.pages.length <= 1) return;
    const page = ch.pages.find(function (p) { return p.id === pageId; });
    const hasCards = ch.cards.some(function (c) { return c.page === pageId; });
    if (!hasCards) {
      confirmDialog(App.tf('confirmDeletePage', { name: page.name }), function () { doDeletePage(pageId, null); }, App.t('deletePage'));
      return;
    }
    // на странице есть карточки — предлагаем выбор: перенести или удалить вместе со страницей
    const others = ch.pages.filter(function (p) { return p.id !== pageId; });
    const opts = others.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + '</option>';
    }).join('');
    openModal(App.t('deletePage'),
      '<p class="confirm-text">' + esc(App.tf('confirmDeletePage', { name: page.name })) + '</p>' +
      '<div class="field check"><input id="f-movecards" type="checkbox" checked><label for="f-movecards">' + esc(App.t('moveCards')) + '</label></div>' +
      '<div class="field" id="f-movetarget"><label>' + esc(App.t('moveToPage')) + '</label><select id="f-target">' + opts + '</select></div>' +
      '<div class="field" id="f-deletecards" style="display:none"><span class="meta">' + esc(App.t('cardsWillDelete')) + '</span></div>',
      [
        { label: App.t('cancel') },
        { label: App.t('delete'), cls: 'danger', onClick: function () {
            const move = readCheck('f-movecards');
            const cb = document.getElementById('f-movecards');
            const target = (cb && cb.checked) ? document.getElementById('f-target').value : null;
            doDeletePage(pageId, move ? target : null);
          } }
      ]
    );
    const cb = document.getElementById('f-movecards');
    const upd = function () {
      const on = cb.checked;
      document.getElementById('f-movetarget').style.display = on ? '' : 'none';
      document.getElementById('f-deletecards').style.display = on ? 'none' : '';
    };
    cb.addEventListener('change', upd);
    upd();
  }
  function doDeletePage(pageId, targetPageId) {
    const ch = activeChar();
    if (!ch) return;
    mutate(function () {
      const idx = ch.pages.findIndex(function (p) { return p.id === pageId; });
      if (idx < 0) return;
      if (targetPageId) {
        ch.cards.forEach(function (c) { if (c.page === pageId) c.page = targetPageId; });
      } else {
        ch.cards = ch.cards.filter(function (c) { return c.page !== pageId; });
      }
      ch.pages.splice(idx, 1);
      if (targetPageId) ch.lastPage = targetPageId;
      ensurePages(ch);
      if (!ch.pages.some(function (p) { return p.id === ch.lastPage; })) ch.lastPage = ch.pages[0].id;
    });
    toast(App.t('pageDeleted'));
  }
  function renderTabs() {
    const bar = document.getElementById('pageTabs');
    const ch = activeChar();
    if (!ch) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
    ensurePages(ch);
    bar.classList.remove('hidden');
    const tabs = ch.pages.map(function (p) {
      return '<button class="ptab' + (p.id === ch.lastPage ? ' active' : '') + '" data-page="' + p.id + '">' + esc(p.name) + '</button>';
    }).join('');
    const ctrl =
      '<span class="pt-ctrl">' +
      '<button class="icon" id="pt-add" title="' + esc(App.t('addPage')) + '">+</button>' +
      (editMode ? '<button class="icon" id="pt-rename" title="' + esc(App.t('renamePage')) + '">✎</button>' : '') +
      (editMode && ch.pages.length > 1 ? '<button class="icon danger" id="pt-delete" title="' + esc(App.t('deletePage')) + '">✕</button>' : '') +
      '</span>';
    bar.innerHTML = tabs + ctrl;
    bar.querySelectorAll('.ptab').forEach(function (b) {
      b.addEventListener('click', function () { ch.lastPage = b.dataset.page; commit(); });
    });
    bar.querySelector('#pt-add').addEventListener('click', function () {
      mutate(function () {
        const p = { id: uid(), name: defaultPageName(ch) };
        ch.pages.push(p);
        ch.lastPage = p.id;
      });
    });
    if (editMode) {
      bar.querySelector('#pt-rename').addEventListener('click', openPageRename);
      const del = bar.querySelector('#pt-delete');
      if (del) del.addEventListener('click', function () { deletePage(ch.lastPage); });
    }
  }
  function findCard(cardId) {
    const ch = activeChar();
    return ch ? ch.cards.find(function (c) { return c.id === cardId; }) : null;
  }
  function findCardByName(name) {
    const ch = activeChar();
    if (!ch) return null;
    return ch.cards.find(function (c) { return c.name === name; }) || null;
  }
  function isNameUsed(name, exceptId) {
    const ch = activeChar();
    if (!ch) return false;
    return ch.cards.some(function (c) { return c.name === name && c.id !== exceptId; });
  }

  function typeLabelKey(type) { return 'type' + type.charAt(0).toUpperCase() + type.slice(1); }
  function typeLabel(type) { return App.t(typeLabelKey(type)); }

  function defaultsFor(type) {
    switch (type) {
      case 'counter': return { current: 0, max: 0, bonus: '', die: null, restores: false };
      case 'skill': return { die: 20, bonus: '' };
      case 'stat': return { value: 0, bonus: '', die: null };
      case 'formula': return { expression: '', bonus: '', die: null };
      case 'spell': return { description: '', charges: { mode: 'own', current: 0, max: 0, linkId: null, cost: 1, blockEmpty: false }, die: null, bonus: '', restores: false };
      case 'currency': return {
        units: [
          { id: uid(), name: 'Серебро', base: 1 },
          { id: uid(), name: 'Золото', base: 10 },
          { id: uid(), name: 'Платина', base: 10 }
        ], amounts: {}, autoconvert: true
      };
      case 'perk': return { description: '', charges: { mode: 'own', current: 0, max: 0, linkId: null, cost: 1, blockEmpty: false }, restores: false };
      case 'inventory': return { items: [], showWeight: true };
      case 'note': return { text: '' };
    }
    return {};
  }

  function createCard(type, name, extra) {
    return Object.assign({ id: uid(), type: type, name: name, ui: { bg: '', color: '', align: '', bold: false, italic: false } }, defaultsFor(type), extra || {});
  }

  function defaultCardName(type) {
    const base = typeLabel(type);
    let name = base;
    let i = 2;
    while (isNameUsed(name)) { name = base + ' ' + i; i++; }
    return name;
  }

  function defaultSize(type) {
    switch (type) {
      case 'note': return { w: 300, h: 220 };
      case 'inventory': return { w: 300, h: 200 };
      case 'currency': return { w: 300, h: 170 };
      case 'spell': return { w: 300, h: 175 };       // описание 2 строки + заряды
      case 'perk': return { w: 300, h: 200 };
      case 'skill': return { w: 300, h: 90 };        // тело пустое: только шапка с кубиком
      case 'stat': return { w: 300, h: 105 };        // шапка + строка значения
      case 'formula': return { w: 300, h: 120 };     // шапка + выражение + значение
      default: return { w: 300, h: 120 };            // counter: шапка + строка счётчика
    }
  }
  // жёсткий минимум: чтобы содержимое карточки не обрезалось при сжатии.
  // Зависит от содержимого: валюты растут от числа единиц, инвентарь — от числа предметов.
  // Вариант F: бросок переехал в шапку, зоны результата нет — высоты заметно ниже, минимум 220.
  function minSize(card) {
    const type = card.type;
    let w = MIN_W, h = MIN_H;
    if (type === 'counter') h = 100;            // шапка + строка счётчика
    if (type === 'stat') h = 95;                // шапка + значение
    if (type === 'skill') h = 75;               // тело пустое: только шапка
    if (type === 'formula') h = 120;            // шапка + выражение (может перенестись) + значение
    if (type === 'spell') h = 125;              // описание 2 строки + заряды
    if (type === 'perk') h = 120;               // описание 2 строки + заряды
    if (type === 'inventory') {                 // предметы + строка итога веса
      const n = (card.items || []).length;
      h = Math.max(h, 62 + n * 30 + 22);        // 2 строки описания в предмете тоже учтены сверху (30/строка может не хватить — проверяется тестом)
    }
    if (type === 'currency') {                  // каждая валюта — строка ~28px
      const n = Math.max(2, (card.units || []).length);
      h = Math.max(h, 64 + n * 28);
    }
    return { w: w, h: h };
  }

  function autoPlace(ch, card) {
    const margin = 16, gap = 14;
    const size = (card.w && card.h) ? { w: card.w, h: card.h } : defaultSize(card.type);
    const vw = window.innerWidth || 1200;
    const cols = Math.max(1, Math.floor((vw - margin * 2 + gap) / (size.w + gap)));
    const colBottom = [], colX = [];
    for (let i = 0; i < cols; i++) { colBottom[i] = margin; colX[i] = margin + i * (size.w + gap); }
    ch.cards.forEach(function (c) {
      if (c === card || c.x == null || c.page !== card.page) return;
      let col = Math.round((c.x - margin) / (size.w + gap));
      col = Math.max(0, Math.min(cols - 1, col));
      colBottom[col] = Math.max(colBottom[col], (c.y || margin) + (c.h || size.h) + gap);
    });
    let idx = 0;
    for (let i = 1; i < cols; i++) if (colBottom[i] < colBottom[idx]) idx = i;
    card.x = colX[idx];
    card.y = colBottom[idx];
    card.w = size.w;
    card.h = size.h;
  }

  function layoutCharacter(ch) {
    if (!ch) return;
    ensurePages(ch);
    ch.cards.forEach(function (card) {
      if (card.x == null || card.y == null) autoPlace(ch, card);
      const mn = minSize(card);
      card.w = card.w == null ? defaultSize(card.type).w : Math.max(mn.w, card.w);
      card.h = card.h == null ? defaultSize(card.type).h : Math.max(mn.h, card.h);
    });
  }

  function sizeCanvas() {
    const canvas = document.getElementById('canvas');
    if (!canvas) return;
    let maxX = 0, maxY = 0;
    const ch = activeChar();
    if (ch) {
      const pageId = curPageId(ch);
      ch.cards.forEach(function (c) {
        if (c.x == null || c.page !== pageId) return;
        maxX = Math.max(maxX, c.x + c.w + 16);
        maxY = Math.max(maxY, c.y + c.h + 16);
      });
    }
    const vw = window.innerWidth - 28;
    const vh = window.innerHeight - 60;
    canvas.style.width = Math.max(maxX, vw) + 'px';
    canvas.style.height = Math.max(maxY, vh) + 'px';
  }

  function defaultCards() {
    const cards = [];
    cards.push(createCard('counter', 'Здоровье', { current: 10, max: 10, restores: true }));
    cards.push(createCard('counter', 'Мана', { current: 5, max: 5, restores: true }));
    cards.push(createCard('counter', 'Броня', { current: 10, max: null }));
    cards.push(createCard('counter', 'Временные HP', { current: 0, max: 0 }));
    cards.push(createCard('counter', 'Кости хитов', { current: 4, max: 4, die: 8, restores: true }));
    cards.push(createCard('counter', 'Спасброски: успехи', { current: 0, max: 3 }));
    cards.push(createCard('counter', 'Спасброски: провалы', { current: 0, max: 3 }));
    cards.push(createCard('currency', 'Деньги', {}));
    return cards;
  }

  function newCharacter(name) {
    const id = uid();
    const ch = { id: id, name: name || App.t('newCharName'), cards: defaultCards() };
    layoutCharacter(ch);
    state.characters.push(ch);
    state.activeCharacterId = id;
  }

  // ===== Formulas =====
  function chargesCurrent(card) {
    const ch = card.charges || {};
    if (ch.mode === 'link') {
      const t = findCard(ch.linkId);
      return t && t.type === 'counter' ? num(t.current) : 0;
    }
    return num(ch.current);
  }
  function cardBonus(card) {
    if (card.bonus == null || String(card.bonus).trim() === '') return 0;
    try { return App.formula.evaluateArithmetic(String(card.bonus)); }
    catch (e) { return 0; }
  }
  function cardValue(card) {
    switch (card.type) {
      case 'counter': return num(card.current);
      case 'stat': return num(card.value);
      case 'formula': return evalFormula(card.id);
      case 'spell': case 'perk': return chargesCurrent(card);
      default: return 0;
    }
  }

  function evalFormula(cardId) {
    if (formulaMemo[cardId] !== undefined) return formulaMemo[cardId];
    const card = findCard(cardId);
    if (!card || card.type !== 'formula') throw new Error('not a formula');
    if (formulaVisiting.has(cardId)) { const e = new Error('cycle'); e.cycle = true; throw e; }
    formulaVisiting.add(cardId);
    const resolveRef = function (name, part) {
      const target = findCardByName(name);
      if (!target) throw new Error(name);
      return part === 'bonus' ? cardBonus(target) : cardValue(target);
    };
    const val = App.formula.evaluate(card.expression || '0', resolveRef);
    formulaVisiting.delete(cardId);
    formulaMemo[cardId] = val;
    return val;
  }

  function computeFormulas() {
    formulaMemo = {};
    formulaVisiting = new Set();
    const ch = activeChar();
    if (!ch) return;
    ch.cards.forEach(function (c) {
      if (c.type === 'formula') {
        try {
          c._value = evalFormula(c.id);
          c._error = null;
        } catch (e) {
          c._error = (e && e.cycle) ? App.t('cycleError') : (App.t('brokenRef') + ': ' + (e.message || ''));
          c._value = null;
        }
      }
    });
  }

  // ===== Currency =====
  function normalizeCurrency(card) {
    if (!card.autoconvert) return;
    const units = card.units || [];
    for (let i = 0; i < units.length - 1; i++) {
      const rate = num(units[i + 1].base);
      if (rate > 1 && Number.isInteger(rate)) {
        const a = num(card.amounts[units[i].id]);
        if (a >= rate) {
          const carry = Math.floor(a / rate);
          card.amounts[units[i].id] = a - carry * rate;
          card.amounts[units[i + 1].id] = num(card.amounts[units[i + 1].id]) + carry;
        }
      }
    }
  }

  // ===== Dice / rolling =====
  function animOn() {
    return state.settings && state.settings.diceAnimation !== false &&
      !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function popOnce(el, cls) {
    if (!el || !el.classList) return;
    el.classList.remove(cls);
    void el.offsetWidth;             // перезапуск CSS-анимации
    el.classList.add(cls);
    el.addEventListener('animationend', function () { el.classList.remove(cls); }, { once: true });
  }
  // «прокрутка» циферы итога: случайные значения, затем реальный результат + подскок
  function animateTotal(totalEl, target) {
    let ticks = 0;
    const top = Math.max(target, 6);
    const timer = setInterval(function () {
      ticks++;
      if (!totalEl.isConnected || ticks > 9) {
        clearInterval(timer);
        totalEl.textContent = target;
        popOnce(totalEl, 'dw-pop');
        return;
      }
      totalEl.textContent = 1 + Math.floor(Math.random() * top);
    }, 45);
  }
  function logRoll(text) {
    state.log.unshift({ ts: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), text: text });
    if (state.log.length > 100) state.log.length = 100;
  }
  // ===== Вариант F: результат броска — тост по центру экрана =====
  // Последний бросок перезаписывает предыдущий (очереди нет: серия бросков видна последним итогом).
  // История остаётся в журнале бросков, на карточке результата нет.
  let rollToastTimer = null;
  let rollToastHideTimer = null;
  function showRollToast(rolled, bonus, total) {
    let host = document.getElementById('rollToast');
    if (!host) {
      host = document.createElement('div');
      host.id = 'rollToast';
      document.body.appendChild(host);
    }
    clearInterval(rollToastTimer);
    clearTimeout(rollToastHideTimer);
    // перезапись с анимацией только при реальном броске (и если анимации включены)
    host.innerHTML = bonus
      ? '<div class="rt-row"><span class="rt-die">' + rolled + '</span><span class="rt-bonus">' + (bonus > 0 ? '+' : '−') + Math.abs(bonus) + '</span><span class="rt-eq">=</span><span class="rt-total">' + total + '</span></div>'
      : '<div class="rt-row"><span class="rt-total">' + total + '</span></div>';
    host.classList.remove('rt-hide');
    if (animOn()) popOnce(host, 'rt-pop');
    rollToastTimer = setTimeout(function () { host.classList.add('rt-hide'); }, 1800);
    rollToastHideTimer = setTimeout(function () { host.innerHTML = ''; }, 2200);
  }
  function rollCard(card) {
    if (!card.die) return;
    const bonus = cardBonus(card);
    const dieRoll = App.dice.roll(card.die);
    const total = dieRoll + bonus;
    const detail = dieLabel(card.die) + bonusStr(bonus);
    const text = card.name + ' (' + detail + '): ' + dieRoll + (bonus ? (bonus > 0 ? ' + ' : ' − ') + Math.abs(bonus) + ' = ' + total : '');
    logRoll(text);
    commit();
    showRollToast(dieRoll, bonus, total);
  }

  // ===== Card actions =====
  function useCharge(card) {
    const ch = card.charges || {};
    if (ch.mode === 'link') {
      const target = findCard(ch.linkId);
      if (!target || target.type !== 'counter') return;
      const cost = num(ch.cost) || 1;
      if (ch.blockEmpty && num(target.current) < cost) { toast(App.t('insufficient')); return; }
      mutate(function () { target.current = num(target.current) - cost; });
      return;
    }
    if (ch.blockEmpty && num(ch.current) <= 0) { toast(App.t('insufficient')); return; }
    mutate(function () { ch.current = num(ch.current) - 1; });
  }

  function handleAction(cardId, ds, e) {
    const card = findCard(cardId);
    if (!card) return;
    const act = ds.act;
    if (act === 'inc') mutate(function () { card.current = num(card.current) + 1; });
    else if (act === 'dec') mutate(function () { card.current = num(card.current) - 1; });
    else if (act === 'custom-inc') openQuickDelta(card, 1, e && e.currentTarget);
    else if (act === 'custom-dec') openQuickDelta(card, -1, e && e.currentTarget);
    else if (act === 'roll') rollCard(card);
    else if (act === 'use') useCharge(card);
    else if (act === 'curr-inc') mutate(function () { card.amounts[ds.unit] = num(card.amounts[ds.unit]) + 1; normalizeCurrency(card); });
    else if (act === 'curr-dec') mutate(function () { card.amounts[ds.unit] = num(card.amounts[ds.unit]) - 1; });
    else if (act === 'curr-custom-inc') openCurrencyDelta(card, ds.unit, 1, e && e.currentTarget);
    else if (act === 'curr-custom-dec') openCurrencyDelta(card, ds.unit, -1, e && e.currentTarget);
    else if (act === 'item-del') mutate(function () { card.items = card.items.filter(function (i) { return i.id !== ds.item; }); });
  }

  // ===== Ввод своего значения (маленькие ++/−−) =====
  // Плавающее окно возле нажатой кнопки: ничего на карточке не сдвигается.
  // (Замена значения полем обсуждалась и отвергнута — остаётся только поповер.)
  let deltaActive = null;   // функция принудительного закрытия открытого окна
  function closeDeltaInput() {
    if (!deltaActive) return;
    const fn = deltaActive;
    deltaActive = null;
    fn();
  }
  // Плавающее окно: позиционируется под нажатой кнопкой, зажимается в границах карточки
  function deltaPop(anchor, sign, applyFn) {
    if (!anchor) return;
    closeDeltaInput();
    const cardEl = anchor.closest('.card');
    if (!cardEl) return;
    const pop = document.createElement('div');
    pop.className = 'delta-pop';
    pop.innerHTML =
      '<span class="dp-sign">' + (sign > 0 ? '+' : '−') + '</span>' +
      '<input type="number" class="delta-pop-in" placeholder="0">' +
      '<button type="button" class="small primary dp-ok" title="OK">✓</button>' +
      '<button type="button" class="small dp-no" title="' + esc(App.t('cancel')) + '">✕</button>';
    cardEl.appendChild(pop);
    const inp = pop.querySelector('input');
    let done = false;
    const detach = function () {
      document.removeEventListener('pointerdown', onDoc, true);
      pop.remove();
      deltaActive = null;
    };
    const apply = function () {
      if (done) return;
      done = true;
      const v = num(inp.value);
      detach();
      if (v) mutate(function () { applyFn(v); });
    };
    const onDoc = function (e) {          // клик мимо окна = отмена (без записи)
      if (pop.contains(e.target)) return;
      done = true;
      detach();
    };
    deltaActive = function () { done = true; detach(); };
    pop.querySelector('.dp-ok').addEventListener('click', apply);
    pop.querySelector('.dp-no').addEventListener('click', function () { done = true; detach(); });
    document.addEventListener('pointerdown', onDoc, true);
    inp.addEventListener('click', function (e) { e.stopPropagation(); });
    inp.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') apply();
      else if (e.key === 'Escape') { done = true; detach(); }
    });
    // позиция: считаем после вставки в DOM
    const cr = cardEl.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    pop.style.visibility = 'hidden';
    requestAnimationFrame(function () {
      if (done) return;
      const pr = pop.getBoundingClientRect();
      let left = (ar.left - cr.left) + ar.width / 2 - pr.width / 2;
      left = Math.max(4, Math.min(cardEl.clientWidth - pr.width - 4, left));
      let top = (ar.bottom - cr.top) + 6;
      if (top + pr.height > cr.height) top = (ar.top - cr.top) - pr.height - 6;
      if (top < 4) top = 4;
      pop.style.left = Math.round(left) + 'px';
      pop.style.top = Math.round(top) + 'px';
      pop.style.visibility = '';
      inp.focus();
    });
  }
  function openQuickDelta(card, sign, anchor) {
    const row = document.querySelector('.card[data-id="' + card.id + '"] .counter-row');
    if (!row) return;
    anchor = anchor || row.querySelector(sign > 0 ? '.counter-more.plus' : '.counter-more.minus');
    if (!anchor) return;
    deltaPop(anchor, sign, function (v) { card.current = num(card.current) + v; });
  }
  function openCurrencyDelta(card, unitId, sign, anchor) {
    const row = document.querySelector('.card[data-id="' + card.id + '"] .currency-row[data-unit="' + unitId + '"]');
    if (!row) return;
    anchor = anchor || row.querySelector(sign > 0 ? '.counter-more.plus' : '.counter-more.minus');
    if (!anchor) return;
    deltaPop(anchor, sign, function (v) {
      card.amounts[unitId] = num(card.amounts[unitId]) + v;
      normalizeCurrency(card);
    });
  }

  function moveCard(cardId, dir) {
    const ch = activeChar();
    if (!ch) return;
    mutate(function () {
      const idx = ch.cards.findIndex(function (c) { return c.id === cardId; });
      const newIdx = idx + dir;
      if (idx < 0 || newIdx < 0 || newIdx >= ch.cards.length) return;
      const arr = ch.cards;
      const item = arr.splice(idx, 1)[0];
      arr.splice(newIdx, 0, item);
    });
  }

  function duplicateCard(cardId) {
    const ch = activeChar();
    const card = findCard(cardId);
    if (!ch || !card) return;
    mutate(function () {
      const copy = JSON.parse(JSON.stringify(card));
      copy.id = uid();
      delete copy._value; delete copy._error;
      let base = card.name, i = 2, nm = base;
      while (ch.cards.some(function (c) { return c.name === nm; })) { nm = base + ' (' + i + ')'; i++; }
      copy.name = nm;
      if (copy.type === 'currency' && copy.units) {
        const umap = {};
        copy.units.forEach(function (u) { const nu = uid(); umap[u.id] = nu; u.id = nu; });
        const na = {};
        for (const k in copy.amounts) if (umap[k]) na[umap[k]] = copy.amounts[k];
        copy.amounts = na;
      }
      if (copy.type === 'inventory' && copy.items) copy.items.forEach(function (it) { it.id = uid(); });
      if (copy.x != null) { copy.x += 24; copy.y += 24; }
      ch.cards.push(copy);
    });
  }

  function deleteCard(cardId) {
    const ch = activeChar();
    const card = findCard(cardId);
    if (!ch || !card) return;
    const refs = ch.cards.filter(function (c) { return c.type === 'formula' && App.formula.hasRef(c.expression || '', card.name); });
    if (refs.length) {
      confirmDialog(App.t('referencedBy') + ' ' + refs.map(function (r) { return r.name; }).join(', '), function () { doDeleteCard(cardId); });
    } else {
      confirmDialog(App.tf('confirmDeleteCard', { name: card.name }), function () { doDeleteCard(cardId); });
    }
  }
  function doDeleteCard(cardId) {
    const ch = activeChar();
    if (!ch) return;
    mutate(function () { ch.cards = ch.cards.filter(function (c) { return c.id !== cardId; }); });
  }

  function doRest() {
    const ch = activeChar();
    if (!ch) return;
    mutate(function () {
      ch.cards.forEach(function (c) {
        if (!c.restores) return;
        if (c.type === 'counter') {
          c.current = (c.max == null) ? 0 : num(c.max);
        } else if ((c.type === 'spell' || c.type === 'perk') && c.charges && c.charges.mode === 'own') {
          c.charges.current = (c.charges.max == null) ? 0 : num(c.charges.max);
        }
      });
    });
    toast(App.t('restApplied'));
  }

  // ===== Undo / redo =====
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    const s = undoStack.pop();
    state.characters = s.characters;
    state.activeCharacterId = s.activeCharacterId;
    save(); render();
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    const s = redoStack.pop();
    state.characters = s.characters;
    state.activeCharacterId = s.activeCharacterId;
    save(); render();
  }

  // ===== Rendering =====
  function render() {
    renderHeader();
    renderTabs();
    renderCanvas();
    renderLog();
    updateFab();
  }
  function updateFab() {
    document.getElementById('fab').classList.toggle('hidden', !editMode || !activeChar());
  }

  function renderHeader() {
    const bar = document.getElementById('topbar');
    bar.innerHTML =
      '<div class="brand">🎲 <span class="accent">' + esc(App.t('appName')) + '</span></div>' +
      '<div class="top-controls">' +
        '<button class="icon" id="restBtn" title="' + esc(App.t('rest')) + '">☾</button>' +
        '<button class="icon" id="diceBtn" title="' + esc(App.t('dice')) + '">⚄</button>' +
        '<button class="icon" id="logBtn" title="' + esc(App.t('log')) + '">☰</button>' +
        '<button class="icon" id="undoBtn" title="' + esc(App.t('undo')) + '">↶</button>' +
        '<button class="icon" id="redoBtn" title="' + esc(App.t('redo')) + '">↷</button>' +
        '<button class="icon" id="settingsBtn" title="' + esc(App.t('settings')) + '">⚙</button>' +
        '<button class="icon" id="editModeBtn" title="' + esc(App.t('editMode')) + '">' + (editMode ? '✓' : '🖉') + '</button>' +
      '</div>';

    document.getElementById('restBtn').addEventListener('click', doRest);
    document.getElementById('diceBtn').addEventListener('click', toggleDiceWidget);
    document.getElementById('logBtn').addEventListener('click', toggleLog);
    document.getElementById('undoBtn').addEventListener('click', undo);
    document.getElementById('redoBtn').addEventListener('click', redo);
    document.getElementById('settingsBtn').addEventListener('click', openSettings);
    document.getElementById('editModeBtn').addEventListener('click', toggleEditMode);
  }

  function toggleEditMode() {
    editMode = !editMode;
    render();
  }

  function renderCanvas() {
    const canvas = document.getElementById('canvas');
    const ch = activeChar();
    const desktop = isDesktop();
    canvas.classList.toggle('free', desktop);
    if (!ch) {
      canvas.innerHTML = '<div class="empty-hint">' + esc(App.t('noChars')) + '</div>';
      canvas.style.width = ''; canvas.style.height = '';
      return;
    }
    const pageId = curPageId(ch);
    const visible = ch.cards.filter(function (c) { return c.page === pageId; });
    if (!visible.length) {
      canvas.innerHTML = '<div class="empty-hint">' + esc(App.t('emptyCanvas')) + '</div>';
      canvas.style.width = ''; canvas.style.height = '';
      return;
    }
    canvas.innerHTML = visible.map(function (c) { return cardView(c, desktop); }).join('');
    visible.forEach(bindCard);
    if (desktop) sizeCanvas();
    else { canvas.style.width = ''; canvas.style.height = ''; }
  }

  function cardUIStyle(card) {
    const ui = card.ui || {};
    let s = '';
    if (ui.bg) s += 'background:' + ui.bg + ';';
    if (ui.color) s += 'color:' + ui.color + ';';
    if (ui.align) s += 'text-align:' + ui.align + ';';
    if (ui.bold) s += 'font-weight:bold;';
    if (ui.italic) s += 'font-style:italic;';
    return s;
  }

  function cardView(card, desktop) {
    const broken = (card.type === 'formula' && card._error) ? ' broken' : '';
    let style = '';
    if (desktop && card.x != null) {
      style += 'left:' + Math.round(card.x) + 'px;top:' + Math.round(card.y) + 'px;width:' + Math.round(card.w) + 'px;height:' + Math.round(card.h) + 'px;';
    }
    style += cardUIStyle(card);
    const resize = (editMode && desktop) ? '<span class="resize-handle" title="↘"></span>' : '';
    return '<div class="card type-' + card.type + broken + '" data-id="' + card.id + '" style="' + style + '">' + cardHead(card, desktop) + cardBody(card) + resize + '</div>';
  }

  function cardHead(card, desktop) {
    const tools = editMode ?
      '<div class="tools">' +
        (desktop ? '' : '<button class="card-up" title="↑">▲</button><button class="card-down" title="↓">▼</button>') +
        '<button class="card-edit" title="' + esc(App.t('edit')) + '">✎</button>' +
        '<button class="card-dup" title="' + esc(App.t('duplicate')) + '">⧉</button>' +
        '<button class="card-del" title="' + esc(App.t('delete')) + '">✕</button>' +
      '</div>' : '';
    const handle = (editMode && desktop) ? '<span class="handle" title="⋮⋮">⋮⋮</span>' : '';
    // вариант F: кубик в шапке + тег бонуса. В режиме правки НЕ показываем (в правке не бросают) —
    // иначе тулзы (✎⧉✕) не влезают на минимальной ширине
    let roller = '';
    if (card.die && !editMode) {
      const b = cardBonus(card);
      roller = '<button class="headroll" data-act="roll" title="' + esc(App.t('roll')) + ' ' + esc(dieLabel(card.die)) + '">' + esc(dieLabel(card.die)) + '</button>' +
        (b ? '<span class="inc">' + (b > 0 ? '+' : '−') + Math.abs(b) + '</span>' : '');
    }
    return '<div class="card-head">' + handle + '<span class="card-name">' + (card.restores ? '<span class="restore-ic">☾</span>' : '') + esc(card.name) + '</span>' + roller + tools + '</div>';
  }

  function cardBody(card) {
    switch (card.type) {
      case 'counter': return counterBody(card);
      case 'skill': return skillBody(card);
      case 'stat': return statBody(card);
      case 'formula': return formulaBody(card);
      case 'spell': return spellBody(card);
      case 'currency': return currencyBody(card);
      case 'perk': return perkBody(card);
      case 'inventory': return inventoryBody(card);
      case 'note': return noteBody(card);
    }
    return '';
  }

  function counterBody(card) {
    const cur = num(card.current);
    const max = card.max == null ? null : num(card.max);
    const over = (max != null && cur > max);
    const under = cur < 0;
    const val = '<span class="counter-val' + (over ? ' over' : '') + (under ? ' under' : '') + '">' + cur + (max != null ? '<small> / ' + max + '</small>' : '') + '</span>';
    return '<div class="card-body">' +
      '<div class="counter-row">' +
        '<div class="cbtn-wrap">' +
          '<button class="counter-btn minus" data-act="dec">−</button>' +
          '<button class="counter-more minus" data-act="custom-dec" title="' + esc(App.t('customValue')) + '">−−</button>' +
        '</div>' +
        val +
        '<div class="cbtn-wrap">' +
          '<button class="counter-btn plus" data-act="inc">+</button>' +
          '<button class="counter-more plus" data-act="custom-inc" title="' + esc(App.t('customValue')) + '">++</button>' +
        '</div>' +
      '</div>' +
      '</div>';
  }

  function skillBody(card) {
    // тело навыка пустое: бросок уехал в шапку (карточка = название + кубик)
    return '';
  }

  function statBody(card) {
    const val = num(card.value);
    const bonus = cardBonus(card);
    return '<div class="card-body"><div class="stat-line"><span class="stat-value' + (val < 0 ? ' under' : '') + '">' + fmt(val) + '</span>' +
      (bonus ? '<span class="stat-bonus">(' + (bonus > 0 ? '+' : '') + bonus + ')</span>' : '') + '</div></div>';
  }

  function formulaBody(card) {
    let valueHtml;
    if (card._error) valueHtml = '<div class="err">' + esc(card._error) + '</div>';
    else valueHtml = '<div class="stat-line"><span class="stat-value">' + fmt(card._value) + '</span></div>';
    return '<div class="card-body"><div class="meta">' + esc(card.expression || '—') + '</div>' + valueHtml + '</div>';
  }

  function pipsString(cur, max) {
    if (max == null || max > 12) return '';
    let s = '';
    for (let i = 0; i < max; i++) s += (i < cur ? '●' : '○');
    return s;
  }

  function chargesInfo(card) {
    const ch = card.charges || {};
    if (ch.mode === 'link') {
      const target = findCard(ch.linkId);
      const nm = target ? target.name : App.t('brokenRef');
      const remain = target && target.type === 'counter' ? num(target.current) : 0;
      const cost = num(ch.cost) || 1;
      return '<div class="charges-row"><span class="meta">' + esc(App.tf('linkedCharges', { name: nm })) + ' · ' + esc(App.t('valueOf')) + ' ' + remain + '</span>' +
        '<button class="small primary use-btn" data-act="use">' + esc(App.t('use')) + (cost !== 1 ? ' (−' + cost + ')' : '') + '</button></div>';
    }
    const cur = num(ch.current);
    const max = ch.max == null ? null : num(ch.max);
    const pips = pipsString(cur, max);
    return '<div class="charges-row"><span class="charges-pips">' + pips + '</span>' +
      '<span class="meta">' + cur + (max != null ? ' / ' + max : '') + '</span>' +
      '<button class="small primary use-btn" data-act="use">' + esc(App.t('use')) + '</button></div>';
  }

  function spellBody(card) {
    return '<div class="card-body">' +
      (card.description ? '<div class="desc-text">' + esc(card.description) + '</div>' : '') +
      chargesInfo(card) + '</div>';
  }

  function perkBody(card) {
    return '<div class="card-body">' +
      (card.description ? '<div class="desc-text">' + esc(card.description) + '</div>' : '') +
      chargesInfo(card) + '</div>';
  }

  function currencyBody(card) {
    const units = card.units || [];
    const rows = units.map(function (u) {
      const amt = num(card.amounts[u.id]);
      return '<div class="currency-row" data-unit="' + u.id + '">' +
        '<span class="cname">' + esc(u.name) + '</span>' +
        '<div class="cbtn-wrap">' +
          '<button class="small" data-act="curr-dec" data-unit="' + u.id + '">−</button>' +
          '<button class="counter-more minus" data-act="curr-custom-dec" data-unit="' + u.id + '" title="' + esc(App.t('customValue')) + '">−−</button>' +
        '</div>' +
        '<span class="amt">' + fmt(amt) + '</span>' +
        '<div class="cbtn-wrap">' +
          '<button class="small" data-act="curr-inc" data-unit="' + u.id + '">＋</button>' +
          '<button class="counter-more plus" data-act="curr-custom-inc" data-unit="' + u.id + '" title="' + esc(App.t('customValue')) + '">++</button>' +
        '</div>' +
        '</div>';
    }).join('');
    return '<div class="card-body">' + (rows || '<div class="meta">—</div>') + '</div>';
  }

  function inventoryBody(card) {
    const items = card.items || [];
    let totalW = 0;
    let hasWeight = false;                      // есть ли хоть у одного предмета указанный вес
    const rows = items.map(function (it) {
      const w = (it.weight == null) ? 0 : num(it.weight);
      totalW += w * num(it.qty);
      if (it.weight != null) hasWeight = true;
      const desc = it.description || '';
  return '<div class="item-row' + (desc ? ' has-desc' : '') + '"' + (desc ? ' data-item="' + it.id + '" title="' + esc(desc) + '"' : '') + '>' +
        '<span class="iname">' + esc(it.name) + (desc ? '<small class="idesc">' + esc(desc) + '</small>' : '') + '</span>' +
        '<span class="iqty">×' + num(it.qty) + '</span>' +
        (card.showWeight && it.weight != null ? '<span class="iwgt">' + fmt(w) + '</span>' : '') +
        (editMode ? '<button class="small" data-act="item-del" data-item="' + it.id + '">✕</button>' : '') +
        '</div>';
    }).join('');
    // итог веса показываем только если вес реально указан (иначе «Вес: 0» только занимал место)
    const total = (card.showWeight && hasWeight) ? '<div class="inv-total">' + esc(App.t('totalWeight')) + ': ' + fmt(totalW) + '</div>' : '';
    return '<div class="card-body">' + (rows || '<div class="meta">—</div>') + total + '</div>';
  }

  function noteBody(card) {
    return '<div class="card-body"><div class="note-text">' + esc(card.text || '') + '</div></div>';
  }

  function bindCard(card) {
    const el = document.querySelector('.card[data-id="' + card.id + '"]');
    if (!el) return;
    el.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { handleAction(card.id, btn.dataset, e); });
    });
    // описание целиком: клик по тексту — модалка «просмотр полностью»
    const desc = el.querySelector('.desc-text');
    if (desc && (card.description || '').trim()) {
      desc.classList.add('readable');
      desc.addEventListener('click', function () { openTextModal(card.name, card.description); });
    }
    // то же для описаний предметов инвентаря
    el.querySelectorAll('.item-row.has-desc').forEach(function (row) {
      const it = (card.items || []).find(function (x) { return x.id === row.dataset.item; });
      if (!it || !(it.description || '').trim()) return;
      const descEl = row.querySelector('.idesc');
      if (!descEl) return;
      descEl.classList.add('readable');
      descEl.addEventListener('click', function (e) { e.stopPropagation(); openTextModal(it.name, it.description); });
    });
    const edit = el.querySelector('.card-edit');
    const dup = el.querySelector('.card-dup');
    const del = el.querySelector('.card-del');
    const up = el.querySelector('.card-up');
    const down = el.querySelector('.card-down');
    if (edit) edit.addEventListener('click', function () { openCardEditor(card.id); });
    if (dup) dup.addEventListener('click', function () { duplicateCard(card.id); });
    if (del) del.addEventListener('click', function () { deleteCard(card.id); });
    if (up) up.addEventListener('click', function () { moveCard(card.id, -1); });
    if (down) down.addEventListener('click', function () { moveCard(card.id, 1); });
  }

  // ===== Free placement (move & resize) =====
  let dragState = null;
  let cardZ = 1;   // счётчик «поднятий» карточки: клик в правке выводит её на передний план
  function initFreePlacement() {
    const canvas = document.getElementById('canvas');
    canvas.addEventListener('pointerdown', function (e) {
      if (!editMode || !isDesktop()) return;
      const cardEl = e.target.closest ? e.target.closest('.card') : null;
      // перекрытия: любой клик по карточке в режиме правки поднимает её наверх (до следующей перерисовки);
      // z растёт ТОЛЬКО до 99, чтобы модалка (z 100/101) всегда была выше - см. fix перекрытия
      if (cardEl) { cardZ = cardZ >= 98 ? 3 : ++cardZ; cardEl.style.zIndex = cardZ; }
      const handle = e.target.closest ? e.target.closest('.handle') : null;
      const resize = e.target.closest ? e.target.closest('.resize-handle') : null;
      if (!handle && !resize) return;
      if (!cardEl) return;
      const card = findCard(cardEl.dataset.id);
      if (!card) return;
      e.preventDefault();
      const mn = minSize(card);
      dragState = {
        id: card.id, type: card.type, el: cardEl, kind: resize ? 'resize' : 'move',
        startX: e.clientX, startY: e.clientY,
        origX: card.x || 0, origY: card.y || 0,
        origW: card.w || 300, origH: card.h || 150,
        minW: mn.w, minH: mn.h
      };
      cardEl.classList.add('dragging');
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (dragState.kind === 'move') {
        dragState.el.style.left = Math.round(dragState.origX + dx) + 'px';
        dragState.el.style.top = Math.round(dragState.origY + dy) + 'px';
      } else {
        dragState.el.style.width = Math.max(dragState.minW, Math.round(dragState.origW + dx)) + 'px';
        dragState.el.style.height = Math.max(dragState.minH, Math.round(dragState.origH + dy)) + 'px';
      }
    });
    window.addEventListener('pointerup', function () {
      if (!dragState) return;
      const card = findCard(dragState.id);
      if (card) {
        const el = dragState.el;
        const nx = parseFloat(el.style.left);
        const ny = parseFloat(el.style.top);
        const nw = parseFloat(el.style.width);
        const nh = parseFloat(el.style.height);
        pushUndo();
        if (dragState.kind === 'move') {
          if (!Number.isNaN(nx)) card.x = Math.round(nx);
          if (!Number.isNaN(ny)) card.y = Math.round(ny);
        } else {
          if (!Number.isNaN(nw)) card.w = Math.max(dragState.minW, Math.round(nw));
          if (!Number.isNaN(nh)) card.h = Math.max(dragState.minH, Math.round(nh));
        }
        commit();
      }
      if (dragState.el) dragState.el.classList.remove('dragging');
      document.body.style.userSelect = '';
      dragState = null;
    });
  }

  // ===== Modals =====
  function openModal(title, bodyHTML, actions) {
    document.getElementById('backdrop').classList.remove('hidden');
    const m = document.getElementById('modal');
    m.classList.remove('hidden');
    m.innerHTML = '<h2>' + esc(title) + '</h2>' + bodyHTML + '<div class="m-actions"></div>';
    const actDiv = m.querySelector('.m-actions');
    (actions || []).forEach(function (a) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.className = a.cls || '';
      btn.addEventListener('click', function () {
        const keepOpen = a.onClick ? (a.onClick() === false) : false;
        if (!keepOpen) closeModal();
      });
      actDiv.appendChild(btn);
    });
  }
  function closeModal() {
    document.getElementById('backdrop').classList.add('hidden');
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('modal').innerHTML = '';
  }

  function confirmDialog(msg, onYes, title) {
    openModal(title || App.t('delete'), '<p class="confirm-text">' + esc(msg) + '</p>', [
      { label: App.t('cancel') },
      { label: App.t('delete'), cls: 'danger', onClick: onYes }
    ]);
  }

  // Полный текст (описание перка/заклинания) отдельным окном
  function openTextModal(title, text) {
    openModal(title || App.t('description'), '<div class="full-text">' + esc(text) + '</div>',
      [{ label: App.t('close'), cls: 'primary' }]);
  }

  // ===== Form helpers =====
  function numField(id, label, value, placeholder) {
    return '<div class="field"><label>' + esc(label) + '</label><input id="' + id + '" type="number" step="1" value="' + (value == null ? '' : value) + '" placeholder="' + esc(placeholder || '0') + '"></div>';
  }
  function bonusField(id, val) {
    return '<div class="field"><label>' + esc(App.t('bonus')) + '</label><input id="' + id + '" type="text" value="' + esc(val == null ? '' : val) + '" placeholder="+2, -3, 2*2, 1/2"></div>';
  }
  // Бонус как галочка: поставил галочку — появилось поле выражения; снял — бонус обнулился
  function bonusToggleFields(val) {
    const has = val != null && String(val).trim() !== '';
    return checkField('f-usebonus', App.t('addBonus'), has) +
      '<div class="field" id="f-bonuswrap"' + (has ? '' : ' style="display:none"') + '">' +
      '<label>' + esc(App.t('bonus')) + '</label>' +
      '<input id="f-bonus" type="text" value="' + esc(val == null ? '' : val) + '" placeholder="+2, -3, 2*2, 1/2"></div>';
  }
  function dieField(id, val) {
    let opts = '<option value=""' + (!val ? ' selected' : '') + '>' + esc(App.t('noDie')) + '</option>';
    App.dice.TYPES.forEach(function (s) {
      opts += '<option value="' + s + '"' + (val === s ? ' selected' : '') + '>d' + s + '</option>';
    });
    return '<div class="field"><label>' + esc(App.t('die')) + '</label><select id="' + id + '">' + opts + '</select></div>';
  }
  function checkField(id, label, checked) {
    return '<div class="field check"><input id="' + id + '" type="checkbox"' + (checked ? ' checked' : '') + '><label for="' + id + '">' + esc(label) + '</label></div>';
  }
  function readNum(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function readDie(id) { const el = document.getElementById(id); const v = el ? el.value : ''; return v === '' ? null : Number(v); }
  function readCheck(id) { const el = document.getElementById(id); return el ? el.checked : false; }
  function readText(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function readNumOrNull(id) { const el = document.getElementById(id); const v = el ? el.value : ''; return v === '' ? null : num(v); }
  // бонус-выражение: читается только если стоит галочка «Добавить бонус» (иначе пусто)
  function readBonus() {
    const cb = document.getElementById('f-usebonus');
    if (cb && !cb.checked) return '';
    return readText('f-bonus').trim();
  }

  function typeFields(card) {
    switch (card.type) {
      case 'counter':
        return numField('f-current', App.t('current'), card.current) +
          numField('f-max', App.t('max'), card.max == null ? '' : card.max, '—') +
          dieField('f-die', card.die) +
          bonusToggleFields(card.bonus) +
          checkField('f-restores', App.t('restores'), !!card.restores);
      case 'skill':
        return dieField('f-die', card.die || 20) + bonusToggleFields(card.bonus);
      case 'stat':
        return numField('f-value', App.t('value'), card.value) + dieField('f-die', card.die) +
          bonusToggleFields(card.bonus);
      case 'formula': return formulaFields(card);
      case 'spell': return spellFields(card);
      case 'currency': return currencyFields(card);
      case 'perk': return perkFields(card);
      case 'inventory': return inventoryFields(card);
      case 'note': return noteFields(card);
    }
    return '';
  }

  function chargesFields(card, showRestores) {
    const ch = card.charges || { mode: 'own' };
    const ch2 = activeChar();
    const counters = ch2.cards.filter(function (c) { return c.type === 'counter' && c.id !== card.id; });
    const linkOpts = counters.map(function (c) {
      return '<option value="' + c.id + '"' + (ch.linkId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');
    let html = '<div class="field"><label>' + esc(App.t('charges')) + '</label>' +
      '<select id="f-chmode">' +
      '<option value="own"' + (ch.mode !== 'link' ? ' selected' : '') + '>' + esc(App.t('chargesOwn')) + '</option>' +
      '<option value="link"' + (ch.mode === 'link' ? ' selected' : '') + '>' + esc(App.t('chargesLink')) + '</option>' +
      '</select></div>';
    html += '<div class="field" id="f-chownwrap"><label>' + esc(App.t('current')) + '</label><input id="f-chcur" type="number" value="' + num(ch.current) + '" placeholder="0"></div>';
    html += '<div class="field" id="f-chownwrap2"><label>' + esc(App.t('max')) + '</label><input id="f-chmax" type="number" value="' + (ch.max == null ? '' : ch.max) + '" placeholder="3"></div>';
    html += '<div class="field" id="f-chlinkwrap"><label>' + esc(App.t('linkTo')) + '</label><select id="f-chlink">' + linkOpts + '</select></div>';
    html += '<div class="field" id="f-chcostwrap"><label>' + esc(App.t('costPerUse')) + '</label><input id="f-chcost" type="number" value="' + (num(ch.cost) || 1) + '" placeholder="1"></div>';
    html += '<div class="field check" id="f-chblockwrap"><input id="f-chblock" type="checkbox"' + (ch.blockEmpty ? ' checked' : '') + '><label for="f-chblock">' + esc(App.t('blockEmpty')) + '</label></div>';
    if (showRestores) html += checkField('f-restores', App.t('restores'), !!card.restores);
    return html;
  }

  function formulaFields(card) {
    editScratch.tokens = tokenizeFormula(card.expression || '');
    editScratch.formulaCard = card;
    const ch = activeChar();
    const refOpts = ch.cards.filter(function (c) { return c.id !== card.id; }).map(function (c) {
      return '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>';
    }).join('');
    return '<div class="field"><label>' + esc(App.t('expression')) + '</label>' +
      '<div class="f-tokens" id="f-tokens"></div>' +
      '<div class="f-buttons">' +
        '<button type="button" class="small f-op" data-op="+">+</button>' +
        '<button type="button" class="small f-op" data-op="-">−</button>' +
        '<button type="button" class="small f-op" data-op="*">×</button>' +
        '<button type="button" class="small f-op" data-op="/">÷</button>' +
        '<button type="button" class="small f-op" data-op="(">(</button>' +
        '<button type="button" class="small f-op" data-op=")">)</button>' +
        '<button type="button" class="small f-op" data-op="num">' + esc(App.t('number')) + '</button>' +
      '</div>' +
      '<div class="f-refadd"><select id="f-newref">' + refOpts + '</select>' +
      '<button type="button" class="small" id="f-addref">+ ' + esc(App.t('addParam')) + '</button></div>' +
      '<div class="f-preview" id="f-preview">= —</div>' +
      '<div class="formula-help">' + esc(App.t('formulaTip')) + '</div>' +
      '</div>' +
      dieField('f-die', card.die) +
      bonusToggleFields(card.bonus);
  }

  function spellFields(card) {
    return '<div class="field"><label>' + esc(App.t('description')) + '</label><textarea id="f-desc" placeholder="' + esc(App.t('description')) + '…">' + esc(card.description || '') + '</textarea></div>' +
      chargesFields(card, true) +
      dieField('f-die', card.die) +
      bonusToggleFields(card.bonus);
  }

  function perkFields(card) {
    return '<div class="field"><label>' + esc(App.t('description')) + '</label><textarea id="f-desc" placeholder="' + esc(App.t('description')) + '…">' + esc(card.description || '') + '</textarea></div>' +
      chargesFields(card, true);
  }

  function noteFields(card) {
    return '<div class="field"><label>' + esc(App.t('text')) + '</label><textarea id="f-text" style="min-height:160px" placeholder="' + esc(App.t('text')) + '…">' + esc(card.text || '') + '</textarea></div>';
  }

  function currencyFields(card) {
    editScratch.units = JSON.parse(JSON.stringify(card.units || []));
    return '<div class="field"><label>' + esc(App.t('units')) + '</label>' +
      '<div class="sublist" id="f-units"></div>' +
      '<button type="button" class="small" id="f-addunit">+ ' + esc(App.t('addUnit')) + '</button>' +
      '<div class="formula-help">' + esc(App.t('currencyHint')) + '</div></div>' +
      checkField('f-autoconv', App.t('autoconvert'), !!card.autoconvert);
  }

  function inventoryFields(card) {
    editScratch.items = JSON.parse(JSON.stringify(card.items || []));
    return '<div class="field"><label>' + esc(App.t('items')) + '</label>' +
      '<div class="sublist" id="f-items"></div>' +
      '<button type="button" class="small" id="f-additem">+ ' + esc(App.t('addItem')) + '</button></div>' +
      checkField('f-showweight', App.t('totalWeight'), !!card.showWeight);
  }

  function appearanceFields(card) {
    const ui = card.ui || {};
    const aligns = [['left', '⇤'], ['center', '⇔'], ['right', '⇥']];
    const alignBtns = aligns.map(function (a) {
      return '<button type="button" class="small ui-align' + (editScratch.uiAlign === a[0] ? ' active' : '') + '" data-v="' + a[0] + '" title="' + a[0] + '">' + a[1] + '</button>';
    }).join('');
    return '<div class="field"><label>' + esc(App.t('appearance')) + '</label>' +
      '<div class="app-grid">' +
        '<span class="app-lab">' + esc(App.t('background')) + '</span><input type="color" id="ui-bg" value="' + (ui.bg || '#232334') + '">' +
        '<span class="app-lab">' + esc(App.t('textColor')) + '</span><input type="color" id="ui-color" value="' + (ui.color || '#e8e6f0') + '">' +
        '<span class="app-lab">' + esc(App.t('alignment')) + '</span><span class="app-aligns">' + alignBtns + '</span>' +
        '<span class="app-lab">' + esc(App.t('bold')) + '</span><input type="checkbox" id="ui-bold"' + (ui.bold ? ' checked' : '') + '>' +
        '<span class="app-lab">' + esc(App.t('italic')) + '</span><input type="checkbox" id="ui-italic"' + (ui.italic ? ' checked' : '') + '>' +
      '</div></div>';
  }

  function bindCurrencyEditor() {
    const container = document.getElementById('f-units');
    const units = editScratch.units;
    function renderUnits() {
      container.innerHTML = units.map(function (u, i) {
        return '<div class="srow" data-i="' + i + '">' +
          '<button type="button" class="small u-up" title="↑">▲</button>' +
          '<button type="button" class="small u-down" title="↓">▼</button>' +
          '<input type="text" data-k="name" value="' + esc(u.name) + '" placeholder="' + esc(App.t('unitName')) + '">' +
          '<input type="number" data-k="base" value="' + num(u.base) + '" title="' + esc(App.t('denomination')) + '" placeholder="10">' +
          '<button type="button" class="small danger" data-del="' + i + '">✕</button>' +
          '</div>';
      }).join('');
      container.querySelectorAll('.srow').forEach(function (row) {
        const i = Number(row.dataset.i);
        row.querySelector('input[data-k="name"]').addEventListener('input', function (e) { units[i].name = e.target.value; });
        row.querySelector('input[data-k="base"]').addEventListener('input', function (e) { units[i].base = num(e.target.value); });
        row.querySelector('.u-up').addEventListener('click', function () { if (i > 0) { const t = units[i - 1]; units[i - 1] = units[i]; units[i] = t; renderUnits(); } });
        row.querySelector('.u-down').addEventListener('click', function () { if (i < units.length - 1) { const t = units[i + 1]; units[i + 1] = units[i]; units[i] = t; renderUnits(); } });
        row.querySelector('[data-del]').addEventListener('click', function () { units.splice(i, 1); renderUnits(); });
      });
    }
    renderUnits();
    document.getElementById('f-addunit').addEventListener('click', function () {
      units.push({ id: uid(), name: '', base: 1 });
      renderUnits();
    });
  }

  function bindInventoryEditor() {
    const container = document.getElementById('f-items');
    const items = editScratch.items;
    function renderItems() {
      container.innerHTML = items.map(function (it, i) {
        return '<div class="srow" data-i="' + i + '">' +
          '<input type="text" data-k="name" value="' + esc(it.name) + '" placeholder="' + esc(App.t('itemName')) + '">' +
          '<input type="text" data-k="description" value="' + esc(it.description || '') + '" placeholder="' + esc(App.t('itemDescription')) + '">' +
          '<input type="number" data-k="qty" value="' + num(it.qty) + '" title="' + esc(App.t('qty')) + '" placeholder="1" class="small">' +
          '<input type="number" data-k="weight" value="' + (it.weight == null ? '' : it.weight) + '" title="' + esc(App.t('weight')) + '" placeholder="0" class="small">' +
          '<button type="button" class="small danger" data-del="' + i + '">✕</button>' +
          '</div>';
      }).join('');
      container.querySelectorAll('.srow').forEach(function (row) {
        const i = Number(row.dataset.i);
        row.querySelector('input[data-k="name"]').addEventListener('input', function (e) { items[i].name = e.target.value; });
        row.querySelector('input[data-k="description"]').addEventListener('input', function (e) { items[i].description = e.target.value; });
        row.querySelector('input[data-k="qty"]').addEventListener('input', function (e) { items[i].qty = num(e.target.value); });
        row.querySelector('input[data-k="weight"]').addEventListener('input', function (e) { const v = e.target.value; items[i].weight = v === '' ? null : num(v); });
        row.querySelector('[data-del]').addEventListener('click', function () { items.splice(i, 1); renderItems(); });
      });
    }
    renderItems();
    document.getElementById('f-additem').addEventListener('click', function () {
      items.push({ id: uid(), name: '', description: '', qty: 1, weight: null });
      renderItems();
    });
  }

  function bindChargesToggle() {
    const mode = document.getElementById('f-chmode');
    function upd() {
      const isOwn = mode.value !== 'link';
      ['f-chownwrap', 'f-chownwrap2'].forEach(function (id) { const el = document.getElementById(id); if (el) el.style.display = isOwn ? '' : 'none'; });
      ['f-chlinkwrap', 'f-chcostwrap'].forEach(function (id) { const el = document.getElementById(id); if (el) el.style.display = isOwn ? 'none' : ''; });
    }
    mode.addEventListener('change', upd);
    upd();
  }

  // Бонус как галочка: галочка снята — поле скрыто, бонус считается пустым
  function bindBonusToggle() {
    const cb = document.getElementById('f-usebonus');
    const wrap = document.getElementById('f-bonuswrap');
    if (!cb || !wrap) return;
    const upd = function () {
      wrap.style.display = cb.checked ? '' : 'none';
      if (cb.checked) {
        const inp = wrap.querySelector('input');
        if (inp && !inp.value) inp.focus();
      }
    };
    cb.addEventListener('change', upd);
    upd();
  }

  function bindAppearance() {
    document.querySelectorAll('.ui-align').forEach(function (b) {
      b.addEventListener('click', function () {
        editScratch.uiAlign = b.dataset.v;
        document.querySelectorAll('.ui-align').forEach(function (x) { x.classList.toggle('active', x === b); });
      });
    });
  }

  function postInitEditor(card) {
    if (card.type === 'currency') bindCurrencyEditor();
    if (card.type === 'inventory') bindInventoryEditor();
    if (card.type === 'formula') bindFormulaEditor();
    if (card.type === 'spell' || card.type === 'perk') bindChargesToggle();
    bindBonusToggle();
    bindAppearance();
  }

  // ===== Formula token editor =====
  function opSymbol(v) {
    return ({ '+': '+', '-': '−', '*': '×', '/': '÷', '(': '(', ')': ')' })[v] || v;
  }
  function cycleOp(v) {
    const order = ['+', '-', '*', '/'];
    const i = order.indexOf(v);
    return i === -1 ? '+' : order[(i + 1) % order.length];
  }
  function tokenizeFormula(str) {
    const tokens = [];
    let i = 0;
    while (i < str.length) {
      const c = str[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '{') {
        const end = str.indexOf('}', i);
        if (end === -1) break;
        const inner = str.slice(i + 1, end).trim();
        const m = inner.match(/^(.*?)\s*\.\s*(бонус|bonus)$/i);
        if (m) tokens.push({ t: 'ref', name: m[1].trim(), part: 'bonus' });
        else tokens.push({ t: 'ref', name: inner, part: 'value' });
        i = end + 1;
      } else if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < str.length && /[0-9.]/.test(str[j])) j++;
        tokens.push({ t: 'num', v: str.slice(i, j) });
        i = j;
      } else if ('+-*/()'.indexOf(c) !== -1) {
        tokens.push({ t: 'op', v: c });
        i++;
      } else {
        i++;
      }
    }
    return tokens;
  }
  function serializeFormula(tokens) {
    return tokens.map(function (t) {
      if (t.t === 'ref') return '{' + t.name + (t.part === 'bonus' ? '.бонус' : '') + '}';
      if (t.t === 'num') return t.v;
      if (t.t === 'op') return t.v;
      return '';
    }).join(' ');
  }
  function tokenHtml(t, i, cardNames) {
    let inner = '';
    if (t.t === 'num') {
      inner = '<input type="number" class="tok-num" data-i="' + i + '" value="' + esc(t.v) + '">';
    } else if (t.t === 'op') {
      inner = '<button type="button" class="tok-op" data-i="' + i + '">' + opSymbol(t.v) + '</button>';
    } else if (t.t === 'ref') {
      const opts = cardNames.map(function (n) {
        return '<option value="' + esc(n) + '"' + (n === t.name ? ' selected' : '') + '>' + esc(n) + '</option>';
      }).join('');
      inner = '<span class="tok-ref"><select class="tok-refsel" data-i="' + i + '">' + opts + '</select>' +
        '<button type="button" class="tok-part" data-i="' + i + '" title="' + esc(App.t('valueOf')) + ' / ' + esc(App.t('bonusOf')) + '">' + (t.part === 'bonus' ? esc(App.t('bonusOf')) : esc(App.t('valueOf'))) + '</button></span>';
    }
    return '<span class="tok" data-i="' + i + '">' + inner + '<button type="button" class="tok-del" title="✕">×</button></span>';
  }
  function renderFormulaTokens() {
    const area = document.getElementById('f-tokens');
    const tokens = editScratch.tokens || [];
    const ch = activeChar();
    const cardNames = ch ? ch.cards.map(function (c) { return c.name; }) : [];
    area.innerHTML = tokens.map(function (t, i) { return tokenHtml(t, i, cardNames); }).join('');
    area.querySelectorAll('.tok').forEach(function (wrap) {
      const i = Number(wrap.dataset.i);
      const t = tokens[i];
      const del = wrap.querySelector('.tok-del');
      if (del) del.addEventListener('click', function () { tokens.splice(i, 1); renderFormulaTokens(); updateFormulaPreview(); });
      const num = wrap.querySelector('.tok-num');
      if (num) num.addEventListener('input', function () { t.v = num.value; updateFormulaPreview(); });
      const opBtn = wrap.querySelector('.tok-op');
      if (opBtn) opBtn.addEventListener('click', function () { t.v = cycleOp(t.v); opBtn.textContent = opSymbol(t.v); updateFormulaPreview(); });
      const sel = wrap.querySelector('.tok-refsel');
      if (sel) sel.addEventListener('change', function () { t.name = sel.value; updateFormulaPreview(); });
      const partBtn = wrap.querySelector('.tok-part');
      if (partBtn) partBtn.addEventListener('click', function () { t.part = (t.part === 'bonus' ? 'value' : 'bonus'); partBtn.textContent = (t.part === 'bonus' ? App.t('bonusOf') : App.t('valueOf')); updateFormulaPreview(); });
    });
  }
  function insertFormulaToken(kind) {
    const tokens = editScratch.tokens || [];
    if (kind === 'num') tokens.push({ t: 'num', v: '1' });
    else if (kind === 'ref') {
      const sel = document.getElementById('f-newref');
      if (sel && sel.value) tokens.push({ t: 'ref', name: sel.value, part: 'value' });
    } else {
      tokens.push({ t: 'op', v: kind });
    }
    renderFormulaTokens();
    updateFormulaPreview();
  }
  function previewValue(card, part) {
    if (part === 'bonus') return cardBonus(card);
    switch (card.type) {
      case 'counter': return num(card.current);
      case 'stat': return num(card.value);
      case 'spell': case 'perk': return chargesCurrent(card);
      case 'formula': return card._value != null ? card._value : 0;
      default: return 0;
    }
  }
  function updateFormulaPreview() {
    const el = document.getElementById('f-preview');
    if (!el) return;
    const str = serializeFormula(editScratch.tokens || []).trim();
    if (!str) { el.innerHTML = '= —'; return; }
    const card = editScratch.formulaCard;
    const ch = activeChar();
    try {
      const val = App.formula.evaluate(str, function (name, part) {
        const target = ch ? ch.cards.find(function (c) { return c.name === name; }) : null;
        if (!target) throw new Error(name);
        if (card && target.id === card.id) throw new Error('cycle');
        return previewValue(target, part);
      });
      el.innerHTML = '= ' + fmt(val);
    } catch (e) {
      el.innerHTML = '= <span class="err">' + esc(App.t('brokenRef')) + '</span>';
    }
  }
  function bindFormulaEditor() {
    const area = document.getElementById('f-tokens');
    if (area) renderFormulaTokens();
    const m = document.getElementById('modal');
    m.querySelectorAll('.f-op').forEach(function (b) {
      b.addEventListener('click', function () { insertFormulaToken(b.dataset.op); });
    });
    const addRef = document.getElementById('f-addref');
    if (addRef) addRef.addEventListener('click', function () { insertFormulaToken('ref'); });
    updateFormulaPreview();
  }

  function readCharges(card) {
    const charges = card.charges || { mode: 'own' };
    charges.mode = document.getElementById('f-chmode').value;
    charges.blockEmpty = readCheck('f-chblock');
    if (charges.mode === 'link') {
      const link = document.getElementById('f-chlink');
      charges.linkId = link && link.value ? link.value : null;
      charges.cost = num(readNum('f-chcost')) || 1;
    } else {
      charges.current = num(readNum('f-chcur'));
      charges.max = readNumOrNull('f-chmax');
    }
    return charges;
  }

  // ОФОРМЛЕНИЕ: временно скрыто из редактора (по просьбе пользователя, «пока рано»).
  // Чтобы вернуть: в openCardEditor снова добавить body += appearanceFields(card);
  // и в applyFields снять guard вокруг назначения card.ui.
  function applyFields(card) {
    switch (card.type) {
      case 'counter':
        card.current = num(readNum('f-current'));
        card.max = readNumOrNull('f-max');
        card.bonus = readBonus();
        card.die = readDie('f-die');
        card.restores = readCheck('f-restores');
        break;
      case 'skill':
        card.die = readDie('f-die') || 20;
        card.bonus = readBonus();
        break;
      case 'stat':
        card.value = num(readNum('f-value'));
        card.bonus = readBonus();
        card.die = readDie('f-die');
        break;
      case 'formula':
        card.expression = serializeFormula(editScratch.tokens || []).trim();
        card.bonus = readBonus();
        card.die = readDie('f-die');
        break;
      case 'spell':
        card.description = readText('f-desc');
        card.charges = readCharges(card);
        card.die = readDie('f-die');
        card.bonus = readBonus();
        card.restores = readCheck('f-restores');
        break;
      case 'perk':
        card.description = readText('f-desc');
        card.charges = readCharges(card);
        card.restores = readCheck('f-restores');
        break;
      case 'currency': {
        const units = editScratch.units || card.units;
        card.units = units.map(function (u) { return { id: u.id, name: u.name, base: num(u.base) }; });
        card.autoconvert = readCheck('f-autoconv');
        const ids = card.units.map(function (u) { return u.id; });
        for (const k in card.amounts) if (ids.indexOf(k) === -1) delete card.amounts[k];
        break;
      }
      case 'inventory':
        card.items = (editScratch.items || card.items).map(function (it) { return { id: it.id, name: it.name, description: it.description || '', qty: num(it.qty), weight: it.weight }; });
        card.showWeight = readCheck('f-showweight');
        break;
      case 'note':
        card.text = readText('f-text');
        break;
    }
    const uiBg = document.getElementById('ui-bg');
    if (uiBg) {   // ОФОРМЛЕНИЕ: поля скрыты — существующие настройки карточки сохраняем как есть
      card.ui = {
        bg: readText('ui-bg'),
        color: readText('ui-color'),
        align: editScratch.uiAlign || '',
        bold: readCheck('ui-bold'),
        italic: readCheck('ui-italic')
      };
    }
  }

  function openCardEditor(cardId) {
    const card = findCard(cardId);
    if (!card) return;
    editScratch.uiAlign = (card.ui && card.ui.align) || '';
    let body = '<div class="field"><label>' + esc(App.t('name')) + '</label><input id="f-name" type="text" value="' + esc(card.name) + '" placeholder="' + esc(nameExample(card.type)) + '"></div>';
    body += typeFields(card);
    // body += appearanceFields(card);   // ОФОРМЛЕНИЕ: временно скрыто (см. комментарий в applyFields)
    openModal(typeLabel(card.type), body, [
      { label: App.t('cancel') },
      { label: App.t('save'), cls: 'primary', onClick: function () { return saveCardEdit(card); } }
    ]);
    postInitEditor(card);
  }

  function saveCardEdit(card) {
    const nameInput = document.getElementById('f-name');
    const name = nameInput.value.trim();
    if (!name) { toast(App.t('uniqueNameError')); return false; }
    if (isNameUsed(name, card.id)) { toast(App.t('uniqueNameError')); return false; }
    const oldName = card.name;
    mutate(function () {
      if (oldName !== name) {
        const ch = activeChar();
        ch.cards.forEach(function (c) {
          if (c.type === 'formula') c.expression = App.formula.renameRefs(c.expression || '', oldName, name);
        });
      }
      card.name = name;
      applyFields(card);
      // содержимое могло вырасти (добавили валюты/предметы) — не даём карточке остаться
      // меньше минимума, иначе строки уйдут за границы
      const mn = minSize(card);
      card.w = Math.max(mn.w, card.w || mn.w);
      card.h = Math.max(mn.h, card.h || mn.h);
    });
    return true;
  }

  // ===== Add card =====
  function openAddMenu() {
    const ch = activeChar();
    if (!ch) return;
    const presets = [
      { type: 'counter', name: App.t('presetHealth'), extra: { current: 10, max: 10, restores: true } },
      { type: 'counter', name: App.t('presetMana'), extra: { current: 5, max: 5, restores: true } },
      { type: 'counter', name: App.t('presetArmor'), extra: { current: 10, max: null } },
      { type: 'currency', name: App.t('presetMoney'), extra: {} },
      { type: 'skill', name: App.t('presetSkill'), extra: { die: 20, bonus: '' } },
      { type: 'stat', name: App.t('presetStat'), extra: { value: 10 } }
    ];
    const presetBtns = presets.map(function (p) {
      return '<button type="button" class="add-preset" data-type="' + p.type + '" data-name="' + esc(p.name) + '" data-extra="' + esc(JSON.stringify(p.extra)) + '">' + esc(p.name) + '</button>';
    }).join('');
    const typeBtns = CARD_TYPES.map(function (tp) {
      return '<button type="button" class="add-type" data-type="' + tp + '">' + esc(typeLabel(tp)) + '</button>';
    }).join('');

    openModal(App.t('addCard'),
      '<div class="field"><label>' + esc(App.t('presets')) + '</label><div class="btn-grid">' + presetBtns + '</div></div>' +
      '<div class="field"><label>' + esc(App.t('customTypes')) + '</label><div class="btn-grid">' + typeBtns + '</div></div>',
      [{ label: App.t('cancel') }]
    );

    const m = document.getElementById('modal');
    m.querySelectorAll('.add-preset').forEach(function (b) {
      b.addEventListener('click', function () { addCardFromMenu(b.dataset.type, b.dataset.name, JSON.parse(b.dataset.extra || '{}')); });
    });
    m.querySelectorAll('.add-type').forEach(function (b) {
      b.addEventListener('click', function () { addCardFromMenu(b.dataset.type, null, null); });
    });
  }

  function addCardFromMenu(type, name, extra) {
    const ch = activeChar();
    if (!ch) { closeModal(); return; }
    let newId = null;
    mutate(function () {
      let nm = name || defaultCardName(type);
      let i = 2, base = nm;
      while (ch.cards.some(function (c) { return c.name === nm; })) { nm = base + ' (' + i + ')'; i++; }
      const c = createCard(type, nm, extra);
      c.page = curPageId(ch);
      newId = c.id;
      ch.cards.push(c);
      autoPlace(ch, c);
    });
    closeModal();
    if (newId) openCardEditor(newId);
  }

  // ===== Settings =====
  function openSettings() {
    const ch = activeChar();
    const lang = state.settings.language;
    const charOpts = state.characters.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === state.activeCharacterId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');
    const body =
      '<div class="field"><label>' + esc(App.t('languageLabel')) + '</label>' +
      '<select id="s-lang"><option value="ru"' + (lang === 'ru' ? ' selected' : '') + '>Русский</option>' +
      '<option value="en"' + (lang === 'en' ? ' selected' : '') + '>English</option></select></div>' +
      '<div class="field check"><input id="s-anim" type="checkbox"' + (state.settings.diceAnimation !== false ? ' checked' : '') + '><label for="s-anim">' + esc(App.t('diceAnimation')) + '</label></div>' +
      '<div class="field"><label>' + esc(App.t('characters')) + '</label>' +
      '<select id="s-char">' + charOpts + '</select>' +
      '<div class="f-buttons">' +
        '<button type="button" id="s-newchar">+ ' + esc(App.t('newCharacter')) + '</button>' +
        (ch ? '<button type="button" class="danger" id="s-delchar">' + esc(App.t('deleteCharacter')) + '</button>' : '') +
      '</div></div>' +
      '<div class="field"><label>' + esc(App.t('dataTitle')) + '</label>' +
      '<div class="btn-col">' +
        '<button type="button" id="s-expchar">' + esc(App.t('exportCurrent')) + '</button>' +
        '<button type="button" id="s-impchar">' + esc(App.t('importChar')) + '</button>' +
        '<button type="button" id="s-expall">' + esc(App.t('exportAll')) + '</button>' +
        '<button type="button" id="s-impall">' + esc(App.t('importAll')) + '</button>' +
      '</div></div>' +
      '<div class="field"><button type="button" class="danger" id="s-reset">' + esc(App.t('resetData')) + '</button></div>';

    openModal(App.t('settings'), body, [{ label: App.t('close'), cls: 'primary' }]);

    document.getElementById('s-lang').addEventListener('change', function (e) { state.settings.language = e.target.value; save(); render(); });
    document.getElementById('s-anim').addEventListener('change', function (e) { state.settings.diceAnimation = e.target.checked; save(); });
    document.getElementById('s-char').addEventListener('change', function (e) { state.activeCharacterId = e.target.value; save(); render(); });
    document.getElementById('s-newchar').addEventListener('click', function () {
      closeModal();
      openNewCharModal();
    });
    if (ch) document.getElementById('s-delchar').addEventListener('click', function () {
      closeModal();
      confirmDialog(App.tf('confirmDeleteChar', { name: ch.name }), deleteActiveCharacter, App.t('deleteCharacter'));
    });
    document.getElementById('s-expchar').addEventListener('click', exportCharacter);
    document.getElementById('s-impchar').addEventListener('click', function () { pickFile(importCharacter); });
    document.getElementById('s-expall').addEventListener('click', exportAll);
    document.getElementById('s-impall').addEventListener('click', function () { pickFile(importAll); });
    document.getElementById('s-reset').addEventListener('click', function () {
      closeModal();
      confirmDialog(App.t('resetConfirm'), function () { localStorage.removeItem(STORAGE_KEY); location.reload(); }, App.t('settings'));
    });
  }

  function openNewCharModal() {
    openModal(App.t('newCharacter'),
      '<div class="field"><label>' + esc(App.t('charName')) + '</label><input id="charNameInput" type="text" value="' + esc(App.t('newCharName')) + '" placeholder="' + esc(App.t('newCharName')) + '"></div>',
      [
        { label: App.t('cancel') },
        { label: App.t('save'), cls: 'primary', onClick: function () {
            const inp = document.getElementById('charNameInput');
            const name = inp.value.trim() || App.t('newCharName');
            mutate(function () { newCharacter(name); });
          } }
      ]
    );
    const inp = document.getElementById('charNameInput');
    if (inp) { inp.focus(); inp.select(); }
  }

  function deleteActiveCharacter() {
    const ch = activeChar();
    if (!ch) return;
    mutate(function () {
      state.characters = state.characters.filter(function (c) { return c.id !== ch.id; });
      if (state.activeCharacterId === ch.id) state.activeCharacterId = state.characters.length ? state.characters[0].id : null;
    });
    toast(App.t('charDeleted'));
  }

  // ===== Export / import =====
  function stripTransient(ch) {
    const copy = JSON.parse(JSON.stringify(ch));
    copy.cards.forEach(function (c) { delete c._value; delete c._error; });
    return copy;
  }
  function safeName(s) { return s.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'character'; }
  function download(filename, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }
  function pickFile(cb) {
    const input = document.getElementById('fileInput');
    input.value = '';
    input.onchange = function () {
      const f = input.files && input.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = function () { try { cb(r.result); } catch (e) { toast(App.t('importError')); } };
      r.readAsText(f);
    };
    input.click();
  }

  function exportCharacter() {
    const ch = activeChar();
    if (!ch) return;
    download(safeName(ch.name) + '.json', JSON.stringify({ app: 'custplay', kind: 'character', version: 1, character: stripTransient(ch) }, null, 2));
    toast(App.t('exported'));
  }
  function importCharacter(json) {
    const data = JSON.parse(json);
    const src = data.character || (data.cards ? data : null);
    if (!src || !Array.isArray(src.cards)) throw new Error('bad');
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    let nm = copy.name || App.t('newCharName');
    let i = 2, base = nm;
    while (state.characters.some(function (c) { return c.name === nm; })) { nm = base + ' (' + i + ')'; i++; }
    copy.name = nm;
    const idMap = {};
    copy.cards.forEach(function (c) { const old = c.id; const nu = uid(); c.id = nu; idMap[old] = nu; });
    copy.cards.forEach(function (c) {
      if (c.type === 'currency' && c.units) {
        const umap = {};
        c.units.forEach(function (u) { const nu = uid(); umap[u.id] = nu; u.id = nu; });
        const na = {};
        for (const k in (c.amounts || {})) if (umap[k]) na[umap[k]] = c.amounts[k];
        c.amounts = na;
      }
      if (c.type === 'inventory' && c.items) c.items.forEach(function (it) { it.id = uid(); });
      if (c.charges && c.charges.mode === 'link' && c.charges.linkId) {
        c.charges.linkId = idMap[c.charges.linkId] || null;
      }
    });
    layoutCharacter(copy);
    mutate(function () { state.characters.push(copy); state.activeCharacterId = copy.id; });
    toast(App.t('imported'));
  }
  function exportAll() {
    download('custplay-backup.json', JSON.stringify({ app: 'custplay', kind: 'backup', version: 1, characters: state.characters.map(stripTransient), settings: state.settings }, null, 2));
    toast(App.t('exported'));
  }
  function importAll(json) {
    const data = JSON.parse(json);
    if (!data || !Array.isArray(data.characters)) throw new Error('bad');
    mutate(function () {
      state.characters = data.characters.map(function (ch) {
        const c = JSON.parse(JSON.stringify(ch));
        c.id = uid();
        layoutCharacter(c);
        return c;
      });
      if (data.settings) state.settings = Object.assign(state.settings, data.settings);
      state.activeCharacterId = state.characters.length ? state.characters[0].id : null;
    });
    toast(App.t('imported'));
  }

  // ===== Dice widget =====
  const dwState = { sel: {}, resultHtml: '' };
  App.dice.TYPES.forEach(function (s) { dwState.sel[s] = { count: 0, bonus: 0 }; });

  const DW_SHAPES = {
    4: '50,10 92,86 8,86',
    6: '18,18 82,18 82,82 18,82',
    8: '50,4 94,50 50,96 6,50',
    10: '50,4 94,42 62,86 38,86 6,42',
    12: '50,6 94,40 79,90 21,90 6,40',
    20: '50,4 93,28 93,72 50,96 7,72 7,28',
    100: '50,4 94,42 62,86 38,86 6,42'
  };
  function dwSvg(sides) {
    const inner = sides === 100 ? '<polygon class="dw-inner" points="50,26 72,46 50,70 28,46"/>' : '';
    const narrow = String(sides).length > 2 ? ' class="dw-narrow"' : '';
    return '<svg viewBox="0 0 100 100"><polygon class="dw-outline" points="' + DW_SHAPES[sides] + '"/>' + inner +
      '<text x="50" y="' + (sides === 4 ? 62 : 52) + '"' + narrow + '>' + sides + '</text></svg>';
  }
  function dwResultHtml(r, chosen) {
    const detail = App.dice.describeSet(chosen);
    const vals = r.parts.filter(function (p) { return !p.bonus; }).map(function (p) { return p.value; }).join(' + ');
    const bsum = r.parts.filter(function (p) { return p.bonus; }).reduce(function (a, p) { return a + p.value; }, 0);
    return '<span class="dw-total">' + r.total + '</span><span class="dw-break">' + esc(detail) + ' → ' + vals + (bsum ? (bsum > 0 ? ' + ' : ' − ') + Math.abs(bsum) + ' ' + esc(App.t('bonus')).toLowerCase() : '') + '</span>';
  }
  function renderDiceWidget() {
    const w = document.getElementById('diceWidget');
    const cells = App.dice.TYPES.map(function (s) {
      const st = dwState.sel[s];
      return '<div class="dw-cell' + (st.count > 0 ? ' sel' : '') + '" data-s="' + s + '">' +
        '<div class="dw-shape">' + dwSvg(s) + '<span class="dw-badge' + (st.count ? '' : ' hidden') + '">' + st.count + '</span></div>' +
        '<input type="number" class="dw-bonus" data-s="' + s + '" value="' + st.bonus + '" title="' + esc(App.t('bonus')) + '" placeholder="+">' +
        '</div>';
    }).join('');
    w.innerHTML =
      '<div class="dw-head"><span class="dw-title">' + esc(App.t('dicePanel')) + '</span>' +
        '<button class="icon dw-close" title="' + esc(App.t('close')) + '">✕</button></div>' +
      '<div class="dw-grid">' + cells + '</div>' +
      '<div class="dw-hint">' + esc(App.t('dwHint')) + '</div>' +
      '<div class="dw-result">' + (dwState.resultHtml || '<span class="meta">—</span>') + '</div>' +
      '<div class="dw-actions"><button id="dw-reset">' + esc(App.t('reset')) + '</button>' +
        '<button id="dw-roll" class="primary">' + esc(App.t('roll')) + '</button></div>';

    w.querySelector('.dw-close').addEventListener('click', toggleDiceWidget);
    w.querySelectorAll('.dw-shape').forEach(function (sh) {
      const sides = Number(sh.closest('.dw-cell').dataset.s);
      sh.addEventListener('click', function () { dwBump(sides, 1); });
      sh.addEventListener('contextmenu', function (e) { e.preventDefault(); dwBump(sides, -1); });
    });
    w.querySelectorAll('.dw-bonus').forEach(function (inp) {
      inp.addEventListener('change', function () {
        dwState.sel[Number(inp.dataset.s)].bonus = num(inp.value);
      });
      inp.addEventListener('click', function (e) { e.stopPropagation(); });
    });
    w.querySelector('#dw-reset').addEventListener('click', function () {
      App.dice.TYPES.forEach(function (s) { dwState.sel[s].count = 0; dwState.sel[s].bonus = 0; });
      dwState.resultHtml = '';
      renderDiceWidget();
    });
    w.querySelector('#dw-roll').addEventListener('click', function () {
      const chosen = App.dice.TYPES.filter(function (s) { return dwState.sel[s].count > 0; })
        .map(function (s) { return { sides: s, count: dwState.sel[s].count, bonus: dwState.sel[s].bonus }; });
      if (!chosen.length) { toast(App.t('noDiceSelected')); return; }
      const r = App.dice.rollSet(chosen);
      dwState.resultHtml = dwResultHtml(r, chosen);
      w.querySelector('.dw-result').innerHTML = dwState.resultHtml;
      const totalEl = w.querySelector('.dw-total');
      if (totalEl && animOn()) animateTotal(totalEl, r.total);
      logRoll(App.dice.describeSet(chosen) + ' = ' + r.total);
      commit();
    });
  }
  function dwBump(sides, d) {
    const cell = document.querySelector('#diceWidget .dw-cell[data-s="' + sides + '"]');
    if (!cell) return;
    const st = dwState.sel[sides];
    st.count = Math.max(0, st.count + d);
    cell.classList.toggle('sel', st.count > 0);
    const badge = cell.querySelector('.dw-badge');
    badge.textContent = st.count;
    badge.classList.toggle('hidden', st.count === 0);
  }

  // ---- перемещение виджета с сохранением позиции ----
  const DW_POS_KEY = 'custplay-dw-pos';
  function dwPosRect(w) {
    const r = w.getBoundingClientRect();
    return { w: r.width || 340, h: r.height || 320 };
  }
  function applyDwPos(saved) {
    const w = document.getElementById('diceWidget');
    if (!saved) {                       // позиции нет — вернуть виджет в дефолт (левый нижний угол)
      w.style.left = ''; w.style.top = ''; w.style.right = ''; w.style.bottom = '';
      return;
    }
    const vw = window.innerWidth, vh = window.innerHeight;
    const d = dwPosRect(w);
    const x = Math.max(8, Math.min(vw - d.w - 8, saved.x));
    const y = Math.max(58, Math.min(vh - d.h - 8, saved.y));
    w.style.left = Math.round(x) + 'px';
    w.style.top = Math.round(y) + 'px';
    w.style.right = 'auto';
    w.style.bottom = 'auto';
  }
  function loadDwPos() {
    try { return JSON.parse(localStorage.getItem(DW_POS_KEY)); } catch (e) { return null; }
  }
  function initDwDrag() {
    const w = document.getElementById('diceWidget');
    w.addEventListener('pointerdown', function (e) {
      const head = e.target.closest('.dw-head');
      if (!head || e.target.closest('button')) return;   // тянем за шапку, но не за кнопки
      e.preventDefault();
      const rect = w.getBoundingClientRect();
      const startX = e.clientX, startY = e.clientY;
      const origX = rect.left, origY = rect.top;
      const d = dwPosRect(w);
      w.classList.add('dragging');
      document.body.style.userSelect = 'none';
      function onMove(ev) {
        const x = Math.max(8, Math.min(window.innerWidth - d.w - 8, origX + ev.clientX - startX));
        const y = Math.max(58, Math.min(window.innerHeight - d.h - 8, origY + ev.clientY - startY));
        w.style.left = Math.round(x) + 'px';
        w.style.top = Math.round(y) + 'px';
        w.style.right = 'auto';
        w.style.bottom = 'auto';
      }
      function onUp() {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        w.classList.remove('dragging');
        document.body.style.userSelect = '';
        try {
          localStorage.setItem(DW_POS_KEY, JSON.stringify({ x: parseFloat(w.style.left) || 16, y: parseFloat(w.style.top) || 100 }));
        } catch (err) {}
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }
  function toggleDiceWidget() {
    const w = document.getElementById('diceWidget');
    if (w.classList.contains('hidden')) {
      renderDiceWidget();
      w.classList.remove('hidden');
      applyDwPos(loadDwPos());
    } else {
      w.classList.add('hidden');
    }
  }

  // ===== Log =====
  function toggleLog() {
    const log = document.getElementById('log');
    log.classList.toggle('hidden');
    renderLog();
  }
  function renderLog() {
    const log = document.getElementById('log');
    if (log.classList.contains('hidden')) return;
    const entries = state.log.slice(0, 50).map(function (e) {
      return '<div class="log-entry"><span class="lt">' + esc(e.ts) + '</span><span class="lres">' + esc(e.text) + '</span></div>';
    }).join('');
    log.innerHTML = '<h3>' + esc(App.t('rollLog')) + '<button class="small ghost" id="log-clear">' + esc(App.t('clear')) + '</button></h3>' +
      (entries || '<div class="meta">—</div>');
    const b = document.getElementById('log-clear');
    if (b) b.addEventListener('click', function () { state.log = []; renderLog(); save(); });
  }

  // ===== Toast =====
  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2200);
  }

  // ===== Init =====
  function init() {
    if (!state.characters.length) {
      const id = uid();
      const ch = { id: id, name: App.t('newCharName'), cards: defaultCards() };
      state.characters.push(ch);
      state.activeCharacterId = id;
      save();
    }
    state.characters.forEach(layoutCharacter);
    initFreePlacement();
    render();
    document.getElementById('fab').addEventListener('click', openAddMenu);
    document.getElementById('backdrop').addEventListener('click', closeModal);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!document.getElementById('modal').classList.contains('hidden')) closeModal();
        else document.getElementById('diceWidget').classList.add('hidden');
      }
    });
    initDwDrag();
    window.addEventListener('resize', function () {
      if (isDesktop()) sizeCanvas();
      const w = document.getElementById('diceWidget');
      if (w && !w.classList.contains('hidden')) applyDwPos(loadDwPos());
    });
  }

  init();
})();
