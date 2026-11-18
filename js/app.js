window.App = window.App || {};

(function () {
  'use strict';

  // ===== Constants =====
  const STORAGE_KEY = 'custplay-v1';
  const LEGACY_KEY = 'dnd-tracker-v1';
  const CARD_TYPES = ['counter', 'skill', 'spell', 'currency', 'inventory', 'note', 'initiative', 'condition'];
  // v22: типы, которые можно использовать в формулах — без валюты/инвентаря/заметок
  const FORMULA_REF_TYPES = ['counter', 'skill', 'spell'];
  // Свертывание в ярлык (v29, со стенда «текущее свертывание И, З, В»): только типы
  // с готовой иконкой; иконки в icons/labels/. Счётчик/навык/заклинание — позже.
  const FOLDABLE_ICONS = { currency: 'кошель', inventory: 'сундук', note: 'книга' };
  const LABEL_W = 143, LABEL_H = 120;   // ярлык (v58: по высоте равен счётчику — компоновка сходится)
  // Иконка «мусорка» для ВСЕХ кнопок «Удалить» (вместо крестика ✕): инлайн-SVG
  // в currentColor — красится как текст кнопки, как остальные глифы тулз
  const TRASH_SVG = '<svg class="trash-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
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
  // v50: подпись кубика с количеством — «2d20» или «d20»
  function cardDiceLabel(card) {
    const n = Math.max(1, Math.round(num(card.nDice) || 1));
    return (n > 1 ? n : '') + dieLabel(card.die);
  }
  function bonusStr(b) {
    b = num(b);
    if (!b) return '';
    return (b > 0 ? ' + ' : ' − ') + Math.abs(b);
  }
  function isDesktop() {
    return window.matchMedia('(min-width: 721px)').matches;
  }
  function nameExample(type) {
    return ({ counter: 'Здоровье', skill: 'Акробатика', spell: 'Огненный шар', currency: 'Деньги', inventory: 'Снаряжение', note: 'Заметка' })[type] || '';
  }

  // ===== State =====
  function defaultState() {
    return {
      version: 1,
      activeCharacterId: null,
      characters: [],
      settings: { language: 'ru', critSuccess: '20', critFail: '1' },
      // v71: библиотеки наборов на устройстве (состояния и вещи).
      // Засеваются стандартными на старте — см. ensureLibraries()
      libraries: { states: [], items: [] },
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
      // читаем ТОЛЬКО знакомые поля: мусор/обрывки из хранилища не протекают в приложение
      const st = defaultState();
      if (s && typeof s === 'object') {
        if (Array.isArray(s.characters)) {
          st.characters = s.characters.filter(function (c) { return c && typeof c === 'object'; }).map(function (c) {
            // карточки без id/имени не отдаём конечному коду дальше как есть — подставляем честные значения
            const ch = c;
            if (Array.isArray(ch.cards)) {
              ch.cards = ch.cards.filter(function (k) { return k && typeof k === 'object'; }).map(function (k) {
                if (!k.id) k.id = uid();
                // v65: у карточки «Состояние» пустое имя — норма (подпись необязательна)
                if (typeof k.name !== 'string' || (!k.name && k.type !== 'condition')) k.name = '—';
                return k;
              });
            }
            return ch;
          });
        }
        if (s.activeCharacterId && st.characters.some(function (c) { return c.id === s.activeCharacterId; })) st.activeCharacterId = s.activeCharacterId;
        if (s.settings && typeof s.settings === 'object') st.settings = Object.assign(st.settings, s.settings);
        // v71: наборы состояний/вещей (библиотеки на устройстве)
        if (s.libraries && typeof s.libraries === 'object') {
          if (Array.isArray(s.libraries.states)) st.libraries.states = s.libraries.states.filter(function (x) { return x && typeof x === 'object' && Array.isArray(x.entries); });
          if (Array.isArray(s.libraries.items)) st.libraries.items = s.libraries.items.filter(function (x) { return x && typeof x === 'object' && Array.isArray(x.entries); });
        }
        if (Array.isArray(s.log)) st.log = s.log.filter(function (e) { return e && typeof e.text === 'string'; });
      }
      return st;
    } catch (e) {
      return defaultState();
    }
  }
  let saveErrorShown = false;
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); saveErrorShown = false; }
    catch (e) {
      // хранилище переполнено или недоступно: предупреждаем один раз, дальше молчим, пока не пройдёт
      if (!saveErrorShown) { saveErrorShown = true; toast(App.t('saveError')); }
    }
  }

  let state = load();
  App.state = state;

  let undoStack = [];
  let redoStack = [];
  const MAX_UNDO = 15;   // v20d: 15 действий достаточно (каждый снимок = копия всего состояния)
  let editMode = false;
  let editScratch = { units: null, items: null, editCard: null };

  function snapshot() {
    return JSON.parse(JSON.stringify({ characters: state.characters, activeCharacterId: state.activeCharacterId }));
  }
  function pushUndo() {
    undoStack.push(snapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
    redoStack = [];
  }
  function commit() {
    invalidateMods();          // модификаторы могли измениться — индекс пересоберём
    save();
    render();
    if (layerCardId) refreshLayer();   // слой ярлыка догоняет данные (кнопки −/＋ и т.п.)
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
  function openPageRename(pageId) {
    const ch = activeChar();
    if (!ch) return;
    const page = ch.pages.find(function (p) { return p.id === (pageId || ch.lastPage); });
    if (!page) return;
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
      // кебаб ⋮ ВНУТРИ вкладки справа, только в правке (как ручка ⋮⋮ на карточках)
      const kebab = editMode ? '<span class="pt-kebab" data-page="' + p.id + '" title="' + esc(App.t('pageMenu')) + '">⋮</span>' : '';
      return '<button class="ptab' + (p.id === ch.lastPage ? ' active' : '') + '" data-page="' + p.id + '">' + esc(p.name) + kebab + '</button>';
    }).join('');
    // «+» — только в правке (старые кнопки ✎/✕ заменил кебаб ⋮ у каждой вкладки)
    const ctrl = editMode ? '<span class="pt-ctrl"><button class="icon" id="pt-add" title="' + esc(App.t('addPage')) + '">+</button></span>' : '';
    bar.innerHTML = tabs + ctrl;
    bar.querySelectorAll('.ptab').forEach(function (b) {
      const k = b.querySelector('.pt-kebab');
      if (k) k.addEventListener('click', function (e) { e.stopPropagation(); openPageMenu(b.dataset.page, k); });
      if (editMode && isDesktop()) b.addEventListener('pointerdown', function (e) { startTabDrag(b, ch, bar, e); });
      else b.addEventListener('click', function () { ch.lastPage = b.dataset.page; commit(); });
    });
    if (editMode) {
      bar.querySelector('#pt-add').addEventListener('click', function () {
        mutate(function () {
          const p = { id: uid(), name: defaultPageName(ch) };
          ch.pages.push(p);
          ch.lastPage = p.id;
        });
      });
    }
  }
  // перенос вкладок в своей строке drag and drop (только в правке, десктоп):
  // вся вкладка кроме кебаба — ручка (без ручек-точек). Во время переноса ничего не переставляем:
  // вкладка под курсором подсвечивается (.drop-hint), свап — в момент ОТПУСКАНИЯ.
  // Так «3 через 2 на место 1» даёт ровно 3-2-1 (свап с конечной целью, без цепочки промежуточных).
  // Состояние ОДНО глобальное (tabDrag) + одна пара обработчиков на window — как у drag карточек:
  // никаких слушателей на каждую кнопку, нечему «протухать» между перерисовками.
  let tabDrag = null;   // { b, ch, bar, startX, moved, target }
  function startTabDrag(b, ch, bar, e) {
    if (e.button !== 0 || tabDrag) return;
    const kebab = b.querySelector('.pt-kebab');
    if (kebab && kebab.contains(e.target)) return;   // кебаб — меню, не перенос
    tabDrag = { b: b, ch: ch, bar: bar, startX: e.clientX, moved: false, target: null };
  }
  function tabDragPick(x) {
    const tabs = Array.prototype.slice.call(tabDrag.bar.querySelectorAll('.ptab'));
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i];
      if (t === tabDrag.b) continue;
      const r = t.getBoundingClientRect();
      if (x >= r.left && x < r.right) return t;
    }
    return null;
  }
  window.addEventListener('pointermove', function (e) {
    if (!tabDrag) return;
    if (!tabDrag.moved && Math.abs(e.clientX - tabDrag.startX) > 5) {
      tabDrag.moved = true;
      tabDrag.b.classList.add('dragging');
    }
    if (!tabDrag.moved) return;
    const t = tabDragPick(e.clientX);
    if (t !== tabDrag.target) {
      if (tabDrag.target) tabDrag.target.classList.remove('drop-hint');
      tabDrag.target = t;
      if (t) t.classList.add('drop-hint');
    }
  });
  window.addEventListener('pointerup', function () {
    if (!tabDrag) return;
    const td = tabDrag;
    tabDrag = null;
    td.b.classList.remove('dragging');
    if (td.target) td.target.classList.remove('drop-hint');
    if (!td.moved) { td.ch.lastPage = td.b.dataset.page; commit(); return; }   // это был клик, не перенос
    if (!td.target) return;   // отпустили мимо вкладок — ничего не меняем
    // свап местами в DOM, порядок из DOM — одна mutate
    const anchor = (td.b.nextSibling === td.target) ? td.b : td.b.nextSibling;
    td.bar.insertBefore(td.b, td.target);
    td.bar.insertBefore(td.target, anchor);
    const order = Array.prototype.slice.call(td.bar.querySelectorAll('.ptab')).map(function (t) { return t.dataset.page; });
    mutate(function () {
      td.ch.pages.sort(function (x, y) { return order.indexOf(x.id) - order.indexOf(y.id); });
    });
  });
  // контекстное меню страницы (⋮): переименовать / удалить. Закрывается кликом мимо и по resize
  function closePageMenu() {
    const m = document.querySelector('.ctxmenu');
    if (m) m.remove();
    document.removeEventListener('pointerdown', onPageMenuClose, true);
    window.removeEventListener('resize', closePageMenu);
  }
  function onPageMenuClose(e) {
    const m = document.querySelector('.ctxmenu');
    if (m && !m.contains(e.target)) closePageMenu();
  }
  function openPageMenu(pageId, kebab) {
    closePageMenu();
    const ch = activeChar();
    if (!ch) return;
    const menu = document.createElement('div');
    menu.className = 'ctxmenu';
    const canDel = ch.pages.length > 1;
    menu.innerHTML =
      '<button type="button" data-act="rename">✎ ' + esc(App.t('renamePage')) + '</button>' +
      '<button type="button" data-act="del"' + (canDel ? '' : ' disabled') + '>' + TRASH_SVG + ' ' + esc(App.t('deletePage')) + '</button>';
    const r = kebab.getBoundingClientRect();
    menu.style.left = Math.round(r.left) + 'px';
    menu.style.top = Math.round(r.bottom + 4) + 'px';
    document.body.appendChild(menu);
    menu.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      closePageMenu();
      if (b.dataset.act === 'rename') openPageRename(pageId);
      else if (b.dataset.act === 'del') deletePage(pageId);
    });
    document.addEventListener('pointerdown', onPageMenuClose, true);
    window.addEventListener('resize', closePageMenu);
  }
  // v19: кебаб-меню мобильной шапки (⋮): Отдых / История / Назад / Вперед.
  // Генеричное .ctxmenu, прижат вправо под кнопкой; закрытие — клик мимо (pointerdown capture) и resize
  function closeTopMenu() {
    const m = document.getElementById('topMenu');
    if (m) m.remove();
    document.removeEventListener('pointerdown', onTopMenuClose, true);
    window.removeEventListener('resize', closeTopMenu);
  }
  function onTopMenuClose(e) {
    const m = document.getElementById('topMenu');
    if (m && !m.contains(e.target)) closeTopMenu();
  }
  function openTopMenu() {
    closeTopMenu();
    const btn = document.getElementById('topMenuBtn');
    if (!btn) return;
    const menu = document.createElement('div');
    menu.className = 'ctxmenu';
    menu.id = 'topMenu';
    menu.innerHTML =
      '<button type="button" data-act="rest">☾ ' + esc(App.t('rest')) + '</button>' +
      '<button type="button" data-act="log">☰ ' + esc(App.t('log')) + '</button>' +
      '<button type="button" data-act="undo">↶ ' + esc(App.t('menuUndo')) + '</button>' +
      '<button type="button" data-act="redo">↷ ' + esc(App.t('menuRedo')) + '</button>';
    const r = btn.getBoundingClientRect();
    menu.style.right = Math.round(window.innerWidth - r.right) + 'px';
    menu.style.top = Math.round(r.bottom + 4) + 'px';
    document.body.appendChild(menu);
    menu.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      closeTopMenu();
      if (b.dataset.act === 'rest') confirmRest();
      else if (b.dataset.act === 'log') toggleLog();
      else if (b.dataset.act === 'undo') undo();
      else if (b.dataset.act === 'redo') redo();
    });
    document.addEventListener('pointerdown', onTopMenuClose, true);
    window.addEventListener('resize', closeTopMenu);
  }

  // Кебаб карточки (v40): у компактного счётчика вместо трёх кнопок ✎⧉🗑 — одно меню.
  // Разметка и поведение те же, что у верхнего меню (.ctxmenu).
  let cardMenuAnchor = null;
  function closeCardMenu() {
    const m = document.getElementById('cardMenu');
    if (m) m.remove();
    document.removeEventListener('pointerdown', onCardMenuClose, true);
    window.removeEventListener('resize', closeCardMenu);
    window.removeEventListener('scroll', closeCardMenu, true);
    cardMenuAnchor = null;
  }
  function onCardMenuClose(e) {
    const m = document.getElementById('cardMenu');
    if (!m) return;
    if (m.contains(e.target)) return;
    if (cardMenuAnchor && cardMenuAnchor.contains(e.target)) return;
    closeCardMenu();
  }
  function openCardMenu(cardId, anchor) {
    closeCardMenu();
    const card = findCard(cardId);
    if (!card || !anchor) return;
    cardMenuAnchor = anchor;
    const menu = document.createElement('div');
    menu.className = 'ctxmenu';
    menu.id = 'cardMenu';
    let html = '';
    // v47: на телефоне — выбор ширины карточки в клетках (1–4) и перенос на лист.
    // Стрелки ▲▼ убраны (освободили места); порядок карточек на телефоне будет
    // меняться перетаскиванием — это следующий шаг.
    if (!isDesktop()) {
      const cur = cardSpan(card);
      html += '<div class="menu-row"><span>' + esc(App.t('cardSize')) + '</span>' +
        [1, 2, 3, 4].map(function (n) {
          return '<button type="button" class="size-btn' + (n === cur ? ' on' : '') +
            '" data-m="span" data-n="' + n + '" aria-label="' + n + '">' + n + '</button>';
        }).join('') + '</div>';
      const ch = activeChar();
      if (ch && ch.pages.length > 1) {
        html += '<button type="button" data-m="page">' + esc(App.t('moveToPage')) + '…</button>';
      }
    }
    html += '<button type="button" data-m="edit">✎ ' + esc(App.t('edit')) + '</button>' +
            '<button type="button" data-m="dup">⧉ ' + esc(App.t('duplicate')) + '</button>' +
            '<button type="button" data-m="del">' + TRASH_SVG + ' ' + esc(App.t('delete')) + '</button>';
    menu.innerHTML = html;
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8));
    let top = r.bottom + 4;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    menu.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      const m = b.dataset.m;
      if (m === 'span') { setCardSpan(cardId, Number(b.dataset.n)); closeCardMenu(); return; }
      closeCardMenu();
      if (m === 'edit') openCardEditor(cardId);
      else if (m === 'dup') duplicateCard(cardId);
      else if (m === 'del') deleteCard(cardId);
      else if (m === 'page') openMoveToPage(cardId);
    });
    document.addEventListener('pointerdown', onCardMenuClose, true);
    window.addEventListener('resize', closeCardMenu);
    window.addEventListener('scroll', closeCardMenu, true);
  }
  function findCard(cardId) {
    const ch = activeChar();
    return ch ? ch.cards.find(function (c) { return c.id === cardId; }) : null;
  }
  // ===== Свертывание в ярлык (И, З, В) =====
  function foldable(card) { return !!FOLDABLE_ICONS[card.type]; }
  // Свернутость у ПК и телефона РАЗДЕЛЬНАЯ: на телефоне ярлык — состояние ПО УМОЛЧАНИЮ
  // (экономит место), на ПК карточка по умолчанию развернута. Поворот экрана не дергает карточки.
  function isCollapsed(card) {
    return isDesktop() ? !!card.collapsed : card.collapsedM !== false;
  }
  // фактический прямоугольник на холсте (у ярлыка — размер ярлыка): границы, пересечения
  function effW(c) { return isCollapsed(c) ? LABEL_W : (c.w || 300); }
  function effH(c) { return isCollapsed(c) ? LABEL_H : (c.h || 150); }
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
      case 'skill': return { value: null, die: 20, bonus: '', description: '', nDice: 1 };
      case 'spell': return { description: '', charges: { mode: 'own', current: 0, max: 0, linkId: null, cost: 1, emptyMode: 'block' }, die: null, bonus: '', restores: false };
      case 'currency': return {
        units: [
          { id: uid(), name: 'Серебро', base: 1 },
          { id: uid(), name: 'Золото', base: 10 },
          { id: uid(), name: 'Платина', base: 10 }
        ], amounts: {}, autoconvert: true
      };
      case 'inventory': return { items: [], showWeight: true };
      case 'note': return { text: '' };
      // v59: инициатива — строки участников, две фазы (подготовка/бой)
      case 'initiative': return {
        rows: [], phase: 'prep', round: 1, turnId: null,
        die: 20, newMode: 'roll', mini: false, hFull: 0
      };
      // v65: состояние — кукла-вуду + список активных состояний (снимки)
      case 'condition': return { conditions: [] };
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
      // v58: единая сетка — высоты по шагу 40 (80/120/160/200), ширины 143/300.
      // 143 + 14 (зазор) + 143 = 300: два счётчика ровно равны одной широкой карточке.
      case 'note': return { w: 300, h: 160 };
      case 'inventory': return { w: 300, h: 160 };
      case 'currency': return { w: 300, h: 120 };
      case 'spell': return { w: 300, h: 160 };        // 2 ряда треугольников + описание
      case 'skill': return { w: 300, h: 80 };         // шапка + значение (описание — сбоку, высоту не растит)
      case 'counter': return { w: 143, h: 120 };      // ровно половина широкой карточки
      case 'initiative': return { w: 300, h: 352 };  // 4 строки + добавление + кнопка хода
      // v65: состояние — фигура 236×305 + шапка и воздух; ресайз отключён.
      // v68: высота 360 — фигура 305 + шапка 18 + отступы 18 + запас 19
      case 'condition': return { w: 300, h: 360 };
      default: return { w: 300, h: 120 };
    }
  }
  // жёсткий минимум: чтобы содержимое карточки не обрезалось при сжатии.
  // Зависит от содержимого: валюты растут от числа единиц, инвентарь — от числа предметов.
  function minSize(card) {
    const type = card.type;
    let w = MIN_W, h = MIN_H;
    if (type === 'counter') { w = 143; h = 120; }   // половина широкой карточки
    if (type === 'skill') {
      // v58: компактная вёрстка — значение слева, описание сбоку. Минимум 160 по ширине
      // (дальше срабатывает «узкий» вид), высота 80 без описания и 90 с ним.
      w = 160;
      h = (card.description || '').trim() ? 90 : 80;
    }
    if (type === 'spell') {
      const sk = chargeSkeleton(card.charges ? chargeMaxUnits(card) : null);
      if (sk) {
        // фигуры: ширина 300, чтобы кнопка «Применить» не налезала на ячейки при сжатии
        w = 300;
        // v52: один ряд треугольников — ниже, два ряда — выше
        const rows = sk.bottom ? 2 : 1;
        h = rows === 2
          ? ((card.description || '').trim() ? 162 : 118)
          : ((card.description || '').trim() ? 132 : 88);
      } else h = MIN_H;   // тег вместо фигур — компактная карточка
    }
    if (type === 'inventory') {                 // предметы + строка итога веса
      const n = (card.items || []).length;
      h = Math.max(h, 62 + n * 30 + 22);        // 2 строки описания в предмете тоже учтены сверху (30/строка может не хватить — проверяется тестом)
    }
    if (type === 'currency') {                  // каждая валюта — строка ~28px
      const n = Math.max(2, (card.units || []).length);
      h = Math.max(h, 64 + n * 28);
    }
    if (type === 'initiative') {
      // карточка-окно: 4 строки минимум, выше — по высоте. Свёрнутая строка — 42.
      w = 300;
      h = card.mini ? 42 : 352;
    }
    // v65: состояние — фиксированный размер, фигура не должна сжиматься/обрезаться
    if (type === 'condition') { w = 300; h = 360; }
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
      // v8: «Стат» → «Навык»; v15: «Перк» → «Заклинание» (отличие было только в кубике),
      // у перка мог не быть charges — подставляем собственные;
      // v26: «Формула» → «Навык» (тип удалён: у навыка то же поле-выражение «значение»
      // плюс независимые галочки) — выражение переезжает в значение, кубик/бонус сохраняются
      if (card.type === 'stat') card.type = 'skill';
      if (card.type === 'perk') {
        card.type = 'spell';
        if (!card.charges) card.charges = { mode: 'own', current: 0, max: 0, linkId: null, cost: 1, emptyMode: 'block' };
      }
      if (card.type === 'formula') {
        card.type = 'skill';
        card.value = (card.expression && String(card.expression).trim() !== '') ? card.expression : null;
        delete card.expression;
      }
      // v32: галочка «запретить использование без ресурса» → выбор действия при нехватке.
      // Старые карты: блокировка была ВКЛ → «Запретить», ВЫКЛ → «Уйти в минус»
      // (поведение сохраняется один в один)
      if (card.charges && card.charges.emptyMode == null) {
        card.charges.emptyMode = card.charges.blockEmpty ? 'block' : 'negative';
        delete card.charges.blockEmpty;
      }
      if (card.x == null || card.y == null) autoPlace(ch, card);
      const mn = minSize(card);
      card.w = card.w == null ? defaultSize(card.type).w : Math.max(mn.w, card.w);
      card.h = card.h == null ? defaultSize(card.type).h : Math.max(mn.h, card.h);
      // v50: ширина карточки в мобильной сетке (1–4 клетки)
      if (card.span == null) card.span = defaultSpan(card.type);
      // v50: у навыка появились описание и количество кубиков
      if (card.type === 'skill') {
        if (card.nDice == null) card.nDice = 1;
        if (card.description == null) card.description = '';
      }
      // v68: «Состояние» — фиксированный размер; старые карточки v65 хранили 400
      if (card.type === 'condition') { card.w = 300; card.h = 360; }
    });
    // v40: ВСЕ счётчики разом приводим к единому компактному размеру (один раз на
    // персонажа — флаг в данных). Позиции не трогаем: уменьшение карточки не может
    // создать наложение, а раскладку юзера не ломаем.
    if (ch.compactCounters !== 1) {
      ch.cards.forEach(function (c) {
        if (c.type !== 'counter') return;
        c.w = defaultSize('counter').w;
        c.h = defaultSize('counter').h;
      });
      ch.compactCounters = 1;
    }
    // v58: единая сетка размеров. Карточки, стоящие ровно на СТАРЫХ дефолтах
    // (пользователь их не растягивал), подтягиваем к новым — иначе пустота останется
    // навсегда: размеры хранятся в данных. Растянутые вручную не трогаем.
    if (ch.sizes58 !== 1) {
      const OLD = { skill: [300, 110], spell: [300, 140], currency: [300, 170], inventory: [300, 200], note: [300, 220] };
      ch.cards.forEach(function (c) {
        const old = OLD[c.type];
        if (!old) return;
        if (c.w === old[0]) c.w = defaultSize(c.type).w;
        if (c.h === old[1]) c.h = Math.max(defaultSize(c.type).h, minSize(c).h);
      });
      ch.sizes58 = 1;
    }
  }

  function sizeCanvas() {
    const canvas = document.getElementById('canvas');
    if (!canvas) return;
    let maxY = 0;
    const ch = activeChar();
    if (ch) {
      const pageId = curPageId(ch);
      ch.cards.forEach(function (c) {
        if (c.x == null || c.page !== pageId) return;
        maxY = Math.max(maxY, c.y + c.h + 16);
      });
    }
    // полотно ровно по ширине окна (карточку за правый край не увести),
    // высота — от содержимого, но не меньше окна
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = Math.max(maxY, window.innerHeight - 60) + 'px';
  }

  function defaultCards() {
    const cards = [];
    cards.push(createCard('counter', 'Здоровье', { current: 10, max: 10, restores: true }));
    cards.push(createCard('counter', 'Мана', { current: 5, max: 5, restores: true }));
    cards.push(createCard('counter', 'Броня', { current: 10, max: null }));
    cards.push(createCard('counter', 'Временные HP', { current: 0, max: 0 }));
    cards.push(createCard('counter', 'Кости хитов', { current: 4, max: 4, restores: true }));
    cards.push(createCard('counter', 'Спасброски: успехи', { current: 0, max: 3 }));
    cards.push(createCard('counter', 'Спасброски: провалы', { current: 0, max: 3 }));
    cards.push(createCard('currency', 'Деньги', {}));
    return cards;
  }

  function newCharacter(name) {   // единственный путь создания: и из меню, и стартовый персонаж при пустом хранилище
    const ch = { id: uid(), name: name || App.t('newCharName'), cards: defaultCards() };
    layoutCharacter(ch);
    state.characters.push(ch);
    state.activeCharacterId = ch.id;
    return ch;
  }

  // ===== Values / expressions =====
  function chargesCurrent(card) {
    const ch = card.charges || {};
    if (ch.mode === 'link') {
      const t = findCard(ch.linkId);
      return t && t.type === 'counter' ? num(t.current) : 0;
    }
    return num(ch.current);
  }
  function cardBonus(card) {
    let base = 0;
    if (card.bonus != null && String(card.bonus).trim() !== '') {
      try { base = evalCardExpr(card, card.bonus, 'bonus'); }
      catch (e) { base = 0; }
    }
    // модификаторы состояний применяются и к пустому бонусу: «+2 к атаке» должно работать
    // у навыка, где бонус не вписан
    const v = applyMods(card, 'bonus', base);
    return Number.isFinite(v) ? v : base;
  }
  // ===== Выражения со ссылками в полях (v25) =====
  // Поля бонуса/максимума/значения хранят строку вида «2 + {Мана}» или «{Имя}.бонус».
  // evalCardExpr подставляет текущие числа карточек; exprVisiting защищает от циклов
  // между полями (бонус → формула → бонус той же карточки и т.п.).
  // v36: field — какое поле карточки считаем ('bonus'/'value'/...). Защита от циклов
  // ведётся по паре «карточка+поле»: бонус навыка может ссылаться на своё значение,
  // и это не цикл, хотя формально это та же карточка.
  const exprVisiting = new Set();
  function evalCardExpr(card, input, field) {
    const s = String(input == null ? '' : input).trim();
    if (s === '') return 0;
    const key = card.id + ':' + (field || 'any');
    if (exprVisiting.has(key)) { const e = new Error('cycle'); e.cycle = true; throw e; }
    exprVisiting.add(key);
    try {
      return App.formula.evaluate(s, function (name, part) {
        const target = findCardByName(name);
        if (!target) throw new Error(name);
        if (target.id === card.id) {
          // ссылка на СЕБЯ: только бонусу навыка и только на своё ЗНАЧЕНИЕ
          // (просьба юзера — бонус = доля значения). Значение навыка от бонуса не
          // зависит, поэтому цикла нет; {Имя.бонус} и ссылки на себя в максимуме/
          // значении/зарядах по-прежнему ошибка
          if (field !== 'bonus' || part === 'bonus' || card.type !== 'skill') throw new Error('self');
          return skillValueNum(card);
        }
        return part === 'bonus' ? cardBonus(target) : cardValue(target);
      });
    } finally { exprVisiting.delete(key); }
  }
  // выражение → число; число проходит как есть; битая ссылка/пустота → null (без предела)
  function exprNumber(card, input) {
    if (input == null) return null;
    if (typeof input === 'number') return input;
    try { const v = evalCardExpr(card, input); return Number.isFinite(v) ? v : null; }
    catch (e) { return null; }
  }
  // максимум счётчика (число или выражение), null — без предела
  function counterMaxNum(card) {
    const v = applyMods(card, 'max', exprNumber(card, card.max));
    return (v == null || !Number.isFinite(v)) ? null : v;
  }
  // максимум собственных зарядов заклинания
  function chargesMaxNum(card) {
    const v = applyMods(card, 'charges', exprNumber(card, card.charges ? card.charges.max : null));
    return (v == null || !Number.isFinite(v)) ? null : v;
  }
  // значение навыка (число или выражение)
  function skillValueNum(card) {
    if (card.value == null) return applyMods(card, 'value', 0);
    let base = 0;
    if (typeof card.value === 'number') base = num(card.value);
    else { try { base = evalCardExpr(card, card.value, 'value'); } catch (e) { base = 0; } }
    const v = applyMods(card, 'value', base);
    return Number.isFinite(v) ? v : base;
  }
  // все строковые поля карточки, где могут быть ссылки {Имя} (переименование/удаление)
  function cardExprFields(c) {
    // поля-выражения всех карточек уже включают c.value; expression удалён вместе с типом «формула»
    return [c.bonus, c.max, c.value, c.charges && c.charges.max]
      .filter(function (v) { return v != null && typeof v !== 'number' && String(v).indexOf('{') !== -1; })
      .map(String);
  }
  function cardValue(card) {
    switch (card.type) {
      case 'counter': return num(card.current);
      case 'skill': return skillValueNum(card);
      case 'spell': return chargesCurrent(card);
      default: return 0;
    }
  }

  // ===== Модификаторы (v77) =====
  // Активное состояние меняет ПРОИЗВОДНЫЕ числа карточек-целей на лету: бонус навыка,
  // максимум счётчика, значение навыка, максимум зарядов. current не трогаем никогда —
  // «−3 HP» применялось бы на каждом рендере и жгло персонажа бесконечно (изменение
  // текущего — это тик, слой 2, а не модификатор, слой 1).
  // Порядок фиксирован: add → mul → set → cap. Иначе результат зависел бы от того,
  // в каком порядке игрок включал состояния.
  const MOD_ORDER = { add: 1, mul: 2, set: 3, cap: 4 };
  // какие числа можно менять у каждого типа карточки (для формы «на что влияет»)
  const MOD_FIELDS = {
    counter: ['max', 'current'],
    skill: ['bonus', 'value'],
    spell: ['bonus', 'charges']
  };

  // Индекс строится один раз за рендер: так каждая карточка не бегает по всем
  // состояниям листа (иначе O(карточки × состояния) на каждый render).
  let modIndexCache = null;
  function invalidateMods() { modIndexCache = null; }
  function modIndex() {
    if (modIndexCache) return modIndexCache;
    const byTarget = {}, blocks = {};
    const ch = activeChar();
    if (ch) (ch.cards || []).forEach(function (card) {
      if (card.type !== 'condition') return;
      (card.conditions || []).forEach(function (s) {
        (s.effects || []).forEach(function (ef) {
          if (!ef || !ef.target) return;              // флаг без цели на числа не влияет
          if (ef.mode === 'block') { blocks[ef.target] = ef.label || s.name || ''; return; }
          (byTarget[ef.target] || (byTarget[ef.target] = [])).push({ ef: ef, source: s.name || '' });
        });
      });
    });
    modIndexCache = { byTarget: byTarget, blocks: blocks };
    return modIndexCache;
  }

  function modsFor(card, field) {
    const list = (modIndex().byTarget[card.id] || []).filter(function (it) {
      return (it.ef.field || 'bonus') === field && MOD_ORDER[it.ef.mode];
    });
    // внутри режима сохраняется порядок включения (sort в JS стабилен)
    return list.slice().sort(function (a, b) { return MOD_ORDER[a.ef.mode] - MOD_ORDER[b.ef.mode]; });
  }

  // значение эффекта — выражение: «-{Уровень}», «1/3». В режиме умножения люди пишут
  // «*0.5» — звёздочку прощаем. Битая ссылка и деление на ноль → эффект пропускается.
  function modNumber(card, expr, mode) {
    let s = String(expr == null ? '' : expr).trim();
    if (!s) return null;
    if (mode === 'mul' && /^[*×]/.test(s)) s = s.slice(1);
    if (mode === 'add' && s[0] === '+') s = s.slice(1);
    const n = exprNumber(card, s);
    return (n == null || !Number.isFinite(n)) ? null : n;
  }

  function applyMods(card, field, base) {
    const list = modsFor(card, field);
    if (!list.length) return base;
    let v = base;
    list.forEach(function (it) {
      const ef = it.ef;
      const n = modNumber(card, ef.value, ef.mode);
      if (n == null) return;
      if (ef.mode === 'add') { if (v == null) return; v = v + n; }
      else if (ef.mode === 'mul') { if (v == null) return; v = v * n; }
      else if (ef.mode === 'set') v = n;
      else if (ef.mode === 'cap') { if (v == null) return; v = Math.min(v, n); }
    });
    return v;
  }

  // доп. кубики к броску (режим dice): «1d6», «2d8»
  function diceEffectsFor(card) {
    // v79: кубик добавляется только к бонусу (к броску). «Кубик в значение»
    // раньше молча прибавлялся к броску — это было не то, что видел игрок.
    return (modIndex().byTarget[card.id] || []).filter(function (it) {
      return it.ef.mode === 'dice' && effectField(it.ef) === 'bonus';
    });
  }
  function rollEffectDice(card) {
    const out = { total: 0, parts: [] };
    diceEffectsFor(card).forEach(function (it) {
      const m = /^\s*(\d*)d(\d+)\s*$/i.exec(String(it.ef.value == null ? '' : it.ef.value));
      if (!m) return;                                // мусор в поле молча пропускаем
      const count = Math.max(1, parseInt(m[1], 10) || 1);
      const sides = parseInt(m[2], 10);
      if (!(sides > 1)) return;
      for (let i = 0; i < count; i++) {
        const r = App.dice.roll(sides);
        out.total += r;
        out.parts.push({ label: String(it.ef.label || it.source || ''), sides: sides, value: r });
      }
    });
    return out;
  }

  // запрет броска (режим block): возвращает причину или пустую строку
  function blockedBy(card) { return modIndex().blocks[card.id] || ''; }

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
  // v55: крит-значения из настроек («20» / «10,20»), пусто — обычный бросок
  function critValues(str) {
    return String(str == null ? '' : str).split(',').map(function (x) { return parseInt(x, 10); })
      .filter(function (n) { return Number.isFinite(n); });
  }
  function critKind(rolled) {
    const s = state.settings || {};
    if (critValues(s.critSuccess).indexOf(rolled) !== -1) return 'success';
    if (critValues(s.critFail).indexOf(rolled) !== -1) return 'fail';
    return '';
  }
  // v57: звёзды крит-успеха — вылетают ИЗ ЦЕНТРА наружу, зеркало осколков провала.
  // dx/dy — конечная точка полёта, rot — доворот звезды за время полёта.
  const CRIT_STARS = [
    [-138, -34, 110, 20, '.02s'], [134, -42, -96, 17, '.06s'],
    [-150, 14, 160, 14, '.10s'], [146, 22, -142, 22, '.01s'],
    [-112, 48, 74, 15, '.13s'], [108, 52, -68, 18, '.08s'],
    [-154, -8, 200, 12, '.15s'], [152, -6, -208, 13, '.12s'],
    [-72, -62, 128, 16, '.04s'], [74, -58, -118, 15, '.09s'],
    [-34, 66, 90, 13, '.16s'], [36, 64, -84, 12, '.18s']
  ];
  function critStarsHTML() {
    return '<div class="rt-stars" aria-hidden="true">' + CRIT_STARS.map(function (s, i) {
      return '<i class="rt-star" style="--dx:' + s[0] + 'px;--dy:' + s[1] + 'px;--rot:' + s[2] +
        'deg;--size:' + s[3] + 'px;--delay:' + s[4] + '">' + (i % 2 ? '✧' : '✦') + '</i>';
    }).join('') + '</div>';
  }
  function showRollToast(rolled, bonus, total, modsHTML) {
    let host = document.getElementById('rollToast');
    if (!host) {
      host = document.createElement('div');
      host.id = 'rollToast';
      document.body.appendChild(host);
    }
    clearInterval(rollToastTimer);
    clearTimeout(rollToastHideTimer);
    const kind = critKind(rolled);
    // Крит по логике НРИ — «всё или ничего»: бонус уже не важен, показываем только
    // выпавшее число, без «+N =». Иначе игрок считает 20+5=25 и спорит с правилами.
    host.innerHTML =
      (kind
        ? '<div class="rt-row"><span class="rt-total">' + rolled + '</span></div>'
        : (bonus
          ? '<div class="rt-row"><span class="rt-die">' + rolled + '</span><span class="rt-bonus">' + (bonus > 0 ? '+' : '−') + Math.abs(bonus) + '</span><span class="rt-eq">=</span><span class="rt-total">' + total + '</span></div>'
          : '<div class="rt-row"><span class="rt-total">' + total + '</span></div>') +
          // разложка источников: на крите не показываем («всё или ничего»), иначе
          // игрок складывает 20 + бонус и спорит с правилами
          (!kind && modsHTML ? modsHTML : '')) +
      // провал — осколки снаружи к центру, успех — звёзды из центра наружу
      (kind === 'fail' ? '<div class="rt-shards" aria-hidden="true">' +
        '<i class="rt-shard" style="--dx:-118px;--dy:-46px;--rot:-62deg;--size:12px;--delay:.02s"></i>' +
        '<i class="rt-shard" style="--dx:112px;--dy:-52px;--rot:74deg;--size:11px;--delay:.05s"></i>' +
        '<i class="rt-shard" style="--dx:-132px;--dy:6px;--rot:132deg;--size:9px;--delay:.08s"></i>' +
        '<i class="rt-shard" style="--dx:126px;--dy:18px;--rot:-118deg;--size:13px;--delay:.01s"></i>' +
        '<i class="rt-shard" style="--dx:-86px;--dy:44px;--rot:42deg;--size:8px;--delay:.11s"></i>' +
        '<i class="rt-shard" style="--dx:88px;--dy:46px;--rot:156deg;--size:11px;--delay:.07s"></i>' +
        '<i class="rt-shard" style="--dx:-146px;--dy:-20px;--rot:210deg;--size:7px;--delay:.14s"></i>' +
        '<i class="rt-shard" style="--dx:146px;--dy:-16px;--rot:-35deg;--size:8px;--delay:.12s"></i>' +
        '<i class="rt-shard" style="--dx:24px;--dy:-62px;--rot:95deg;--size:7px;--delay:.04s"></i>' +
        '<i class="rt-shard" style="--dx:-26px;--dy:62px;--rot:-90deg;--size:9px;--delay:.09s"></i>' +
        '</div>'
        : (kind === 'success' ? critStarsHTML() : ''));
    host.classList.remove('rt-hide', 'success', 'fail', 'play');
    if (kind) host.classList.add(kind);
    if (animOn()) {
      if (kind) { void host.offsetWidth; host.classList.add('play'); }
      else popOnce(host, 'rt-pop');
    }
    rollToastTimer = setTimeout(function () { host.classList.add('rt-hide'); }, 1800);
    rollToastHideTimer = setTimeout(function () { host.innerHTML = ''; host.classList.remove('success', 'fail', 'play'); }, 2200);
  }
  function rollCard(card) {
    if (!card.die) return;
    // v78: запрет состояния гасит «Применить», а не кубик. Бросок остаётся обычным —
    // так просил юзер: зачёркивать кнопку действия, а не сам кубик.
    const bonus = cardBonus(card);
    // v50: у навыка может быть несколько кубиков (2d20 и т.п.) — бросаем все и суммируем
    const n = Math.max(1, Math.round(num(card.nDice) || 1));
    const rolls = [];
    for (let i = 0; i < n; i++) rolls.push(App.dice.roll(card.die));
    const dieRoll = rolls.reduce(function (a, b) { return a + b; }, 0);
    // доп. кубики от состояний (режим dice) — бросаются вместе с основным
    const extra = rollEffectDice(card);
    const total = dieRoll + bonus + extra.total;
    const detail = cardDiceLabel(card) + bonusStr(bonus);
    const rollText = n > 1 ? rolls.join(' + ') + ' = ' + dieRoll : String(dieRoll);
    const text = card.name + ' (' + detail + '): ' + rollText +
      (extra.total ? ' + ' + extra.total + ' (состояния)' : '') +
      (bonus ? (bonus > 0 ? ' + ' : ' − ') + Math.abs(bonus) + ' = ' + total : (extra.total ? ' = ' + total : ''));
    logRoll(text);
    commit();
    showRollToast(dieRoll, bonus + extra.total, total, rollModsHTML(card, extra));
  }

  // разложка модификаторов под тостом броска: без неё непонятно, откуда взялось число
  function rollModsHTML(card, extra) {
    const parts = [];
    modsFor(card, 'bonus').forEach(function (it) {
      const ef = it.ef;
      if (ef.mode === 'set' || ef.mode === 'cap') return;   // замену и потолок словами не разложить
      const n = modNumber(card, ef.value, ef.mode);
      if (n == null) return;
      // своя подпись важнее вычисленной: «−2 к броскам» читается лучше, чем «−2 Отравлен».
      // Карандаш помечает, что текст задан вручную, а не собран из режима и числа.
      const sign = (ef.mode === 'mul') ? '×' + n : (n > 0 ? '+' : '−') + Math.abs(n);
      const text = ef.label ? '✎ ' + ef.label : sign + ' ' + (it.source || '');
      parts.push('<span class="rt-mod">' + esc(text) + '</span>');
    });
    (extra && extra.parts ? extra.parts : []).forEach(function (p) {
      parts.push('<span class="rt-mod">' + esc('+' + p.value + ' d' + p.sides + ' ' + (p.label || '')) + '</span>');
    });
    return parts.length ? '<div class="rt-mods">' + parts.join('') + '</div>' : '';
  }

  // ===== Card actions =====
  function useCharge(card) {
    // v78: запрет («Немота») гасит именно «Применить», поэтому и здесь страхуемся:
    // кнопка disabled, но горячие клавиши/старый DOM не должны обойти запрет
    const why = blockedBy(card);
    if (why) { toast(App.tf('useBlocked', { why: why })); return; }
    const ch = card.charges || {};
    // v32: действие при нехватке основного ресурса (миграция blockEmpty → emptyMode;
    // fallback — старая логика на случай старых снапшотов undo). Резерв тратится ТИХО
    // (решение юзера: без каскадов и без уведомлений); если резерва не хватило —
    // как «Запретить» (штатный toast)
    const emptyMode = ch.emptyMode || (ch.blockEmpty ? 'block' : 'negative');
    const spendReserve = function (amount) {
      const res = findCard(ch.reserveId);
      if (!res || res.type !== 'counter' || num(res.current) < amount) return false;
      mutate(function () { res.current = num(res.current) - amount; });
      return true;
    };
    if (ch.mode === 'link') {
      const target = findCard(ch.linkId);
      if (!target || target.type !== 'counter') return;
      const cost = num(ch.cost) || 1;
      if (num(target.current) >= cost) { mutate(function () { target.current = num(target.current) - cost; }); return; }
      // нехватка основного
      if (emptyMode === 'reserve' && spendReserve(cost)) return;
      if (emptyMode !== 'negative') { toast(App.tf('insufficientLinked', { name: target.name })); return; }
      mutate(function () { target.current = num(target.current) - cost; });   // уйти в минус
      return;
    }
    if (num(ch.current) > 0) { mutate(function () { ch.current = num(ch.current) - 1; }); return; }
    // нехватка основного (собственные заряды тратятся по 1)
    if (emptyMode === 'reserve' && spendReserve(1)) return;
    if (emptyMode !== 'negative') { toast(App.t('insufficient')); return; }
    mutate(function () { ch.current = num(ch.current) - 1; });
  }

  function handleAction(cardId, ds, e) {
    const card = findCard(cardId);
    if (!card) return;
    const act = ds.act;
    if (act === 'inc') mutate(function () { card.current = num(card.current) + counterStep(card.id); });
    else if (act === 'dec') mutate(function () { card.current = num(card.current) - counterStep(card.id); });
    else if (act === 'card-menu') openCardMenu(card.id, e && e.currentTarget);
    else if (act === 'roll') rollCard(card);
    else if (act === 'use') useCharge(card);
    else if (act === 'chg-drum') openChargeDrum(card);
    else if (act === 'pip') {
      // клик по треугольнику: заряды заполняются до этой ячейки (и опустошаются после неё).
      // Порядок — сверху вниз: 1..6 верхний ряд, 7..12 нижний
      if (card.charges && card.charges.mode !== 'link') {
        const max = chargesMaxNum(card);
        const cur = num(card.charges.current);
        let next = Math.max(0, num(ds.i) || 0) + 1;
        if (max != null) next = Math.min(next, num(max));
        if (next === cur) return;   // клик мимо запаса (сверх максимума) — ничего не меняем
        mutate(function () { card.charges.current = next; });
      } else {
        // связанные ячейки только показывают остаток счётчика: пополнять их кликами нельзя
        const tgt = card.charges && card.charges.linkId ? findCard(card.charges.linkId) : null;
        if (tgt) toast(App.tf('refillRes', { name: tgt.name }));
      }
    }
    else if (act === 'curr-inc') mutate(function () { card.amounts[ds.unit] = num(card.amounts[ds.unit]) + 1; normalizeCurrency(card); });
    else if (act === 'curr-dec') mutate(function () {
      const current = num(card.amounts[ds.unit]);
      if (current > 0) {
        card.amounts[ds.unit] = current - 1;
        normalizeCurrency(card);
      }
    });
    else if (act === 'curr-custom-inc') openCurrencyDelta(card, ds.unit, 1, e && e.currentTarget);
    else if (act === 'curr-custom-dec') openCurrencyDelta(card, ds.unit, -1, e && e.currentTarget);
    else if (act === 'item-del') {
      const item = (card.items || []).find(function (i) { return i.id === ds.item; });
      const itemName = item ? item.name : '';
      confirmDialog(App.tf('confirmDeleteItem', { name: itemName }), function () {
        mutate(function () { card.items = card.items.filter(function (i) { return i.id !== ds.item; }); });
      });
    }
    else if (act.indexOf('ini-') === 0) handleInitiative(card, act, ds, e);
  }

  // ===== Действия карточки «Инициатива» (v59) =====
  let iniPreviewTimer = null;
  function handleInitiative(card, act, ds, e) {
    const el = e && e.currentTarget ? e.currentTarget.closest('.card') : null;

    if (act === 'ini-roll-all') {
      const s = iniDie(card);
      mutate(function () {
        iniRows(card).forEach(function (r) { r.value = 1 + Math.floor(Math.random() * s) + num(r.bonus); });
        card.viewManual = false;
      });
      toast(App.t('iniRolledAll'));
      return;
    }

    if (act === 'ini-roll') {
      const row = iniRows(card).find(function (r) { return r.id === ds.row; });
      if (!row) return;
      const s = iniDie(card);
      const val = 1 + Math.floor(Math.random() * s) + num(row.bonus);
      mutate(function () {
        row.value = val;
        card.focusId = row.id;
        card.viewManual = false;
      });
      toast(App.tf('iniRolledOne', { name: row.name, v: val }));
      return;
    }

    if (act === 'ini-add') {
      const inp = el ? el.querySelector('.ini-add-input') : null;
      const name = inp ? inp.value.trim() : '';
      if (!name) { if (inp) inp.focus(); return; }
      const s = iniDie(card);
      let value = null;
      if (card.phase === 'battle') {
        if (card.newMode === 'last') {
          const vals = iniRows(card).filter(iniFilled).map(function (r) { return Number(r.value); });
          value = vals.length ? Math.min.apply(null, vals) : 1 + Math.floor(Math.random() * s);
        } else {
          value = 1 + Math.floor(Math.random() * s);
        }
      }
      const row = { id: uid(), name: name, value: value, bonus: 0, seq: iniRows(card).length + 1, out: false };
      card.previewId = row.id;
      card.focusId = row.id;
      card.viewManual = false;
      mutate(function () { iniRows(card).push(row); });
      if (inp) inp.value = '';

      const pos = iniOrder(card).findIndex(function (r) { return r.id === row.id; }) + 1;
      if (card.phase === 'battle') {
        toast(App.tf('iniPlaced', { name: name, v: value == null ? '—' : value, n: pos }));
      } else {
        toast(App.tf('iniAdded', { name: name }));
      }

      clearTimeout(iniPreviewTimer);
      iniPreviewTimer = setTimeout(function () {
        // v63: в подготовке остаёмся на новом участнике (он там, где его добавили);
        // в бою окно само вернётся к текущему ходу — focusId в бою не используется
        card.previewId = null;
        render();
      }, 2200);
      return;
    }

    if (act === 'ini-del') {
      const row = iniRows(card).find(function (r) { return r.id === ds.row; });
      if (!row) return;
      // в бою первый клик — «выбыл», второй — убрать; в подготовке сразу убираем
      if (card.phase === 'battle' && !row.out) {
        mutate(function () { row.out = true; });
        return;
      }
      mutate(function () {
        card.rows = iniRows(card).filter(function (r) { return r.id !== row.id; });
        if (card.phase === 'battle' && card.turnId === row.id) {
          const order = iniSorted(card);
          card.turnId = order.length ? order[0].id : null;
        }
      });
      return;
    }

    if (act === 'ini-back') {
      const row = iniRows(card).find(function (r) { return r.id === ds.row; });
      if (row) mutate(function () { row.out = false; });
      return;
    }

    if (act === 'ini-scroll') {
      mutate(function () {
        const len = iniOrder(card).length;
        const maxStart = Math.max(0, len - iniWin(card));
        card.viewStart = Math.max(0, Math.min(maxStart, (num(card.viewStart) || 0) + (num(ds.d) || 0)));
        card.viewManual = true;
      });
      return;
    }

    if (act === 'ini-pass') {
      if (card.phase !== 'battle') {
        const total = iniRows(card).length;
        const filled = iniFilledCount(card);
        if (!total) { toast(App.t('iniNoRows')); return; }
        if (filled < total) { toast(App.tf('iniMissing', { n: total - filled })); return; }
        const order = iniSorted(card);
        const first = order[0];
        let sum = null;
        mutate(function () {
          card.phase = 'battle';
          card.round = 1;
          card.turnId = first.id;
          card.viewStart = 0;
          card.viewManual = false;
          sum = applyInitiativeTicks(card, null, first);
        });
        iniFlash(card, App.t('iniRound') + ' 1');
        const msg = ticksSummary(sum);
        if (msg) toast(msg);
        return;
      }
      const order = iniSorted(card);
      if (!order.length) return;
      if (card._iniAdvancing) return;
      const i = order.findIndex(function (r) { return r.id === card.turnId; });
      if (i === order.length - 1) {
        // последний в раунде: сначала полоса доходит до 100 %, потом «Раунд N+1»
        const bar = document.querySelector('.card[data-id="' + card.id + '"] .ini-prog i');
        if (bar) bar.style.width = '100%';
        card._iniAdvancing = true;
        const prev = iniCur(card);
        const first = order[0];
        setTimeout(function () {
          card._iniAdvancing = false;
          let sum = null;
          mutate(function () {
            card.round = (num(card.round) || 1) + 1;
            card.turnId = first.id;
            card.viewStart = 0;
            card.viewManual = false;
            sum = applyInitiativeTicks(card, prev, first);
          });
          iniFlash(card, App.t('iniRound') + ' ' + card.round);
          const msg = ticksSummary(sum);
          if (msg) toast(msg);
        }, 340);
      } else {
        const prev = iniCur(card);
        const next = order[i + 1];
        let sum = null;
        mutate(function () {
          sum = applyInitiativeTicks(card, prev, next);
          card.turnId = next.id;
        });
        const msg = ticksSummary(sum);
        if (msg) toast(msg);
      }
      return;
    }

    if (act === 'ini-flag') {
      const prev = {
        phase: card.phase, round: num(card.round) || 1, turnId: card.turnId,
        h: num(card.h) || 352,
        values: iniRows(card).map(function (r) { return r.value; })
      };
      mutate(function () {
        if (card.phase === 'battle') {
          card.phase = 'prep';
          card.round = 1;
          card.turnId = null;
          // v64: бой окончен — значения инициативы устарели, чистим (как «сброс»);
          // откат вернёт их обратно вместе с ходом и раундом
          iniRows(card).forEach(function (r) { r.value = null; r.out = false; });
        }
        card.hFull = card.h;
        card.mini = true;
        card.h = 42;
        card.viewStart = 0;
        card.viewManual = false;
      });
      if (prev.phase === 'battle') {
        showUndoToast(App.t('iniFinished'), function () {
          mutate(function () {
            card.phase = prev.phase;
            card.round = prev.round;
            card.turnId = prev.turnId;
            card.mini = false;
            card.h = prev.h;
            iniRows(card).forEach(function (r, i) { r.value = prev.values[i] == null ? null : prev.values[i]; });
          });
        });
      }
      return;
    }

    if (act === 'ini-expand') {
      mutate(function () {
        card.mini = false;
        card.h = num(card.hFull) || defaultSize('initiative').h;
      });
      return;
    }
  }

  // тост с кнопкой «Вернуть» — чтобы случайный флаг можно было отменить
  let undoTimer = null;
  function showUndoToast(text, onUndo) {
    let el = document.getElementById('undoToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'undoToast';
      document.body.appendChild(el);
    }
    el.innerHTML = '<span>' + esc(text) + '</span><button type="button">' + esc(App.t('iniUndo')) + '</button>';
    el.classList.add('show');
    clearTimeout(undoTimer);
    undoTimer = setTimeout(function () { el.classList.remove('show'); }, 5000);
    el.querySelector('button').onclick = function () {
      clearTimeout(undoTimer);
      el.classList.remove('show');
      onUndo();
    };
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
      // v22: знак кнопки участвует в расчёте — «−−» должна уменьшать, а не прибавлять введённое
      if (v) mutate(function () { applyFn(sign * v); });
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
  // v40: шаг изменения счётчика. Живёт в памяти (в данных не сохраняется), чтобы
  // перерисовка карточки после ± не сбрасывала введённое число; очищается кликом
  // мимо карточки и Esc — как в стенде.
  const counterSteps = new Map();          // cardId → шаг (целое > 0)
  function counterStep(cardId) {
    const v = counterSteps.get(cardId);
    return v && v > 0 ? v : 1;
  }
  function readStepInput(inp) {
    const id = inp.dataset.step;
    if (!id) return;
    const clean = String(inp.value || '').replace(/[^\d]/g, '');
    if (clean !== inp.value) inp.value = clean;   // только цифры
    const n = parseInt(clean, 10);
    if (n > 0) counterSteps.set(id, n); else counterSteps.delete(id);
  }
  function clearCounterSteps() {
    if (!counterSteps.size) return;
    counterSteps.clear();
    document.querySelectorAll('.step-input').forEach(function (i) { i.value = ''; });
  }
  function openCurrencyDelta(card, unitId, sign, anchor) {
    const row = document.querySelector('.card[data-id="' + card.id + '"] .currency-row[data-unit="' + unitId + '"]');
    if (!row) return;
    anchor = anchor || row.querySelector(sign > 0 ? '.counter-more.plus' : '.counter-more.minus');
    if (!anchor) return;
    deltaPop(anchor, sign, function (v) {
      const current = num(card.amounts[unitId]) || 0;
      // v23: не даём значению стать меньше нуля
      if (sign > 0 || current + v >= 0) {
        card.amounts[unitId] = current + v;
        normalizeCurrency(card);
      }
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

  // перегенерация внутренних ID карточек: units/items всегда, card.id и charges.linkId — когда
  // передан idMap (импорт, дублирование персонажа). Помощник один — вызывают дубликат и импорт.
  function renewIds(cards, idMap) {
    cards.forEach(function (c) {
      if (idMap) { const nu = uid(); idMap[c.id] = nu; c.id = nu; }
      if (c.type === 'currency' && c.units) {
        const umap = {};
        c.units.forEach(function (u) { const nu = uid(); umap[u.id] = nu; u.id = nu; });
        const na = {};
        for (const k in (c.amounts || {})) if (umap[k]) na[umap[k]] = c.amounts[k];
        c.amounts = na;
      }
      if (c.type === 'inventory' && c.items) c.items.forEach(function (it) { it.id = uid(); });
      if (idMap && c.charges && c.charges.mode === 'link' && c.charges.linkId) {
        c.charges.linkId = idMap[c.charges.linkId] || null;
      }
    });
  }

  function duplicateCard(cardId) {
    const ch = activeChar();
    const card = findCard(cardId);
    if (!ch || !card) return;
    mutate(function () {
      const copy = JSON.parse(JSON.stringify(card));
      copy.id = uid();           // новый id копии ОБЯЗАТЕЛЕН: id ищется/удаляется/анимируется по data-id,
                                 // общий id ломает удаление дубля, заряды и Ctrl+Z (баг v17-дублей)
      renewIds([copy], null);    // внутренние id (units/items); linkId НЕ ремапим — цель внешняя
      // Имя-источник может само быть копией («Мана (2)») — номер всегда считаем
      // от КОРНЯ, иначе получается «Мана (2) (2)» (баг, найден юзером на скриншоте).
      // Нумерация с единицы: Мана → Мана (1) → Мана (2) …; если какой-то номер
      // освободился (карточку удалили), он и займётся первым.
      const base = card.name.replace(/\s*\(\d+\)\s*$/, '');
      let i = 1, nm = base;
      // v65: у «Состояния» имя может быть пустым — копия тоже остаётся без подписи
      if (base) { while (ch.cards.some(function (c) { return c.name === nm; })) { nm = base + ' (' + i + ')'; i++; } }
      copy.name = nm;
      if (copy.x != null) { copy.x += 24; copy.y += 24; }
      ch.cards.push(copy);
    });
  }

  function deleteCard(cardId) {
    const ch = activeChar();
    const card = findCard(cardId);
    if (!ch || !card) return;
    // кто зависит от удаляемой карточки: ссылки в формулах, бонусах, максимумах,
    // значениях и в максимумах зарядов (v25) + заклинания со связанными зарядами
    const name = card.name;
    const refs = ch.cards.filter(function (c) {
      if (c.id === cardId) return false;
      return cardExprFields(c).some(function (s) { return App.formula.hasRef(s, name); });
    });
    const linked = ch.cards.filter(function (c) { return c.id !== cardId && c.type === 'spell' && c.charges && c.charges.mode === 'link' && c.charges.linkId === cardId; });
    let msg = '';
    if (refs.length) msg += App.t('referencedBy') + ' ' + refs.map(function (r) { return r.name; }).join(', ');
    if (linked.length) {
      if (msg) msg += ' ';
      msg += App.tf('linkedBy', { name: linked.map(function (l) { return l.name; }).join(', ') });
    }
    const confirmMsg = msg || App.tf('confirmDeleteCard', { name: name });
    confirmDialog(confirmMsg, function () { doDeleteCard(cardId); });
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
          const mx = counterMaxNum(c);   // максимум может быть выражением — считаем на момент отдыха
          c.current = mx == null ? 0 : num(mx);
        } else if (c.type === 'spell' && c.charges && c.charges.mode === 'own') {
          const mx = chargesMaxNum(c);
          c.charges.current = mx == null ? 0 : num(mx);
        }
      });
    });
    toast(App.t('restApplied'));
  }
  function confirmRest() {   // «Отдых» восполняет всё сразу — спрашиваем подтверждение
    const ch = activeChar();
    if (!ch || !ch.cards.some(function (c) { return c.restores; })) { toast(App.t('nothingToRest')); return; }
    confirmDialog(App.t('restConfirm'), doRest, App.t('rest'), { no: App.t('no'), yes: App.t('yes'), yesCls: 'primary' });
  }

  // ===== Undo / redo =====
  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    const s = undoStack.pop();
    state.characters = s.characters;
    state.activeCharacterId = s.activeCharacterId;
    save(); render();
    if (layerCardId) refreshLayer();   // слой не должен переживать свои данные
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    const s = redoStack.pop();
    state.characters = s.characters;
    state.activeCharacterId = s.activeCharacterId;
    save(); render();
    if (layerCardId) refreshLayer();
  }

  // ===== Rendering =====
  function render() {
    // модификаторы пересобираются на каждый рендер: undo/redo и импорт меняют
    // состояние в обход commit(), а индекс обязан быть свежим (кэш — один на рендер)
    invalidateMods();
    renderHeader();
    renderTabs();
    renderCanvas();
    renderLog();
    updateFab();
  }
  function updateFab() {
    document.getElementById('fab').classList.toggle('hidden', !editMode || !activeChar());
  }

  // Накладка ↺/↻: на ПК клавиши Ctrl+Z / Ctrl+Y (и Ctrl+Shift+Z), кнопки в шапке — только телефон
  function addUndoKeys() {
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // v20d: сравниваем ФИЗИЧЕСКУЮ клавишу e.code, а не e.key — на русской раскладке
      // Ctrl+Z даёт key='я' (и Ctrl+Y='н'), из-за чего отмена молча не срабатывала.
      // e.code='KeyZ'/'KeyY' не зависит от языка раскладки.
      if (e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (e.code === 'KeyY' || (e.code === 'KeyZ' && e.shiftKey)) { e.preventDefault(); redo(); }
    });
  }

  function renderHeader() {
    const bar = document.getElementById('topbar');
    const ch = activeChar();
    const desktop = isDesktop();
    // v19: мобильный ряд — [✎/✓ Правка] [⚄ Кубики] [⋮ кебаб: Отдых/История/Назад/Вперед];
    // ↶↷ из узкой шапки убраны (переехали в кебаб); карандаш ✎ вместо 🖉 (тофу-квадрат на Android)
    const editGlyph = editMode ? '✓' : '✎';
    const editBtnHtml =
      '<button class="icon" id="editModeBtn" title="' + esc(App.t('editMode')) + '">' + editGlyph + '</button>';
    const diceBtnHtml =
      '<button class="icon" id="diceBtn" title="' + esc(App.t('dice')) + '">⚄</button>';
    const controlsHtml = desktop ?
      '<button class="icon" id="restBtn" title="' + esc(App.t('rest')) + '">☾</button>' +
      diceBtnHtml +
      '<button class="icon" id="logBtn" title="' + esc(App.t('log')) + '">☰</button>' +
      editBtnHtml :
      editBtnHtml +
      diceBtnHtml +
      '<button class="icon" id="topMenuBtn" title="' + esc(App.t('menu')) + '">⋮</button>';
    // v18.2: настройки за логотипом (кнопка #brandBtn вместо div.brand), имя персонажа
    // в центре топбара (.char-name); кнопка ⚙ #settingsBtn из игрового ряда убрана
    const charNameHtml = ch ?
      '<div class="char-name"><span class="orn">◆</span><span class="char-title">' + esc(ch.name) + '</span><span class="orn">◆</span></div>' :
      '';
    bar.innerHTML =
      '<button class="brand brand-btn" id="brandBtn" title="' + esc(App.t('settings')) + '">🎲 <span class="accent">' + esc(App.t('appName')) + '</span></button>' +
      charNameHtml +
      '<div class="top-controls">' + controlsHtml + '</div>';

    document.getElementById('brandBtn').addEventListener('click', openSettings);
    const restBtn = document.getElementById('restBtn');
    if (restBtn) restBtn.addEventListener('click', confirmRest);
    document.getElementById('diceBtn').addEventListener('click', toggleDiceWidget);
    const logBtn = document.getElementById('logBtn');
    if (logBtn) logBtn.addEventListener('click', toggleLog);
    document.getElementById('editModeBtn').addEventListener('click', toggleEditMode);
    const topMenuBtn = document.getElementById('topMenuBtn');
    if (topMenuBtn) topMenuBtn.addEventListener('click', openTopMenu);
  }

  function toggleEditMode() {
    editMode = !editMode;
    setSelection([]);   // выделение групп существует только в режиме правки
    render();
  }

  function renderCanvas() {
    const canvas = document.getElementById('canvas');
    const ch = activeChar();
    const desktop = isDesktop();
    canvas.classList.toggle('free', desktop);
    // сетка видна, пока правишь раскладку: на неё магнитятся карточки
    canvas.classList.toggle('grid-on', desktop && editMode);
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
    syncChargeFx(visible);
    // v65: pop-анимация иконки состояния нужна только на один рендер
    condFresh = null;
    if (desktop) sizeCanvas();
    else { canvas.style.width = ''; canvas.style.height = ''; }
  }

  // ===== Мобильная сетка (v46): сколько клеток занимает карточка (1–4) =====
  // Ширину на телефоне задаёт grid; на ПК поле ни на что не влияет (там свободное
  // размещение и ручной ресайз).
  function defaultSpan(type) {
    if (type === 'counter') return 1;      // четыре счётчика в ряд
    if (type === 'currency') return 1;     // валюта/ярлык — компактная клетка
    return 2;                              // навык/заклинание/инвентарь/заметка
  }
  function cardSpan(card) {
    const n = Math.round(num(card.span) || 0);
    return (n >= 1 && n <= 4) ? n : defaultSpan(card.type);
  }
  // v47: выбор ширины карточки из кебаба (1–4 клетки мобильной сетки)
  function setCardSpan(cardId, n) {
    const card = findCard(cardId);
    if (!card || !(n >= 1 && n <= 4)) return;
    if (cardSpan(card) === n) return;
    mutate(function () { card.span = n; });
  }

  function cardView(card, desktop) {
    const sel = (desktop && editMode && selIds.has(card.id)) ? ' selected' : '';
    const folded = foldable(card) && isCollapsed(card);
    let style = '--span:' + cardSpan(card) + ';';
    if (desktop && card.x != null) {
      // при сужении окна карточки визуально поджимаются внутрь, но сохранённые координаты
      // НЕ перезаписываются: расширил окно — карточки восстановили положение
      const dx = Math.max(0, Math.min(card.x, canvasRight() - effW(card)));
      const dy = Math.max(0, card.y);
      // inline w/h — ВСЕГДА (и у ярлыка): разворот без render вернет сохраненный размер,
      // а класс .collapsed перебивает их через !important
      style += 'left:' + Math.round(dx) + 'px;top:' + Math.round(dy) + 'px;width:' + Math.round(card.w) + 'px;height:' + Math.round(card.h) + 'px;';
    }
    // Уголок ресайза есть ВСЕГДА в правке (и у свёрнутого тоже — прячет CSS
    // .card.collapsed .resize-handle). Иначе после «свернул → подвинул → развернул»
    // кнопка не появлялась: toggleFold меняет класс на живом узле без render(),
    // а уголок раньше создавался только для развёрнутой карточки (баг v38).
    const resize = (editMode && desktop && card.type !== 'condition') ? '<span class="resize-handle" title="↘"></span>' : '';
    // язычок и иконка/подпись живут в DOM у ВСЕХ сворачиваемых карточек: видимость
    // переключает класс .collapsed — сворот без перерисовки сохранит CSS-переход
    const label = foldable(card) ?
      '<div class="artifact" aria-hidden="true"><img src="icons/labels/' + esc(FOLDABLE_ICONS[card.type]) + '.png" alt=""></div>' +
      '<div class="card-title-small">' + esc(card.name) + '</div>' +
      '<button class="fold-tab" title="' + esc(App.t(folded ? 'unfoldCard' : 'foldCard')) + '" aria-label="' + esc(App.t(folded ? 'unfoldCard' : 'foldCard')) + '"></button>' : '';
    const cls = 'card type-' + card.type + (card.mini ? ' mini' : '') + (folded ? ' collapsed' : '') + sel + (card.restores ? ' restores' : '');
    // v58: у навыка шапка и кнопка броска — соседи в сетке .skill-grid, чтобы на
    // узкой карточке кнопка уходила вниз, к значению (иначе из шапки её не вынуть).
    if (card.type === 'skill') {
      const roll = cardRoller(card);
      return '<div class="' + cls + '" data-id="' + card.id + '" style="' + style + '">' +
        '<div class="skill-grid">' +
          cardHead(card, desktop, undefined, true) +
          (roll ? '<span class="skill-act">' + roll + '</span>' : '') +
          cardBody(card) +
        '</div>' + resize + label + '</div>';
    }
    return '<div class="' + cls + '" data-id="' + card.id + '" style="' + style + '">' + cardHead(card, desktop) + cardBody(card) + resize + label + '</div>';
  }

  function cardHead(card, desktop, toolsMode, noRoller) {
    // toolsMode: не задан — как раньше (тулзы только в правке); true — тулзы всегда
    // (слой ярлыка); false — тулзы скрыты (в слое они уже есть в шапке ПАНЕЛИ,
    // дублирующие мёртвые кнопки в копии карточки не нужны)
    // v47/v48: кебаб в правке — у счётчика всегда (узкая карточка), у остальных
    // только на телефоне: три кнопки ✎⧉🗑 там заменяются меню, а долгий тап
    // освобождается под перетаскивание карточки
    const kebabMode = editMode && (card.type === 'counter' || card.type === 'condition' || !desktop) && !toolsMode;
    let tools = '';
    if (kebabMode) {
      tools = '<button type="button" class="kebab" data-act="card-menu"' +
        ' title="' + esc(App.t('menu')) + '" aria-label="' + esc(App.t('menu')) + '">' +
        '<span></span><span></span><span></span></button>';
    } else if (toolsMode !== false && (editMode || toolsMode)) {
      tools = '<div class="tools">' +
        (desktop ? '' : '<button class="card-up" title="↑">▲</button><button class="card-down" title="↓">▼</button>') +
        '<button class="card-edit" title="' + esc(App.t('edit')) + '">✎</button>' +
        '<button class="card-dup" title="' + esc(App.t('duplicate')) + '">⧉</button>' +
        '<button class="card-del" title="' + esc(App.t('delete')) + '">' + TRASH_SVG + '</button>' +
      '</div>';
    }
    const handle = (editMode && desktop) ? '<span class="handle" title="⋮⋮">⋮⋮</span>' : '';
    // вариант F: кубик в шапке + тег бонуса. В режиме правки НЕ показываем (в правке не бросают) —
    // иначе тулзы (✎⧉✕) не влезают на минимальной ширине.
    // v36: у СЧЁТЧИКА кубика больше нет (просьба юзера) — даже если в старых данных
    // остался card.die, чип не рисуем; данные чистятся при сохранении карточки
    // v58: кнопка вынесена в cardRoller — у навыка она живёт отдельно от шапки,
    // чтобы на узкой карточке переехать вниз (сетка .skill-grid)
    let roller = noRoller ? '' : cardRoller(card);
    // v59: у инициативы свои кнопки: «бросить всем» (только в подготовке) и флаг
    // («бой окончен» / сворачивание). Флаг всегда последний — в бою он у правого края.
    if (card.type === 'initiative') {
      roller = editMode ? '' :
        (card.phase === 'battle' ? '' :
          '<button type="button" class="headroll" data-act="ini-roll-all" title="' + esc(App.t('iniRollAll')) + '"></button>') +
        '<button type="button" class="headroll flag-btn" data-act="ini-flag" title="' + esc(App.t('iniEndFight')) + '">' + FLAG_SVG + '</button>';
    }
    // восклицательный знак в кружке: у карточек, чьё значение — выражение (бывшие формулы,
    // теперь навыки с параметрами): навёл курсор — подсказка с выражением и результатом.
    // Скрываем в режиме правки — дальше тулзы не влезают (как и кубик в шапке)
    const finfo = (!editMode && typeof card.value === 'string' && card.value.trim() !== '')
      ? '<span class="finf" data-id="' + esc(card.id) + '" title="' + esc(App.t('expression')) + '">!</span>' : '';
    // 🔗 у заклинаний с привязанными зарядами: клик — плашка «от какого счётчика зависят заряды»
    const linktag = (!editMode && card.type === 'spell' && card.charges && card.charges.mode === 'link')
      ? '<span class="linktag" title="' + esc(App.t('charges')) + '">🔗</span>' : '';
    // v40: у счётчика ☾ в шапке больше нет — «восстанавливается при отдыхе»
    // показывает большая фоновая луна (.card.restores::after)
    return '<div class="card-head">' + handle + '<span class="card-name">' +
      (card.restores && card.type !== 'counter' ? '<span class="restore-ic">☾</span>' : '') + esc(card.name) +
      '</span>' + finfo + linktag + roller + tools + '</div>';
  }

  // Кнопка броска (v58): отдельная сущность, а не часть шапки — у навыка она
  // стоит в своей клетке сетки и на узком виде переезжает вниз, к значению.
  // У навыка бонус уже показан в скобках у значения, поэтому чип +N не дублируем.
  function cardRoller(card) {
    if (!card.die || editMode || card.type === 'counter' || card.type === 'initiative') return '';
    const b = cardBonus(card);
    const dl = cardDiceLabel(card);
    // v78: запрет состояния не трогает кубик — он бросается как обычно,
    // а гаснет кнопка «Применить» у заклинания (см. chargesInfo)
    return '<button class="headroll" data-act="roll" title="' + esc(App.t('roll')) + ' ' + esc(dl) + '">' + esc(dl) + '</button>' +
      (b && card.type !== 'skill' ? '<span class="inc">' + (b > 0 ? '+' : '−') + Math.abs(b) + '</span>' : '');
  }

  function cardBody(card) {
    switch (card.type) {
      case 'counter': return counterBody(card);
      case 'skill': return skillBody(card);
      case 'spell': return spellBody(card);
      case 'currency': return currencyBody(card);
      case 'inventory': return inventoryBody(card);
      case 'note': return noteBody(card);
      case 'initiative': return initiativeBody(card);
      case 'condition': return conditionBody(card);
    }
    return '';
  }

  function counterBody(card) {
    const cur = num(card.current);
    const max = counterMaxNum(card);
    const over = (max != null && cur > max);
    const under = cur < 0;
    const step = counterSteps.get(card.id);
    // v40: компактный вид — значение крупно по центру, ниже степпер «− [шаг] +».
    // Фиксированные +/− и ++/−− убраны: шаг задаётся полем (пусто = 1).
    return '<div class="card-body counter-body">' +
        '<div class="counter-val' + (over ? ' over' : '') + (under ? ' under' : '') + '">' + cur +
          (max != null ? '<small> / ' + max + '</small>' : '') + '</div>' +
        '<div class="counter-step">' +
          '<button type="button" class="step-btn minus" data-act="dec" title="' + esc(App.t('decrease')) + '">−</button>' +
          '<input class="step-input" type="text" inputmode="numeric" autocomplete="off" spellcheck="false"' +
            ' placeholder="—" value="' + (step ? String(step) : '') + '"' +
            ' title="' + esc(App.t('step')) + '" aria-label="' + esc(App.t('step')) + '" data-step="' + esc(card.id) + '">' +
          '<button type="button" class="step-btn plus" data-act="inc" title="' + esc(App.t('increase')) + '">+</button>' +
        '</div>' +
      '</div>';
  }

  // Навык (v58): значение с бонусом в скобках слева, описание — сбоку за тонкой чертой.
  // Порядок важен: при сужении карточки описание прячется (CSS), а значение остаётся.
  function skillBody(card) {
    const desc = (card.description || '').trim();
    const hasVal = card.value != null;
    if (!desc && !hasVal) return '';
    let html = '';
    if (hasVal) {
      const val = skillValueNum(card);
      const bonus = cardBonus(card);
      html += '<div class="stat-line"><span class="stat-value' + (val < 0 ? ' under' : '') + '">' + fmt(val) + '</span>' +
        (bonus ? '<span class="stat-bonus">(' + (bonus > 0 ? '+' : '') + bonus + ')</span>' : '') + '</div>';
    }
    if (desc) {
      html += '<span class="skill-vline" aria-hidden="true"></span>' +
        '<div class="desc-text">' + esc(card.description) + '</div>';
    }
    return '<div class="card-body skill-body">' + html + '</div>';
  }

  /* ===== Заряды-фигуры (v52: только треугольники, 2 ряда по 6) =====
     12 треугольников максимум: верхний ряд 6, нижний 6. Если максимум меньше 12 —
     рисуем ровно столько ячеек, сколько зарядов (макс 8 → 6 + 2).
     Предел больше 12 (или без предела) — фигуры заменяет текстовый тег. */
  const CHG_TRI_MAX = 12;
  const CHG_ROW = 6;
  // цвета как на стенде: собственные заряды — золотые, связанные (от счётчика) — фиолетовые
  const CHG_PAL = {
    own:  { fill: '#B58A43', stroke: '#F4C65E' },
    link: { fill: '#7669C9', stroke: '#C1B7FF' }
  };
  const CHG_TRI_PTS = '30,4 55,50 5,50';

  function chgOwnPalette(card) {
    return CHG_PAL[card.charges && card.charges.mode === 'link' ? 'link' : 'own'];
  }

  // «единицы ресурса»: собственные — текущее число зарядов; связанные — floor(текущего счётчика / траты).
  // Счётчик без максимума тоже годится: единицы считаются, предела просто нет (тег без « / N»)
  function chargeUnits(card) {
    const ch = card.charges || {};
    if (ch.mode === 'link') {
      const t = findCard(ch.linkId);
      if (t && t.type === 'counter') return Math.floor(num(t.current) / (num(ch.cost) || 1));
      return null;
    }
    return num(ch.current);
  }
  // предел в единицах; null — без предела
  function chargeMaxUnits(card) {
    const ch = card.charges || {};
    if (ch.mode === 'link') {
      const t = findCard(ch.linkId);
      // максимум счётчика может быть выражением ({Мана} + 2) — сначала считаем его
      const tm = t && t.type === 'counter' ? counterMaxNum(t) : null;
      if (tm != null) return Math.floor(tm / (num(ch.cost) || 1));
      return null;
    }
    return chargesMaxNum(card);
  }
  // скелет ячеек: сколько треугольников и как они раскладываются по двум рядам.
  // null — фигуры не показываем (предел неизвестен, нулевой или выше 12 — тогда тег)
  function chargeSkeleton(maxUnits) {
    if (maxUnits == null || maxUnits <= 0 || maxUnits > CHG_TRI_MAX) return null;
    const slots = Math.min(CHG_TRI_MAX, Math.floor(maxUnits));
    const top = Math.min(CHG_ROW, slots);
    return { slots: slots, top: top, bottom: slots - top };
  }
  // сколько ячеек заполнено: сверху вниз, слева направо (1..6 верх, 7..12 низ)
  function chargeFill(units, sk) {
    const u = Math.max(0, Math.floor(num(units) || 0));
    const filled = Math.min(sk.slots, u);
    return {
      top: Math.min(sk.top, filled),
      bottom: Math.max(0, Math.min(sk.bottom, filled - sk.top))
    };
  }

  function chgBtnHTML(filled, palette, attrs, title) {
    return '<button type="button" class="charge triangle' + (filled ? ' filled' : '') + '"' + attrs +
      ' style="--chg-fill:' + palette.fill + ';--chg-stroke:' + palette.stroke + '"' +
      (title ? ' title="' + esc(title) + '"' : '') + '>' +
      '<svg viewBox="0 0 60 54" aria-hidden="true"><polygon points="' + CHG_TRI_PTS + '"/></svg>' +
      (filled ? '<span class="shine" aria-hidden="true"></span>' : '') +
      '</button>';
  }

  // два ряда треугольников: верхний (до 6) и нижний (до 6)
  function chargeFiguresHTML(card, tip) {
    const sk = chargeSkeleton(chargeMaxUnits(card));
    if (!sk) return null;
    const pal = chgOwnPalette(card);
    const fill = chargeFill(chargeUnits(card) || 0, sk);
    const clickable = !(card.charges && card.charges.mode === 'link');
    const attrsFor = function (idx) {
      return clickable ? ' data-act="pip" data-i="' + idx + '"' : ' data-act="pip"';
    };
    const title = clickable ? App.t('pipFill') : tip;
    let top = '', bottom = '';
    for (let i = 0; i < sk.top; i++) {
      top += chgBtnHTML(i < fill.top, pal, attrsFor(i), title);
    }
    for (let i = 0; i < sk.bottom; i++) {
      bottom += chgBtnHTML(i < fill.bottom, pal, attrsFor(sk.top + i), title);
    }
    return '<div class="chg-area">' +
      (sk.top ? '<div class="chg-row chg-tris">' + top + '</div>' : '') +
      (sk.bottom ? '<div class="chg-row chg-tris">' + bottom + '</div>' : '') +
      '</div>';
  }

  // тег с числом вместо фигур (предел > 12 или без предела), цвет — как у ячеек
  function chargeBadgeHTML(card) {
    const m = card.charges && card.charges.mode === 'link' ? 'link' : 'own';
    const cur = Math.floor(num(chargeUnits(card)) || 0);
    const maxU = chargeMaxUnits(card);
    const txt = cur + (maxU != null ? ' / ' + Math.floor(maxU) : '');
    // v53: у СВОИХ зарядов тег открывает барабан (тап по «Х / N»);
    // у связанных — как раньше, плашка-подсказка «пополните счётчик»
    const act = m === 'link' ? ' data-act="pip"' : ' data-act="chg-drum"';
    return '<button type="button" class="chg-badge ' + m + '"' + act +
      ' title="' + esc(App.t('charges')) + '">' + txt + '</button>';
  }

  function chargesInfo(card) {
    const ch = card.charges || {};
    // v32: галочка «показывать тег х/N вместо анимации» — принудительный тег
    const forceTag = !!ch.tag;
    const useWhy = blockedBy(card);
    const useBtn = useWhy
      ? '<button class="small primary use-btn blocked" type="button" disabled title="' + esc(App.tf('useBlocked', { why: useWhy })) + '">' + esc(App.t('use')) + '</button>'
      : '<button class="small primary use-btn" data-act="use">' + esc(App.t('use')) + '</button>';
    if (ch.mode === 'link') {
      const target = findCard(ch.linkId);
      if (target && target.type === 'counter') {
        // счётчик без предела — тег вместо фигур (как при зарядов больше 12)
        if (target.max == null || forceTag) return '<div class="charges-row">' + chargeBadgeHTML(card) + useBtn + '</div>';
        const tip = App.tf('linkPipTip', { cost: num(ch.cost) || 1, name: target.name });
        const figs = chargeFiguresHTML(card, tip);
        // ячеек больше 12 — тег вместо фигур
        return '<div class="charges-row">' + (figs || chargeBadgeHTML(card)) + useBtn + '</div>';
      }
      // потерянная ссылка — старый текстовый вид
      const nm = target ? target.name : App.t('brokenRef');
      const remain = target && target.type === 'counter' ? num(target.current) : 0;
      return '<div class="charges-row"><span class="meta">' + esc(App.tf('linkedCharges', { name: nm })) + ': ' + remain + '</span>' +
        useBtn + '</div>';
    }
    if (forceTag) return '<div class="charges-row">' + chargeBadgeHTML(card) + useBtn + '</div>';
    const figs = chargeFiguresHTML(card, App.t('pipFill'));
    return '<div class="charges-row">' + (figs || chargeBadgeHTML(card)) + useBtn + '</div>';
  }

  function spellBody(card) {
    return '<div class="card-body">' +
      (card.description ? '<div class="desc-text">' + esc(card.description) + '</div>' : '') +
      chargesInfo(card) + '</div>';
  }

  /* ===== Инициатива (v59) =====
     Две фазы. «Подготовка»: порядок не назначается (строки как добавили), у новых
     участников инициатива пустая («—»), такие строки подсвечены фиолетовым, полоса
     показывает, сколько заполнено. «Начать бой» сортирует, прячет значения, кубики
     и плюсы. Окно строк — от высоты карточки, минимум 4. Флаг — «бой окончен»
     и сворачивание в строку 42 px. */
  const FLAG_SVG = '<svg class="ini-flag-ic" viewBox="0 0 100 100" aria-hidden="true"><path d="M14 96 L14 6"/><path d="M14 14 C22 8 35 4 48 6 C52 7 55 10 55 14 L55 22 C60 22 70 20 80 18 C84 17 88 15 88 15 L88 55 C80 58 70 62 60 63 C55 64 50 62 50 56 L50 46 C42 48 32 52 22 54 C18 55 14 56 14 56"/></svg>';

  function iniDie(card) { return Math.max(2, Math.round(num(card.die) || 20)); }
  function iniRows(card) { if (!Array.isArray(card.rows)) card.rows = []; return card.rows; }
  function iniFilled(r) { return !!r && r.value != null && r.value !== '' && Number.isFinite(Number(r.value)); }
  function iniFilledCount(card) { return iniRows(card).filter(iniFilled).length; }
  function iniSorted(card) {
    return iniRows(card).slice().sort(function (a, b) {
      const av = iniFilled(a) ? Number(a.value) : -Infinity;
      const bv = iniFilled(b) ? Number(b.value) : -Infinity;
      return (bv - av) || ((num(a.seq) || 0) - (num(b.seq) || 0));
    });
  }
  function iniOrder(card) { return card.phase === 'battle' ? iniSorted(card) : iniRows(card); }
  function iniCur(card) { return iniRows(card).find(function (r) { return r.id === card.turnId; }) || null; }
  // сколько строк видно: минимум 4, дальше — по высоте карточки
  function iniWin(card) {
    // 208 — вся «обвязка» карточки, кроме списка: отступы, шапка, подпись, полоса,
    // подсказки, добавление и кнопка хода. При высоте 352 остаётся ровно 4 строки.
    return Math.max(4, Math.floor(((num(card.h) || 352) - 208) / 37));
  }
  function iniViewStart(card) {
    const order = iniOrder(card);
    const len = order.length;
    const win = iniWin(card);
    const maxStart = Math.max(0, len - win);
    let st = Math.max(0, Math.min(num(card.viewStart) || 0, maxStart));
    if (!card.viewManual) {
      let focus = 0;
      if (card.phase === 'battle') {
        focus = Math.max(0, order.findIndex(function (r) { return r.id === card.turnId; }));
      } else if (card.focusId) {
        focus = Math.max(0, order.findIndex(function (r) { return r.id === card.focusId; }));
      }
      if (focus < st) st = focus;
      else if (focus > st + win - 1) st = focus - win + 1;
    }
    return Math.max(0, Math.min(st, maxStart));
  }

  function initiativeBody(card) {
    iniRows(card);
    if (card.mini) return initiativeMini(card);

    const order = iniOrder(card);
    const total = order.length;
    const filled = iniFilledCount(card);
    const win = iniWin(card);
    const start = iniViewStart(card);
    card.viewStart = start;
    const view = order.slice(start, start + win);
    const prep = card.phase !== 'battle';

    let headLabel, prog;
    if (prep) {
      headLabel = '<span class="ini-label prep">' + esc(App.t('iniPreparation')) +
        '<span class="ini-cnt">' + filled + ' / ' + total + '</span></span>';
      prog = total ? Math.round(filled / total * 100) : 0;
    } else {
      const ti = Math.max(0, order.findIndex(function (r) { return r.id === card.turnId; }));
      headLabel = '<span class="ini-label">' + esc(App.t('iniRound')) + ' <b>' + (num(card.round) || 1) + '</b></span>';
      prog = total ? Math.round(ti / total * 100) : 0;
    }

    let html = '<div class="ini-top">' + headLabel + '</div>' +
      '<div class="ini-prog' + (prep ? ' prep' : '') + '"><i style="width:' + prog + '%"></i></div>' +
      '<div class="ini-spill">' + (start ? '<button type="button" class="ini-scroll" data-act="ini-scroll" data-d="-1">↑ ещё ' + start + '</button>' : '') + '</div>' +
      '<div class="ini-list">';

    view.forEach(function (r, i) {
      const rank = start + i + 1;
      const cur = !prep && r.id === card.turnId;
      const todo = prep && !iniFilled(r);
      // v63: в подготовке не мигаем — пока инициатива пустая, держится ровная
      // фиолетовая подсветка (todo). Вспышка — только когда значение уже есть.
      const fresh = r.id === card.previewId && (!prep || iniFilled(r));
      html += '<div class="ini-row' + (cur ? ' cur' : '') + (todo ? ' todo' : '') + (r.out ? ' out' : '') + (fresh ? ' fresh' : '') + '" data-row="' + esc(r.id) + '">' +
        '<span class="ini-rank">' + rank + '</span>' +
        '<input class="ini-name" data-ini="name" data-row="' + esc(r.id) + '" value="' + esc(r.name) + '">' +
        (prep
          ? (num(r.bonus) ? '<span class="ini-bonus">+' + num(r.bonus) + '</span>' : '') +
            '<input class="ini-val" data-ini="value" data-row="' + esc(r.id) + '" placeholder="—" inputmode="numeric" value="' + (iniFilled(r) ? esc(r.value) : '') + '">' +
            '<button type="button" class="ini-dice" data-act="ini-roll" data-row="' + esc(r.id) + '" title="' + esc(App.t('roll')) + '">🎲</button>' +
            '<button type="button" class="ini-del" data-act="ini-del" data-row="' + esc(r.id) + '" title="' + esc(App.t('delete')) + '">✕</button>'
          : (!r.out
              ? '<button type="button" class="ini-del" data-act="ini-del" data-row="' + esc(r.id) + '" title="' + esc(App.t('iniOut')) + '">✕</button>'
              : '<button type="button" class="ini-back" data-act="ini-back" data-row="' + esc(r.id) + '" title="' + esc(App.t('iniBack')) + '">↩</button>' +
                '<button type="button" class="ini-del armed" data-act="ini-del" data-row="' + esc(r.id) + '" title="' + esc(App.t('delete')) + '">✕</button>')) +
        '</div>';
    });
    html += '</div>';

    const above = start;
    const below = Math.max(0, total - (start + win));
    html += '<div class="ini-spill">' +
      (below ? '<button type="button" class="ini-scroll" data-act="ini-scroll" data-d="1">↓ ещё ' + below + '</button>' : '') +
      '</div>';

    const blocked = prep && (filled < total || !total);
    html += '<div class="ini-add">' +
        '<input class="ini-add-input" type="text" placeholder="' + esc(App.t('iniName')) + '">' +
        '<button type="button" data-act="ini-add">+</button>' +
      '</div>' +
      '<button type="button" class="ini-pass' + (prep ? ' start' : '') + (blocked ? ' blocked' : '') + '" data-act="ini-pass">' +
        esc(App.t(prep ? 'iniStart' : 'iniNext')) + '</button>';

    return '<div class="card-body ini-body">' + html + '</div>';
  }

  // свёрнутая строка: имя · раунд/подготовка · текущий
  function initiativeMini(card) {
    const prep = card.phase !== 'battle';
    const cur = iniCur(card);
    const left = prep ? App.t('iniPreparation') : App.t('iniRound') + ' ' + (num(card.round) || 1);
    const right = prep ? iniFilledCount(card) + '/' + iniRows(card).length : (cur ? '▶ ' + cur.name : '');
    return '<div class="card-body ini-body mini">' +
      '<div class="ini-mini" data-act="ini-expand" role="button" tabindex="0">' +
        '<span class="m-name">' + esc(card.name) + '</span>' +
        '<span class="m-sep"></span>' +
        '<span class="m-round' + (prep ? ' prep' : '') + '">' + esc(left) + '</span>' +
        '<span class="m-turn' + (prep ? ' dim' : '') + '">' + esc(right) + '</span>' +
      '</div></div>';
  }

  // всплывающая надпись «Раунд N» при смене раунда
  function iniFlash(card, text) {
    const el = document.querySelector('.card[data-id="' + card.id + '"]');
    if (!el) return;
    const d = document.createElement('div');
    d.className = 'ini-flash';
    d.textContent = text;
    el.appendChild(d);
    setTimeout(function () { d.remove(); }, 1000);
  }

  /* ===== Барабан зарядов (v53) =====
     Тап по тегу «Х / N» у СВОИХ зарядов открывает колесо выбора 0..N.
     Оверлей фиксированный (вне холста), поэтому не зависит от мобильного zoom.
     У связанных зарядов барабана нет — там значение принадлежит счётчику. */
  let drumState = null;
  function closeChargeDrum(apply) {
    const ov = document.getElementById('chgDrum');
    if (!ov) return;
    const st = drumState;
    drumState = null;
    document.removeEventListener('keydown', st ? st.onKey : null);
    ov.remove();
    if (!apply || !st) return;
    const card = findCard(st.cardId);
    if (!card || !card.charges) return;
    if (Math.floor(num(card.charges.current)) === st.value) return;
    mutate(function () { card.charges.current = st.value; });
  }
  function openChargeDrum(card) {
    closeChargeDrum(false);
    const maxU = chargeMaxUnits(card);
    const upTo = maxU != null ? Math.max(1, Math.floor(maxU)) : Math.max(99, Math.floor(num(card.charges.current) || 0));
    const cur = Math.max(0, Math.min(upTo, Math.floor(num(card.charges.current) || 0)));
    const ITEM = 36;
    const ov = document.createElement('div');
    ov.className = 'chg-drum-overlay';
    ov.id = 'chgDrum';
    ov.innerHTML =
      '<div class="chg-drum-panel" role="dialog" aria-modal="true">' +
        '<div class="chg-drum" id="chgDrumWheel"><div class="chg-drum-band"></div><ul class="chg-drum-list"></ul></div>' +
      '</div>';
    document.body.appendChild(ov);
    const wheel = ov.querySelector('#chgDrumWheel');
    const list = ov.querySelector('.chg-drum-list');
    const items = [];
    for (let i = 0; i <= upTo; i++) {
      const li = document.createElement('li');
      li.className = 'chg-drum-item';
      li.textContent = i;
      list.appendChild(li);
      items.push(li);
    }
    const posFor = function (v) { return -(v * ITEM + ITEM / 2); };
    const valueFromY = function (y) { return Math.round((-y - ITEM / 2) / ITEM); };
    const mark = function (v) { items.forEach(function (it, i) { it.classList.toggle('sel', i === v); }); };
    const st = { cardId: card.id, value: cur, onKey: null };
    drumState = st;
    function setVal(v, animate) {
      v = Math.max(0, Math.min(upTo, Math.round(v)));
      st.value = v;
      list.style.transition = animate ? 'transform .32s cubic-bezier(.2,.9,.3,1.15)' : 'none';
      list.style.transform = 'translateY(' + posFor(v) + 'px)';
      mark(v);
    }
    setVal(cur, false);

    let dragging = false, didMove = false, startY = 0, startTr = 0, lastY = 0, lastT = 0, vel = 0;
    const yNow = function () { return new DOMMatrixReadOnly(getComputedStyle(list).transform).m42; };
    const onMove = function (e) {
      if (!dragging) return;
      if (Math.abs(e.clientY - startY) > 4) didMove = true;
      let y = startTr + (e.clientY - startY);
      const maxY = posFor(0), minY = posFor(upTo);
      if (y > maxY) y = maxY + (y - maxY) * 0.18;          // резинка на краях
      else if (y < minY) y = minY + (y - minY) * 0.18;
      list.style.transform = 'translateY(' + y + 'px)';
      const now = performance.now(), dt = now - lastT;
      if (dt > 0) vel = (e.clientY - lastY) / dt;
      lastY = e.clientY;
      lastT = now;
    };
    const onUp = function () {
      if (!dragging) return;
      dragging = false;
      setVal(valueFromY(yNow() + vel * 90), true);         // инерция + примагничивание
    };
    wheel.addEventListener('pointerdown', function (e) {
      dragging = true;
      didMove = false;
      list.style.transition = 'none';
      startY = e.clientY; lastY = e.clientY; lastT = performance.now(); vel = 0;
      startTr = yNow();
      e.preventDefault();
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    wheel.addEventListener('wheel', function (e) {
      e.preventDefault();
      setVal(st.value + (e.deltaY > 0 ? -1 : 1), true);
    }, { passive: false });
    // тап по полосе (не сдвигая колесо) — подтвердить; тап мимо панели — отмена
    wheel.addEventListener('click', function () { if (didMove) return; closeChargeDrum(true); });
    ov.addEventListener('click', function (e) { if (e.target === ov) closeChargeDrum(false); });
    st.onKey = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeChargeDrum(false); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setVal(st.value - 1, true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setVal(st.value + 1, true); }
    };
    document.addEventListener('keydown', st.onKey);
  }

  /* ===== Анимации зарядов: дублёры-призраки поверх карточки =====
     Состояние меняется сразу (undo/журнал не ждут), картинка догоняет сама. */
  const chgPrev = {};   // cardId -> прежнее число единиц

  function chgGhost(filled, pal, r) {
    const tpl = document.createElement('template');
    tpl.innerHTML = chgBtnHTML(filled, pal, '', '');
    const el = tpl.content.firstElementChild;
    el.style.position = 'fixed';
    el.style.left = Math.round(r.left) + 'px';
    el.style.top = Math.round(r.top) + 'px';
    el.style.width = Math.round(r.width) + 'px';
    el.style.height = Math.round(r.height) + 'px';
    el.style.margin = '0';
    el.style.flex = '0 0 auto';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '9999';
    document.body.appendChild(el);
    return el;
  }
  function chgClearLater(ghosts, ms) {
    window.setTimeout(function () { ghosts.forEach(function (g) { g.remove(); }); }, ms);
  }

  function chargeFx(card, prevU, newU) {
    const el = document.querySelector('.card[data-id="' + card.id + '"]');
    if (!el) return;
    const sk = chargeSkeleton(chargeMaxUnits(card));
    if (!sk) return;
    const pal = chgOwnPalette(card);
    const prevF = chargeFill(prevU, sk), newF = chargeFill(newU, sk);
    const prevN = prevF.top + prevF.bottom;
    const newN = newF.top + newF.bottom;
    // оба ряда — одна плоская лента: верхний ряд, затем нижний
    const triEls = el.querySelectorAll('.chg-tris .charge');

    if (newN > prevN) {
      // заполнение: pop новых треугольников
      for (let i = prevN; i < newN; i++) {
        const it = triEls[i];
        if (!it) break;
        it.classList.remove('just-appeared');
        void it.offsetWidth;
        it.classList.add('just-appeared');
        window.setTimeout(function (n) { return function () { n.classList.remove('just-appeared'); }; }(it), 420);
      }
    } else if (newN < prevN) {
      // трата: угасает последний бывший треугольник
      const slot = triEls[prevN - 1];
      if (slot) {
        const g = chgGhost(true, pal, slot.getBoundingClientRect());
        g.classList.add('just-removed');
        chgClearLater([g], 360);
      }
    }
  }

  // после каждой перерисовки: сравнить прежние единицы с новыми, запустить нужную анимацию.
  // Первую отрисовку карточки не анимируем (открытие листа — не событие траты)
  function syncChargeFx(visible) {
    const seen = {};
    visible.forEach(function (card) {
      if (card.type !== 'spell' || !card.charges) return;
      seen[card.id] = true;
      const u = chargeUnits(card);
      const prev = chgPrev[card.id];
      chgPrev[card.id] = u;
      if (prev == null || u == null || prev === u) return;
      chargeFx(card, prev, u);
    });
    Object.keys(chgPrev).forEach(function (id) { if (!seen[id]) delete chgPrev[id]; });
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
    // заметка: прокрутка внутри карточки + клик — просмотр полного текста
    const note = el.querySelector('.note-text');
    if (note && (card.text || '').trim()) {
      note.classList.add('readable');
      note.addEventListener('click', function () { openTextModal(card.name, card.text); });
    }
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
    // v40: поле шага счётчика — только цифры, значение живёт в counterSteps
    const stepInp = el.querySelector('.step-input');
    if (stepInp) {
      stepInp.addEventListener('input', function () { readStepInput(stepInp); });
      // фокус сразу выделяет число: тап по полю + ввод = новое значение шага,
      // а не «дописать к старому»
      stepInp.addEventListener('focus', function () { stepInp.select(); });
      stepInp.addEventListener('keydown', function (e) { if (e.key === 'Enter') stepInp.blur(); });
      // фокус в поле не должен тянуть карточку/меню — гасим всплытие клика
      stepInp.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    }
    // v59: инициатива — правка имени/значения прямо в строке и прокрутка окна колесом
    if (card.type === 'initiative') {
      el.querySelectorAll('[data-ini]').forEach(function (inp) {
        inp.addEventListener('change', function () {
          const row = iniRows(card).find(function (r) { return r.id === inp.dataset.row; });
          if (!row) return;
          if (inp.dataset.ini === 'name') {
            const v = inp.value.trim();
            if (!v) { inp.value = row.name; return; }
            if (v === row.name) return;
            mutate(function () { row.name = v; });
            return;
          }
          const raw = inp.value.trim();
          const v = parseInt(raw, 10);
          mutate(function () {
            row.value = raw === '' || !Number.isFinite(v) ? null : v;
            card.focusId = row.id;
            card.viewManual = false;
          });
        });
        inp.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      });
      const iniList = el.querySelector('.ini-list');
      if (iniList) {
        iniList.addEventListener('wheel', function (ev) {
          if (Math.max(0, iniOrder(card).length - iniWin(card)) === 0) return;
          ev.preventDefault();
          handleInitiative(card, 'ini-scroll', { d: ev.deltaY > 0 ? '1' : '-1' }, { currentTarget: el });
        }, { passive: false });
      }
    }
    // Язычок: клик — свернуть/развернуть (единственный способ). Клик по САМОЙ карточке
    // ничего не сворачивает (как решили).
    const fold = el.querySelector('.fold-tab');
    if (fold) fold.addEventListener('click', function (e) { e.stopPropagation(); toggleFold(card.id); });
    // Ярлык: клик/тап (не по язычку) — второй слой с содержимым, в любом режиме.
    // card в замыкании мог протухнуть после undo (state пересобирается) — берем свежую
    if (foldable(card)) {
      el.addEventListener('click', function (e) {
        if (e.target.closest('.fold-tab')) return;
        const cur = findCard(card.id);
        if (!cur || !isCollapsed(cur)) return;
        openLabelLayer(card.id);
      });
    }
    // v65: состояние — тап/клик по кукле открывает второй слой в любом режиме.
    // Перетаскивание и долгий тап (перестановка на телефоне) слой НЕ открывают:
    // проверяем, что палец не сдвинулся и тап был коротким.
    if (card.type === 'condition') {
      let downX = 0, downY = 0, downT = 0;
      el.addEventListener('pointerdown', function (e) {
        downX = e.clientX; downY = e.clientY; downT = Date.now();
      });
      el.addEventListener('click', function (e) {
        if (e.ctrlKey || e.metaKey) return;   // Ctrl-клик — выделение группы
        if (e.target.closest('button, .handle, .resize-handle')) return;
        if (Math.abs(e.clientX - downX) > 10 || Math.abs(e.clientY - downY) > 10) return;
        // downT = 0 — клик без pointerdown (программный/доступность): не блокируем
        if (downT && Date.now() - downT > 650) return;
        openConditionLayer(card.id);
      });
    }
    // v48: долгий тап больше не «Перенести на лист» (это теперь пункт в кебабе) —
    // он поднимает карточку для перестановки (см. initColumnDrag)
  }

  // Перенос карточки на другой лист списком (мобильный путь; на ПК карточку тащат на вкладку)
  function openMoveToPage(cardId) {
    const ch = activeChar();
    const card = findCard(cardId);
    if (!ch || !card || ch.pages.length < 2) return;
    const from = card.page;
    const opts = ch.pages.filter(function (p) { return p.id !== from; }).map(function (p) {
      return '<option value="' + p.id + '"' + (false ? ' selected' : '') + '>' + esc(p.name) + '</option>';
    }).join('');
    if (!opts) return;
    openModal(App.t('moveCard'), '<p class="confirm-text">' + esc(card.name) + '</p>' +
      '<div class="field"><label>' + esc(App.t('moveToPage')) + '</label><select id="f-target">' + opts + '</select></div>',
      [
        { label: App.t('cancel') },
        { label: App.t('moveCard'), cls: 'primary', onClick: function () {
            const target = document.getElementById('f-target').value;
            if (!target || target === from) return;
            mutate(function () {
              card.page = target;
              ch.lastPage = target;
            });
            toast(App.t('cardMoved'));
          } }
      ]);
  }

  // ===== Free placement: сетка, границы, выделение групп =====
  const GRID = 20;              // шаг магнитной сетки
  let dragState = null;
  let selIds = new Set();       // выделенные карточки (id)
  let cardZ = 1;                // счётчик «поднятий» карточки: клик в правке выводит её на передний план

  function snap(v) { return Math.round(v / GRID) * GRID; }

  // правый край, за который карточку нельзя увести (полотно = ширина окна)
  function canvasRight() {
    const c = document.getElementById('canvas');
    return Math.max(MIN_W, (c && c.clientWidth ? c.clientWidth : window.innerWidth) - 8);
  }

  function cardElOf(id) {
    return document.querySelector('.canvas .card[data-id="' + id + '"]');
  }
  function setSelection(ids) {
    selIds = new Set(ids || []);
    document.querySelectorAll('.canvas .card').forEach(function (el) {
      el.classList.toggle('selected', selIds.has(el.dataset.id));
    });
  }
  function toggleSelectedCard(id) {
    const on = !selIds.has(id);
    if (on) selIds.add(id); else selIds.delete(id);
    const el = cardElOf(id);
    if (el) el.classList.toggle('selected', on);
  }
  function raiseZ(els) {
    els.forEach(function (el) {
      cardZ = cardZ >= 98 ? 1 : cardZ;   // z выше 100 занято модалкой
      cardZ += 1;
      el.style.zIndex = cardZ;
    });
  }

  // ---- Выделение ----
  // Рамка выделения по пустому месту УБРАНА (v35): на тач-экране протягивание
  // по пустому месту — это прокрутка, и рамка конфликтовала с телефоном (жест
  // отменялся браузером, а состояние рамки оставалось «залипшим»). Мультивыбор
  // теперь один на всех: Ctrl/Cmd + клик по карточке (на ПК).

  // подсветка вкладки листа под курсором при перетаскивании карточки вверх
  function hintTabs(e) {
    let found = null;
    document.querySelectorAll('.ptab').forEach(function (t) {
      t.classList.remove('drop-hint');
      const r = t.getBoundingClientRect();
      if (!found && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4) {
        if (t.dataset.page !== (activeChar() ? curPageId(activeChar()) : null)) found = t;
      }
    });
    if (found) found.classList.add('drop-hint');
    if (dragState) dragState.hintPage = found ? found.dataset.page : null;
  }
  // разубрать подсветку после дропа
  function unhintTabs() {
    document.querySelectorAll('.ptab.drop-hint').forEach(function (t) { t.classList.remove('drop-hint'); });
  }

  function initFreePlacement() {
    const canvas = document.getElementById('canvas');
    canvas.addEventListener('pointerdown', function (e) {
      if (!editMode || !isDesktop() || e.button !== 0) return;
      if (!activeChar()) return;
      const cardEl = e.target.closest ? e.target.closest('.card') : null;

      // пустое место — просто снять выделение (рамки выделения больше нет);
      // с зажатым Ctrl выделение намеренно не трогаем
      if (!cardEl) { if (!(e.ctrlKey || e.metaKey)) setSelection([]); return; }
      if (e.target.closest('button')) return;   // кнопки на карточке работают как обычно

      // Ctrl-клик — добавить/убрать карточку из выделения
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        toggleSelectedCard(cardEl.dataset.id);
        return;
      }

      // перекрытия: клик по карточке в правке поднимает её (или всю выделенную группу) наверх
      const raiseIds = selIds.has(cardEl.dataset.id) ? Array.from(selIds) : [cardEl.dataset.id];
      raiseZ(raiseIds.map(cardElOf).filter(Boolean));

      const handle = e.target.closest ? e.target.closest('.handle') : null;
      const resize = e.target.closest ? e.target.closest('.resize-handle') : null;
      // у ярлыка нет ручки (шапка скрыта) — тащим за тело; то же у свёрнутой инициативы
      const foldedCard = cardEl.classList.contains('collapsed') || cardEl.classList.contains('mini');
      if (!handle && !resize && !foldedCard) return;   // клик по телу — только подъём (как раньше)
      if (resize && foldedCard) return;
      const card = findCard(cardEl.dataset.id);
      if (!card) return;
      e.preventDefault();

      // двигаем выделенную карточку — едет вся выделенная группа; иначе группа = одна карточка.
      // Ярлык: фиолетовое выделение НЕ включаем (решение юзера), НО если ярлык уже
      // в выделении (рамкой или Ctrl) — тащим всю выделенную группу, как обычную карточку
      // (иначе «выделил 3 ярлыка, тащу один — едет только он»)
      let group;
      if (foldedCard && !selIds.has(card.id)) group = [card];
      else {
        if (!selIds.has(card.id)) setSelection([card.id]);
        group = Array.from(selIds).map(findCard).filter(Boolean);
      }
      group.forEach(function (c) { const gEl = cardElOf(c.id); if (gEl) gEl.classList.add('dragging'); });
      const mn = minSize(card);
      dragState = {
        kind: resize ? 'resize' : 'move',
        startX: e.clientX, startY: e.clientY,
        moved: false,
        minW: mn.w, minH: mn.h,
        group: group.map(function (c) {
          return { card: c, el: cardElOf(c.id), ox: c.x || 0, oy: c.y || 0, ow: effW(c), oh: effH(c) };
        })
      };
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('pointermove', function (e) {
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      if (dragState.kind === 'resize') {
        const g = dragState.group[0];
        let nw = Math.max(dragState.minW, Math.round(g.ow + dx));
        let nh = Math.max(dragState.minH, Math.round(g.oh + dy));
        nw = Math.max(dragState.minW, snap(nw));   // магнитная сетка
        nh = Math.max(dragState.minH, snap(nh));
        nw = Math.min(nw, Math.max(dragState.minW, canvasRight() - g.card.x));  // за правый край нельзя
        if (nw !== g.ow || nh !== g.oh) dragState.moved = true;
        g.el.style.width = nw + 'px';
        g.el.style.height = nh + 'px';
      } else {
        // двигаем от «самой левой верхней» карточки группы, чтобы границы соблюдались всей группой
        const minX = Math.min.apply(null, dragState.group.map(function (g) { return g.ox; }));
        const minY = Math.min.apply(null, dragState.group.map(function (g) { return g.oy; }));
        const boxW = Math.max.apply(null, dragState.group.map(function (g) { return g.ox + effW(g.card); })) - minX;
        let ldx = snap(minX + dx) - minX;   // примагничивание к сетке
        let ldy = snap(minY + dy) - minY;
        ldx = Math.max(-minX, Math.min(ldx, canvasRight() - (minX + boxW)));   // левая/правая границы
        ldy = Math.max(-minY, ldy);                                            // верхняя граница — табы страниц
        if (ldx || ldy) dragState.moved = true;
        dragState.group.forEach(function (g) {
          if (!g.el) return;
          g.el.style.left = (g.ox + ldx) + 'px';
          g.el.style.top = (g.oy + ldy) + 'px';
        });
        // тянем карточку вверх к вкладкам листов — подсвечиваем вкладку под курсором
        hintTabs(e);
      }
    });
    // Жест отменён браузером (тач: палец ушёл в прокрутку или системный жест,
    // окно потеряло фокус) — возвращаем карточки к сохранённым координатам.
    // Без этого dragState оставался жить: карточка продолжала ехать за пальцем
    // при следующих касаниях, а класс .dragging висел до перерисовки (баг v33).
    function cancelDrag() {
      if (!dragState) return;
      const ds = dragState;
      dragState = null;
      ds.group.forEach(function (g) {
        if (!g.el) return;
        g.el.classList.remove('dragging');
        if (ds.kind === 'resize') {
          g.el.style.width = g.ow + 'px';
          g.el.style.height = g.oh + 'px';
        } else {
          g.el.style.left = g.ox + 'px';
          g.el.style.top = g.oy + 'px';
        }
      });
      document.body.style.userSelect = '';
      unhintTabs();
    }
    window.addEventListener('pointercancel', cancelDrag);
    window.addEventListener('blur', cancelDrag);
    window.addEventListener('pointerup', function () {
      if (!dragState) return;
      const ds = dragState;
      dragState = null;
      ds.group.forEach(function (g) { if (g.el) g.el.classList.remove('dragging'); });
      document.body.style.userSelect = '';
      if (!ds.moved) { unhintTabs(); return; }      // просто клик по ручке — ничего не перемещали

      // «отпустили карточку на вкладке» — переносим всю группу на этот лист
      if (ds.hintPage) {
        unhintTabs();
        const chp = activeChar();
        const from = curPageId(chp);
        pushUndo();
        ds.group.forEach(function (g) { if (g.card.page === from) g.card.page = ds.hintPage; });
        chp.lastPage = ds.hintPage;   // видно результат сразу — открываем лист назначения
        commit();
        return;
      }
      unhintTabs();

      // 1) вычисляем, куда карточки попали бы — ещё НЕ сохраняя
      const page = ds.group[0].card.page;
      const others = activeChar().cards.filter(function (c) {
        return c.page === page && !ds.group.some(function (g) { return g.card === c; });
      });
      const place = [];   // прямоугольники куда бы легли карточки группы
      if (ds.kind === 'move') {
        ds.group.forEach(function (g) {
          if (!g.el) return;
          const nx = parseFloat(g.el.style.left), ny = parseFloat(g.el.style.top);
          place.push({
            x: Number.isNaN(nx) ? (g.card.x || 0) : Math.max(0, Math.min(snap(Math.round(nx)), canvasRight() - effW(g.card))),
            y: Number.isNaN(ny) ? (g.card.y || 0) : Math.max(0, snap(Math.round(ny))),
            w: effW(g.card), h: effH(g.card)
          });
        });
      } else {
        const g = ds.group[0];
        let nw = parseFloat(g.el.style.width), nh = parseFloat(g.el.style.height);
        if (Number.isNaN(nw)) nw = g.ow;
        if (Number.isNaN(nh)) nh = g.oh;
        place.push({
          x: g.card.x || 0, y: g.card.y || 0,
          w: Math.max(ds.minW, Math.min(snap(Math.round(nw)), Math.max(ds.minW, canvasRight() - g.card.x))),
          h: Math.max(ds.minH, snap(Math.round(nh)))
        });
      }

      // 2) пересечение с любой другой карточкой страницы — откат и подсказка
      const hit = place.some(function (r) {
        return others.some(function (c) {
          const cx = c.x || 0, cy = c.y || 0, cw = effW(c), chh = effH(c);
          return r.x < cx + cw && cx < r.x + r.w && r.y < cy + chh && cy < r.y + r.h;
        });
      });
      if (hit) {
        ds.group.forEach(function (g) {
          if (!g.el) return;
          g.el.style.left = g.ox + 'px';
          g.el.style.top = g.oy + 'px';
          g.el.style.width = g.ow + 'px';
          g.el.style.height = g.oh + 'px';
        });
        toast(App.t('noOverlap'));
        return;
      }

      // 3) всё свободно — сохраняем
      pushUndo();
      if (ds.kind === 'move') {
        ds.group.forEach(function (g, i) {
          g.card.x = place[i].x;
          g.card.y = place[i].y;
        });
      } else {
        const g = ds.group[0];
        g.card.w = place[0].w;
        g.card.h = place[0].h;
      }
      commit();
    });
  }

  // ===== Карточка «Состояние» (v65) =====
  // Кукла-вуду: состояние = тонировка тела + детали + иконка вокруг.
  // Тон тела — СРЕДНЕЕ по активным тонировкам (решение юзера: не усложнять).
  // Поля category/scope/strength заложены в снимок состояния, чтобы позже заменить
  // усреднение на приоритет категорий без миграции сохранённых листов.
  const COND_PRESETS = [
    { key: 'poison', nameKey: 'condPoisonName', descKey: 'condPoisonDesc', icon: 'skull',
      color: '#95d65a', shade: '#528c27', hi: '#d4f7a8', tint: '#7eb84c', tintOp: 0.42, category: 'poison', scope: 'body' },
    { key: 'blood', nameKey: 'condBloodName', descKey: 'condBloodDesc', icon: 'drop',
      color: '#d94848', shade: '#821c1c', hi: '#ff9e9e', tint: '#a84444', tintOp: 0.2, category: 'wound', scope: 'limbs' },
    { key: 'burn', nameKey: 'condBurnName', descKey: 'condBurnDesc', icon: 'flame',
      color: '#f0823d', shade: '#a33c12', hi: '#ffd470', tint: '#c2622c', tintOp: 0.34, category: 'temperature', scope: 'body' },
    { key: 'freeze', nameKey: 'condFreezeName', descKey: 'condFreezeDesc', icon: 'snow',
      color: '#7cc7ff', shade: '#3578b5', hi: '#dbf0ff', tint: '#63a8e0', tintOp: 0.42, category: 'temperature', scope: 'body' },
    { key: 'paralyze', nameKey: 'condParalyzeName', descKey: 'condParalyzeDesc', icon: 'bolt',
      color: '#82b7ff', shade: '#3764b3', hi: '#d6e8ff', tint: '#5c87d6', tintOp: 0.28, category: 'control', scope: 'body' },
    { key: 'stun', nameKey: 'condStunName', descKey: 'condStunDesc', icon: 'star',
      color: '#f2c14e', shade: '#b57c1e', hi: '#fff0b3', tint: null, tintOp: 0, category: 'senses', scope: 'none', face: 'dizzy' },
    { key: 'blind', nameKey: 'condBlindName', descKey: 'condBlindDesc', icon: 'eye',
      color: '#c3cad8', shade: '#5d6577', hi: '#f0f3fa', tint: null, tintOp: 0, category: 'senses', scope: 'none', face: 'blind' },
    { key: 'charm', nameKey: 'condCharmName', descKey: 'condCharmDesc', icon: 'heart',
      color: '#e86fa0', shade: '#9c3560', hi: '#ffb8d4', tint: '#d4749a', tintOp: 0.3, category: 'mind', scope: 'body' },
    { key: 'fear', nameKey: 'condFearName', descKey: 'condFearDesc', icon: 'bang',
      color: '#c9a2ff', shade: '#6a45a8', hi: '#efe2ff', tint: null, tintOp: 0, category: 'mind', scope: 'none' },
    { key: 'grab', nameKey: 'condGrabName', descKey: 'condGrabDesc', icon: 'grip',
      color: '#c79a6a', shade: '#7a5636', hi: '#f0d6b8', tint: null, tintOp: 0, category: 'control', scope: 'none' },
    { key: 'prone', nameKey: 'condProneName', descKey: 'condProneDesc', icon: 'fall',
      color: '#b98b5e', shade: '#6e4c2c', hi: '#e8cba6', tint: null, tintOp: 0, category: 'control', scope: 'none' },
    { key: 'bound', nameKey: 'condBoundName', descKey: 'condBoundDesc', icon: 'net',
      color: '#9ab86a', shade: '#546b34', hi: '#d8e9b6', tint: null, tintOp: 0, category: 'control', scope: 'none' },
    { key: 'unconscious', nameKey: 'condUncName', descKey: 'condUncDesc', icon: 'zzz',
      color: '#8fa8d8', shade: '#48608f', hi: '#dbe6ff', tint: null, tintOp: 0, category: 'consciousness', scope: 'none', face: 'closed' },
    { key: 'weary', nameKey: 'condWearyName', descKey: 'condWearyDesc', icon: 'weary',
      color: '#8c8c9a', shade: '#4c4c58', hi: '#d6d6e0', tint: '#7a7a86', tintOp: 0.16, category: 'weakness', scope: 'body' },
    { key: 'curse', nameKey: 'condCurseName', descKey: 'condCurseDesc', icon: 'curse',
      color: '#9b72f2', shade: '#522da6', hi: '#d9c7ff', tint: '#6c4eb8', tintOp: 0.4, category: 'magic', scope: 'body' }
  ];

  // ===== Наборы (уровень 2): библиотеки на устройстве =====
  // Устройство хранит наборы состояний и наборы вещей. У персонажа — массив ссылок
  // (в интерфейсе пока выбирается один набор, но данные готовы к уровню 3 —
  // несколько наборов одновременно). Наложенные состояния/вещи — снимки, поэтому
  // смена набора не ломает уже сохранённые карточки.

  function libSets(kind) {
    if (!state.libraries) state.libraries = { states: [], items: [] };
    if (!Array.isArray(state.libraries[kind])) state.libraries[kind] = [];
    return state.libraries[kind];
  }
  function libSetById(kind, id) {
    if (!id) return null;
    return libSets(kind).find(function (s) { return s.id === id; }) || null;
  }
  function charSetRefs(ch, kind) {
    if (!ch) return [];
    const key = kind === 'states' ? 'stateSets' : 'itemSets';
    if (!Array.isArray(ch[key])) ch[key] = [];
    return ch[key];
  }
  function charSetId(ch, kind) {
    const refs = charSetRefs(ch, kind);
    const first = refs[0] && libSetById(kind, refs[0]);
    if (first) return first.id;
    const fallback = libSets(kind)[0];
    return fallback ? fallback.id : null;
  }
  function charSet(ch, kind) {
    return libSetById(kind, charSetId(ch, kind)) || libSets(kind)[0] || null;
  }
  function setDisplayName(set) {
    if (!set) return '';
    return set.nameKey ? App.t(set.nameKey) : (set.name || '');
  }
  function stateSetOf(ch) { return charSet(ch, 'states'); }
  function itemSetOf(ch) { return charSet(ch, 'items'); }
  function stateEntries(ch) {
    const set = stateSetOf(ch);
    return set && Array.isArray(set.entries) ? set.entries : [];
  }
  function itemEntries(ch) {
    const set = itemSetOf(ch);
    return set && Array.isArray(set.entries) ? set.entries : [];
  }

  // Демонстрационный второй набор (одноразово): показывает, как выглядит
  // несколько наборов и состояния «своими руками». Удаляется вместе с набором.
  const DEMO_STATE_ENTRIES = [
    { key: 'demo_mud', name: 'В грязи', effect: 'Помеха на скрытность', icon: 'net',
      color: '#9ab86a', shade: '#546b34', hi: '#d8e9b6', tint: '#6f6647', tintOp: 0.26, category: 'control', scope: 'none' },
    { key: 'demo_rain', name: 'Под дождём', effect: 'Мокрый: −1 к броскам', icon: 'drop',
      color: '#7cc7ff', shade: '#3578b5', hi: '#dbf0ff', tint: '#4a7ea8', tintOp: 0.22, category: 'temperature', scope: 'body' },
    { key: 'demo_mark', name: 'Помечен', effect: 'Мастер видит цель', icon: 'eye',
      color: '#e8b04a', shade: '#8a6420', hi: '#ffe6a8', tint: null, tintOp: 0, category: 'mind', scope: 'none' }
  ];
  // Третий демо-набор — чтобы посмотреть, как ведут себя 3+ набора. Удаляется как обычный.
  const DEMO_STATE_ENTRIES_3 = [
    { key: 'demo_dazzle', name: 'Ослеплён светом', effect: 'Помеха на атаки', icon: 'star',
      color: '#f2c14e', shade: '#b57c1e', hi: '#fff0b3', tint: null, tintOp: 0, category: 'senses', scope: 'none' },
    { key: 'demo_curse', name: 'Проклят', effect: 'Помеха на спасброски', icon: 'curse',
      color: '#9b72f2', shade: '#522da6', hi: '#d9c7ff', tint: '#6c4eb8', tintOp: 0.3, category: 'magic', scope: 'body' },
    { key: 'demo_slow', name: 'Замедлен', effect: 'Одно действие за ход', icon: 'weary',
      color: '#8c8c9a', shade: '#4c4c58', hi: '#d6d6e0', tint: '#7a7a86', tintOp: 0.14, category: 'weakness', scope: 'body' },
    { key: 'demo_stuck', name: 'Приклеен', effect: 'Не может двигаться', icon: 'net',
      color: '#9ab86a', shade: '#546b34', hi: '#d8e9b6', tint: null, tintOp: 0, category: 'control', scope: 'none' }
  ];

  // Первый запуск (и миграция с v70): засеваем базовые наборы и ссылки у персонажей
  function ensureLibraries() {
    if (!state.libraries) state.libraries = { states: [], items: [] };
    if (!libSets('states').length) {
      libSets('states').push({
        id: uid(), nameKey: 'setDefaultStates', builtin: true,
        entries: COND_PRESETS.map(function (p) { return Object.assign({}, p); })
      });
    }
    if (!libSets('items').length) {
      libSets('items').push({ id: uid(), nameKey: 'setDefaultItems', builtin: true, entries: [] });
    }
    // один раз показываем второй набор, чтобы было видно, как это выглядит
    if (!state.settings.demoSetsShown) {
      state.settings.demoSetsShown = true;
      if (libSets('states').length === 1) {
        libSets('states').push({
          id: uid(), nameKey: 'setDemoStates', builtin: false, demo: true,
          entries: DEMO_STATE_ENTRIES.map(function (e) { return Object.assign({}, e); })
        });
      }
    }
    // и третий — проверить поведение при 3+ наборах (удаляется как обычный)
    if (!state.settings.demoSets3Shown) {
      state.settings.demoSets3Shown = true;
      if (libSets('states').length === 2) {
        libSets('states').push({
          id: uid(), name: App.t('setDemoStates3'), builtin: false, demo: true,
          entries: DEMO_STATE_ENTRIES_3.map(function (e) { return Object.assign({}, e); })
        });
      }
    }
    state.characters.forEach(function (ch) {
      charSetRefs(ch, 'states');
      charSetRefs(ch, 'items');
    });
    ensureStateEntryIds();
  }

  // v81: стабильный id записи набора. По нему цель и личные значения переживут
  // переименование состояния и обновление набора; key остаётся для старых данных.
  function ensureStateEntryIds() {
    let changed = false;
    libSets('states').forEach(function (set) {
      (set.entries || []).forEach(function (e) {
        if (!e.entryId) { e.entryId = 'st-' + uid(); changed = true; }
      });
    });
    if (changed) save();
  }

  // v86: память личных эффектов переезжает с key на entryId. Ищем entryId
  // по снимку, активному набору или любому набору; старый ключ удаляем.
  function migrateCondEntryIds() {
    const entryById = {}, entryByKey = {};
    libSets('states').forEach(function (set) {
      (set.entries || []).forEach(function (e) {
        if (e.entryId) entryById[e.entryId] = e;
        if (e.key) (entryByKey[e.key] || (entryByKey[e.key] = [])).push(e);
      });
    });
    let changed = false;
    state.characters.forEach(function (ch) {
      (ch.cards || []).forEach(function (card) {
        if (card.type !== 'condition') return;
        (card.conditions || []).forEach(function (snap) {
          if (!snap.entryId) {
            const set = libSetById('states', snap.setId) || charSet(ch, 'states');
            const entry = (set && (set.entries || []).find(function (e) { return e.key === snap.key; })) ||
              (entryByKey[snap.key] || [])[0];
            if (entry && entry.entryId) { snap.entryId = entry.entryId; changed = true; }
          }
        });
        if (!card.condEffects) return;
        Object.keys(card.condEffects).forEach(function (key) {
          if (entryById[key]) return;   // уже entryId
          const snap = (card.conditions || []).find(function (s) { return s.key === key; });
          let entry = snap && snap.entryId ? entryById[snap.entryId] : null;
          if (!entry) {
            const set = charSet(ch, 'states');
            entry = (set && (set.entries || []).find(function (e) { return e.key === key; })) ||
              (entryByKey[key] || [])[0];
          }
          if (entry && entry.entryId && entry.entryId !== key) {
            if (!card.condEffects[entry.entryId]) card.condEffects[entry.entryId] = card.condEffects[key];
            delete card.condEffects[key];
            changed = true;
          }
        });
      });
    });
    if (changed) save();
  }

  // Иконки: монохромный путь в цвете состояния + тёмный контур и блик,
  // чтобы без плашки читались на тёмном фоне (референс «Иконки состояний.png»).
  function condIcon(type, color, shade, hi) {
    const s = '#18151f';
    switch (type) {
      case 'skull':
        return '<svg viewBox="0 0 48 48"><g transform="rotate(-6 24 24)">' +
          '<path d="M24 5 C13 5 6.5 12.5 6.5 22 C6.5 27.2 9.2 31.2 13.5 33.2 C14.5 33.7 14.8 35 14.5 37.5 L14.2 40.5 C14.1 42 15.8 42.8 17.2 42 L18.8 39 L20.2 42.2 C21 43.2 22.8 43.2 23.4 42 L24.5 39 L25.8 42 C26.5 43.2 28.2 43.2 29 42.2 L30.4 39 L32 42 C33.4 42.8 35 42 34.8 40.5 L34.5 37.5 C34.2 35 34.5 33.7 35.5 33.2 C39.8 31.2 42.5 27.2 42.5 22 C42.5 12.5 35 5 24 5 Z" fill="' + color + '" stroke="' + s + '" stroke-width="2.5" stroke-linejoin="round"/>' +
          '<path d="M23 7.5 C15.5 7.5 10.2 12.5 9.5 19.5 C12.5 13.5 17.5 10.2 25 9.8 Z" fill="' + hi + '" opacity=".55"/>' +
          '<ellipse cx="17.5" cy="23.5" rx="4.5" ry="5" transform="rotate(-8 17.5 23.5)" fill="' + s + '"/>' +
          '<ellipse cx="30.8" cy="23.5" rx="4.2" ry="4.8" transform="rotate(8 30.8 23.5)" fill="' + s + '"/>' +
          '<path d="M24.2 27.8 L21.8 32.8 L26.5 32.8 Z" fill="' + s + '"/></g></svg>';
      case 'drop':
        return '<svg viewBox="0 0 48 48"><path d="M24 5 C24 5 38.5 22.5 38.5 31.5 C38.5 39.8 32 44 24 44 C16 44 9.5 39.8 9.5 31.5 C9.5 22.5 24 5 24 5 Z" fill="' + color + '" stroke="' + s + '" stroke-width="2.5" stroke-linejoin="round"/>' +
          '<path d="M24 7 C29 14 35 23.5 35 31.5 C35 37.8 30.2 41.5 23.5 42 C31.2 42.5 36.8 38.5 36.8 31.5 C36.8 23.5 29 12.5 24 7 Z" fill="' + shade + '" opacity=".65"/>' +
          '<path d="M16.5 25 C14.5 29.5 15 34.5 18 37.5" stroke="' + hi + '" stroke-width="2.8" stroke-linecap="round" fill="none" opacity=".75"/></svg>';
      case 'snow':
        return '<svg viewBox="0 0 48 48"><g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
          '<g stroke="' + s + '" stroke-width="5"><path d="M24 5 V43 M7.5 14.5 L40.5 33.5 M40.5 14.5 L7.5 33.5"/><path d="M19 9.5 L24 14 L29 9.5 M19 38.5 L24 34 L29 38.5"/><path d="M9.5 20.5 L15.5 19 L14 13 M38.5 27.5 L32.5 29 L34 35"/><path d="M14 35 L15.5 29 L9.5 27.5 M34 13 L32.5 19 L38.5 20.5"/></g>' +
          '<g stroke="' + color + '" stroke-width="2.6"><path d="M24 5 V43 M7.5 14.5 L40.5 33.5 M40.5 14.5 L7.5 33.5"/><path d="M19 9.5 L24 14 L29 9.5 M19 38.5 L24 34 L29 38.5"/><path d="M9.5 20.5 L15.5 19 L14 13 M38.5 27.5 L32.5 29 L34 35"/><path d="M14 35 L15.5 29 L9.5 27.5 M34 13 L32.5 19 L38.5 20.5"/></g></g>' +
          '<circle cx="24" cy="24" r="3" fill="' + hi + '" stroke="' + s + '" stroke-width="1.5"/></svg>';
      case 'star':
        return '<svg viewBox="0 0 48 48"><path d="M24 4 L29.8 16.8 L43.8 18.4 L33.4 27.9 L36.2 41.7 L24 34.8 L11.8 41.7 L14.6 27.9 L4.2 18.4 L18.2 16.8 Z" fill="' + color + '" stroke="' + s + '" stroke-width="2.5" stroke-linejoin="round"/>' +
          '<path d="M24 6.5 L28.5 17.5 L40.5 19 L31.5 27 L24 24 Z" fill="' + hi + '" opacity=".55"/></svg>';
      case 'heart':
        return '<svg viewBox="0 0 48 48"><g transform="rotate(8 24 24)"><path d="M24 41.5 C24 41.5 7 30.8 7 18.5 C7 11.5 12.2 7 18 7 C21.5 7 23.2 9 24 11.2 C24.8 9 26.5 7 30 7 C35.8 7 41 11.5 41 18.5 C41 30.8 24 41.5 24 41.5 Z" fill="' + color + '" stroke="' + s + '" stroke-width="2.5" stroke-linejoin="round"/>' +
          '<path d="M30 8.5 C34.8 8.5 39 12.2 39 18.5 C39 28.5 26.5 37.5 24 39.5 C28.5 34.5 35 27.5 35 18.5 C35 13.5 32.8 10.2 30 8.5 Z" fill="' + shade + '" opacity=".55"/>' +
          '<path d="M13 15 C11.5 18 12 21.5 13.8 24" stroke="' + hi + '" stroke-width="2.6" stroke-linecap="round" fill="none" opacity=".75"/></g></svg>';
      case 'flame':
        return '<svg viewBox="0 0 48 48"><path d="M25 4 C29 13 39 19 39 30 C39 38.5 32.2 44 24 44 C15.8 44 9 38.2 9 29.5 C9 22 14 16 17.5 11.5 C17.5 16.5 20 19 21.5 21 C20.5 14.5 22 8.5 25 4 Z" fill="' + color + '" stroke="' + s + '" stroke-width="2.5" stroke-linejoin="round"/>' +
          '<path d="M24 21 C27 25 31 28.5 31 34 C31 38.5 28 41.5 24 41.5 C20 41.5 17 38.5 17 34 C17 29.5 21 26 24 21 Z" fill="' + hi + '" opacity=".85"/></svg>';
      case 'curse':
        return '<svg viewBox="0 0 48 48"><path d="M24 4 C26.5 16 32 21.5 44 24 C32 26.5 26.5 32 24 44 C21.5 32 16 26.5 4 24 C16 21.5 21.5 16 24 4 Z" fill="' + color + '" stroke="' + s + '" stroke-width="2.5" stroke-linejoin="round"/>' +
          '<circle cx="24" cy="24" r="4.5" fill="' + hi + '"/></svg>';
      case 'bolt':
        return '<svg viewBox="0 0 48 48"><path d="M27 4 L11 26 H23 L19 44 L37 20 H25 Z" fill="' + color + '" stroke="' + s + '" stroke-width="2.5" stroke-linejoin="round"/>' +
          '<path d="M25.5 7.5 L14 24.5 H22.5 L25.5 7.5 Z" fill="' + hi + '" opacity=".6"/></svg>';
      case 'eye':
        return '<svg viewBox="0 0 48 48"><path d="M24 13 C35.5 13 43.5 21 45.5 24 C43.5 27 35.5 35 24 35 C12.5 35 4.5 27 2.5 24 C4.5 21 12.5 13 24 13 Z" fill="' + color + '" stroke="' + s + '" stroke-width="2.5" stroke-linejoin="round"/>' +
          '<circle cx="24" cy="24" r="7" fill="' + s + '"/><circle cx="24" cy="24" r="2.6" fill="' + hi + '"/>' +
          '<path d="M8 41 L40 7" stroke="' + s + '" stroke-width="6.4" stroke-linecap="round"/><path d="M8 41 L40 7" stroke="' + hi + '" stroke-width="3" stroke-linecap="round"/></svg>';
      case 'bang':
        return '<svg viewBox="0 0 48 48"><rect x="19.5" y="4" width="9" height="26" rx="4.5" fill="' + color + '" stroke="' + s + '" stroke-width="2.5"/>' +
          '<circle cx="24" cy="39" r="5.5" fill="' + color + '" stroke="' + s + '" stroke-width="2.5"/>' +
          '<rect x="21.5" y="6" width="3" height="16" rx="1.5" fill="' + hi + '" opacity=".6"/></svg>';
      case 'grip':
        return '<svg viewBox="0 0 48 48"><path d="M10 36 V22 C10 14.3 16.3 8 24 8 C31.7 8 38 14.3 38 22 V36" fill="none" stroke="' + s + '" stroke-width="10" stroke-linecap="round"/>' +
          '<path d="M10 36 V22 C10 14.3 16.3 8 24 8 C31.7 8 38 14.3 38 22 V36" fill="none" stroke="' + color + '" stroke-width="5" stroke-linecap="round"/>' +
          '<circle cx="10" cy="36" r="5" fill="' + color + '" stroke="' + s + '" stroke-width="2.2"/><circle cx="38" cy="36" r="5" fill="' + color + '" stroke="' + s + '" stroke-width="2.2"/></svg>';
      case 'fall':
        return '<svg viewBox="0 0 48 48"><g transform="rotate(-28 24 24)" stroke-linecap="round">' +
          '<circle cx="16" cy="11" r="5.5" fill="' + color + '" stroke="' + s + '" stroke-width="2.2"/>' +
          '<path d="M16 18 V31 M16 31 L8 41 M16 31 L25 40 M16 23 L7 28 M16 23 L26 28" fill="none" stroke="' + s + '" stroke-width="8.6"/>' +
          '<path d="M16 18 V31 M16 31 L8 41 M16 31 L25 40 M16 23 L7 28 M16 23 L26 28" fill="none" stroke="' + color + '" stroke-width="4.2"/></g></svg>';
      case 'net':
        return '<svg viewBox="0 0 48 48"><g fill="none" stroke-linecap="round">' +
          '<g stroke="' + s + '" stroke-width="7"><path d="M8 8 L40 40 M40 8 L8 40 M5 24 H43 M24 5 V43"/></g>' +
          '<g stroke="' + color + '" stroke-width="3"><path d="M8 8 L40 40 M40 8 L8 40 M5 24 H43 M24 5 V43"/></g></g>' +
          '<circle cx="24" cy="24" r="4" fill="' + hi + '" stroke="' + s + '" stroke-width="1.6"/></svg>';
      case 'zzz':
        return '<svg viewBox="0 0 48 48"><g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M8 10 H26 L8 27 H27" stroke="' + s + '" stroke-width="8"/><path d="M8 10 H26 L8 27 H27" stroke="' + color + '" stroke-width="3.8"/>' +
          '<path d="M27 29 H41 L27 42 H41" stroke="' + s + '" stroke-width="6.4"/><path d="M27 29 H41 L27 42 H41" stroke="' + hi + '" stroke-width="2.8"/></g></svg>';
      case 'weary':
        // истощение — «пустеющие деления»: столбики, последний погас
        return '<svg viewBox="0 0 48 48">' +
          '<g stroke="' + s + '" stroke-width="2.4" stroke-linejoin="round">' +
          '<rect x="7" y="24" width="9" height="18" rx="3" fill="' + color + '"/>' +
          '<rect x="19.5" y="16" width="9" height="26" rx="3" fill="' + color + '"/>' +
          '<rect x="32" y="8" width="9" height="34" rx="3" fill="' + color + '" opacity=".3"/>' +
          '</g><path d="M9.5 26 V40 M22 18 V40" stroke="' + hi + '" stroke-width="1.6" opacity=".5" stroke-linecap="round"/></svg>';
    }
    return '';
  }

  // Средний тон активных состояний: зелёный + красный → оливковый и т.п.
  // (при 5+ дебаффах тон темнеет — осознанно, приоритеты категориями будут позже)
  function condHexToRgb(hex) {
    const h = String(hex || '').replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function condRgbToHex(r, g, b) {
    const f = function (v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); };
    return '#' + f(r) + f(g) + f(b);
  }
  function condAvgTint(list) {
    const tinted = (list || []).filter(function (s) { return s && s.tint && num(s.tintOp) > 0; });
    if (!tinted.length) return null;
    let r = 0, g = 0, b = 0, op = 0;
    tinted.forEach(function (s) {
      const c = condHexToRgb(s.tint);
      r += c.r; g += c.g; b += c.b; op += num(s.tintOp);
    });
    const n = tinted.length;
    return { color: condRgbToHex(r / n, g / n, b / n), op: Math.min(0.5, op / n) };
  }

  // Лицо: важнее всего «без сознания», затем ослепление, затем оглушение —
  // чтобы несколько дебаффов не превращали лицо в кашу
  function condFace(list) {
    const faces = (list || []).map(function (s) { return s && s.face; });
    if (faces.indexOf('closed') !== -1) return 'closed';
    if (faces.indexOf('blind') !== -1) return 'blind';
    if (faces.indexOf('dizzy') !== -1) return 'dizzy';
    return null;
  }

  // Геометрия куклы — перенос со стенда doll_base_v2.html (единый силуэт без «П»)
  const COND_BODY_D = 'M 98 112 Q 119 108 140 114 C 160 127 181 142 199 156 L 192 161 L 198 169 L 188 171 L 191 179 L 181 176 C 167 166 154 155 142 144 C 142 156 146 178 152 202 L 165 264 L 158 260 L 154 272 L 146 263 L 141 273 L 135 264 C 128 240 121 215 115 193 C 107 216 98 244 90 272 L 83 263 L 76 273 L 70 261 L 62 267 L 82 198 C 87 180 92 160 94 140 C 78 150 61 160 45 169 C 31 176 25 155 39 146 C 56 135 78 122 98 112 Z';
  const COND_HEAD_D = 'M 124 30 C 150 31 168 50 166 75 C 164 98 145 112 120 111 C 95 110 78 93 80 69 C 82 45 100 29 124 30 Z';
  const COND_PATCH_L_D = 'M 76 214 Q 90 219 104 220 L 98 241 L 93 236 L 88 243 L 83 237 L 78 242 L 73 236 L 69 239 Z';
  const COND_PATCH_R_D = 'M 142 216 L 155 213 L 162 245 L 148 248 Z';
  const COND_ROPE_D = 'M 96 105 Q 119 114 143 109 C 146 111 145 115 141 115 Q 119 120 96 111 C 93 109 93 106 96 105 Z M 95 111 Q 119 120 142 115 C 145 117 144 121 140 121 Q 118 126 95 117 C 92 115 92 112 95 111 Z';

  let condUid = 0;
  let condFresh = null;   // ключ только что добавленного состояния — для pop-анимации иконки

  function conditionBody(card, bare) {
    const list = Array.isArray(card.conditions) ? card.conditions : [];
    const gid = 'cd' + (++condUid);
    const face = condFace(list);
    const tint = condAvgTint(list);
    const keys = list.map(function (s) { return s.key; });
    const isStun = face === 'dizzy';
    const primary = list[0] || null;

    // Цвет пуговиц слегка подстраивается под первое состояние
    let btn1 = '#47424c', btn2 = '#2c2831', btnRim = '#686170';
    if (primary && primary.color) {
      const c = condHexToRgb(primary.color);
      btn1 = condRgbToHex(c.r * 0.55, c.g * 0.55, c.b * 0.55);
      btn2 = condRgbToHex(c.r * 0.3, c.g * 0.3, c.b * 0.3);
      btnRim = condRgbToHex(c.r * 0.8 + 40, c.g * 0.8 + 40, c.b * 0.8 + 40);
    }

    // Тонировка: красим сами пути силуэта (как на стенде), а не прямоугольник
    // под clip-path — у клипованного прямоугольника оставался тонкий шов у левой руки.
    let tintHtml = '';
    if (tint) {
      tintHtml = '<g class="cond-tint" fill="' + tint.color + '" opacity="' + tint.op.toFixed(2) + '" style="mix-blend-mode:color">' +
        '<path d="' + COND_BODY_D + '"/><path d="' + COND_HEAD_D + '"/></g>';
    }

    // Детали состояний на самой кукле
    let fx = '';
    if (keys.indexOf('poison') !== -1) {
      fx += '<g fill="#7ac74f" stroke="#1b1822" stroke-width="1.5" opacity=".9">' +
        '<path d="M 164 153 Q 176 163 188 172 L 185 188 C 184 192 180 192 179 188 L 178 176 L 172 183 C 171 186 168 185 168 181 Z"/>' +
        '<circle cx="181" cy="197" r="2.5"/><circle cx="171" cy="191" r="1.7"/></g>';
    }
    if (keys.indexOf('blood') !== -1) {
      fx += '<g fill="#b52a2a" opacity=".88">' +
        '<path d="M 102 84 Q 100 96 102 105 C 103 108 106 108 106 104 Q 105 94 106 84 Z"/>' +
        '<path d="M 96 119 Q 92 136 95 152 C 96 156 99 155 99 151 Q 98 136 101 120 Z"/>' +
        '<path d="M 105 120 Q 104 132 106 141 C 107 144 109 143 109 140 Q 108 130 109 120 Z"/>' +
        '<path d="M 42 150 Q 35 161 36 171 C 37 174 40 174 41 170 Q 41 160 47 154 Z"/>' +
        '<path d="M 38 177 C 38 177 42 183 42 186 A 3 3 0 1 1 36 186 C 36 183 38 177 38 177 Z" stroke="#1b1822" stroke-width="1.2"/></g>';
    }
    if (keys.indexOf('freeze') !== -1) {
      fx += '<g fill="#8fd3ff" stroke="#1b1822" stroke-width="1.6" stroke-linejoin="round" opacity=".92">' +
        '<polygon points="35,164 39,184 45,168"/><polygon points="49,162 52,179 57,160"/>' +
        '<polygon points="184,173 188,193 194,174"/><polygon points="171,166 175,184 180,169"/>' +
        '<polygon points="154,196 164,190 158,204"/><polygon points="78,194 68,189 74,203"/></g>';
    }
    if (keys.indexOf('burn') !== -1) {
      fx += '<g opacity=".9">' +
        '<path d="M 62 267 L 70 261 L 76 273 L 83 263 L 90 272 L 94 252 Q 78 248 67 250 Z" fill="#2a1d17"/>' +
        '<path d="M 135 264 L 141 273 L 146 263 L 154 272 L 158 261 L 165 264 L 160 248 Q 146 250 132 250 Z" fill="#2a1d17"/>' +
        '<path d="M 65 264 L 72 257 L 76 269 L 83 259 L 89 268" stroke="#ff7a2f" stroke-width="2.2" fill="none"/>' +
        '<path d="M 136 261 L 142 269 L 147 259 L 154 268 L 162 260" stroke="#ff7a2f" stroke-width="2.2" fill="none"/></g>';
    }

    // Глаза-пуговицы: крестики; при оглушении — спирали (головокружение);
    // при ослеплении — мазок маркером; при «без сознания» — пуговицы без крестиков
    // (веки поверх пуговиц читались плохо — глаза у нас именно пуговицы).
    let eyes = '';
    if (face === 'closed') {
      // «Без сознания»: пуговицы погасли — матовые, без блика и без крестиков.
      // Веки поверх пуговиц не рисуем (глаза у нас именно пуговицы).
      eyes = '<g>' +
        '<circle cx="106.5" cy="75.5" r="12.8" fill="#1a1512" opacity=".42"/>' +
        '<circle cx="138.5" cy="80.5" r="12.2" fill="#1a1512" opacity=".42"/>' +
        '<circle cx="105" cy="73" r="12.5" fill="#262230" stroke="#141019" stroke-width="2.4"/>' +
        '<circle cx="105" cy="73" r="9.3" fill="none" stroke="#1b1723" stroke-width="1.8"/>' +
        '<circle cx="137" cy="78" r="12" fill="#221f2b" stroke="#141019" stroke-width="2.4"/>' +
        '<circle cx="137" cy="78" r="8.9" fill="none" stroke="#1b1723" stroke-width="1.8"/>' +
        '</g>';
    } else if (isStun) {
      eyes = '<g>' +
        '<circle cx="105" cy="73" r="12.5" fill="url(#' + gid + '-btn)" stroke="#19161f" stroke-width="2.4"/>' +
        '<path d="M105 73 m-1 0 a 2 2 0 1 0 4 0 a 4.5 4.5 0 1 0 -9 0 a 7 7 0 1 0 14 0 a 9.5 9.5 0 1 0 -19 0" fill="none" stroke="#18151e" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="137" cy="78" r="12" fill="url(#' + gid + '-btn)" stroke="#19161f" stroke-width="2.4"/>' +
        '<path d="M137 78 m-1 0 a 2 2 0 1 0 4 0 a 4.5 4.5 0 1 0 -9 0 a 7 7 0 1 0 14 0 a 9.2 9.2 0 1 0 -18.4 0" fill="none" stroke="#18151e" stroke-width="2" stroke-linecap="round"/>' +
        '</g>';
    } else {
      eyes = '<g>' +
        '<circle cx="106.5" cy="75.5" r="12.8" fill="#1a1512" opacity=".42"/>' +
        '<circle cx="138.5" cy="80.5" r="12.2" fill="#1a1512" opacity=".42"/>' +
        '<circle cx="105" cy="73" r="12.5" fill="url(#' + gid + '-btn)" stroke="#19161f" stroke-width="2.4"/>' +
        '<circle cx="105" cy="73" r="9.3" fill="none" stroke="#211d26" stroke-width="1.6"/>' +
        '<path d="M 100.5 68.5 L 109.5 77.5 M 109.5 68.5 L 100.5 77.5" stroke="#17141c" stroke-width="2.8" stroke-linecap="round"/>' +
        '<circle cx="137" cy="78" r="12" fill="url(#' + gid + '-btn)" stroke="#19161f" stroke-width="2.4"/>' +
        '<circle cx="137" cy="78" r="8.9" fill="none" stroke="#211d26" stroke-width="1.6"/>' +
        '<path d="M 132.8 73.8 L 141.2 82.2 M 141.2 73.8 L 132.8 82.2" stroke="#17141c" stroke-width="2.8" stroke-linecap="round"/>' +
        '</g>';
    }
    if (face === 'blind') {
      // «Слепота»: пуговицы-глаза заклеены тканевыми заплатками и пришиты по краю —
      // тот же приём, что заплатки на ногах, поэтому читается как «глаза закрыты».
      eyes += '<g>' +
        '<g transform="rotate(-7 105 73)">' +
          '<path d="M 91 57 Q 105 54 118 58 Q 121 66 120 76 Q 119 86 112 89 Q 100 90 92 87 Q 87 78 88 68 Q 88 61 91 57 Z" fill="#b3a086" stroke="#1b1822" stroke-width="2.2" stroke-linejoin="round"/>' +
          '<path d="M 93 61 Q 105 58 116 62 Q 118 70 117 78 Q 116 85 110 87 Q 100 88 94 85 Q 90 76 91 68 Q 91 63 93 61 Z" fill="none" stroke="#6f5f4c" stroke-width="1.3" stroke-dasharray="3 3"/>' +
          '<path d="M 96 66 H 104 M 110 70 H 116 M 98 80 H 106" stroke="#8b7a63" stroke-width="1" opacity=".55" stroke-linecap="round"/>' +
          '<path d="M 90 64 L 84 62 M 92 82 L 86 85" stroke="#b3a086" stroke-width="2" stroke-linecap="round"/>' +
        '</g>' +
        '<g transform="rotate(6 137 78)">' +
          '<path d="M 123 61 Q 137 58 150 62 Q 153 70 152 80 Q 151 90 144 93 Q 132 94 124 91 Q 119 82 120 72 Q 120 65 123 61 Z" fill="#ab9a80" stroke="#1b1822" stroke-width="2.2" stroke-linejoin="round"/>' +
          '<path d="M 125 65 Q 137 62 148 66 Q 150 74 149 82 Q 148 89 142 91 Q 132 92 126 89 Q 122 80 123 72 Q 123 67 125 65 Z" fill="none" stroke="#6f5f4c" stroke-width="1.3" stroke-dasharray="3 3"/>' +
          '<path d="M 128 70 H 136 M 142 74 H 148 M 130 84 H 138" stroke="#8b7a63" stroke-width="1" opacity=".55" stroke-linecap="round"/>' +
          '<path d="M 153 78 L 159 77 M 151 88 L 157 91" stroke="#ab9a80" stroke-width="2" stroke-linecap="round"/>' +
        '</g>' +
      '</g>';
    }

    const stage = '<div class="cond-stage">' +
      '<svg class="cond-doll" viewBox="0 0 240 310" aria-hidden="true"><defs>' +
        '<radialGradient id="' + gid + '-head" cx="36%" cy="30%" r="70%"><stop offset="0%" stop-color="#c2b098"/><stop offset="52%" stop-color="#9b8974"/><stop offset="88%" stop-color="#6e5f4e"/><stop offset="100%" stop-color="#584b3d"/></radialGradient>' +
        '<linearGradient id="' + gid + '-body" x1="22%" y1="12%" x2="82%" y2="88%"><stop offset="0%" stop-color="#b9a68e"/><stop offset="48%" stop-color="#95836e"/><stop offset="85%" stop-color="#6c5d4c"/><stop offset="100%" stop-color="#55483a"/></linearGradient>' +
        '<linearGradient id="' + gid + '-patch" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ae9b82"/><stop offset="65%" stop-color="#867460"/><stop offset="100%" stop-color="#615243"/></linearGradient>' +
        '<linearGradient id="' + gid + '-rope" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#9e8a70"/><stop offset="55%" stop-color="#75644f"/><stop offset="100%" stop-color="#4e4133"/></linearGradient>' +
        '<radialGradient id="' + gid + '-btn" cx="35%" cy="32%" r="68%"><stop offset="0%" stop-color="' + btn1 + '"/><stop offset="100%" stop-color="' + btn2 + '"/></radialGradient>' +
        '<clipPath id="' + gid + '-clip"><path d="' + COND_BODY_D + '"/><path d="' + COND_HEAD_D + '"/></clipPath>' +
      '</defs>' +
      '<path d="' + COND_BODY_D + '" fill="url(#' + gid + '-body)"/>' +
      '<g clip-path="url(#' + gid + '-clip)">' +
        '<path d="M 94 140 C 78 150 61 160 45 169 C 36 173 30 166 31 158 L 94 126 Z" fill="#463b30" opacity=".42"/>' +
        '<path d="M 142 144 C 154 155 167 166 181 176 L 191 179 L 188 171 L 196 168 L 141 128 Z" fill="#463b30" opacity=".45"/>' +
        '<path d="M 131 116 Q 136 155 135 190 L 152 264 L 165 264 L 152 202 C 146 178 142 156 142 144 L 140 114 Z" fill="#463b30" opacity=".44"/>' +
        '<path d="M 115 193 C 107 216 98 244 90 272 L 83 263 L 106 189 Z" fill="#463b30" opacity=".42"/>' +
        '<path d="M 94 115 Q 119 124 143 118 L 142 128 Q 118 134 94 125 Z" fill="#352c23" opacity=".38"/>' +
      '</g>' +
      '<path d="M 94 116 C 77 125 58 137 42 147" stroke="#d5c5ae" stroke-width="2.2" stroke-linecap="round" fill="none" opacity=".38"/>' +
      '<path d="M 143 118 C 160 129 178 142 194 155" stroke="#c9b8a0" stroke-width="1.8" stroke-linecap="round" fill="none" opacity=".28"/>' +
      '<path d="M 98 126 Q 94 154 86 190 L 69 252" stroke="#d4c3ac" stroke-width="3" stroke-linecap="round" fill="none" opacity=".28"/>' +
      '<path d="' + COND_PATCH_L_D + '" fill="url(#' + gid + '-patch)"/>' +
      '<path d="' + COND_PATCH_R_D + '" fill="url(#' + gid + '-patch)"/>' +
      '<path d="M 69 239 L 73 236 L 78 242 L 83 237 L 88 243 L 93 236 L 98 241" stroke="#382f25" stroke-width="2" fill="none" opacity=".5"/>' +
      '<path d="' + COND_HEAD_D + '" fill="url(#' + gid + '-head)"/>' +
      '<path d="M 146 37 C 161 52 162 82 144 98 C 127 111 101 109 86 92 C 104 103 130 101 144 85 C 157 70 156 49 146 37 Z" fill="#43382d" opacity=".48"/>' +
      '<ellipse cx="106" cy="48" rx="18" ry="11" transform="rotate(-24 106 48)" fill="#ded0bc" opacity=".28"/>' +
      '<g stroke="#5c4e40" stroke-width="0.9" opacity=".28" fill="none" stroke-linecap="round"><path d="M92 52h10 M95 49v7 M98 50v6 M146 64h8 M149 61v7"/><path d="M104 146h11 M107 143v7 M111 144v6 M124 168h9 M128 165v7"/></g>' +
      tintHtml +
      fx +
      '<g fill="none" stroke="#1b1822" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="' + COND_BODY_D + '"/><path d="' + COND_PATCH_L_D + '" stroke-width="2.1"/><path d="' + COND_PATCH_R_D + '" stroke-width="2.1"/>' +
      '</g>' +
      '<path d="' + COND_ROPE_D + '" fill="url(#' + gid + '-rope)" stroke="#1b1822" stroke-width="2.2" stroke-linejoin="round"/>' +
      '<g stroke="#332a21" stroke-width="1.5" stroke-linecap="round" opacity=".75"><path d="M104 107 L101 112 M113 109 L110 115 M122 111 L119 116 M131 110 L128 116"/><path d="M103 113 L100 118 M112 115 L109 121 M121 117 L118 122 M130 116 L127 122"/></g>' +
      '<circle cx="136" cy="116" r="3.4" fill="url(#' + gid + '-rope)" stroke="#1b1822" stroke-width="2"/>' +
      '<path d="' + COND_HEAD_D + '" fill="none" stroke="#1b1822" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<g fill="none" stroke="#221d26" stroke-linecap="round">' +
        '<path d="M 130 31 Q 128 44 126 56" stroke-width="2"/><path d="M 125 37 L 134 39 M 124 44 L 133 46 M 123 51 L 131 53" stroke-width="1.8"/>' +
        '<path d="M 114 93 Q 119.5 95 125 94" stroke-width="2.3"/><path d="M 119.5 90.5 L 119 97.5" stroke-width="1.9"/>' +
        '<path d="M 120 124 Q 117 150 116 177" stroke-width="2.1"/><path d="M 115 131 L 124 132 M 114 142 L 123 143 M 113 154 L 122 155 M 112 166 L 121 167" stroke-width="1.8"/>' +
        '<path d="M 65 132 Q 70 142 75 151" stroke-width="1.7" opacity=".85"/><path d="M 63 138 L 71 134 M 68 146 L 76 142" stroke-width="1.6"/>' +
        '<path d="M 164 132 Q 159 143 154 153" stroke-width="1.7" opacity=".85"/><path d="M 158 136 L 166 141 M 153 145 L 161 150" stroke-width="1.6"/>' +
        '<path d="M 85 194 L 98 202" stroke-width="1.8"/><path d="M 89 192 L 86 199 M 95 196 L 92 203" stroke-width="1.6"/>' +
        '<path d="M 132 203 L 146 196" stroke-width="1.8"/><path d="M 135 197 L 138 204 M 141 194 L 144 201" stroke-width="1.6"/>' +
        '<path d="M 79 213 L 78 219 M 88 216 L 87 222 M 97 217 L 96 223" stroke-width="1.6"/>' +
        '<path d="M 139 224 L 145 223 M 141 233 L 147 232 M 143 242 L 149 241" stroke-width="1.6"/>' +
      '</g>' + eyes +
      '</svg>' + condIconsHTML(list, card) +
    '</div>';
    // bare — только сцена (для превью во втором слое), иначе тело карточки целиком
    return bare ? stage : '<div class="card-body cond-body">' + stage + '</div>';
  }

  // Позиции иконок вокруг фигуры (проценты от stage). Первая — справа сверху у головы,
  // как на референсе; дальше по кругу по часовой.
  const COND_SLOTS = [
    { x: 78, y: 12 }, { x: 22, y: 12 }, { x: 93, y: 30 }, { x: 7, y: 30 },
    { x: 94, y: 57 }, { x: 6, y: 57 }, { x: 81, y: 87 }, { x: 19, y: 87 }
  ];

  function condIconsHTML(list, card) {
    const n = (list || []).length;
    if (!n) return '';
    const max = 8;
    const more = n > max;
    const shown = more ? max - 1 : n;
    let html = '<div class="cond-icons">';
    for (let i = 0; i < shown; i++) {
      const s = list[i];
      const pos = COND_SLOTS[i] || COND_SLOTS[0];
      const fresh = condFresh && condFresh.id === card.id && condFresh.key === s.key ? ' fresh' : '';
      html += '<span class="cond-icon' + (n > 1 ? ' mini' : '') + fresh + '" data-ic="' + s.icon + '" style="left:' + pos.x + '%;top:' + pos.y + '%" title="' + esc(s.name) + '">' +
        condIcon(s.icon, s.color, s.shade, s.hi) + '</span>';
    }
    if (more) {
      const pos = COND_SLOTS[max - 1];
      html += '<span class="cond-icon cond-more" style="left:' + pos.x + '%;top:' + pos.y + '%" title="' + esc(App.tf('condMore', { n: n - shown })) + '">+' + (n - shown) + '</span>';
    }
    return html + '</div>';
  }

  function condSnapshot(p, setId) {
    return {
      id: uid(), key: p.key, setId: setId || null,
      entryId: p.entryId || null,
      name: p.nameKey ? App.t(p.nameKey) : (p.name || ''),
      effect: p.descKey ? App.t(p.descKey) : (p.effect || ''),
      icon: p.icon, color: p.color, shade: p.shade, hi: p.hi,
      tint: p.tint || null, tintOp: p.tintOp || 0,
      category: p.category, scope: p.scope || 'none', face: p.face || null,
      duration: p.duration || null,
      // эффекты из набора — шаблоны БЕЗ цели (набор общий для всех персонажей,
      // id карточек у каждого свои). Цель подставится из личных эффектов карточки
      effects: (p.effects || []).map(function (ef) {
        return { mode: ef.mode, field: effectField(ef), value: ef.value,
                 label: ef.label || '', target: null,
                 timing: ef.mode === 'tick' ? (ef.timing || 'start') : null };
      })
    };
  }

  function condPreset(key) {
    return stateEntries(activeChar()).find(function (p) { return p.key === key; }) || null;
  }

  // личные эффекты состояния: живут на карточке и переживают снятие состояния.
  // Набор общий для устройства, поэтому цель (id карточки) может храниться только здесь.
  // v86: ключ памяти — entryId; старые данные по key читаем как fallback.
  function condMemoryKey(obj) {
    return obj ? (obj.entryId || obj.key || null) : null;
  }
  function condPersonalEffects(card, memKey, legacyKey) {
    const map = card && card.condEffects;
    if (!map) return null;
    if (memKey && Array.isArray(map[memKey])) return map[memKey];
    if (legacyKey && legacyKey !== memKey && Array.isArray(map[legacyKey])) return map[legacyKey];
    return null;
  }

  function toggleCondition(cardId, key) {
    const card = findCard(cardId);
    const p = condPreset(key);
    if (!card || card.type !== 'condition' || !p) return;
    const set = stateSetOf(activeChar());
    const list = Array.isArray(card.conditions) ? card.conditions : [];
    const sameState = function (s) {
      return (p.entryId && s.entryId === p.entryId) || s.key === key;
    };
    const has = list.some(sameState);
    mutate(function () {
      if (has) card.conditions = list.filter(function (s) { return !sameState(s); });
      else {
        const snap = condSnapshot(p, set ? set.id : null);
        // личные эффекты (с целями) перебивают шаблон набора — иначе цель выбирать заново
        const own = condPersonalEffects(card, condMemoryKey(p), p.key);
        if (own && own.length) {
          snap.effects = own.map(function (ef) {
            return { mode: ef.mode, field: effectField(ef), value: ef.value,
                     label: ef.label || '', target: ef.target || null, custom: !!ef.custom,
                     timing: ef.mode === 'tick' ? (ef.timing || 'start') : null };
          });
        }
        card.conditions = list.concat([snap]);
        condFresh = { id: card.id, key: key };
      }
    });
    // v69: без тостов — ни на добавление, ни на снятие: список и кукла сами показывают результат
  }

  function clearConditions(cardId) {
    const card = findCard(cardId);
    if (!card) return;
    if (!(card.conditions || []).length) return;
    mutate(function () { card.conditions = []; });
  }

  // v83: обновить активные снимки на карточке из текущего набора.
  // Цели и личные переопределения сохраняются; шаблон меняет только «базу».
  function refreshFromSet(cardId) {
    const card = findCard(cardId);
    if (!card || card.type !== 'condition') return;
    const set = stateSetOf(activeChar());
    const entries = set && Array.isArray(set.entries) ? set.entries : [];
    const jobs = [];
    (card.conditions || []).forEach(function (snap) {
      const entry = entries.find(function (e) {
        return (snap.entryId && e.entryId === snap.entryId) || e.key === snap.key;
      });
      if (entry) jobs.push({ snap: snap, entry: entry });
    });
    if (!jobs.length) { toast(App.t('condNothingToRefresh')); return; }
    mutate(function () {
      jobs.forEach(function (job) {
        const snap = job.snap, entry = job.entry;
        const own = condPersonalEffects(card, condMemoryKey(snap), snap.key);
        const oldEffects = (snap.effects || []).slice();
        snap.name = entry.nameKey ? App.t(entry.nameKey) : (entry.name || '');
        snap.effect = entry.descKey ? App.t(entry.descKey) : (entry.effect || '');
        snap.icon = entry.icon || snap.icon;
        snap.color = entry.color || snap.color;
        snap.shade = entry.shade || snap.shade;
        snap.hi = entry.hi || snap.hi;
        snap.tint = entry.tint || null;
        snap.tintOp = num(entry.tintOp) || 0;
        snap.category = entry.category || snap.category;
        snap.scope = entry.scope || snap.scope;
        snap.face = entry.face || null;
        snap.duration = entry.duration || null;
        if (entry.entryId) snap.entryId = entry.entryId;
        if (set) snap.setId = set.id;
        const tpl = (entry.effects || []).map(function (ef) {
          return { mode: ef.mode, field: effectField(ef), value: ef.value, label: ef.label || '',
                   timing: ef.mode === 'tick' ? (ef.timing || 'start') : null };
        });
        if (own && own.length) {
          // личные эффекты остаются, но target-only правки (custom=false)
          // обновляют значение/подпись/режим из шаблона; цель сохраняется.
          const next = [];
          const max = Math.max(own.length, tpl.length);
          for (let i = 0; i < max; i++) {
            const o = own[i], t = tpl[i];
            if (o) {
              if (o.custom == null) {
                const old = oldEffects[i];
                o.custom = !old || o.value !== old.value || (o.label || '') !== (old.label || '') ||
                  o.mode !== old.mode || effectField(o) !== effectField(old) ||
                  (o.timing || 'start') !== (old.timing || 'start');
              }
              if (o.custom) next.push(cloneEffect(o));
              else if (t) next.push({ mode: t.mode, field: t.field, value: t.value, label: t.label, target: o.target || null, custom: false, timing: t.timing });
            } else if (t) {
              next.push({ mode: t.mode, field: t.field, value: t.value, label: t.label,
                target: (oldEffects[i] && oldEffects[i].target) || null, custom: false, timing: t.timing });
            }
          }
          const memKey = condMemoryKey(snap);
          if (next.length) card.condEffects[memKey] = next;
          else delete card.condEffects[memKey];
          if (memKey !== snap.key) delete card.condEffects[snap.key];
          snap.effects = next.map(cloneEffect);
        } else {
          snap.effects = tpl.map(function (t, i) {
            return { mode: t.mode, field: t.field, value: t.value, label: t.label,
              target: (oldEffects[i] && oldEffects[i].target) || null, timing: t.timing };
          });
        }
      });
    });
    toast(App.tf('condRefreshed', { n: jobs.length }));
  }

  // ===== Тики (слой 2) =====
  // Тик — не модификатор: он меняет current один раз и помнит, что сработал.
  // duration уменьшается в конце хода/при ручном применении; 0 — снять состояние.
  function hasTicksOrDuration(card) {
    return (card.conditions || []).some(function (s) {
      return (s.effects || []).some(function (ef) { return ef.mode === 'tick'; }) || num(s.duration) > 0;
    });
  }
  function applyTicksForChar(ch, timing, manual) {
    const parts = [], expired = [];
    let durationChanged = false;
    (ch.cards || []).forEach(function (card) {
      if (card.type !== 'condition') return;
      const keep = [];
      (card.conditions || []).forEach(function (snap) {
        let remove = false;
        (snap.effects || []).forEach(function (ef) {
          if (ef.mode !== 'tick') return;
          if (!manual && (ef.timing || 'start') !== timing) return;
          const t = findCard(ef.target);
          if (!t || t.type !== 'counter') return;
          const delta = exprNumber(t, ef.value);
          if (delta == null || !Number.isFinite(delta) || delta === 0) return;
          t.current = num(t.current) + delta;
          // v88: в тосте — кто сработал и что изменилось: «Яд: Здоровье −1»
          parts.push((snap.name ? snap.name + ': ' : '') + t.name + ' ' + (delta > 0 ? '+' : '−') + Math.abs(delta));
        });
        if (manual || timing === 'end') {
          const dur = num(snap.duration);
          if (dur > 0) {
            snap.duration = dur - 1;
            durationChanged = true;
            if (snap.duration <= 0) { expired.push(snap.name || ''); remove = true; }
          }
        }
        if (!remove) keep.push(snap);
      });
      card.conditions = keep;
    });
    return { parts: parts, expired: expired, durationChanged: durationChanged };
  }
  function ticksSummary(sum) {
    if (!sum) return '';
    const bits = [];
    if (sum.parts.length) bits.push(App.tf('condTicksApplied', { parts: sum.parts.join(', ') }));
    const names = sum.expired.filter(Boolean);
    if (names.length) bits.push(App.tf('condTicksExpired', { names: names.join(', ') }));
    return bits.join(' · ');
  }
  function applyTicksManual() {
    const ch = activeChar();
    if (!ch) return;
    if (!(ch.cards || []).some(hasTicksOrDuration)) { toast(App.t('condTicksNone')); return; }
    let sum = null;
    mutate(function () { sum = applyTicksForChar(ch, 'end', true); });
    let msg = ticksSummary(sum);
    if (!msg && sum && sum.durationChanged) msg = App.t('condTicksTurn');
    toast(msg || App.t('condTicksNone'));
  }
  // Кто в инициативе — «я»: сначала явный флаг, иначе совпадение имени с листом.
  function iniSelfRow(card) {
    const ch = activeChar();
    if (!ch) return null;
    const rows = iniRows(card);
    const self = rows.find(function (r) { return r.self; });
    if (self) return self;
    const nm = String(ch.name || '').trim().toLowerCase();
    if (!nm) return null;
    return rows.find(function (r) { return String(r.name || '').trim().toLowerCase() === nm; }) || null;
  }
  function applyInitiativeTicks(card, prevRow, nextRow) {
    const ch = activeChar();
    const self = iniSelfRow(card);
    if (!ch || !self) return null;
    const sum = { parts: [], expired: [], durationChanged: false };
    if (prevRow && prevRow.id === self.id) {
      const a = applyTicksForChar(ch, 'end', false);
      sum.parts = sum.parts.concat(a.parts);
      sum.expired = sum.expired.concat(a.expired);
      sum.durationChanged = sum.durationChanged || a.durationChanged;
    }
    if (nextRow && nextRow.id === self.id) {
      const b = applyTicksForChar(ch, 'start', false);
      sum.parts = sum.parts.concat(b.parts);
      sum.expired = sum.expired.concat(b.expired);
      sum.durationChanged = sum.durationChanged || b.durationChanged;
    }
    return sum;
  }

  // Второй слой: живая мини-кукла сверху + список активных. «Добавить состояние»
  // Иконка «сбросить все» — круговая стрелка (кнопка в слое состояния)
  const COND_RESET_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v5h5"/></svg>';
  // Иконка «экспорт набора» в шапке набора (в настройках)
  const SET_EXPORT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11"/><path d="M8 10l4 4 4-4"/><path d="M4 17v3h16v-3"/></svg>';

  // ===== Эффекты состояния: «на что влияет» (v77) =====
  // Эффект хранится на карточке (card.condEffects по ключу состояния), а не в наборе:
  // набор общий для всех персонажей устройства, а цель — id карточки конкретного листа.
  // Поэтому набор может отключаться/сменяться без потери привязок.
  const FX_MODE_KEYS = { add: 'fxOpAdd', mul: 'fxOpMul', set: 'fxOpSet', cap: 'fxOpCap', dice: 'fxOpDice', block: 'fxOpBlock', tick: 'fxOpTick' };
  // подсказка живёт прямо в поле «Значение» и зависит от режима —
  // иначе при «умножить» висело «например -2 или 1d6»
  const FX_MODE_PH = { add: 'fxPhAdd', mul: 'fxPhMul', set: 'fxPhSet', cap: 'fxPhCap', dice: 'fxPhDice', tick: 'fxPhTick' };
  const FX_FIELD_KEYS = { bonus: 'fxFieldBonus', max: 'fxFieldMax', value: 'fxFieldValue', charges: 'fxFieldCharges', current: 'fxFieldCurrent' };
  function fxModeText(mode) { return App.t(FX_MODE_KEYS[mode] || 'fxOpAdd'); }
  function fxFieldText(field) { return App.t(FX_FIELD_KEYS[field] || 'fxFieldBonus'); }
  function fxShort(ef) {
    const f = fxFieldText(effectField(ef));
    if (ef.mode === 'block') return App.t('fxOpBlock');
    if (ef.mode === 'tick') return '⏱ ' + (ef.value == null ? '' : ef.value) + ' ' + f;
    if (ef.mode === 'dice') return '+' + (ef.value || '') + ' ' + f;
    if (ef.mode === 'mul') return '×' + String(ef.value == null ? '' : ef.value).replace(/^[*×]/, '') + ' ' + f;
    if (ef.mode === 'set') return '= ' + ef.value + ' ' + f;
    if (ef.mode === 'cap') return '≤ ' + ef.value + ' ' + f;
    return String(ef.value) + ' ' + f;
  }
  // v79: block относится к зарядам, а не к бонусу. Старые записи (v78) читаем
  // как charges, иначе при первой правке режим молча превратился бы в «прибавить».
  function effectField(ef) { return ef.mode === 'block' ? 'charges' : (ef.field || 'bonus'); }
  function cloneEffect(ef) {
    return { mode: ef.mode, field: effectField(ef), value: ef.value, label: ef.label || '', target: ef.target || null, custom: !!ef.custom,
             timing: ef.mode === 'tick' ? (ef.timing || 'start') : null };
  }
  // один источник правды: личные эффекты карточки; живой снимок состояния переписываем с них.
  // v86: память хранится по entryId, старый key удаляем после сохранения.
  function savePersonalEffects(cardId, memKey, list, legacyKey) {
    const c = findCard(cardId);
    if (!c) return;
    if (!c.condEffects) c.condEffects = {};
    if (list && list.length) c.condEffects[memKey] = list;
    else delete c.condEffects[memKey];
    if (legacyKey && legacyKey !== memKey) delete c.condEffects[legacyKey];
    const live = (c.conditions || []).find(function (s) { return s.key === legacyKey; }) ||
      (c.conditions || []).find(function (s) { return s.entryId === memKey; });
    if (live) live.effects = (list || []).map(cloneEffect);
  }
  // с чего начинать правку: личные эффекты, а если их нет — то, что уже наложено
  // (эффекты могли прийти из набора — затирать их при первом редактировании нельзя)
  function condEffectList(card, live) {
    if (!live) return [];
    const own = condPersonalEffects(card, condMemoryKey(live), live.key);
    if (own) return own.map(cloneEffect);
    return ((live && live.effects) || []).map(cloneEffect);
  }
  function editStateEffect(cardId, key, index, ef) {
    mutate(function () {
      const c = findCard(cardId);
      if (!c) return;
      const live = (c.conditions || []).find(function (s) { return s.key === key; });
      const list = condEffectList(c, live);
      if (ef) {
        const old = index >= 0 ? list[index] : null;
        // v83: custom — значение/подпись/режим меняли вручную. Если правили только
        // цель, при «Обновить из набора» значение должно обновиться из шаблона.
        if (index < 0) ef.custom = true;
        else {
          ef.custom = !!(old && old.custom);
          if (!old || ef.value !== old.value || (ef.label || '') !== (old.label || '') ||
              ef.mode !== old.mode || effectField(ef) !== effectField(old) ||
              (ef.timing || 'start') !== (old.timing || 'start')) {
            ef.custom = true;
          }
        }
        if (index >= 0) list[index] = ef; else list.push(ef);
      }
      else if (index >= 0) list.splice(index, 1);
      savePersonalEffects(cardId, condMemoryKey(live) || key, list, key);
    });
  }

  function openEffectModal(cardId, stateId, index) {
    const card = findCard(cardId);
    const st = card && (card.conditions || []).find(function (s) { return s.id === stateId; });
    if (!st) return;
    const targets = (activeChar().cards || []).filter(function (c) { return MOD_FIELDS[c.type]; });
    if (!targets.length) { toast(App.t('fxNoTargets')); return; }

    const own = condEffectList(card, st);
    const cur = index >= 0 ? own[index] : null;
    // v81: цель по умолчанию должна поддерживать поле эффекта. Иначе block/charges
    // открывался на первом счётчике, поле становилось max, а режим — «прибавить».
    const desiredField = cur ? effectField(cur) : 'bonus';
    const fits = function (c) { return (MOD_FIELDS[c.type] || []).indexOf(desiredField) !== -1; };
    const tSel = (cur && cur.target && targets.some(function (c) { return c.id === cur.target && fits(c); }))
      ? cur.target
      : (targets.find(fits) || targets[0]).id;
    const tOpts = targets.map(function (c) {
      return '<option value="' + esc(c.id) + '"' + (c.id === tSel ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');

    const el = function (id) { return document.getElementById(id); };
    const val = function (id) { const n = el(id); return n ? n.value : ''; };
    function fieldsOf(tId) {
      const t = findCard(tId);
      return t ? (MOD_FIELDS[t.type] || []) : [];
    }
    // v78: block — только у заклинания и только для бонуса: гасим «Применить»,
    // кубик при этом бросается как обычно (просьба юзера). К зарядам запрет не применяем.
    function modesOf(tId, field) {
      const t = findCard(tId);
      if (field === 'current') return ['tick'];
      const out = ['add', 'mul', 'set', 'cap'];
      // кубик есть только у навыка и заклинания и только для бонуса: «кубик в значение»
      // на деле прибавлялся к броску — убираем эту двусмысленность
      if (t && t.die && (t.type === 'skill' || t.type === 'spell') && field === 'bonus') out.push('dice');
      if (t && t.type === 'spell' && field === 'charges') out.push('block');
      return out;
    }
    // блокировка значения и подсказка зависят от режима; держим в одном месте,
    // чтобы переключение режима и первичная отрисовка не расходились
    function syncModeUI() {
      const mode = val('fx-mode');
      const block = (mode === 'block');
      const tick = (mode === 'tick');
      const input = el('fx-value');
      input.disabled = block;
      input.placeholder = block ? '—' : App.t(FX_MODE_PH[mode] || 'fxPhAdd');
      // при переходе в «запретить» старое число не должно оставаться в поле
      if (block) input.value = '';
      const tw = el('fx-timing-wrap');
      if (tw) tw.style.display = tick ? '' : 'none';
    }
    function fillModes() {
      const ms = modesOf(val('fx-target'), val('fx-field'));
      const prev = val('fx-mode') || (cur ? cur.mode : 'add');
      el('fx-mode').innerHTML = ms.map(function (m) {
        return '<option value="' + m + '">' + esc(fxModeText(m)) + '</option>';
      }).join('');
      el('fx-mode').value = ms.indexOf(prev) !== -1 ? prev : ms[0];
      syncModeUI();
    }
    function fillFields() {
      const fs = fieldsOf(val('fx-target'));
      const prev = val('fx-field') || (cur ? cur.field : '');
      const pick = fs.indexOf(prev) !== -1 ? prev : fs[0];
      el('fx-field').innerHTML = fs.map(function (f) {
        return '<option value="' + f + '"' + (f === pick ? ' selected' : '') + '>' + esc(fxFieldText(f)) + '</option>';
      }).join('');
      fillModes();
    }

    const actions = [
      { label: App.t('cancel') },
      cur ? { label: App.t('delete'), cls: 'danger', onClick: function () {
        editStateEffect(cardId, st.key, index, null);
      } } : null,
      { label: App.t('save'), cls: 'primary', onClick: function () {
        const mode = val('fx-mode');
        const target = val('fx-target');
        const value = val('fx-value').trim();
        if (mode !== 'block' && !value) { toast(App.t('fxValueNeeded')); return false; }
        editStateEffect(cardId, st.key, index, {
          mode: mode, field: val('fx-field'), value: mode === 'block' ? '' : value,
          label: val('fx-label').trim(), target: target,
          timing: mode === 'tick' ? val('fx-timing') : null
        });
      } }
    ].filter(Boolean);

    openModal(cur ? App.t('fxEdit') : App.t('fxAdd'),
      '<div class="field"><label>' + esc(App.t('fxTarget')) + '</label><select id="fx-target">' + tOpts + '</select></div>' +
      '<div class="field"><label>' + esc(App.t('fxField')) + '</label><select id="fx-field"></select></div>' +
      '<div class="field"><label>' + esc(App.t('fxMode')) + '</label><select id="fx-mode"></select></div>' +
      '<div class="field" id="fx-timing-wrap"><label>' + esc(App.t('fxTiming')) + '</label><select id="fx-timing">' +
        '<option value="start"' + (cur && cur.timing === 'end' ? '' : ' selected') + '>' + esc(App.t('fxTimingStart')) + '</option>' +
        '<option value="end"' + (cur && cur.timing === 'end' ? ' selected' : '') + '>' + esc(App.t('fxTimingEnd')) + '</option>' +
      '</select></div>' +
      '<div class="field"><label>' + esc(App.t('fxValue')) + '</label><input id="fx-value" type="text" autocomplete="off" spellcheck="false" placeholder="' + esc(App.t('fxPhAdd')) + '" value="' + esc((cur && cur.value) || '') + '"></div>' +
      '<div class="field"><label>' + esc(App.t('fxLabelField')) + '</label><input id="fx-label" type="text" autocomplete="off" spellcheck="false" placeholder="' + esc(App.t('fxLabelPh')) + '" value="' + esc((cur && cur.label) || '') + '"></div>',
      actions);

    el('fx-target').addEventListener('change', fillFields);
    el('fx-field').addEventListener('change', fillModes);
    el('fx-mode').addEventListener('change', syncModeUI);
    fillFields();
  }

  // разворачивает каталог ПРЯМО В ПАНЕЛИ (третьего окна нет) — кукла остаётся на виду
  // и меняется от каждого тапа. Повторный клик по строке каталога снимает состояние.
  function buildConditionPanel(card) {
    const panel = document.createElement('div');
    panel.className = 'layer-panel cond-panel';
    panel.innerHTML =
      '<button type="button" class="cond-reset-btn" data-role="reset" title="' + esc(App.t('condReset')) + '" aria-label="' + esc(App.t('condReset')) + '">' + COND_RESET_SVG + '</button>' +
      '<div class="cond-grid">' +
        // слева — каталог фиксированной ширины (всегда виден, своя прокрутка)
        '<div class="cond-col cond-col-cat">' +
          '<input class="cond-search" data-role="search" type="text" autocomplete="off" spellcheck="false" placeholder="' + esc(App.t('condSearch')) + '">' +
          '<div class="cond-pick" data-role="pick"></div>' +
        '</div>' +
        // справа — живая кукла, кнопки тиков/обновления и список активных состояний
        '<div class="cond-col cond-col-live">' +
          '<div class="cond-preview" data-role="preview"></div>' +
          '<div class="cond-actions">' +
            '<button type="button" class="cond-refresh" data-role="refresh" title="' + esc(App.t('condRefresh')) + '">↻ ' + esc(App.t('condRefresh')) + '</button>' +
            '<button type="button" class="cond-tick" data-role="applyticks" title="' + esc(App.t('condApplyTicks')) + '">⏱ ' + esc(App.t('condApplyTicks')) + '</button>' +
          '</div>' +
          '<div class="cond-list" data-role="list"></div>' +
        '</div>' +
      '</div>';

    const q = function (role) { return panel.querySelector('[data-role="' + role + '"]'); };
    const cur = function () { return findCard(card.id) || card; };

    function rowsHTML(items) {
      if (!items.length) return '<div class="cond-empty">' + esc(App.t('condEmpty')) + '</div>';
      return items.map(function (s) {
        // эффекты — отдельной строкой под описанием: видно, на что состояние влияет
        const fx = (s.effects || []).map(function (ef, i) {
          const t = findCard(ef.target);
          const tgt = t ? t.name : App.t('fxNoTarget');
          const computed = fxShort(ef);
          // v79: кубик имеет смысл только для бонуса. Старые эффекты «кубик в значение»
          // больше не применяются — помечаем их, чтобы не выглядели рабочими.
          const inactive = ef.mode === 'dice' && effectField(ef) !== 'bonus';
          // v78: своя подпись заменяет описание эффекта — помечаем карандашом,
          // иначе непонятно, откуда взялся текст, и что эффект делает на самом деле
          const lbl = (inactive ? '⚠ ' : (ef.label ? '✎ ' : '')) + (ef.label || computed);
          const tip = inactive ? App.t('fxDiceOnlyBonus')
            : (ef.label ? App.tf('fxCustomTip', { text: computed }) : App.t('fxEdit'));
          return '<button type="button" class="cond-fx' + (inactive ? ' off' : '') + '" data-fx="' + esc(s.id) + '" data-fi="' + i + '" title="' + esc(tip) + '">' +
            esc(lbl) + ' → ' + esc(tgt) +
          '</button>';
        }).join('');
        return '<div class="cond-row">' +
          '<span class="cond-row-ic" data-ic="' + s.icon + '">' + condIcon(s.icon, s.color, s.shade, s.hi) + '</span>' +
          '<span class="cond-row-main">' +
            '<span class="cond-row-txt"><span class="cond-row-name">' + esc(s.name) +
              '<span class="cond-dur-wrap" title="' + esc(App.t('condDurLabel')) + '">⏱ <input class="cond-dur-input" data-dur="' + esc(s.id) + '" type="number" min="0" max="99" step="1" inputmode="numeric" value="' + (num(s.duration) > 0 ? num(s.duration) : '') + '" placeholder="—" aria-label="' + esc(App.t('condDurLabel')) + '"></span>' +
            '</span>' +
              '<span class="cond-row-desc">' + esc(s.effect || '') + '</span></span>' +
            (fx ? '<span class="cond-row-fxwrap">' + fx + '</span>' : '') +
          '</span>' +
          '<button type="button" class="cond-row-fxadd" data-fxadd="' + esc(s.id) + '" title="' + esc(App.t('fxAdd')) + '" aria-label="' + esc(App.t('fxAdd')) + '">+</button>' +
          '<button type="button" class="cond-row-del" data-cond="' + esc(s.id) + '" title="' + esc(App.t('delete')) + '" aria-label="' + esc(App.t('delete')) + '">' + TRASH_SVG + '</button>' +
        '</div>';
      }).join('');
    }

    function catalogHTML(items) {
      const query = (q('search') ? q('search').value : '').trim().toLowerCase();
      return stateEntries(activeChar()).filter(function (p) {
        const nm = p.nameKey ? App.t(p.nameKey) : (p.name || '');
        return !query || nm.toLowerCase().indexOf(query) !== -1;
      }).map(function (p) {
        const live = items.find(function (s) {
          return (p.entryId && s.entryId === p.entryId) || s.key === p.key;
        });
        const on = !!live;
        const nm = p.nameKey ? App.t(p.nameKey) : (p.name || '');
        let ds = p.descKey ? App.t(p.descKey) : (p.effect || '');
        // v81: сначала личные эффекты, потом шаблонные, и только потом описание.
        // Так каталог показывает то, что реально применится, а не старую подпись.
        const own = condPersonalEffects(card, condMemoryKey(p), p.key);
        const fx = (own && own.length) ? own : (p.effects || []);
        if (fx.length) {
          ds = fx.map(function (ef) { return ef.label || fxShort(ef); }).join(' · ');
        }
        return '<button type="button" class="cond-pick-row' + (on ? ' on' : '') + '" data-key="' + esc(p.key) + '">' +
          '<span class="cond-pick-ic" data-ic="' + esc(p.icon) + '">' + condIcon(p.icon, p.color, p.shade, p.hi) + '</span>' +
          '<span class="cond-pick-txt"><span class="cond-pick-name">' + esc(nm) + '</span>' +
          '<span class="cond-pick-desc">' + esc(ds) + '</span></span>' +
          (on ? '<span class="cond-pick-check">✓</span>' : '') +
        '</button>';
      }).join('');
    }

    // Перерисовка на месте с сохранением прокрутки обоих списков:
    // панель фиксированного размера, поэтому ничего не прыгает при добавлении/снятии.
    function refresh() {
      const c = cur();
      const items = c.conditions || [];
      q('preview').innerHTML = conditionBody(c, true);
      const listEl = q('list'), pickEl = q('pick');
      const s1 = listEl.scrollTop, s2 = pickEl.scrollTop;
      listEl.innerHTML = rowsHTML(items);
      pickEl.innerHTML = catalogHTML(items);
      listEl.scrollTop = s1; pickEl.scrollTop = s2;
      const resetBtn = q('reset');
      if (resetBtn) resetBtn.disabled = !items.length;
      const refreshBtn = q('refresh');
      if (refreshBtn) refreshBtn.disabled = !items.length;
      const tickBtn = q('applyticks');
      if (tickBtn) tickBtn.disabled = !(activeChar().cards || []).some(hasTicksOrDuration);
    }

    panel._condRefresh = refresh;

    panel.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.cond) {
        mutate(function () {
          const c = cur();
          c.conditions = (c.conditions || []).filter(function (s) { return s.id !== b.dataset.cond; });
        });
        return;
      }
      // «+» у строки — добавить эффект «на что влияет»; сам чип — правка существующего
      if (b.dataset.fxadd) { openEffectModal(card.id, b.dataset.fxadd, -1); return; }
      if (b.dataset.fx) { openEffectModal(card.id, b.dataset.fx, parseInt(b.dataset.fi, 10)); return; }
      if (b.dataset.key) { toggleCondition(card.id, b.dataset.key); return; }
      // v70: сброс без подтверждения и без тоста — решение юзера
      if (b.dataset.role === 'reset') { clearConditions(card.id); return; }
      if (b.dataset.role === 'refresh') { refreshFromSet(card.id); return; }
      if (b.dataset.role === 'applyticks') { applyTicksManual(); }
    });
    panel.addEventListener('input', function (e) {
      if (e.target && e.target.dataset.role === 'search') refresh();
    });
    // v88: длительность ходов правится прямо в слое — как в редакторе набора
    panel.addEventListener('change', function (e) {
      const inp = e.target && e.target.closest ? e.target.closest('[data-dur]') : null;
      if (!inp) return;
      const snapId = inp.dataset.dur;
      const v = Math.max(0, Math.min(99, parseInt(inp.value, 10) || 0));
      mutate(function () {
        const c = cur();
        const s = (c.conditions || []).find(function (x) { return x.id === snapId; });
        if (s) s.duration = v > 0 ? v : null;
      });
    });

    refresh();
    return panel;
  }

  function openConditionLayer(cardId) {
    const card = findCard(cardId);
    if (!card || card.type !== 'condition') return;
    const ov = document.getElementById('labelLayer');
    layerCardId = cardId;
    ov.innerHTML = '';
    ov.appendChild(buildConditionPanel(card));
    ov.classList.remove('hidden');
    updateScrollLock();
  }

  // ===== Modals =====
  // Пока открыто окно или второй слой, страница под ним не прокручивается
  // (иначе колесо/палец уводит лист и окно «уезжает» из вида).
  function updateScrollLock() {
    const modalOpen = !document.getElementById('modal').classList.contains('hidden');
    const layerOpen = !document.getElementById('labelLayer').classList.contains('hidden');
    document.body.classList.toggle('no-scroll', modalOpen || layerOpen);
  }

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
        if (!keepOpen) {
          closeModal();
          // v79: после закрытия окна обновляем слой ещё раз. commit() уже зовёт
          // refreshLayer(), но окно в этот момент ещё открыто — был случай, когда
          // под ним оставались старые подписи эффектов.
          if (layerCardId) refreshLayer();
        }
      });
      actDiv.appendChild(btn);
    });
    updateScrollLock();
  }
  function closeModal() {
    closeRefMenu();   // пикер живёт на document.body — прибираем за модалкой
    document.getElementById('backdrop').classList.add('hidden');
    const modal = document.getElementById('modal');
    modal.classList.remove('settings-modal');
    modal.classList.add('hidden');
    modal.innerHTML = '';
    updateScrollLock();
  }

  function confirmDialog(msg, onYes, title, labels) {
    labels = labels || {};
    openModal(title || App.t('delete'), '<p class="confirm-text">' + esc(msg) + '</p>', [
      { label: labels.no || App.t('cancel') },
      { label: labels.yes || App.t('delete'), cls: labels.yesCls || 'danger', onClick: onYes }
    ]);
  }

  // Полный текст (описание перка/заклинания) отдельным окном
  function openTextModal(title, text) {
    openModal(title || App.t('description'), '<div class="full-text">' + esc(text) + '</div>',
      [{ label: App.t('close'), cls: 'primary' }]);
  }

  // ===== Второй слой ярлыка (свернутые И, З, В) =====
  // Креста НЕТ: закрытие кликом/тапом мимо панели или Esc (решение юзера).
  // Валюта/инвентарь — живая копия карточки (настоящие cardHead/cardBody): кнопки −/＋
  // работают, тулзы ✎⧉✕ в шапке активны В ЛЮБОМ режиме (и на телефоне).
  // Заметка — большое окно текста, правка доступна сразу в любом режиме.
  let layerCardId = null;

  function openLabelLayer(cardId) {
    const card = findCard(cardId);
    if (!card || !foldable(card) || !isCollapsed(card)) return;
    const ov = document.getElementById('labelLayer');
    layerCardId = cardId;
    ov.innerHTML = '';
    if (card.type === 'note') {
      // Заметка — отдельная панель (шапка + большое окно текста); вариант юзера, не трогаем
      const panel = document.createElement('div');
      panel.className = 'layer-panel layer-note-panel';
      panel.appendChild(buildLayerHead(card));
      const ta = document.createElement('textarea');
      ta.className = 'layer-note';
      ta.value = card.text || '';
      panel.appendChild(ta);
      ov.appendChild(panel);
    } else {
      // Валюта/инвентарь — ТОЧНАЯ копия развернутой карточки, без доп рамок:
      // единственное отличие — активные кнопки правки (✎⧉✕ + ресайз) в шапке
      ov.appendChild(buildLayerCard(card));
    }
    ov.classList.remove('hidden');
    updateScrollLock();
  }

  // Тулзы шапки слоя. На телефоне — ТОЛЬКО кебаб (меню с теми же действиями
  // плюс «Размер» и «На страницу…»): иначе в шапке оказывались и кебаб, и три
  // кнопки с ПК-версии (баг v48).
  function layerToolsHTML() {
    if (!isDesktop()) {
      return '<div class="tools">' +
        '<button type="button" class="layer-menu" title="' + esc(App.t('menu')) + '" aria-label="' + esc(App.t('menu')) + '">' +
          '<span></span><span></span><span></span></button></div>';
    }
    return '<div class="tools">' +
      '<button class="card-edit" title="' + esc(App.t('edit')) + '">✎</button>' +
      '<button class="card-dup" title="' + esc(App.t('duplicate')) + '">⧉</button>' +
      '<button class="card-del" title="' + esc(App.t('delete')) + '">' + TRASH_SVG + '</button>' +
      '</div>';
  }
  function wireLayerTools(head, card) {
    const bEdit = head.querySelector('.card-edit');
    const bDup = head.querySelector('.card-dup');
    const bDel = head.querySelector('.card-del');
    if (bEdit) bEdit.addEventListener('click', function () {
      const ov = document.getElementById('labelLayer');
      const ta = ov.querySelector('.layer-note');
      if (ta) {   // заметка: несохранённый текст пишем ДО редактора, иначе он покажет старое
        const cur = findCard(card.id);
        const txt = ta.value;
        if (cur && (cur.text || '') !== txt) mutate(function () { cur.text = txt; });
      }
      openCardEditor(card.id);
    });
    // дубль: слой закрываем — иначе новая карточка появится ПОД затемнением
    // и юзер её не увидит; удаление не закрываем: после подтверждения
    // refreshLayer сам закроет слой (карточки больше нет), при отмене слой остаётся
    if (bDup) bDup.addEventListener('click', function () { closeLabelLayer(); duplicateCard(card.id); });
    if (bDel) bDel.addEventListener('click', function () { deleteCard(card.id); });
    // v48: у свёрнутого ярлыка шапки на холсте нет — «Размер» и «На страницу…»
    // доступны из второго слоя через это меню
    const menu = head.querySelector('.layer-menu');
    if (menu) menu.addEventListener('click', function (e) {
      e.stopPropagation();
      openCardMenu(card.id, menu);
    });
  }

  function buildLayerHead(card) {
    const head = document.createElement('div');
    head.className = 'layer-head';
    head.innerHTML =
      '<span class="card-name">' + esc(card.name) + '</span>' + layerToolsHTML();
    wireLayerTools(head, card);
    return head;
  }

  // Копия карточки в слое. data-id НЕ ставим: глобальные помощники ищут по
  // '.card[data-id]' и нашли бы карточку холста. Кнопки тела — handleAction по card.id.
  function buildLayerCard(card) {
    const el = document.createElement('div');
    el.className = 'card type-' + card.type + ' layer-card';
    const desktop = isDesktop();
    const mn = minSize(card);
    if (desktop) {
      el.style.width = Math.max(mn.w, card.w || 300) + 'px';
      el.style.height = Math.max(mn.h, card.h || 150) + 'px';
    }
    const head = document.createElement('div');
    head.className = 'card-head';
    head.innerHTML =
      '<span class="card-name">' + esc(card.name) + '</span>' + layerToolsHTML();
    wireLayerTools(head, card);
    el.appendChild(head);
    // cardBody уже возвращает обёртку .card-body — вставляем как есть
    const body = document.createElement('div');
    body.innerHTML = cardBody(card);
    while (body.firstChild) el.appendChild(body.firstChild);
    el.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { handleAction(card.id, btn.dataset, e); });
    });
    // описания предметов инвентаря: клик — окно полного текста ПОВЕРХ слоя (как редактор)
    el.querySelectorAll('.item-row.has-desc').forEach(function (row) {
      const it = (card.items || []).find(function (x) { return x.id === row.dataset.item; });
      if (!it || !(it.description || '').trim()) return;
      const descEl = row.querySelector('.idesc');
      if (!descEl) return;
      descEl.classList.add('readable');
      descEl.addEventListener('click', function (e) {
        e.stopPropagation();
        openTextModal(it.name, it.description);
      });
    });
    // ресайз — активная кнопка правки: уголок копии меняет размер НАСТОЯЩЕЙ карточки
    if (desktop) {
      const rh = document.createElement('span');
      rh.className = 'resize-handle';
      rh.title = '↘';
      rh.addEventListener('pointerdown', function (e) { startLayerResize(e, card, el); });
      el.appendChild(rh);
    }
    return el;
  }

  // Ресайз из слоя: тянем уголок — размер пишется в карточку ПО ОТПУСКАНИИ
  // (один pushUndo на всё действие, как у ресайза на холсте; во время тяки меняем только стиль)
  function startLayerResize(e, card, el) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    const ow = card.w || 300, oh = card.h || 150;
    const mn = minSize(card);
    let nw = ow, nh = oh;
    document.body.style.userSelect = 'none';
    const move = function (ev) {
      nw = Math.max(mn.w, Math.min(snap(Math.round(ow + ev.clientX - startX)), Math.max(mn.w, canvasRight() - (card.x || 0))));
      nh = Math.max(mn.h, snap(Math.round(oh + ev.clientY - startY)));
      el.style.width = nw + 'px';
      el.style.height = nh + 'px';
    };
    const up = function () {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
      if (nw === ow && nh === oh) return;
      const c = findCard(card.id);
      if (!c) return;
      pushUndo();
      c.w = nw;
      c.h = nh;
      commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // После любого mutate (commit) слой догоняет данные — холст и слой синхронны
  function refreshLayer() {
    if (!layerCardId) return;
    const card = findCard(layerCardId);
    if (!card) { closeLabelLayer(); return; }
    // v65: слой состояния перестраиваем целиком — список и кнопки зависят от данных
    if (card.type === 'condition') {
      const ov = document.getElementById('labelLayer');
      const panel = ov.querySelector('.cond-panel');
      // панель уже открыта — обновляем на месте (не теряем каталог, поиск и прокрутку)
      if (panel && panel._condRefresh) { panel._condRefresh(); return; }
      ov.innerHTML = '';
      ov.appendChild(buildConditionPanel(card));
      return;
    }
    if (!foldable(card) || !isCollapsed(card)) { closeLabelLayer(); return; }
    const ov = document.getElementById('labelLayer');
    // заметка: текст в окне слоя может быть ещё не сохранён — тело не трогаем,
    // но имя и текст после редактора обновляем. Иначе сценарий «ярлык → ✎ →
    // напечатал → Сохранить → закрыл слой» откатывал текст: closeLabelLayer
    // писал из textarea старое значение (баг, найден юзером).
    const ta = ov.querySelector('.layer-note');
    if (ta) {
      const nm = ov.querySelector('.layer-head .card-name');
      if (nm) nm.textContent = card.name;
      if (ta.value !== (card.text || '')) ta.value = card.text || '';
      return;
    }
    const old = ov.querySelector('.layer-card');
    if (old) old.replaceWith(buildLayerCard(card));
    else closeLabelLayer();
  }

  function closeLabelLayer() {
    const ov = document.getElementById('labelLayer');
    if (ov.classList.contains('hidden')) return;
    // заметка: несохранённый правки текст пишем при закрытии (undo/redo работают)
    const ta = ov.querySelector('.layer-note');
    if (ta && layerCardId) {
      const card = findCard(layerCardId);
      const txt = ta.value;
      if (card && (card.text || '') !== txt) mutate(function () { card.text = txt; });
    }
    layerCardId = null;
    ov.classList.add('hidden');
    ov.innerHTML = '';
    updateScrollLock();
  }

  // Сворачивание/разворот — ТОЛЬКО язычок. Состояние пишем через pushUndo+save
  // (Ctrl+Z работает), но render() не зовём: класс переключается на живом узле,
  // CSS-переход сжатия/разворота отыгрывает. Любая следующая перерисовка построит
  // карточку из данных как надо.
  function toggleFold(cardId) {
    const card = findCard(cardId);
    if (!card || !foldable(card)) return;
    const el = cardElOf(cardId);
    pushUndo();
    if (isDesktop()) card.collapsed = !isCollapsed(card);
    else card.collapsedM = !isCollapsed(card);
    save();
    if (el) {
      const folded = isCollapsed(card);
      // .folding — переход только на время анимации (ресайз за уголок не страдает)
      el.classList.add('folding');
      setTimeout(function () { el.classList.remove('folding'); }, 380);
      el.classList.toggle('collapsed', folded);
      const tab = el.querySelector('.fold-tab');
      if (tab) {
        tab.title = App.t(folded ? 'unfoldCard' : 'foldCard');
        tab.setAttribute('aria-label', tab.title);
      }
    }
  }

  // ===== Form helpers =====
  function readNum(id) { const el = document.getElementById(id); return el ? el.value : ''; }
  function readDie(id) { const el = document.getElementById(id); const v = el ? el.value : ''; return v === '' ? null : Number(v); }
  function readCheck(id) { const el = document.getElementById(id); return el ? el.checked : false; }
  function readText(id) { const el = document.getElementById(id); return el ? el.value : ''; }

  // ===== Универсальное поле-выражение (v25) =====
  // Тот же контентедит-механизм, что у формулы: свободный ввод + чипы-параметры
  // («+ Параметр» — поиск карточки, вставка в позицию курсора).
  // Хранение — строка («2 + {Мана}»); чистое число нормализуется в Number,
  // поэтому старые сохранения остаются числами и ничего не ломает.
  function exprOrNull(s) {
    s = String(s == null ? '' : s).trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  }
  // v50: строка выражения — [поле][+ Параметр][= N] в ОДНУ линию (как просил юзер).
  // Используется везде, где можно подставить параметр: значение/бонус навыка,
  // максимум счётчика, максимум зарядов.
  function exprFieldHTML(idPrefix, label, value, tip) {
    return '<div class="field"><label>' + esc(label) + '</label>' +
      '<div class="f-row">' +
        '<div class="f-expr" id="' + idPrefix + '-expr" contenteditable="true" spellcheck="false" data-expr="' + esc(value == null ? '' : String(value)) + '"></div>' +
        '<button type="button" class="small f-addref" id="' + idPrefix + '-addref">+ ' + esc(App.t('addParam')) + '</button>' +
        '<span class="f-preview" id="' + idPrefix + '-preview">= —</span>' +
      '</div>' +
      (tip ? '<div class="formula-help">' + esc(tip) + '</div>' : '') +
      '</div>';
  }
  function readExpr(idPrefix) {
    const area = document.getElementById(idPrefix + '-expr');
    return area ? serializeExpr(area) : '';
  }
  // живой предпросмотр «= N» под каждым полем-выражением
  function updateExprPreviews() {
    document.querySelectorAll('.f-expr').forEach(function (area) {
      if (area.id === 'f-expr') return;
      const prev = document.getElementById(area.id.replace(/-expr$/, '-preview'));
      if (!prev) return;
      // заодно дорисовываем чипы (имя, знач./бонус): при повторном открытии
      // редактора они отрисовываются из data-expr без единого input-события
      refreshChips(area);
      const card = editScratch.editCard;
      const str = serializeExpr(area).trim();
      if (!str) { prev.innerHTML = '= —'; return; }
      // поле нужно, чтобы бонус навыка мог ссылаться на своё значение (v36):
      // предпросмотр считается тем же правилом, что и на карточке
      const field = area.id === 'f-bonus-expr' ? 'bonus'
        : area.id === 'f-value-expr' ? 'value'
        : area.id === 'f-chmax-expr' ? 'charges' : 'max';
      // бонус навыка может ссылаться на своё значение («{Навык} / 2»). В редакторе
      // значение ещё не сохранено в карточку, поэтому на время предпросмотра берём
      // его из поля — иначе до «Сохранить» показывало бы 0
      let liveValue = false, savedValue;
      if (field === 'bonus' && card && card.type === 'skill') {
        const vArea = document.getElementById('f-value-expr');
        if (vArea) {
          savedValue = card.value;
          card.value = exprOrNull(serializeExpr(vArea).trim());
          liveValue = true;
        }
      }
      // новую карточку ещё нет в списке под новым именем — на время предпросмотра
      // подставляем имя из поля, иначе «{Самоконтроль}» выглядел бы битой ссылкой
      let liveName = false, savedName;
      const nameEl = document.getElementById('f-name');
      const typedName = nameEl ? nameEl.value.trim() : '';
      if (card && typedName && typedName !== card.name) {
        savedName = card.name;
        card.name = typedName;
        liveName = true;
      }
      try {
        const val = evalCardExpr(card, str, field);
        prev.innerHTML = '= ' + fmt(val);
        prev.title = '';
      } catch (e) {
        // v51: в строке ошибку показываем коротким знаком, полный текст — в title
        prev.innerHTML = '= <span class="err">⚠</span>';
        prev.title = App.t('brokenRef');
      } finally {
        if (liveValue) card.value = savedValue;
        if (liveName) card.name = savedName;
      }
    });
  }
  // привязка всех полей-выражений открытого редактора: отрисовка + кнопка «+ Параметр»
  function bindExprFields() {
    ['f-max', 'f-bonus', 'f-value', 'f-chmax'].forEach(function (p) {
      const area = document.getElementById(p + '-expr');
      if (!area) return;
      renderExprInto(area, area.dataset.expr || '');
      lastExpr = null;
      ensureExprCaretTracking();
      area.addEventListener('input', updateExprPreviews);
      const btn = document.getElementById(p + '-addref');
      if (btn) btn.addEventListener('click', function () {
        if (refMenuAnchor === btn) { closeRefMenu(); return; }   // повторный клик — просто закрыть
        // v36: в бонусе навыка разрешаем выбрать саму карточку — ссылка на своё
        // значение (бонус = половина значения и т.п.), цикла тут не бывает
        const self = editScratch.editCard;
        openRefMenu(btn, { area: area, allowSelf: p === 'f-bonus' && !!self && self.type === 'skill' });
      });
    });
    updateExprPreviews();
  }
  // бонус-выражение: читается только если стоит галочка «Добавить бонус» (иначе пусто)
  function readBonus() {
    const cb = document.getElementById('f-usebonus');
    if (cb && !cb.checked) return '';
    return readExpr('f-bonus').trim();
  }
  // Бонус как галочка: поставил галочку — появилось поле выражения; снял — бонус обнулился
  // (v25: поле-выражение с чипами-параметрами)
  function bonusToggleFields(val) {
    const has = val != null && String(val).trim() !== '';
    return checkField('f-usebonus', App.t('addBonus'), has) +
      '<div id="f-bonuswrap"' + (has ? '' : ' style="display:none"') + '>' +
      exprFieldHTML('f-bonus', App.t('bonus'), val, '') + '</div>';
  }
  // Галочка «Кубик»: поставил — появился выбор кубика (d20 по умолчанию) и количество, снял — скрылось
  function dieToggleFields(die, nDice) {
    const n = Math.max(1, Math.min(20, Math.round(num(nDice) || 1)));
    let opts = '';
    App.dice.TYPES.forEach(function (s) {
      opts += '<option value="' + s + '"' + (die === s ? ' selected' : '') + '>d' + s + '</option>';
    });
    return checkField('f-usedie', App.t('die'), !!die) +
      '<div id="f-diewrap"' + (die ? '' : ' style="display:none"') + '>' +
        '<div class="field"><div class="f-row">' +
          '<select id="f-die" class="f-die">' + opts + '</select>' +
          '<span class="f-lbl">' + esc(App.t('diceCount')) + '</span>' +
          '<input id="f-ndice" class="f-ndice" type="number" inputmode="numeric" min="1" max="20" step="1" value="' + n + '" aria-label="' + esc(App.t('diceCount')) + '">' +
        '</div></div>' +
      '</div>';
  }
  // Описание как галочка (у навыка): включил — появилось поле текста
  function descToggleFields(val) {
    const has = val != null && String(val) !== '';
    return checkField('f-usedesc', App.t('description'), has) +
      '<div id="f-descwrap"' + (has ? '' : ' style="display:none"') + '>' +
        '<div class="field"><textarea id="f-desc" placeholder="' + esc(App.t('description')) + '…">' + esc(val || '') + '</textarea></div>' +
      '</div>';
  }
  // Значение как галочка (у навыка): то же поведение — включил, появилось поле
  // (v25: значение тоже умеет параметр — «{Уровень} * 2»)
  function valueToggleFields(val) {
    const has = val != null;
    return checkField('f-usevalue', App.t('addValue'), has) +
      '<div id="f-valuewrap"' + (has ? '' : ' style="display:none"') + '>' +
      exprFieldHTML('f-value', App.t('value'), val, '') + '</div>';
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

  function typeFields(card) {
    switch (card.type) {
      case 'counter':
        // «Текущее» убрано из редактора: при создании оно стартует с максимума (см. applyFields),
        // дальше игроки меняют его кнопками ⁺/⁻ на самой карточке.
        // v25: максимум — поле-выражение («{Мана} + 2»); у новой карточки дефолтный
        // «0» не показываем, иначе чип приклеивается после него («0{Мана}»)
        // v36: кубик и бонус у счётчика убраны совсем (просьба юзера) — счётчик
        // только хранит число и меняется кнопками
        return exprFieldHTML('f-max', App.t('max'), (card._new && card.max === 0) ? '' : card.max, '') +
          checkField('f-restores', App.t('restores'), !!card.restores);
      case 'skill':
        // v50: порядок как просил юзер — Описание → Значение → Кубик → Бонус;
        // у кубика появилось количество (2d20 и т.п.)
        return descToggleFields(card.description) +
          valueToggleFields(card.value) +
          dieToggleFields(card.die, card.nDice) +
          bonusToggleFields(card.bonus);
      case 'spell': return spellFields(card);
      case 'currency': return currencyFields(card);
      case 'inventory': return inventoryFields(card);
      case 'note': return noteFields(card);
      case 'initiative': return initiativeFields(card);
      // v65: у состояния настраивается только подпись — сами состояния в слое
      case 'condition': return '<div class="formula-help">' + esc(App.t('condTitleHint')) + '</div>';
    }
    return '';
  }

  // v59: настройки инициативы — кубик и поведение нового участника
  function initiativeFields(card) {
    const die = Math.max(2, Math.round(num(card.die) || 20));
    const options = [20, 12, 10, 8, 6].map(function (s) {
      return '<option value="' + s + '"' + (die === s ? ' selected' : '') + '>d' + s + '</option>';
    }).join('');
    return '<div class="field"><label>' + esc(App.t('iniDie')) + '</label>' +
        '<select id="f-ini-die">' + options + '</select></div>' +
      '<div class="field"><label>' + esc(App.t('iniNewMode')) + '</label>' +
        '<select id="f-ini-new">' +
          '<option value="roll"' + (card.newMode === 'last' ? '' : ' selected') + '>' + esc(App.t('iniNewRoll')) + '</option>' +
          '<option value="last"' + (card.newMode === 'last' ? ' selected' : '') + '>' + esc(App.t('iniNewLast')) + '</option>' +
        '</select></div>';
  }

  function chargesFields(card, showRestores) {    const ch = card.charges || { mode: 'own' };
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
    // v25: максимум собственных зарядов — поле-выражение («{Мана} / 2» и т.п.);
    // у новой карточки дефолтный «0» не показываем (см. счётчик)
    html += '<div id="f-chownwrap">' + exprFieldHTML('f-chmax', App.t('max'), (card._new && ch.max === 0) ? '' : ch.max, '') + '</div>';
    html += '<div class="field" id="f-chlinkwrap"><label>' + esc(App.t('linkTo')) + '</label><select id="f-chlink">' + linkOpts + '</select></div>';
    html += '<div class="field" id="f-chcostwrap"><label>' + esc(App.t('costPerUse')) + '</label><input id="f-chcost" type="number" value="' + (num(ch.cost) || 1) + '" placeholder="1"></div>';
    // v32: выбор действия при нехватке основного ресурса — вместо галочки
    // «Запретить использование без ресурса» (переезжает в список первым пунктом)
    const em = ch.emptyMode || (ch.blockEmpty ? 'block' : 'negative');
    // резервный ресурс — счётчик (не сама карточка и не основной ресурс)
    const reserveOpts = counters.filter(function (c) { return c.id !== ch.linkId; }).map(function (c) {
      return '<option value="' + c.id + '"' + (ch.reserveId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');
    html += '<div class="field" id="f-chemptywrap"><label>' + esc(App.t('onEmpty')) + '</label>' +
      '<div class="radio-col" id="f-chempty">' +
        '<label class="radio-row"><input type="radio" name="f-chempty" value="block"' + (em === 'block' ? ' checked' : '') + '>' + esc(App.t('emptyBlock')) + '</label>' +
        '<label class="radio-row"><input type="radio" name="f-chempty" value="negative"' + (em === 'negative' ? ' checked' : '') + '>' + esc(App.t('emptyNegative')) + '</label>' +
        '<label class="radio-row"><input type="radio" name="f-chempty" value="reserve"' + (em === 'reserve' ? ' checked' : '') + '>' + esc(App.t('emptyReserve')) + '</label>' +
      '</div>' +
      // появляется ТОЛЬКО при выборе «Взять из резервного ресурса»
      '<div id="f-chreservewrap" style="display:none"><label>' + esc(App.t('reserveResource')) + '</label><select id="f-chreserve">' + reserveOpts + '</select></div>' +
      '</div>';
    // v32: отображение — анимация (фигуры) или тег «х/N» (тег и так включается
    // сам при зарядов больше 24 или без предела)
    html += checkField('f-chtag', App.t('chgTag'), !!ch.tag);
    if (showRestores) html += checkField('f-restores', App.t('restores'), !!card.restores);
    return html;
  }

  function spellFields(card) {
    return '<div class="field"><label>' + esc(App.t('description')) + '</label><textarea id="f-desc" placeholder="' + esc(App.t('description')) + '…">' + esc(card.description || '') + '</textarea></div>' +
      chargesFields(card, true) +
      dieField('f-die', card.die) +
      '<div id="f-diegate">' + bonusToggleFields(card.bonus) + '</div>';
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
      ['f-chownwrap'].forEach(function (id) { const el = document.getElementById(id); if (el) el.style.display = isOwn ? '' : 'none'; });
      ['f-chlinkwrap', 'f-chcostwrap'].forEach(function (id) { const el = document.getElementById(id); if (el) el.style.display = isOwn ? 'none' : ''; });
      // v32: выбор резервного ресурса показываем ТОЛЬКО при «Взять из резервного ресурса»
      const resWrap = document.getElementById('f-chreservewrap');
      if (resWrap) {
        const checked = document.querySelector('input[name="f-chempty"]:checked');
        resWrap.style.display = (checked && checked.value === 'reserve') ? '' : 'none';
      }
    }
    mode.addEventListener('change', upd);
    // радио-список меняет видимость резерва сразу, без перерисовки формы
    const emWrap = document.getElementById('f-chempty');
    if (emWrap) emWrap.addEventListener('change', upd);
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
  // Значение как галочка (у навыка)
  function bindValueToggle() {
    const cb = document.getElementById('f-usevalue');
    const wrap = document.getElementById('f-valuewrap');
    if (!cb || !wrap) return;
    const upd = function () { wrap.style.display = cb.checked ? '' : 'none'; };
    cb.addEventListener('change', upd);
    upd();
  }
  // Галочка «Кубик» (у навыка): включена — показан выбор кубика
  function bindDieToggle() {
    const cb = document.getElementById('f-usedie');
    const wrap = document.getElementById('f-diewrap');
    if (!cb || !wrap) return;
    const upd = function () { wrap.style.display = cb.checked ? '' : 'none'; };
    cb.addEventListener('change', upd);
    upd();
  }
  // «Когда кубика нет — галочки нет»: блок f-diegate (галочки значения/бонуса)
  // показывается только пока в поле «Кубик» выбран кубик
  function bindDieGate() {
    const dieSel = document.getElementById('f-die');
    const gate = document.getElementById('f-diegate');
    if (!dieSel || !gate) return;
    const upd = function () { gate.style.display = dieSel.value ? '' : 'none'; };
    dieSel.addEventListener('change', upd);
    upd();
  }

  function bindAppearance() {}   // ОФОРМЛЕНИЕ убрано (v15)

  function postInitEditor(card) {
    if (card.type === 'currency') bindCurrencyEditor();
    if (card.type === 'inventory') bindInventoryEditor();
    if (card.type === 'spell') bindChargesToggle();
    bindExprFields();   // v25: поля-выражения (максимум/бонус/значение) — чипы-параметры
    bindBonusToggle();
    bindValueToggle();
    bindDieToggle();
    bindDieGate();
    bindDescToggle();
    // v50: имя влияет на предпросмотр (ссылка на себя по новому имени)
    const nmEl = document.getElementById('f-name');
    if (nmEl) nmEl.addEventListener('input', updateExprPreviews);
  }

  // v50: описание навыка — галочка показывает/скрывает поле
  function bindDescToggle() {
    const cb = document.getElementById('f-usedesc');
    const wrap = document.getElementById('f-descwrap');
    if (!cb || !wrap) return;
    const upd = function () { wrap.style.display = cb.checked ? '' : 'none'; };
    cb.addEventListener('change', upd);
    upd();
  }

  // ===== Чипы-параметры (v21, из редактора формул; с v25 — общий механизм полей-выражений) =====
  // Поле выражения — contenteditable: операторы и числа печатаются с клавиатуры,
  // ссылки на карточки — «несъедобные» чипы (имя, знач./бонус, ◀▶, ✕).
  // Хранение в поле — строка вида «2 + {Имя}» / «{Имя.бонус}».
  function refNames() {
    const ch = activeChar();
    // v22: валюта/инвентарь/заметки не участвуют в формулах — в пикер попадают
    // только счётчики, навыки и заклинания (v26: формул-карточек больше нет)
    return ch ? ch.cards.filter(function (c) { return FORMULA_REF_TYPES.indexOf(c.type) !== -1; })
      .map(function (c) { return c.name; }) : [];
  }
  // обмен двух узлов местами с сохранением текстовых узлов (операторов) между ними
  function swapNodes(a, b) {
    const marker = document.createElement('span');
    a.parentNode.insertBefore(marker, a);
    b.parentNode.insertBefore(a, b);
    marker.parentNode.insertBefore(b, marker);
    marker.parentNode.removeChild(marker);
  }
  // чип-ссылка: кнопка имени (кастомный тёмный дропдаун с поиском) + знач./бонус + ◀▶ + ✕
  function makeRefChip(name, isBonus) {
    const chip = document.createElement('span');
    chip.className = 'tok tok-ref';
    chip.contentEditable = 'false';       // текстовое поле не лезет внутрь чипа
    chip.dataset.name = name;
    chip.dataset.part = isBonus ? 'bonus' : 'value';
    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'tok-name';
    nameBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (refMenuAnchor === nameBtn) closeRefMenu();   // повторный клик — просто закрыть
      else openRefMenu(nameBtn, { chip: chip });
    });
    chip.appendChild(nameBtn);
    const partBtn = document.createElement('button');
    partBtn.type = 'button';
    partBtn.className = 'tok-part';
    partBtn.title = App.t('refPartTip');
    partBtn.addEventListener('click', function () {
      chip.dataset.part = chip.dataset.part === 'bonus' ? 'value' : 'bonus';
      partBtn.textContent = chip.dataset.part === 'bonus' ? App.t('bonusOf') : App.t('valueOf');
      updateExprPreviews();
    });
    chip.appendChild(partBtn);
    const tools = document.createElement('span');
    tools.className = 'tok-tools';
    [-1, 1].forEach(function (dir) {
      const mv = document.createElement('button');
      mv.type = 'button';
      mv.className = 'tok-mv';
      mv.dataset.dir = String(dir);
      mv.textContent = dir < 0 ? '◀' : '▶';
      mv.title = dir < 0 ? '◀' : '▶';
      mv.addEventListener('click', function () {
        const sibling = dir < 0 ? chip.previousElementSibling : chip.nextElementSibling;
        if (sibling) {
          swapNodes(chip, sibling);
          refreshChips(chip.closest('.f-expr'));
          updateFormulaPreview();
          updateExprPreviews();
        }
      });
      tools.appendChild(mv);
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'tok-del';
    del.textContent = '×';
    del.addEventListener('click', function () {
      const area = chip.closest('.f-expr');
      chip.parentNode.removeChild(chip);
      refreshChips(area);
      updateExprPreviews();
    });
    tools.appendChild(del);
    chip.appendChild(tools);
    return chip;
  }
  // проставить чипам: имя, признак битой ссылки, доступность стрелок, надпись знач./бонус
  // (v25: поле может быть не только у формулы — работаем с любым .f-expr)
  function refreshChips(area) {
    if (!area) return;
    const names = refNames();
    area.querySelectorAll('.tok-ref').forEach(function (chip) {
      chip.querySelector('.tok-name').textContent = chip.dataset.name;
      chip.querySelector('.tok-part').textContent = chip.dataset.part === 'bonus' ? App.t('bonusOf') : App.t('valueOf');
      chip.classList.toggle('broken', names.indexOf(chip.dataset.name) === -1);
      chip.querySelector('.tok-mv[data-dir="-1"]').disabled = !chip.previousElementSibling;
      chip.querySelector('.tok-mv[data-dir="1"]').disabled = !chip.nextElementSibling;
    });
  }
  function refreshAllChips() {
    refreshChips(document.getElementById('f-expr'));
  }
  // строка выражения → содержимое поля: {Имя} / {Имя.бонус} → чип, остальное — текст как есть
  function renderExprInto(area, str) {
    area.innerHTML = '';
    const re = /\{([^{}]*)\}/g;
    let last = 0;
    let m;
    while ((m = re.exec(str))) {
      if (m.index > last) area.appendChild(document.createTextNode(str.slice(last, m.index)));
      const inner = m[1].trim();
      const m2 = inner.match(/^(.*?)\s*\.\s*(бонус|bonus)$/i);
      area.appendChild(makeRefChip(m2 ? m2[1].trim() : inner, !!m2));
      last = m.index + m[0].length;
    }
    if (last < str.length) area.appendChild(document.createTextNode(str.slice(last)));
  }
  // содержимое поля → строка выражения (формат хранения не менялся с v1);
  // v25: рекурсивно — браузер может завернуть строки в <div>, текст внутри не теряем
  function serializeExpr(area) {
    if (!area) return '';
    function ser(node) {
      let out = '';
      node.childNodes.forEach(function (n) {
        if (n.nodeType === 3) out += n.textContent;
        else if (n.classList && n.classList.contains('tok-ref')) {
          out += '{' + n.dataset.name + (n.dataset.part === 'bonus' ? '.бонус' : '') + '}';
        } else if (n.nodeType === 1) out += ser(n);
      });
      return out;
    }
    return ser(area);
  }
  function previewValue(card, part) {
    if (part === 'bonus') return cardBonus(card);
    switch (card.type) {
      case 'counter': return num(card.current);
      case 'skill': return skillValueNum(card);
      case 'spell': return chargesCurrent(card);
      default: return 0;
    }
  }
  // последняя позиция курсора в поле выражения (чтобы вставка чипа из пикера
  // шла туда, где курсор был, а не в начало поля после фокуса на поиске).
  // v25: полей несколько (бонус, максимум, значение…) — помним и поле, и диапазон
  let lastExpr = null;   // { area, range }
  function trackExprCaret() {
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.anchorNode) return;
    let n = sel.anchorNode;
    if (n.nodeType !== 1) n = n.parentNode;
    const area = n && n.closest ? n.closest('.f-expr') : null;
    if (area) lastExpr = { area: area, range: sel.getRangeAt(0).cloneRange() };
  }
  let exprCaretBound = false;   // selectionchange-слежение за кареткой полей ставится один раз
  function ensureExprCaretTracking() {
    if (exprCaretBound) return;
    exprCaretBound = true;
    document.addEventListener('selectionchange', trackExprCaret);
  }
  // вставка узла в позицию курсора в конкретном поле (курсора нет — в конец)
  function insertNodeAtCaret(node, area) {
    if (lastExpr && lastExpr.area === area && area.contains(lastExpr.range.commonAncestorContainer)) {
      const r = lastExpr.range;
      r.deleteContents();
      r.insertNode(node);
    } else {
      area.appendChild(node);
    }
    // каретка — сразу после вставленного чипа
    const sel = window.getSelection();
    const r2 = document.createRange();
    r2.setStartAfter(node);
    r2.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r2);
    lastExpr = { area: area, range: r2 };
    area.focus();
  }

  // ===== Пикер карточки (замена нативного select: у options на ПК белый фон) =====
  // Тёмная панель со строкой поиска — единый вид на ПК и мобилке.
  // v26: раньше пикер жил в редакторе формул, с v25 обслуживает поля-выражения всех карточек.
  let refMenuAnchor = null;
  // Позиционирование панели у анкора: не вылезать за правый край, при нехватке
  // места снизу — раскрыть вверх, в любом случае целиком в видимой области.
  // Вынесено отдельной функцией, чтобы на resize НЕ закрывать панель, а переставлять:
  // на телефоне фокус на строке поиска открывает клавиатуру, окно «сжимается» —
  // раньше resize закрывал меню, и список вспыхивал и исчезал вместе с клавиатурой.
  function placeRefMenu() {
    const menu = document.getElementById('refmenu');
    if (!menu || !refMenuAnchor) return;
    const r = refMenuAnchor.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8));
    let top = r.bottom + 4;
    if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 4);
    // панель обязана остаться в пределах видимой области целиком
    // (при открытой клавиатуре видимая область сжимается по высоте)
    top = Math.min(top, Math.max(8, window.innerHeight - menu.offsetHeight - 8));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }
  // anchor — кнопка, к которой прижимается панель; opts.chip — переименовать чип,
  // opts.area — вставить новый чип в позицию курсора этого поля
  function openRefMenu(anchor, opts) {
    closeRefMenu();
    refMenuAnchor = anchor;
    // v25.1: саму редактируемую карточку из выборки убираем — ссылка на саму себя
    // всё равно даёт цикл («Здоровье» в максимуме «Здоровье»).
    // v36: исключение — бонус навыка (opts.allowSelf): там ссылка на своё значение
    // осмысленна и цикла не даёт
    const selfCard = editScratch.editCard;
    const names = refNames().filter(function (n) { return opts.allowSelf || !selfCard || n !== selfCard.name; });
    const menu = document.createElement('div');
    menu.className = 'refmenu';
    menu.id = 'refmenu';
    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'refmenu-search';
    search.placeholder = App.t('refSearch');
    menu.appendChild(search);
    const list = document.createElement('div');
    list.className = 'refmenu-list';
    menu.appendChild(list);
    function renderList(q) {
      const query = (q || '').toLowerCase();
      list.innerHTML = '';
      names.forEach(function (n) {
        if (query && n.toLowerCase().indexOf(query) === -1) return;
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = n;
        if (opts.chip && n === opts.chip.dataset.name) b.classList.add('sel');
        b.addEventListener('click', function () {
          if (opts.chip) opts.chip.dataset.name = n;
          else if (opts.area) insertNodeAtCaret(makeRefChip(n, false), opts.area);
          closeRefMenu();
          refreshChips(opts.area);
          updateExprPreviews();
        });
        list.appendChild(b);
      });
      if (!list.children.length) {
        const empty = document.createElement('div');
        empty.className = 'refmenu-empty';
        empty.textContent = App.t('refNotFound');
        list.appendChild(empty);
      }
    }
    renderList('');
    search.addEventListener('input', function () { renderList(search.value); });
    document.body.appendChild(menu);
    placeRefMenu();
    // v25.2: фокус на строке поиска — только на ПК. На телефоне автофокус тут же
    // поднимает клавиатуру; поиск доступен тапом по строке, когда он нужен.
    if (isDesktop()) setTimeout(function () { search.focus(); }, 0);
    // закрытие: клик/тап мимо (кроме самой панели и её кнопки-анкора).
    // resize НЕ закрывает панель, а переставляет её (клавиатура на телефоне
    // меняет высоту окна и раньше гасила список сразу после открытия)
    document.addEventListener('pointerdown', onRefMenuDocDown, true);
    window.addEventListener('resize', placeRefMenu);
  }
  function onRefMenuDocDown(e) {
    const menu = document.getElementById('refmenu');
    if (menu && !menu.contains(e.target) && !(refMenuAnchor && refMenuAnchor.contains(e.target))) closeRefMenu();
  }
  function closeRefMenu() {
    const menu = document.getElementById('refmenu');
    if (menu) menu.parentNode.removeChild(menu);
    document.removeEventListener('pointerdown', onRefMenuDocDown, true);
    window.removeEventListener('resize', placeRefMenu);
    refMenuAnchor = null;
  }
  function readCharges(card) {
    const charges = card.charges || { mode: 'own' };
    charges.mode = document.getElementById('f-chmode').value;
    // v32: действие при нехватке основного ресурса (заменило галочку blockEmpty —
    // старые карты мигрируются в layoutCharacter, здесь ключ уже не пишем)
    const emEl = document.querySelector('input[name="f-chempty"]:checked');
    charges.emptyMode = emEl ? emEl.value : 'block';
    if (charges.emptyMode === 'reserve') {
      const rs = document.getElementById('f-chreserve');
      charges.reserveId = rs && rs.value ? rs.value : null;
    } else {
      charges.reserveId = null;
    }
    delete charges.blockEmpty;
    // v32: тег «х/N» вместо анимации фигур
    charges.tag = readCheck('f-chtag');
    if (charges.mode === 'link') {
      const link = document.getElementById('f-chlink');
      charges.linkId = link && link.value ? link.value : null;
      charges.cost = num(readNum('f-chcost')) || 1;
    } else {
      // v25: максимум — выражение («{Мана} + 2»); при создании заряды стартуют с него
      charges.max = exprOrNull(readExpr('f-chmax'));
      if (card._new && charges.max != null) {
        const cm = chargesMaxNum(card);
        charges.current = cm == null ? num(charges.max) : num(cm);
      }
    }
    return charges;
  }

  function applyFields(card) {
    switch (card.type) {
      case 'counter':
        // v25: максимум — выражение; при создании счётчика текущее = максимуму
        // (нет максимума — остаётся стартовым)
        card.max = exprOrNull(readExpr('f-max'));
        if (card._new && card.max != null) {
          const mx = counterMaxNum(card);
          card.current = mx == null ? num(card.max) : num(mx);
        }
        // v36: кубик и бонус у счётчика больше не редактируются — при сохранении
        // чистим (в старых данных они оставались от прежней версии)
        card.bonus = '';
        card.die = null;
        card.restores = readCheck('f-restores');
        break;
      case 'skill': {
        // три независимые галочки: Кубик / Значение / Бонус (значение и бонус — выражения)
        const dCb = document.getElementById('f-usedie');
        card.die = (dCb ? dCb.checked : !!card.die) ? (readDie('f-die') || 20) : null;
        // v50: количество кубиков (2d20 и т.п.), 1..20
        const nEl = document.getElementById('f-ndice');
        card.nDice = Math.max(1, Math.min(20, Math.round(num(nEl ? nEl.value : card.nDice) || 1)));
        const vCb = document.getElementById('f-usevalue');
        if (vCb) card.value = vCb.checked ? exprOrNull(readExpr('f-value')) : null;
        const bCb = document.getElementById('f-usebonus');
        if (bCb) card.bonus = bCb.checked ? readExpr('f-bonus').trim() : '';
        // v50: описание — по галочке
        const descCb = document.getElementById('f-usedesc');
        if (descCb) card.description = descCb.checked ? readText('f-desc') : '';
        break;
      }
      case 'spell':
        card.description = readText('f-desc');
        card.charges = readCharges(card);
        card.die = readDie('f-die');
        card.bonus = readBonus();
        card.restores = readCheck('f-restores');
        break;
      case 'initiative': {
        const dEl = document.getElementById('f-ini-die');
        card.die = Math.max(2, Math.round(num(dEl ? dEl.value : card.die) || 20));
        const nEl = document.getElementById('f-ini-new');
        card.newMode = nEl && nEl.value === 'last' ? 'last' : 'roll';
        break;
      }
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
  }

  function openCardEditor(cardId) {
    const card = findCard(cardId);
    if (!card) return;
    editScratch.editCard = card;   // для живого предпросмотра в полях-выражениях
    let body = '<div class="field"><label>' + esc(App.t('name')) + '</label><input id="f-name" type="text" value="' + esc(card.name) + '" placeholder="' + esc(nameExample(card.type)) + '"></div>';
    body += typeFields(card);
    openModal(typeLabel(card.type), body, [
      { label: App.t('cancel') },
      { label: App.t('save'), cls: 'primary', onClick: function () { return saveCardEdit(card); } }
    ]);
    postInitEditor(card);
  }

  function saveCardEdit(card) {
    const nameInput = document.getElementById('f-name');
    const name = nameInput.value.trim();
    // v65: у «Состояния» пустая подпись — норма (карточка без названия)
    if (card.type !== 'condition' && !name) { toast(App.t('uniqueNameError')); return false; }
    if (name && isNameUsed(name, card.id)) { toast(App.t('uniqueNameError')); return false; }
    const oldName = card.name;
    // v25: ссылки теперь живут не только в формулах — переименовываем их
    // во всех полях-выражениях (бонус, максимум, значение, максимум зарядов)
    const renameExpr = function (v) {
      if (v == null || typeof v === 'number' || String(v).indexOf('{') === -1) return v;
      return App.formula.renameRefs(String(v), oldName, name);
    };
    mutate(function () {
      if (oldName !== name) {
        const ch = activeChar();
        ch.cards.forEach(function (c) {
          c.bonus = renameExpr(c.bonus);
          c.max = renameExpr(c.max);
          c.value = renameExpr(c.value);
          if (c.charges) c.charges.max = renameExpr(c.charges.max);
        });
      }
      card.name = name;
      applyFields(card);
      delete card._new;   // метка «только что создан» снята: дальше правки не трогают текущее значение
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
      { type: 'skill', name: App.t('presetStat'), extra: { value: 10, die: 20 } }
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
      // v65: «Состояние» создаётся без подписи — название необязательно
      if (type === 'condition' && !name) nm = '';
      let i = 2, base = nm;
      // пустое имя у состояний не считается занятым: иначе вторая карточка получала « (2)»
      while (nm && ch.cards.some(function (c) { return c.name === nm; })) { nm = base + ' (' + i + ')'; i++; }
      const c = createCard(type, nm, extra);
      c._new = true;   // метка «только что создан»: при первом сохранении current = max (метка снимается и не сохраняется)
      c.page = curPageId(ch);
      newId = c.id;
      ch.cards.push(c);
      autoPlace(ch, c);
    });
    closeModal();
    if (newId) openCardEditor(newId);
  }

  // ===== Settings =====
  // ---- Настройки: хаб с вкладками (v71) ----
  function settingsSetPanel(kind, ch) {
    const isStates = kind === 'states';
    const activeId = charSetId(ch, kind);
    const cards = libSets(kind).map(function (set) {
      const entries = set.entries || [];
      const used = state.characters.filter(function (c) { return charSetId(c, kind) === set.id; }).length;
      const editable = isStates;   // v82: состояния правятся в любом наборе
      const rows = entries.map(function (e) {
        const nm = e.nameKey ? App.t(e.nameKey) : (e.name || '');
        let ds = e.descKey ? App.t(e.descKey) : (e.effect || '');
        // v81: если у шаблона есть эффекты, показываем их, а не старую подпись
        const fx = e.effects || [];
        if (fx.length) ds = fx.map(function (ef) { return ef.label || fxShort(ef); }).join(' · ');
        const ic = isStates
          ? '<span class="set-ic" data-ic="' + esc(e.icon) + '">' + condIcon(e.icon, e.color, e.shade, e.hi) + '</span>'
          : '<span class="set-ic"></span>';
        const eid = e.entryId || e.key;
        return '<div class="set-row' + (editable ? ' editable' : '') + '"' +
          (editable ? ' data-edit-state="' + esc(eid) + '" data-set-id="' + esc(set.id) + '"' : '') + '>' + ic +
          '<span class="set-txt"><span class="set-name">' + esc(nm) + '</span>' +
          '<span class="set-desc">' + esc(ds) + '</span></span>' +
          (editable ? '<button type="button" class="set-row-edit" aria-label="' + esc(App.t('edit')) + '" title="' + esc(App.t('edit')) + '">✎</button>' : '') +
          (editable && !set.builtin
            ? '<button type="button" class="set-row-del" data-del-state="' + esc(eid) + '" data-set-id="' + esc(set.id) + '" aria-label="' + esc(App.t('stDelete')) + '" title="' + esc(App.t('stDelete')) + '">' + TRASH_SVG + '</button>'
            : (editable ? '<span class="set-row-slot"></span>' : '')) +
          '</div>';
      }).join('');
      const open = set.id === activeId;
      return '<div class="set-card' + (open ? ' open' : '') + '" data-set="' + esc(set.id) + '">' +
        '<div class="set-head" data-toggle="' + esc(set.id) + '">' +
          '<span class="set-chev"></span>' +
          '<span class="set-title"><b>' + esc(setDisplayName(set)) + '</b>' +
            '<span class="set-meta">' + esc(App.tf(isStates ? 'statesCount' : 'itemsCount', { n: entries.length })) +
            ' · ' + esc(App.tf('setUsedBy', { n: used })) + '</span></span>' +
          (isStates ? '<button type="button" class="set-plus" data-add-state="' + esc(set.id) + '" aria-label="' + esc(App.t('stAddState')) + '" title="' + esc(App.t('stAddState')) + '">+</button>' : '') +
          (set.id === activeId ? '<span class="set-flag">' + esc(App.t('setHere')) + '</span>' : '') +
          (!set.builtin ? '<button type="button" class="set-ren" data-rename-set="' + esc(set.id) + '" aria-label="' + esc(App.t('setRename')) + '" title="' + esc(App.t('setRename')) + '">✎</button>' : '') +
          (entries.length
            ? '<button type="button" class="set-exp" data-export="' + esc(set.id) + '" aria-label="' + esc(App.t('setExportShort')) + '">' + SET_EXPORT_SVG + '</button>'
            : '') +
          (!set.builtin
            ? '<button type="button" class="set-del" data-del="' + esc(set.id) + '" aria-label="' + esc(App.t('delete')) + '">' + TRASH_SVG + '</button>'
            : '') +
        '</div>' +
        '<div class="set-body">' +
          '<div class="set-rows">' + (rows || '<div class="set-empty">' + esc(isStates ? App.t('setEmptyStates') : App.t('itemsSoon')) + '</div>') + '</div>' +
        '</div></div>';
    }).join('');
    return '<div class="s-panel hidden" data-panel="' + kind + '">' +
      '<div class="set-cards">' + cards + '</div>' +
      '<div class="set-foot">' +
        (isStates ? '<button type="button" id="s-set-import">' + esc(App.t('setImport')) + '</button>' : '') +
      '</div></div>';
  }

  // ===== Редактор шаблона состояния (v81) =====
  // Набор общий на устройство, поэтому здесь НЕТ выбора цели. Цель появляется
  // только в окне состояний на карточке. Здесь — имя, вид и значения по умолчанию.
  const STATE_ICON_KEYS = ['skull', 'drop', 'snow', 'star', 'heart', 'flame', 'curse', 'bolt', 'eye', 'bang', 'grip', 'fall', 'net', 'zzz', 'weary'];
  const STATE_FIELDS = ['bonus', 'max', 'value', 'charges', 'current'];

  function stateColorParts(color) {
    const c = condHexToRgb(color || '#8c8c9a');
    return {
      shade: condRgbToHex(c.r * 0.55, c.g * 0.55, c.b * 0.55),
      hi: condRgbToHex(Math.min(255, c.r * 0.65 + 85), Math.min(255, c.g * 0.65 + 85), Math.min(255, c.b * 0.65 + 85))
    };
  }

  function stateDefaultEntry() {
    const id = uid();
    return {
      entryId: 'st-' + id, key: 'custom_' + id,
      name: App.t('stNewName'), effect: '',
      icon: 'skull', color: '#8c8c9a', shade: '#4c4c58', hi: '#d6d6e0',
      tint: '#7a7a86', tintOp: 0.3,
      category: 'custom', scope: 'none', face: null,
      duration: null,
      effects: []
    };
  }

  function stateCloneEntry(entry) {
    const e = entry || {};
    const parts = stateColorParts(e.color || '#8c8c9a');
    return {
      entryId: e.entryId || null,
      key: e.key || null,
      name: e.nameKey ? App.t(e.nameKey) : (e.name || ''),
      effect: e.descKey ? App.t(e.descKey) : (e.effect || ''),
      icon: STATE_ICON_KEYS.indexOf(e.icon) !== -1 ? e.icon : 'skull',
      color: e.color || '#8c8c9a',
      shade: e.shade || parts.shade,
      hi: e.hi || parts.hi,
      tint: e.tint || null,
      tintOp: num(e.tintOp) || 0,
      category: e.category || 'custom',
      scope: e.scope || 'none',
      face: e.face || null,
      duration: num(e.duration) > 0 ? num(e.duration) : null,
      effects: (e.effects || []).map(function (ef) {
        return { mode: ef.mode || 'add', field: effectField(ef), value: ef.value == null ? '' : String(ef.value), label: ef.label || '',
                 timing: ef.mode === 'tick' ? (ef.timing || 'start') : null };
      })
    };
  }

  function stateEntrySnapshot(entry, setId) {
    const parts = stateColorParts(entry.color || '#8c8c9a');
    return {
      id: 'st-preview', key: entry.key || 'preview', entryId: entry.entryId || null, setId: setId || null,
      name: entry.name || '', effect: entry.effect || '',
      icon: STATE_ICON_KEYS.indexOf(entry.icon) !== -1 ? entry.icon : 'skull',
      color: entry.color || '#8c8c9a',
      shade: entry.shade || parts.shade,
      hi: entry.hi || parts.hi,
      tint: entry.tint || null, tintOp: num(entry.tintOp) || 0,
      category: entry.category || 'custom', scope: entry.scope || 'none', face: entry.face || null,
      duration: entry.duration || null,
      effects: (entry.effects || []).map(function (ef) {
        return { mode: ef.mode, field: effectField(ef), value: ef.value, label: ef.label || '', target: null,
                 timing: ef.mode === 'tick' ? (ef.timing || 'start') : null };
      })
    };
  }

  // Копия набора: правим копию, базовый не трогаем. Копия сразу становится
  // набором текущего листа, иначе правка была бы «в никуда».
  function copyStateSetForEdit(sourceSet, activate) {
    const ch = activeChar();
    const isActive = (activate == null)
      ? !!(ch && (ch.stateSets || [])[0] === sourceSet.id)
      : !!activate;
    // Не плодим «(копия) (копия)»: снимаем прошлые суффиксы и подбираем свободное имя.
    let base = setDisplayName(sourceSet);
    for (;;) {
      const next = base
        .replace(/(?:\s*\((?:копия|copy)(?:\s+\d+)?\))+$/i, '')
        .replace(/\s+\d+$/, '')
        .trim();
      if (!next || next === base) break;
      base = next;
    }
    let name = App.tf('setCopyName', { name: base });
    let n = 2;
    while (libSets('states').some(function (s) { return setDisplayName(s) === name; })) {
      name = App.tf('setCopyName', { name: base + ' ' + n });
      n++;
    }
    const copy = {
      id: uid(),
      name: name,
      builtin: false,
      entries: (sourceSet.entries || []).map(function (e) {
        const clone = Object.assign({}, e);
        clone.entryId = e.entryId || ('st-' + uid());
        clone.effects = (e.effects || []).map(function (ef) { return Object.assign({}, ef); });
        return clone;
      })
    };
    libSets('states').push(copy);
    if (isActive && ch) ch.stateSets = [copy.id];
    return copy;
  }

  function saveStateEntry(targetSet, sourceEntry, draft, isNew) {
    const set = targetSet;
    const list = set.entries || (set.entries = []);
    let entry = null;
    if (!isNew) {
      entry = list.find(function (e) {
        return (draft.entryId && e.entryId === draft.entryId) ||
          (sourceEntry && e.key === sourceEntry.key);
      }) || null;
    }
    if (!entry) { entry = {}; list.push(entry); }

    // Если имя/описание не меняли, у базовой записи сохраняем nameKey/descKey:
    // так копия продолжит переводиться вместе с интерфейсом.
    const oldName = sourceEntry ? (sourceEntry.nameKey ? App.t(sourceEntry.nameKey) : (sourceEntry.name || '')) : '';
    if (isNew || draft.name !== oldName) { delete entry.nameKey; entry.name = draft.name; }
    else if (!entry.nameKey) entry.name = draft.name;
    const oldDesc = sourceEntry ? (sourceEntry.descKey ? App.t(sourceEntry.descKey) : (sourceEntry.effect || '')) : '';
    if (isNew || draft.effect !== oldDesc) { delete entry.descKey; entry.effect = draft.effect; }
    else if (!entry.descKey) entry.effect = draft.effect;

    entry.entryId = entry.entryId || draft.entryId || ('st-' + uid());
    entry.key = entry.key || draft.key || ('custom_' + uid());
    entry.icon = draft.icon || 'skull';
    entry.color = draft.color || '#8c8c9a';
    entry.shade = draft.shade || stateColorParts(entry.color).shade;
    entry.hi = draft.hi || stateColorParts(entry.color).hi;
    entry.tint = draft.tint || null;
    entry.tintOp = num(draft.tintOp) || 0;
    entry.category = entry.category || draft.category || 'custom';
    entry.scope = entry.scope || draft.scope || 'none';
    entry.face = entry.face || draft.face || null;
    entry.duration = num(draft.duration) > 0 ? num(draft.duration) : null;
    entry.effects = (draft.effects || []).map(function (ef) {
      return { mode: ef.mode, field: effectField(ef), value: ef.value, label: ef.label || '',
               timing: ef.mode === 'tick' ? (ef.timing || 'start') : null };
    });
    return set;
  }

  function removeStateEntry(set, entryId) {
    set.entries = (set.entries || []).filter(function (e) {
      return !(e.entryId === entryId || e.key === entryId);
    });
    return set;
  }

  function deleteStateFromSet(setId, entryId, anchor) {
    const set = libSetById('states', setId);
    if (!set || set.builtin) return;   // базовые 15 состояний не удаляем
    const entry = (set.entries || []).find(function (e) { return e.entryId === entryId || e.key === entryId; });
    if (!entry) return;
    const name = entry.nameKey ? App.t(entry.nameKey) : (entry.name || '');
    const msg = set.builtin
      ? App.tf('stDeleteBuiltinConfirm', { name: name })
      : App.tf('stDeleteConfirm', { name: name });
    askInline(anchor, msg, function () {
      mutate(function () { removeStateEntry(set, entryId); });
      openSettings('states');
    });
  }

  function openRenameSetModal(kind, setId) {
    const set = libSetById(kind, setId);
    if (!set || set.builtin) return;   // базовый набор не переименовываем
    const nm = setDisplayName(set);
    openModal(App.t('setRename'),
      '<div class="field"><label>' + esc(App.t('setName')) + '</label>' +
      '<input id="setNameInput" type="text" autocomplete="off" spellcheck="false" value="' + esc(nm) + '"></div>',
      [
        { label: App.t('cancel'), onClick: function () { openSettings(kind); return false; } },
        { label: App.t('save'), cls: 'primary', onClick: function () {
          const inp = document.getElementById('setNameInput');
          const name = inp.value.trim();
          if (!name) { toast(App.t('setNameNeeded')); return false; }
          if (name === setDisplayName(set)) { openSettings(kind); return false; }
          mutate(function () { set.name = name; delete set.nameKey; });
          openSettings(kind);
          return false;
        } }
      ]);
    document.getElementById('modal').classList.add('settings-modal');
    const inp = document.getElementById('setNameInput');
    if (inp) { inp.focus(); inp.select(); }
  }

  // В шаблоне нет цели, поэтому режимы выводятся из поля:
  // bonus → можно кубик; charges → можно запрет применения.
  function stateModesFor(field) {
    if (field === 'current') return ['tick'];
    const out = ['add', 'mul', 'set', 'cap'];
    if (field === 'bonus') out.push('dice');
    if (field === 'charges') out.push('block');
    return out;
  }

  function openStateEditor(setId, entryId) {
    ensureStateEntryIds();
    const sourceSet = libSetById('states', setId) || stateSetOf(activeChar());
    if (!sourceSet) return;
    const isNew = !entryId;
    const sourceEntry = isNew ? null : (sourceSet.entries || []).find(function (e) {
      return e.entryId === entryId || e.key === entryId;
    });
    if (!isNew && !sourceEntry) return;

    const draft = sourceEntry ? stateCloneEntry(sourceEntry) : stateDefaultEntry();
    let colorDirty = false;
    let tintDirty = false;
    let fxEdit = -2;                 // -2 — формы нет, -1 — новый, >=0 — индекс
    let fxDraft = null;

    const el = function (id) { return document.getElementById(id); };
    const val = function (id) { const n = el(id); return n ? n.value : ''; };
    const colorHex = function (v) { return String(v || '').toUpperCase(); };

    function previewHTML() {
      return conditionBody({ id: 'st-preview-card', conditions: [stateEntrySnapshot(draft, sourceSet.id)] }, true);
    }

    function renderPreview() {
      const host = el('st-preview');
      if (host) host.innerHTML = previewHTML();
    }

    function renderIcons() {
      const host = el('st-icons');
      if (!host) return;
      host.innerHTML = STATE_ICON_KEYS.map(function (k) {
        return '<button type="button" class="st-icon-btn' + (draft.icon === k ? ' on' : '') + '" data-icon="' + k + '" aria-label="' + k + '">' +
          condIcon(k, draft.color, draft.shade, draft.hi) + '</button>';
      }).join('');
    }

    function fxPlaceholder(mode) {
      return mode === 'block' ? '—' : App.t(FX_MODE_PH[mode] || 'fxPhAdd');
    }

    function fxFormHTML(ef) {
      const data = ef || { mode: 'add', field: 'bonus', value: '', label: '', timing: 'start' };
      const field = data.field || 'bonus';
      const modes = stateModesFor(field);
      const mode = modes.indexOf(data.mode) !== -1 ? data.mode : modes[0];
      const block = mode === 'block';
      const tick = mode === 'tick';
      const fieldOpts = STATE_FIELDS.map(function (f) {
        return '<option value="' + f + '"' + (f === field ? ' selected' : '') + '>' + esc(fxFieldText(f)) + '</option>';
      }).join('');
      const modeOpts = modes.map(function (m) {
        return '<option value="' + m + '"' + (m === mode ? ' selected' : '') + '>' + esc(fxModeText(m)) + '</option>';
      }).join('');
      return '<div class="st-fx-form">' +
        '<div class="field"><label>' + esc(App.t('fxField')) + '</label><select data-f-field>' + fieldOpts + '</select></div>' +
        '<div class="field"><label>' + esc(App.t('fxMode')) + '</label><select data-f-mode>' + modeOpts + '</select></div>' +
        '<div class="field" data-f-timing-wrap' + (tick ? '' : ' hidden') + '><label>' + esc(App.t('fxTiming')) + '</label><select data-f-timing>' +
          '<option value="start"' + ((data.timing || 'start') === 'start' ? ' selected' : '') + '>' + esc(App.t('fxTimingStart')) + '</option>' +
          '<option value="end"' + (data.timing === 'end' ? ' selected' : '') + '>' + esc(App.t('fxTimingEnd')) + '</option>' +
        '</select></div>' +
        '<div class="field"><label>' + esc(App.t('fxValue')) + '</label><input data-f-value type="text" autocomplete="off" spellcheck="false" value="' + esc(block ? '' : (data.value || '')) + '" placeholder="' + esc(fxPlaceholder(mode)) + '"' + (block ? ' disabled' : '') + '></div>' +
        '<div class="field"><label>' + esc(App.t('fxLabelField')) + '</label><input data-f-label type="text" autocomplete="off" spellcheck="false" value="' + esc(data.label || '') + '" placeholder="' + esc(App.t('fxLabelPh')) + '"></div>' +
        '<div class="st-fx-actions">' +
          '<button type="button" data-f-cancel>' + esc(App.t('cancel')) + '</button>' +
          '<button type="button" class="primary" data-f-done>' + esc(App.t('stFxDone')) + '</button>' +
        '</div>' +
      '</div>';
    }

    function renderFxList() {
      const host = el('st-fx-list');
      if (!host) return;
      if (!draft.effects.length && fxEdit === -2) {
        host.innerHTML = '<div class="st-fx-empty">' + esc(App.t('stNoEffects')) + '</div>';
        return;
      }
      let html = '';
      draft.effects.forEach(function (ef, i) {
        if (fxEdit === i) { html += fxFormHTML(fxDraft || ef); return; }
        html += '<div class="st-fx-row">' +
          '<span class="st-fx-sum" title="' + esc(fxShort(ef)) + '">' + esc(ef.label || fxShort(ef)) + '</span>' +
          '<button type="button" data-fx-edit="' + i + '" title="' + esc(App.t('edit')) + '" aria-label="' + esc(App.t('edit')) + '">✎</button>' +
          '<button type="button" class="st-fx-del" data-fx-del="' + i + '" title="' + esc(App.t('delete')) + '" aria-label="' + esc(App.t('delete')) + '">' + TRASH_SVG + '</button>' +
        '</div>';
      });
      if (fxEdit === -1) html += fxFormHTML(fxDraft);
      host.innerHTML = html;
    }

    function syncFxValue(form) {
      if (!form) return;
      const mode = form.querySelector('[data-f-mode]').value;
      const v = form.querySelector('[data-f-value]');
      const block = mode === 'block';
      const tick = mode === 'tick';
      v.disabled = block;
      v.placeholder = fxPlaceholder(mode);
      if (block) v.value = '';
      const tw = form.querySelector('[data-f-timing-wrap]');
      if (tw) tw.hidden = !tick;
    }

    function commitFx() {
      if (fxEdit === -2) return true;
      const form = document.querySelector('#st-fx-list .st-fx-form');
      if (!form) { fxEdit = -2; fxDraft = null; return true; }
      const field = form.querySelector('[data-f-field]').value;
      const mode = form.querySelector('[data-f-mode]').value;
      const value = form.querySelector('[data-f-value]').value.trim();
      const label = form.querySelector('[data-f-label]').value.trim();
      const timing = form.querySelector('[data-f-timing]') ? form.querySelector('[data-f-timing]').value : 'start';
      // пустую новую строку не заставляем заполнять — просто закрываем
      if (fxEdit === -1 && mode !== 'block' && !value && !label) {
        fxEdit = -2; fxDraft = null; renderFxList(); return true;
      }
      if (mode !== 'block' && !value) { toast(App.t('fxValueNeeded')); return false; }
      const ef = { mode: mode, field: field, value: mode === 'block' ? '' : value, label: label,
                   timing: mode === 'tick' ? timing : null };
      if (fxEdit === -1) draft.effects.push(ef); else draft.effects[fxEdit] = ef;
      fxEdit = -2; fxDraft = null;
      renderFxList();
      return true;
    }

    function cancelFx() {
      fxEdit = -2; fxDraft = null; renderFxList();
    }

    function startFxAdd() {
      if (fxEdit !== -2 && !commitFx()) return;
      fxEdit = -1;
      fxDraft = { mode: 'add', field: 'bonus', value: '', label: '', timing: 'start' };
      renderFxList();
    }

    function startFxEdit(i) {
      if (fxEdit !== -2 && !commitFx()) return;
      const ef = draft.effects[i];
      if (!ef) return;
      fxEdit = i;
      fxDraft = { mode: ef.mode, field: ef.field, value: ef.value, label: ef.label, timing: ef.timing || 'start' };
      renderFxList();
    }

    function saveDraft() {
      const name = val('st-name').trim();
      if (!name) { toast(App.t('stNeedName')); return false; }
      const dup = (sourceSet.entries || []).some(function (e) {
        if (sourceEntry && (e === sourceEntry || (e.entryId && e.entryId === sourceEntry.entryId))) return false;
        const nm = e.nameKey ? App.t(e.nameKey) : (e.name || '');
        return nm.toLowerCase() === name.toLowerCase();
      });
      if (dup) { toast(App.t('stNameUsed')); return false; }
      draft.name = name;
      draft.effect = val('st-desc').trim();
      draft.color = val('st-color') || draft.color;
      if (colorDirty) {
        const parts = stateColorParts(draft.color);
        draft.shade = parts.shade;
        draft.hi = parts.hi;
      }
      // Силу тона отдельным ползунком не трогаем: у существующих сохраняем,
      // у нового/включённого тона — 0.3. Если тон не меняли, не добавляем его
      // состояниям, где тонировки не было.
      if (tintDirty) {
        draft.tint = val('st-tint') || null;
        draft.tintOp = draft.tint ? (draft.tintOp > 0 ? draft.tintOp : 0.3) : 0;
      }
      const dur = parseInt(val('st-duration'), 10);
      draft.duration = dur > 0 ? dur : null;
      const saveMode = sourceSet.builtin
        ? 'copy'
        : ((document.querySelector('input[name="st-save"]:checked') || {}).value || 'set');
      mutate(function () {
        let target = sourceSet;
        if (saveMode === 'copy') {
          const ch = activeChar();
          const active = !!(ch && (ch.stateSets || [])[0] === sourceSet.id);
          target = copyStateSetForEdit(sourceSet, active);
        }
        saveStateEntry(target, sourceEntry, draft, isNew);
      });
      return true;
    }

    const body =
      '<div class="st-edit">' +
        '<div class="st-preview">' +
          '<div id="st-preview" class="st-preview-stage"></div>' +
          '<div class="st-preview-cap">' + esc(App.t('stPreview')) + '</div>' +
        '</div>' +
        '<div class="st-form">' +
          '<button type="button" class="st-back" id="st-back">← ' + esc(App.t('stBack')) + '</button>' +
          (sourceSet.builtin ? '<div class="st-copy-note">' + esc(App.t('stBaseImmutable')) + '</div>' : '') +
          '<div class="field"><label>' + esc(App.t('name')) + '</label><input id="st-name" type="text" autocomplete="off" spellcheck="false" value="' + esc(draft.name) + '" placeholder="' + esc(App.t('stNewName')) + '"></div>' +
          '<div class="field"><label>' + esc(App.t('description')) + '</label><input id="st-desc" type="text" autocomplete="off" spellcheck="false" value="' + esc(draft.effect) + '" placeholder="' + esc(App.t('stDescPh')) + '"></div>' +
          '<div class="field"><label>' + esc(App.t('stIcon')) + '</label><div id="st-icons" class="st-icon-grid"></div></div>' +
          '<div class="st-colors">' +
            '<div class="field"><label>' + esc(App.t('stColor')) + '</label><div class="st-color-row">' +
              '<input id="st-color" type="color" value="' + esc(draft.color) + '">' +
              '<span class="st-meta" id="st-color-hex">' + esc(colorHex(draft.color)) + '</span>' +
            '</div></div>' +
            '<div class="field"><label>' + esc(App.t('stTint')) + '</label><div class="st-color-row">' +
              '<input id="st-tint" type="color" value="' + esc(draft.tint || draft.color) + '">' +
              '<span class="st-meta" id="st-tint-hex">' + esc(colorHex(draft.tint || draft.color)) + '</span>' +
            '</div></div>' +
          '</div>' +
          '<div class="field"><label>' + esc(App.t('stEffects')) + '</label>' +
            '<div id="st-fx-list" class="st-fx-list"></div>' +
            '<button type="button" id="st-fx-add" class="st-add-fx">+ ' + esc(App.t('fxAdd')) + '</button>' +
          '</div>' +
          '<div class="field"><label>' + esc(App.t('stDuration')) + '</label>' +
            '<input id="st-duration" type="number" min="0" step="1" autocomplete="off" placeholder="' + esc(App.t('stDurationPh')) + '" value="' + esc(draft.duration || '') + '">' +
            '<div class="formula-help">' + esc(App.t('stDurationHint')) + '</div>' +
          '</div>' +
          (!sourceSet.builtin
            ? '<div class="st-save-mode">' +
                '<div class="st-save-title">' + esc(App.t('stSaveTo')) + '</div>' +
                '<label><input type="radio" name="st-save" value="set" checked> ' + esc(App.t('stSaveHere')) + '</label>' +
                '<label><input type="radio" name="st-save" value="copy"> ' + esc(App.t('stSaveCopy')) + '</label>' +
              '</div>'
            : '') +
        '</div>' +
      '</div>';

    openModal(isNew ? App.t('stNewTitle') : App.t('stEditTitle'), body, [
      { label: App.t('cancel'), onClick: function () { openSettings('states'); return false; } },
      { label: App.t('save'), cls: 'primary', onClick: function () {
        if (!commitFx()) return false;
        if (!saveDraft()) return false;
        openSettings('states');
        return false;
      } }
    ]);
    document.getElementById('modal').classList.add('settings-modal');

    // поля
    el('st-name').addEventListener('input', function (e) { draft.name = e.target.value; });
    el('st-desc').addEventListener('input', function (e) { draft.effect = e.target.value; });
    el('st-color').addEventListener('input', function (e) {
      draft.color = e.target.value;
      colorDirty = true;
      const parts = stateColorParts(draft.color);
      draft.shade = parts.shade;
      draft.hi = parts.hi;
      el('st-color-hex').textContent = colorHex(draft.color);
      renderIcons();
      renderPreview();
    });
    el('st-tint').addEventListener('input', function (e) {
      draft.tint = e.target.value;
      if (!(draft.tintOp > 0)) draft.tintOp = 0.3;
      tintDirty = true;
      el('st-tint-hex').textContent = colorHex(draft.tint);
      renderPreview();
    });
    el('st-icons').addEventListener('click', function (e) {
      const b = e.target.closest('[data-icon]');
      if (!b) return;
      draft.icon = b.dataset.icon;
      renderIcons();
      renderPreview();
    });
    el('st-back').addEventListener('click', function () { openSettings('states'); });

    // эффекты: одна форма, без цели
    el('st-fx-add').addEventListener('click', startFxAdd);
    el('st-fx-list').addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.fxEdit !== undefined) { startFxEdit(parseInt(b.dataset.fxEdit, 10)); return; }
      if (b.dataset.fxDel !== undefined) {
        const i = parseInt(b.dataset.fxDel, 10);
        draft.effects.splice(i, 1);
        if (fxEdit === i) { fxEdit = -2; fxDraft = null; }
        else if (fxEdit > i) fxEdit--;
        renderFxList();
        return;
      }
      if (b.dataset.fDone !== undefined) { commitFx(); return; }
      if (b.dataset.fCancel !== undefined) { cancelFx(); }
    });
    el('st-fx-list').addEventListener('change', function (e) {
      const t = e.target;
      if (t.matches('[data-f-field]')) {
        const form = t.closest('.st-fx-form');
        const modeSel = form.querySelector('[data-f-mode]');
        const modes = stateModesFor(t.value);
        const prev = modeSel.value;
        modeSel.innerHTML = modes.map(function (m) {
          return '<option value="' + m + '"' + (m === prev ? ' selected' : '') + '>' + esc(fxModeText(m)) + '</option>';
        }).join('');
        if (modes.indexOf(prev) === -1) modeSel.value = modes[0];
        syncFxValue(form);
        return;
      }
      if (t.matches('[data-f-mode]')) syncFxValue(t.closest('.st-fx-form'));
    });
    el('st-fx-list').addEventListener('input', function (e) {
      const t = e.target;
      if (!t.matches('[data-f-value]') && !t.matches('[data-f-label]')) return;
      const form = t.closest('.st-fx-form');
      fxDraft = {
        mode: form.querySelector('[data-f-mode]').value,
        field: form.querySelector('[data-f-field]').value,
        value: form.querySelector('[data-f-value]').value,
        label: form.querySelector('[data-f-label]').value
      };
    });

    renderIcons();
    renderPreview();
    renderFxList();
  }

  function openSettings(startTab) {
    ensureStateEntryIds();
    const ch = activeChar();
    const lang = state.settings.language;
    const charOpts = state.characters.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === state.activeCharacterId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
    }).join('');
    const setOpts = function (kind) {
      return libSets(kind).map(function (s) {
        return '<option value="' + esc(s.id) + '"' + (s.id === charSetId(ch, kind) ? ' selected' : '') + '>' + esc(setDisplayName(s)) + '</option>';
      }).join('');
    };
    const tabs =
      '<div class="s-tabs">' +
        '<button type="button" class="s-tab active" data-tab="general">' + esc(App.t('tabGeneral')) + '</button>' +
        '<button type="button" class="s-tab" data-tab="states">' + esc(App.t('tabStates')) + '</button>' +
        '<button type="button" class="s-tab" data-tab="items">' + esc(App.t('tabItems')) + '</button>' +
        '<button type="button" class="s-tab" data-tab="data">' + esc(App.t('tabData')) + '</button>' +
      '</div>';

    const general =
      '<div class="s-panel" data-panel="general">' +
        '<div class="field"><label>' + esc(App.t('languageLabel')) + '</label>' +
        '<select id="s-lang"><option value="ru"' + (lang === 'ru' ? ' selected' : '') + '>Русский</option>' +
        '<option value="en"' + (lang === 'en' ? ' selected' : '') + '>English</option></select></div>' +
        '<div class="field check"><input id="s-anim" type="checkbox"' + (state.settings.diceAnimation !== false ? ' checked' : '') + '><label for="s-anim">' + esc(App.t('diceAnimation')) + '</label></div>' +
        '<div class="field"><label>' + esc(App.t('critValues')) + '</label>' +
          '<div class="f-row">' +
            '<span class="f-lbl">' + esc(App.t('critOk')) + '</span>' +
            '<input id="s-crit" class="f-ndice f-crit" type="text" value="' + esc(state.settings.critSuccess == null ? '20' : state.settings.critSuccess) + '" placeholder="20">' +
            '<span class="f-lbl">' + esc(App.t('critFailShort')) + '</span>' +
            '<input id="s-critfail" class="f-ndice f-crit" type="text" value="' + esc(state.settings.critFail == null ? '1' : state.settings.critFail) + '" placeholder="1">' +
          '</div>' +
          '<div class="formula-help">' + esc(App.t('critValuesHint')) + '</div></div>' +
        '<div class="field"><label>' + esc(App.t('characters')) + '</label>' +
        '<select id="s-char">' + charOpts + '</select>' +
        '<div class="f-buttons">' +
          '<button type="button" id="s-newchar">+ ' + esc(App.t('newCharacter')) + '</button>' +
          (ch ? '<button type="button" id="s-renchar">✎ ' + esc(App.t('renameCharacter')) + '</button>' : '') +
          (ch ? '<button type="button" class="danger" id="s-delchar">' + esc(App.t('deleteCharacter')) + '</button>' : '') +
        '</div></div>' +
        (ch ? '<div class="field"><label>' + esc(App.t('setStatesLabel')) + '</label><select id="s-stateset">' + setOpts('states') + '</select></div>' : '') +
        (ch ? '<div class="field"><label>' + esc(App.t('setItemsLabel')) + '</label><select id="s-itemset">' + setOpts('items') + '</select></div>' : '') +
      '</div>';

    const dataPanel =
      '<div class="s-panel hidden" data-panel="data">' +
        '<div class="field"><label>' + esc(App.t('dataTitle')) + '</label>' +
        '<div class="btn-col">' +
          '<button type="button" id="s-expchar">' + esc(App.t('exportCurrent')) + '</button>' +
          '<button type="button" id="s-impchar">' + esc(App.t('importChar')) + '</button>' +
          '<button type="button" id="s-expall">' + esc(App.t('exportAll')) + '</button>' +
          '<button type="button" id="s-impall">' + esc(App.t('importAll')) + '</button>' +
        '</div></div>' +
        '<div class="field"><button type="button" class="danger" id="s-reset">' + esc(App.t('resetData')) + '</button></div>' +
      '</div>';

    openModal(App.t('settings'), tabs + general + settingsSetPanel('states', ch) + settingsSetPanel('items', ch) + dataPanel,
      [{ label: App.t('close'), cls: 'primary' }]);
    document.getElementById('modal').classList.add('settings-modal');

    const m = document.getElementById('modal');
    m.querySelectorAll('.s-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        m.querySelectorAll('.s-tab').forEach(function (x) { x.classList.toggle('active', x === b); });
        m.querySelectorAll('.s-panel').forEach(function (p) { p.classList.toggle('hidden', p.dataset.panel !== b.dataset.tab); });
      });
    });
    // открыть сразу нужную вкладку (например, после «Заменить» набор)
    if (startTab && startTab !== 'general') {
      const tb = m.querySelector('.s-tab[data-tab="' + startTab + '"]');
      if (tb) tb.click();
    }

    document.getElementById('s-lang').addEventListener('change', function (e) { state.settings.language = e.target.value; save(); render(); });
    document.getElementById('s-anim').addEventListener('change', function (e) { state.settings.diceAnimation = e.target.checked; save(); });
    document.getElementById('s-crit').addEventListener('change', function (e) { state.settings.critSuccess = e.target.value.trim(); save(); });
    document.getElementById('s-critfail').addEventListener('change', function (e) { state.settings.critFail = e.target.value.trim(); save(); });
    document.getElementById('s-char').addEventListener('change', function (e) {
      state.activeCharacterId = e.target.value;
      save();
      render();
      // v84: пересобрать настройки, иначе вкладка «Состояния» и выбор набора
      // остаются от предыдущего персонажа до повторного открытия меню.
      openSettings('general');
    });
    const stSel = document.getElementById('s-stateset');
    if (stSel) stSel.addEventListener('change', function (e) {
      setCharSet(state.activeCharacterId, 'states', e.target.value);
      // перерисовываем настройки, иначе на вкладке «Состояния» остаётся старая плашка «Выбрано»
      openSettings('general');
    });
    const itSel = document.getElementById('s-itemset');
    if (itSel) itSel.addEventListener('change', function (e) {
      setCharSet(state.activeCharacterId, 'items', e.target.value);
      openSettings('general');
    });
    document.getElementById('s-newchar').addEventListener('click', function () {
      closeModal();
      openNewCharModal();
    });
    if (ch) document.getElementById('s-delchar').addEventListener('click', function () {
      closeModal();
      confirmDialog(App.tf('confirmDeleteChar', { name: ch.name }), deleteActiveCharacter, App.t('deleteCharacter'));
    });
    if (ch) document.getElementById('s-renchar').addEventListener('click', function () {
      closeModal();
      openRenameCharModal(ch);
    });
    document.getElementById('s-expchar').addEventListener('click', exportCharacter);
    document.getElementById('s-impchar').addEventListener('click', function () { pickFile(importCharacter); });
    document.getElementById('s-expall').addEventListener('click', exportAll);
    document.getElementById('s-impall').addEventListener('click', function () { pickFile(importAll); });
    document.getElementById('s-reset').addEventListener('click', function () {
      closeModal();
      confirmDialog(App.t('resetConfirm'), function () { localStorage.removeItem(STORAGE_KEY); location.reload(); }, App.t('settings'));
    });

    const impStates = document.getElementById('s-set-import');
    if (impStates) impStates.addEventListener('click', function () { pickFile(function (txt) { importLibrarySet('states', txt); }); });

    // наборы: раскрыть/свернуть по клику на название, «Выбрать» для листа, экспорт
    m.querySelectorAll('.set-head').forEach(function (h) {
      h.addEventListener('click', function () {
        const card = h.closest('.set-card');
        if (card) card.classList.toggle('open');
      });
    });
    m.querySelectorAll('[data-export]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        const panel = b.closest('.s-panel');
        exportLibrarySet(panel ? panel.dataset.panel : 'states', b.dataset.export);
      });
    });
    m.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        const panel = b.closest('.s-panel');
        deleteLibrarySet(panel ? panel.dataset.panel : 'states', b.dataset.del, b);
      });
    });
    // v82: состояния правятся в любом наборе; «+» и карандаш — в шапке набора
    m.querySelectorAll('.set-row[data-edit-state]').forEach(function (row) {
      row.addEventListener('click', function () {
        openStateEditor(row.dataset.setId, row.dataset.editState);
      });
    });
    m.querySelectorAll('[data-add-state]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        openStateEditor(b.dataset.addState, null);
      });
    });
    m.querySelectorAll('[data-rename-set]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        const panel = b.closest('.s-panel');
        openRenameSetModal(panel ? panel.dataset.panel : 'states', b.dataset.renameSet);
      });
    });
    m.querySelectorAll('[data-del-state]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteStateFromSet(b.dataset.setId, b.dataset.delState, b);
      });
    });
  }

  // Привязать персонажа к набору (массив ссылок — задел на уровень 3)
  function setCharSet(charId, kind, setId) {
    const ch = state.characters.find(function (c) { return c.id === charId; });
    if (!ch || !libSetById(kind, setId)) return;
    const key = kind === 'states' ? 'stateSets' : 'itemSets';
    ch[key] = [setId];
    save();
    render();
  }

  // Всплывающий вопрос «Да / Нет» рядом с кнопкой — вместо отдельного окна
  let askAnchor = null;
  function closeInlineAsk() {
    const pop = document.getElementById('inlineAsk');
    if (pop) pop.remove();
    document.removeEventListener('pointerdown', onAskDocDown, true);
    window.removeEventListener('keydown', onAskKey, true);
    askAnchor = null;
  }
  function onAskDocDown(e) {
    const pop = document.getElementById('inlineAsk');
    if (!pop) return;
    if (pop.contains(e.target)) return;
    if (askAnchor && askAnchor.contains(e.target)) return;
    closeInlineAsk();
  }
  function onAskKey(e) {
    if (e.key === 'Escape') closeInlineAsk();
  }
  function askInline(anchor, text, onYes) {
    closeInlineAsk();
    if (!anchor) return;
    askAnchor = anchor;
    const pop = document.createElement('div');
    pop.className = 'ctxmenu inline-ask';
    pop.id = 'inlineAsk';
    pop.innerHTML = '<div class="ask-text">' + esc(text) + '</div>' +
      '<div class="ask-actions">' +
        '<button type="button" class="ask-yes" data-yes="1">' + esc(App.t('yes')) + '</button>' +
        '<button type="button" data-no="1">' + esc(App.t('no')) + '</button>' +
      '</div>';
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    let top = r.bottom + 6;
    if (top + pop.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - pop.offsetHeight - 6);
    pop.style.top = Math.round(top) + 'px';
    pop.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      e.stopPropagation();
      const yes = !!b.dataset.yes;
      closeInlineAsk();
      if (yes) onYes();
    });
    setTimeout(function () {
      document.addEventListener('pointerdown', onAskDocDown, true);
      window.addEventListener('keydown', onAskKey, true);
    }, 0);
  }

  // Удалить набор (только свой, не базовый). Ничего никуда не переносим:
  // у карточек состояния — снимки, они остаются как есть; листы падают на базовый.
  function deleteLibrarySet(kind, id, anchor) {
    const set = libSetById(kind, id);
    if (!set || set.builtin) return;
    const used = state.characters.filter(function (c) { return charSetId(c, kind) === id; }).length;
    const nm = setDisplayName(set);
    const msg = used ? App.tf('setDeleteUsed', { name: nm, n: used }) : App.tf('setDeleteConfirm', { name: nm });
    askInline(anchor, msg, function () {
      state.libraries[kind] = libSets(kind).filter(function (s) { return s.id !== id; });
      const key = kind === 'states' ? 'stateSets' : 'itemSets';
      const fallback = libSets(kind).find(function (s) { return s.builtin; }) || libSets(kind)[0];
      state.characters.forEach(function (ch) {
        if (Array.isArray(ch[key])) ch[key] = ch[key].filter(function (x) { return x !== id; });
        // явно переводим на базовый набор, а не оставляем пустой массив
        if ((!ch[key] || !ch[key].length) && fallback) ch[key] = [fallback.id];
      });
      save();
      render();
      openSettings(kind);
    });
  }

  function exportLibrarySet(kind, setId) {
    ensureStateEntryIds();
    const set = (setId ? libSetById(kind, setId) : null) || charSet(activeChar(), kind);
    if (!set) return;
    const nm = setDisplayName(set) || (kind === 'states' ? 'states' : 'items');
    download(safeName(nm) + '.json', JSON.stringify({
      app: 'custplay',
      kind: kind === 'states' ? 'states-set' : 'items-set',
      version: 1,
      set: { id: set.id, name: nm, entries: set.entries }
    }, null, 2));
    toast(App.t('exported'));
  }

  // v83: импорт умеет обновлять существующий набор, а не только добавлять копию.
  // Шаблоны обновляются, активные снимки на карточках — только кнопкой «Обновить из набора».
  function normalizeImportSet(src) {
    return {
      id: src.id || null,
      name: String(src.name || '').trim() || App.t('setImported'),
      entries: (src.entries || []).filter(function (e) {
        return e && typeof e === 'object' && e.key;
      }).map(function (e) {
        return Object.assign({}, e, {
          entryId: e.entryId || ('st-' + uid()),
          effects: Array.isArray(e.effects) ? e.effects.map(function (ef) {
            return { mode: ef.mode, field: effectField(ef), value: ef.value, label: ef.label || '',
                     timing: ef.mode === 'tick' ? (ef.timing || 'start') : null };
          }) : []
        });
      })
    };
  }

  function addLibrarySet(kind, srcSet, toastKey) {
    const list = libSets(kind);
    const base = srcSet.name || App.t('setImported');
    let nm = base, i = 2;
    while (list.some(function (s) { return setDisplayName(s) === nm; })) { nm = base + ' (' + i + ')'; i++; }
    mutate(function () {
      list.push({
        id: uid(), name: nm,
        entries: srcSet.entries.map(function (e) {
          return Object.assign({}, e, { effects: (e.effects || []).map(function (ef) { return Object.assign({}, ef); }) });
        })
      });
    });
    openSettings(kind);
    toast(App.t(toastKey || 'setImported'));
  }

  function mergeLibrarySet(target, srcSet) {
    const byId = {}, byKey = {};
    (target.entries || []).forEach(function (e) {
      if (e.entryId) byId[e.entryId] = e;
      if (e.key) byKey[e.key] = e;
    });
    srcSet.entries.forEach(function (se) {
      let te = (se.entryId && byId[se.entryId]) || (se.key && byKey[se.key]) || null;
      if (!te) {
        te = {};
        (target.entries || (target.entries = [])).push(te);
      }
      const keepId = te.entryId;
      const keepKey = te.key;
      // имя/описание: если в импорте литерал — убираем старый nameKey/descKey,
      // иначе старое имя перебило бы новое.
      if (se.nameKey) { te.nameKey = se.nameKey; delete te.name; }
      else { te.name = se.name || ''; delete te.nameKey; }
      if (se.descKey) { te.descKey = se.descKey; delete te.effect; }
      else { te.effect = se.effect || ''; delete te.descKey; }
      Object.assign(te, se);
      te.entryId = keepId || se.entryId || ('st-' + uid());
      te.key = keepKey || se.key;
      te.effects = (se.effects || []).map(function (ef) {
        return { mode: ef.mode, field: effectField(ef), value: ef.value, label: ef.label || '',
                 timing: ef.mode === 'tick' ? (ef.timing || 'start') : null };
      });
      byId[te.entryId] = te;
      if (te.key) byKey[te.key] = te;
    });
  }

  function applyLibraryUpdate(kind, target, srcSet) {
    if (target.builtin) { addLibrarySet(kind, srcSet, 'setBaseCopy'); return; }
    mutate(function () { mergeLibrarySet(target, srcSet); });
    openSettings(kind);
    toast(App.t('setUpdated'));
  }

  function askImportTarget(kind, target, srcSet) {
    if (target.builtin) { addLibrarySet(kind, srcSet, 'setBaseCopy'); return; }
    openModal(App.t('setImportTitle'),
      '<p class="confirm-text">' + esc(App.tf('setImportExists', { name: setDisplayName(target) })) + '</p>',
      [
        { label: App.t('cancel'), onClick: function () { openSettings(kind); return false; } },
        { label: App.t('setImportCopy'), onClick: function () { addLibrarySet(kind, srcSet); return false; } },
        { label: App.t('setImportUpdate'), cls: 'primary', onClick: function () { applyLibraryUpdate(kind, target, srcSet); return false; } }
      ]);
    document.getElementById('modal').classList.add('settings-modal');
  }

  function importLibrarySet(kind, json) {
    let data = null;
    try { data = JSON.parse(json); } catch (e) { data = null; }
    const src = data && data.set && Array.isArray(data.set.entries) ? data.set : null;
    if (!src) { toast(App.t('setImportError')); return; }
    const srcSet = normalizeImportSet(src);
    const byId = srcSet.id ? libSetById(kind, srcSet.id) : null;
    if (byId && byId.builtin) { addLibrarySet(kind, srcSet, 'setBaseCopy'); return; }
    if (byId) { applyLibraryUpdate(kind, byId, srcSet); return; }
    const sameName = libSets(kind).find(function (s) { return setDisplayName(s) === srcSet.name; });
    if (sameName && sameName.builtin) { addLibrarySet(kind, srcSet, 'setBaseCopy'); return; }
    if (sameName) { askImportTarget(kind, sameName, srcSet); return; }
    addLibrarySet(kind, srcSet);
  }

  // v18.2: переименование персонажа из настроек (кнопка «✎ Переименовать»);
  // пустое имя или без изменений — молча закрываем, иначе mutate (работает Ctrl+Z) + тост
  function openRenameCharModal(ch) {
    openModal(App.t('renameCharacter'),
      '<div class="field"><label>' + esc(App.t('charName')) + '</label><input id="charNameInput" type="text" value="' + esc(ch.name) + '"></div>',
      [
        { label: App.t('cancel') },
        { label: App.t('save'), cls: 'primary', onClick: function () {
            const inp = document.getElementById('charNameInput');
            const name = inp.value.trim();
            if (!name || name === ch.name) { closeModal(); return; }
            mutate(function () { ch.name = name; });
            toast(App.t('charRenamed'));
          } }
      ]
    );
    const inp = document.getElementById('charNameInput');
    if (inp) { inp.focus(); inp.select(); }
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
  // временные поля (_new) не сохраняются в файл
  function stripTransient(ch) {
    const copy = JSON.parse(JSON.stringify(ch));
    copy.cards.forEach(function (c) { delete c._new; });
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
    const copy = normalizeImport(src);
    let nm = copy.name || App.t('newCharName');
    let i = 2, base = nm;
    while (state.characters.some(function (c) { return c.name === nm; })) { nm = base + ' (' + i + ')'; i++; }
    copy.name = nm;
    renewIds(copy.cards, {});
    layoutCharacter(copy);
    mutate(function () { state.characters.push(copy); state.activeCharacterId = copy.id; });
    toast(App.t('imported'));
  }
  function importAll(json) {
    const data = JSON.parse(json);
    if (!data || !Array.isArray(data.characters)) throw new Error('bad');
    // сначала ВСЁ приводим в норму и только потом переключаем состояние: кривой файл не испортит игру
    const fresh = data.characters.map(function (c2) {
      const ch = normalizeImport(c2);
      renewIds(ch.cards, {});
      return ch;
    });
    mutate(function () {
      state.characters = fresh;
      fresh.forEach(layoutCharacter);
      if (data.settings && typeof data.settings === 'object') state.settings = Object.assign(state.settings, data.settings);
      state.activeCharacterId = fresh.length ? fresh[0].id : null;
    });
    toast(App.t('imported'));
  }
  function exportAll() {
    download('custplay-backup.json', JSON.stringify({ app: 'custplay', kind: 'backup', version: 1, characters: state.characters.map(stripTransient), settings: state.settings }, null, 2));
    toast(App.t('exported'));
  }

  // проверка и нормализация импортируемого персонажа: старые типы (stat → навык,
  // perk → заклинание, formula → навык), незнакомые карточки отбрасываем, битые поля подставляем.
  // Кидает ошибку для кривого файла.
  function normalizeImport(src) {
    if (!src || typeof src !== 'object' || !Array.isArray(src.cards)) throw new Error('bad');
    const ch = { id: uid(), name: String(src.name || App.t('newCharName')), pages: [], cards: [] };
    if (Array.isArray(src.pages)) {
      src.pages.forEach(function (p) {
        if (p && typeof p === 'object' && typeof p.id === 'string') {
          ch.pages.push({ id: p.id, name: String(p.name || App.t('pageBase')) });
        }
      });
    }
    src.cards.forEach(function (card) {
      if (!card || typeof card !== 'object') return;
      let type = card.type === 'stat' ? 'skill' : card.type === 'perk' ? 'spell' : card.type === 'formula' ? 'skill' : card.type;
      if (CARD_TYPES.indexOf(type) === -1) return;   // незнакомый тип — не импортируем
      const c = JSON.parse(JSON.stringify(card));
      c.type = type;
      // v26: «Формула» → «Навык» — выражение переезжает в значение
      if (card.type === 'formula') {
        c.value = (c.expression && String(c.expression).trim() !== '') ? c.expression : null;
        delete c.expression;
      }
      c.name = String(c.name || App.t('newCharName'));
      if (!c.id || typeof c.id !== 'string') c.id = uid();
      if (c.charges && typeof c.charges === 'object') {
        c.charges.mode = (c.charges.mode === 'link') ? 'link' : 'own';
      } else if (type === 'spell') {
        c.charges = { mode: 'own', current: 0, max: 0, linkId: null, cost: 1, emptyMode: 'block' };
      }
      ch.cards.push(c);
    });
    return ch;
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

  // всплывающая подсказка значка «(!)» у навыков с выражением в значении (бывшие формулы)
  // и «🔗» у привязанных заклинаний:
  // клик — показать плашку ВНУТРИ карточки на уровне шапки, клик в другом месте — спрятать
  function initFormulaInfo() {
    const closeAll = function () {
      const old = document.getElementById('finfPop');
      if (old) old.remove();
      document.querySelectorAll('.card.finf-open').forEach(function (c) { c.classList.remove('finf-open'); });
    };
    document.addEventListener('click', function (e) {
      const finf = e.target.closest ? e.target.closest('.finf') : null;
      const linktag = e.target.closest ? e.target.closest('.linktag') : null;
      const old = document.getElementById('finfPop');
      if (!finf && !linktag) { if (old) old.remove(); closeAll(); return; }
      closeAll();
      const cardEl = (finf || linktag).closest('.card');
      const card = cardEl ? findCard(cardEl.dataset.id) : null;
      if (!card) return;
      const pop = document.createElement('div');
      pop.id = 'finfPop';
      pop.className = 'finf-pop';
      if (finf) {
        // v26: «(!)» теперь у навыков со строковым выражением в значении (бывшие формулы)
        let val = null;
        try { val = skillValueNum(card); } catch (e) { val = null; }
        pop.textContent = card.value + (val == null ? '' : ' = ' + fmt(val));
      } else if (linktag && card.charges && card.charges.mode === 'link') {
        const tgt = findCard(card.charges.linkId);
        const name = tgt ? tgt.name : App.t('brokenRef');
        pop.textContent = App.tf('linkDependsOn', { name: name, cost: card.charges.cost || 1 });
      }
      cardEl.appendChild(pop);
      cardEl.classList.add('finf-open');   // разрешаем карточке «выпустить» плашку
      e.stopPropagation();
    }, true);
  }

  // ===== Init =====
  // ===== Перестановка карточек на телефоне (v48) =====
  // Долгий тап (300 мс) по карточке в правке «поднимает» её: ведём пальцем —
  // карточка меняется местами с соседями в сетке, отпустили — порядок сохраняется.
  // До подъёма прокрутка не блокируется: сдвинул палец раньше таймера — это скролл.
  let colDrag = null;
  let colDragSuppressClick = false;
  function beginColumnDrag(el, x, y) {
    const rect = el.getBoundingClientRect();
    colDrag = { el: el, id: el.dataset.id };
    colDragSuppressClick = true;
    el.classList.add('col-drag');
    document.body.classList.add('col-dragging');
    if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
  }
  function moveColumnDrag(y) {
    if (!colDrag) return;
    const H = window.innerHeight;
    if (y < 90) window.scrollBy(0, -14);          // автопрокрутка у краёв
    else if (y > H - 90) window.scrollBy(0, 14);
    const canvas = document.getElementById('canvas');
    const el = colDrag.el;
    const others = Array.prototype.slice.call(canvas.querySelectorAll('.card')).filter(function (c) { return c !== el; });
    let before = null;
    for (let i = 0; i < others.length; i++) {
      const r = others[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { before = others[i]; break; }
    }
    if (before) {
      if (el.nextElementSibling !== before) canvas.insertBefore(el, before);
    } else if (canvas.lastElementChild !== el) {
      canvas.appendChild(el);
    }
  }
  function finishColumnDrag(apply) {
    const el = colDrag.el;
    el.classList.remove('col-drag');
    document.body.classList.remove('col-dragging');
    colDrag = null;
    const ch = activeChar();
    if (!apply || !ch) { render(); return; }
    const canvas = document.getElementById('canvas');
    const domIds = Array.prototype.map.call(canvas.querySelectorAll('.card'), function (c) { return c.dataset.id; });
    const byId = {};
    ch.cards.forEach(function (c) { byId[c.id] = c; });
    const onPage = new Set(domIds);
    let k = 0;
    const next = ch.cards.map(function (c) { return onPage.has(c.id) ? byId[domIds[k++]] : c; });
    const changed = next.some(function (c, i) { return c !== ch.cards[i]; });
    if (changed) mutate(function () { ch.cards = next; });
    else render();
  }
  function initColumnDrag() {
    const canvas = document.getElementById('canvas');
    // подавляем «долгий тап → контекстное меню» и клик после перетаскивания
    canvas.addEventListener('contextmenu', function (e) { if (colDrag) e.preventDefault(); });
    document.addEventListener('click', function (e) {
      if (!colDragSuppressClick) return;
      colDragSuppressClick = false;
      e.stopPropagation();
      e.preventDefault();
    }, true);
    canvas.addEventListener('pointerdown', function (e) {
      if (isDesktop() || !editMode) return;
      if (e.pointerType === 'mouse') return;
      const el = e.target.closest ? e.target.closest('.card') : null;
      if (!el) return;
      if (e.target.closest('button, input, textarea')) return;
      const startX = e.clientX, startY = e.clientY;
      let lifted = false, done = false, timer = null;
      const blockScroll = function (ev) { if (lifted) ev.preventDefault(); };
      const cleanup = function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        canvas.removeEventListener('touchmove', blockScroll);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
      };
      const onMove = function (ev) {
        if (!lifted) {
          if (Math.abs(ev.clientX - startX) > 10 || Math.abs(ev.clientY - startY) > 10) cleanup();
          return;
        }
        moveColumnDrag(ev.clientY);
      };
      const onUp = function () {
        const wasLifted = lifted;
        cleanup();
        if (wasLifted) finishColumnDrag(true);
      };
      const onCancel = function () {
        const wasLifted = lifted;
        cleanup();
        if (wasLifted) finishColumnDrag(false);
      };
      canvas.addEventListener('touchmove', blockScroll, { passive: false });
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onCancel);
      timer = setTimeout(function () {
        if (done) return;
        lifted = true;
        beginColumnDrag(el);
      }, 300);
    });
  }

  function init() {
    ensureLibraries();
    migrateCondEntryIds();
    if (!state.characters.length) {
      newCharacter();   // стартовый персонаж с демо-карточками — тот же путь, что и «Новый персонаж»
      save();
    }
    state.characters.forEach(layoutCharacter);
    initFreePlacement();
    initColumnDrag();
    initFormulaInfo();
    addUndoKeys();
    render();
    document.getElementById('fab').addEventListener('click', openAddMenu);
    document.getElementById('backdrop').addEventListener('click', closeModal);
    // слой ярлыка: клик/тап мимо панели закрывает (креста нет — решение юзера)
    const labelLayer = document.getElementById('labelLayer');
    labelLayer.addEventListener('click', function (e) { if (e.target === labelLayer) closeLabelLayer(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        // v40: Esc ещё и сбрасывает шаг счётчика
        clearCounterSteps();
        // редактор — ТРЕТИЙ слой ПОВЕРХ слоя ярлыка: Esc сначала закрывает модалку,
        // иначе открытие редактора из слоя «съедало» бы слой первым Esc
        if (!document.getElementById('modal').classList.contains('hidden')) closeModal();
        else if (!document.getElementById('labelLayer').classList.contains('hidden')) closeLabelLayer();
        else document.getElementById('diceWidget').classList.add('hidden');
      }
    });
    // v40: шаг счётчика — временное значение, сбрасываем кликом мимо карточки
    document.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('.card')) return;
      clearCounterSteps();
    }, true);
    initDwDrag();
    // v20c: на мобильном журнал «История» закрывается тапом мимо окна (pointerdown capture на document).
    // Исключения: само окно #log, кнопки открытия #logBtn/#topMenuBtn и кебаб-меню #topMenu —
    // иначе тап по пункту «История» в кебабе закрывал журнал ДО клика и не давал его переключить
    document.addEventListener('pointerdown', function (e) {
      if (isDesktop()) return;
      const log = document.getElementById('log');
      if (!log || log.classList.contains('hidden')) return;
      const t = e.target;
      if (!t || !t.closest) return;
      if (log.contains(t)) return;
      if (t.closest('#logBtn') || t.closest('#topMenuBtn') || t.closest('#topMenu')) return;
      log.classList.add('hidden');
    }, true);
    let lastDesktop = isDesktop();   // v19: для пересечения брейкпоинта при смене ориентации
    window.addEventListener('resize', function () {
      const d = isDesktop();
      // v19: перерисовываем на десктопе ИЛИ при пересечении брейкпоинта 721px в любую сторону —
      // иначе после поворота телефона в портрет шапка остаётся ПК-версией до reload
      if ((d || d !== lastDesktop) && !dragState) render();
      lastDesktop = d;
      const w = document.getElementById('diceWidget');
      if (w && !w.classList.contains('hidden')) applyDwPos(loadDwPos());
    });
  }

  init();
})();
