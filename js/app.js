window.App = window.App || {};

(function () {
  'use strict';

  // ===== Constants =====
  const STORAGE_KEY = 'custplay-v1';
  const LEGACY_KEY = 'dnd-tracker-v1';
  // v94: паки предметов живут отдельно от состояния персонажа, чтобы save()/undo
  // не таскали каталог на каждый тап по счётчику.
  const PACKS_KEY = 'custplay-packs';
  const CARD_TYPES = ['counter', 'skill', 'spell', 'currency', 'inventory', 'note', 'initiative', 'condition', 'buff'];
  // v22: типы, которые можно использовать в формулах — без валюты/инвентаря/заметок
  const FORMULA_REF_TYPES = ['counter', 'skill', 'spell'];
  // Свертывание в ярлык (v29, со стенда «текущее свертывание И, З, В»): только типы
  // с готовой иконкой; иконки в icons/labels/. Счётчик/навык/заклинание — позже.
  const FOLDABLE_ICONS = { currency: 'кошель', inventory: 'сундук', note: 'книга' };
  // v94: категории предметов. Поведение задаёт категория, а не отдельная галочка:
  // consumable всегда тратится при использовании; equipment можно надеть.
  const ITEM_CATEGORIES = [
    { id: 'equipment', labelKey: 'catEquipment' },
    { id: 'consumable', labelKey: 'catConsumable' },
    { id: 'misc', labelKey: 'catMisc' }
  ];
  // v96: базовые иконки по 5 на категорию. Храним id, а не глиф, чтобы позже
  // заменить emoji на SVG без миграции данных.
  // v116: щит предмета — инлайн-SVG, чтобы не путать с эмодзи щита механики (🛡).
  const ITEM_SHIELD_SVG = '<svg class="item-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8 19 5.6v5.9c0 4.7-3.1 8.2-7 9.7-3.9-1.5-7-5-7-9.7V5.6z"/><path d="M12 7.2v7.2"/><path d="M8.9 10.4h6.2"/></svg>';
  const ITEM_ICONS = {
    equipment: [
      { id: 'sword', ch: '⚔' }, { id: 'shield', ch: ITEM_SHIELD_SVG }, { id: 'bow', ch: '🏹' },
      { id: 'hammer', ch: '🔨' }, { id: 'ring', ch: '💍' }
    ],
    consumable: [
      { id: 'potion', ch: '🧪' }, { id: 'food', ch: '🍖' }, { id: 'bomb', ch: '💣' },
      { id: 'scroll', ch: '📜' }, { id: 'drink', ch: '🍷' }
    ],
    misc: [
      { id: 'key', ch: '🔑' }, { id: 'gem', ch: '💎' }, { id: 'coin', ch: '🪙' },
      { id: 'box', ch: '📦' }, { id: 'compass', ch: '🧭' }
    ]
  };
  function itemIconsFor(cat) { return ITEM_ICONS[cat] || ITEM_ICONS.misc; }
  function itemIconId(icon, cat) {
    const list = itemIconsFor(cat);
    return list.some(function (i) { return i.id === icon; }) ? icon : list[0].id;
  }
  function itemIconChar(icon, cat) {
    const id = itemIconId(icon, cat);
    return (itemIconsFor(cat).find(function (i) { return i.id === id; }) || { ch: '•' }).ch;
  }
  const LABEL_W = 143, LABEL_H = 120;   // ярлык (v58: по высоте равен счётчику — компоновка сходится)
  // Иконка «мусорка» для ВСЕХ кнопок «Удалить» (вместо крестика ✕): инлайн-SVG
  // в currentColor — красится как текст кнопки, как остальные глифы тулз
  const TRASH_SVG = '<svg class="trash-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>';
  // v158: ⧉ есть не в каждом шрифте на телефоне — дублирование рисуем SVG,
  // иначе кнопка выглядит пустой.
  const DUP_SVG = '<svg class="dup-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
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
    return ({ counter: 'Здоровье', skill: 'Акробатика', spell: 'Огненный шар', currency: 'Деньги', inventory: 'Снаряжение', note: 'Заметка', buff: 'Ярость' })[type] || '';
  }

  // ===== State =====
  function defaultState() {
    return {
      version: 1,
      // v107: схема данных. Поднимаем, когда меняем смысл полей, чтобы импорт
      // старых файлов мог отличить их и мигрировать.
      schemaVersion: 4,
      activeCharacterId: null,
      characters: [],
      settings: { language: 'ru', critSuccess: '20', critFail: '1', fillMaxCurrent: false },
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
        if (typeof s.schemaVersion === 'number') st.schemaVersion = s.schemaVersion;
        if (s.settings && typeof s.settings === 'object') st.settings = Object.assign(st.settings, s.settings);
        // v71: наборы состояний/вещей (библиотеки на устройстве)
        if (s.libraries && typeof s.libraries === 'object') {
          if (Array.isArray(s.libraries.states)) st.libraries.states = s.libraries.states.filter(function (x) { return x && typeof x === 'object' && Array.isArray(x.entries); });
          if (Array.isArray(s.libraries.items)) st.libraries.items = s.libraries.items.filter(function (x) { return x && typeof x === 'object' && Array.isArray(x.entries); });
        }
        if (Array.isArray(s.log)) st.log = s.log.filter(function (e) { return e && typeof e.text === 'string'; });
      }
      // v111: цель разового эффекта переехала из строки инвентаря в сам эффект
      if ((st.schemaVersion || 0) < 3) {
        migrateItemTargets(st);
        st.schemaVersion = 3;
      }
      // v115: «сверх максимума» становится явным щитом
      if ((st.schemaVersion || 0) < 4) {
        migrateShields(st);
        st.schemaVersion = 4;
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
  let editScratch = { units: null, editCard: null };
  // v106: что удалить, если редактор только что созданной сущности закрыли
  // «Отменой», Esc или тапом мимо. Иначе пустая карточка/предмет остаются.
  let pendingNewCardId = null;
  let pendingNewItem = null;

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
  // skipUndo — для сохранения только что созданной сущности: шаг отката уже
  // сделан при создании, второй шаг заставлял бы нажимать Ctrl+Z дважды.
  function mutate(fn, skipUndo) {
    if (!skipUndo) pushUndo();
    fn();
    commit();
  }

  // v146: настройка «Добавлять текущее при повышении максимума».
  // Снимаем максимумы ДО действия и ПОСЛЕ и сдвигаем текущее на разницу.
  // Так эффекты (состояния/баффы/предметы) дают сразу рабочее значение,
  // а ручная правка максимума в редакторе идёт обычным mutate и текущее не трогает.
  function maxSnapshot() {
    const ch = activeChar();
    if (!ch) return null;
    const map = {};
    ch.cards.forEach(function (c) {
      if (c.type === 'counter') map[c.id] = counterMaxNum(c);
    });
    return map;
  }
  function applyMaxDeltas(before) {
    if (!state.settings.fillMaxCurrent || !before) return;
    const ch = activeChar();
    if (!ch) return;
    ch.cards.forEach(function (c) {
      if (c.type !== 'counter' || !(c.id in before)) return;
      const old = before[c.id];
      const after = counterMaxNum(c);
      if (old == null || after == null || after === old) return;
      let v = num(c.current) + (after - old);
      if (after > 0) v = Math.min(v, after);
      c.current = Math.max(0, v);
    });
  }
  function mutateWithMaxFill(fn, skipUndo) {
    if (!state.settings.fillMaxCurrent) { mutate(fn, skipUndo); return; }
    const before = maxSnapshot();
    if (!skipUndo) pushUndo();
    fn();
    invalidateMods();   // после снятия/включения эффектов максимум считается заново
    applyMaxDeltas(before);
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
            toast(App.tf('renamedGeneric', { name: nm }));
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
      askDelete({ text: App.tf('confirmDeletePage', { name: page.name }), onYes: function () { doDeletePage(pageId, null); }, title: App.t('deletePage') });
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
      // v126: кебаб доступен с клавиатуры — Tab до него и Enter/пробел открывают меню
      const kebab = editMode ? '<span class="pt-kebab" role="button" tabindex="0" data-page="' + p.id + '" title="' + esc(App.t('pageMenu')) + '" aria-label="' + esc(App.t('pageMenu')) + '">⋮</span>' : '';
      return '<button class="ptab' + (p.id === ch.lastPage ? ' active' : '') + '" data-page="' + p.id + '">' + esc(p.name) + kebab + '</button>';
    }).join('');
    // «+» — только в правке (старые кнопки ✎/✕ заменил кебаб ⋮ у каждой вкладки)
    const ctrl = editMode ? '<span class="pt-ctrl"><button class="icon" id="pt-add" title="' + esc(App.t('addPage')) + '">+</button></span>' : '';
    bar.innerHTML = tabs + ctrl;
    bar.querySelectorAll('.ptab').forEach(function (b) {
      const k = b.querySelector('.pt-kebab');
      if (k) {
        k.addEventListener('click', function (e) { e.stopPropagation(); openPageMenu(b.dataset.page, k); });
        k.addEventListener('keydown', function (e) {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          e.stopPropagation();
          openPageMenu(b.dataset.page, k);
        });
      }
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
  // ===== v126: одно поведение у всех всплывающих меню =====
  // Esc, клик мимо, прокрутка вне меню, переворот у края, перепозиция при ресайзе,
  // роли menu/menuitem и возврат фокуса на якорь.
  let mountedMenu = null;
  function closeMountedMenu(refocus) {
    if (!mountedMenu) return;
    const m = mountedMenu;
    mountedMenu = null;
    m.el.remove();
    document.removeEventListener('pointerdown', onMountedMenuDown, true);
    window.removeEventListener('keydown', onMountedMenuKey, true);
    window.removeEventListener('resize', onMountedMenuResize);
    window.removeEventListener('scroll', onMountedMenuScroll, true);
    if (m.onClose) m.onClose();
    if (refocus && m.anchor && m.anchor.isConnected) {
      try { m.anchor.focus({ preventScroll: true }); } catch (e) { m.anchor.focus(); }
    }
  }
  function closeMenuById(id) {
    if (mountedMenu && mountedMenu.el.id === id) {
      // если фокус был внутри меню (выбор мышью или Enter), вернём его на якорь:
      // следующее окно тогда запомнит нормальную точку возврата
      closeMountedMenu(mountedMenu.el.contains(document.activeElement));
    }
  }
  function onMountedMenuDown(e) {
    if (!mountedMenu) return;
    if (mountedMenu.el.contains(e.target)) return;
    if (mountedMenu.anchor && mountedMenu.anchor.contains(e.target)) return;
    closeMountedMenu(false);
  }
  function onMountedMenuKey(e) {
    if (!mountedMenu) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      closeMountedMenu(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    const items = Array.from(mountedMenu.el.querySelectorAll('button:not([disabled]), input, [tabindex="0"]'))
      .filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    let next = 0;
    if (e.key === 'End') next = items.length - 1;
    else if (e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = i <= 0 ? items.length - 1 : i - 1;
    items[next].focus();
  }
  function onMountedMenuScroll(e) {
    if (!mountedMenu) return;
    if (mountedMenu.el.contains(e.target)) return;
    closeMountedMenu(false);
  }
  function onMountedMenuResize() { if (mountedMenu) placeMountedMenu(); }
  function placeMountedMenu() {
    if (!mountedMenu) return;
    const m = mountedMenu;
    const r = m.anchor.getBoundingClientRect();
    const mw = m.el.offsetWidth, mh = m.el.offsetHeight;
    let left = m.align === 'right' ? r.right - mw : r.left;
    if (m.side === 'left') left = r.left - mw - 6;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    let top = r.bottom + 6;
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    top = Math.max(8, Math.min(top, window.innerHeight - mh - 8));
    m.el.style.left = Math.round(left) + 'px';
    m.el.style.top = Math.round(top) + 'px';
  }
  function mountMenu(el, anchor, opts) {
    opts = opts || {};
    if (opts.toggle && mountedMenu && mountedMenu.anchor === anchor) {
      closeMountedMenu(false);
      return null;
    }
    closeMountedMenu(false);
    el.setAttribute('role', 'menu');
    el.querySelectorAll('button').forEach(function (b) { b.setAttribute('role', 'menuitem'); });
    document.body.appendChild(el);
    mountedMenu = { el: el, anchor: anchor, align: opts.align || 'left', side: opts.side || '', onClose: opts.onClose || null };
    placeMountedMenu();
    document.addEventListener('pointerdown', onMountedMenuDown, true);
    window.addEventListener('keydown', onMountedMenuKey, true);
    window.addEventListener('resize', onMountedMenuResize);
    window.addEventListener('scroll', onMountedMenuScroll, true);
    if (opts.focus !== false) {
      const first = el.querySelector('button:not([disabled]), input, [tabindex="0"]');
      if (first) {
        try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); }
      }
    }
    return el;
  }

  // контекстное меню страницы (⋮): переименовать / удалить. Закрывается кликом мимо, Esc и по resize
  function closePageMenu() { closeMenuById('pageMenu'); }
  function openPageMenu(pageId, kebab) {
    closePageMenu();
    const ch = activeChar();
    if (!ch) return;
    const menu = document.createElement('div');
    menu.className = 'ctxmenu';
    menu.id = 'pageMenu';
    const canDel = ch.pages.length > 1;
    menu.innerHTML =
      '<button type="button" data-act="rename">✎ ' + esc(App.t('renamePage')) + '</button>' +
      '<button type="button" data-act="del"' + (canDel ? '' : ' disabled') + '>' + TRASH_SVG + ' ' + esc(App.t('deletePage')) + '</button>';
    menu.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      closePageMenu();
      if (b.dataset.act === 'rename') openPageRename(pageId);
      else if (b.dataset.act === 'del') deletePage(pageId);
    });
    mountMenu(menu, kebab);
  }
  // v19: кебаб-меню мобильной шапки (⋮): Отдых / История / Назад / Вперед.
  // Генеричное .ctxmenu, прижат вправо под кнопкой; закрытие — клик мимо (pointerdown capture) и resize
  function closeTopMenu() { closeMenuById('topMenu'); }
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
    menu.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      closeTopMenu();
      if (b.dataset.act === 'rest') confirmRest();
      else if (b.dataset.act === 'log') toggleLog();
      else if (b.dataset.act === 'undo') undo();
      else if (b.dataset.act === 'redo') redo();
    });
    mountMenu(menu, btn, { align: 'right' });
  }

  // Кебаб карточки (v40): у компактного счётчика вместо трёх кнопок ✎⧉🗑 — одно меню.
  // Разметка и поведение те же, что у верхнего меню (.ctxmenu).
  function closeCardMenu() { closeMenuById('cardMenu'); }
  function openCardMenu(cardId, anchor) {
    closeCardMenu();
    const card = findCard(cardId);
    if (!card || !anchor) return;
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
    html += (card.type === 'inventory' ? '' : '<button type="button" data-m="edit">✎ ' + esc(App.t('edit')) + '</button>') +
            '<button type="button" data-m="dup">⧉ ' + esc(App.t('duplicate')) + '</button>' +
            '<button type="button" data-m="del">' + TRASH_SVG + ' ' + esc(App.t('delete')) + '</button>';
    menu.innerHTML = html;
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
    mountMenu(menu, anchor, { align: 'right' });
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
      case 'inventory': return { items: [], showWeight: true, itemTargets: {} };
      case 'note': return { text: '' };
      // v59: инициатива — строки участников, две фазы (подготовка/бой)
      case 'initiative': return {
        rows: [], phase: 'prep', round: 1, turnId: null,
        die: 20, newMode: 'roll', mini: false, hFull: 0
      };
      // v65: состояние — кукла-вуду + список активных состояний (снимки)
      case 'condition': return { conditions: [] };
      // v91: бафф — самостоятельная карточка-тумблер; эффекты с целями живут на листе
      case 'buff': return { on: false, effects: [], description: '', color: '#d4a93c' };
    }
    return {};
  }

  function createCard(type, name, extra) {
    const card = Object.assign({ id: uid(), type: type, name: name }, defaultsFor(type), extra || {});
    // v142: у заметки сразу есть первая страница, иначе card.text остался бы без листа
    if (type === 'note') ensureNotePages(card);
    return card;
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
      // v91: бафф — 120 для короткого и 200 для чипов с описанием
      case 'buff': return { w: 300, h: 120 };
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
      h = Math.max(h, 88 + n * 38);             // шапка, верхняя строка, строки, итог
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
    // v91: бафф — два двухстрочных чипа в ряд; ниже 120 описание уже не влезает
    if (type === 'buff') { w = 220; h = 120; }
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
      // v96: строки инвентаря получили пакетные поля; старые снимки приводим к модели
      if (card.type === 'inventory') {
        card.items = (card.items || []).map(normalizeInventoryRow);
        if (!card.itemTargets || typeof card.itemTargets !== 'object') card.itemTargets = {};
      }
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
  const MOD_ORDER = { add: 1, mul: 2, div: 3, set: 4, cap: 5 };
  // какие числа можно менять у каждого типа карточки (для формы «на что влияет»)
  const MOD_FIELDS = {
    counter: ['max'],
    skill: ['bonus', 'value'],
    spell: ['bonus', 'charges']
  };
  // v107: все режимы эффекта в одном месте. MOD_ORDER — только «математика»,
  // остальные режимы читают другие потребители (block/tick/adv…).
  const EFFECT_MODES = { add: 1, mul: 2, div: 3, set: 4, cap: 5, dice: 1, block: 1, tick: 1, adv: 1, dis: 1 };
  const EFFECT_FIELDS = MOD_FIELDS;

  // v107: единая нормализация эффекта. Сохраняет timing/duration/target и любые
  // незнакомые поля: старым снимкам и будущим режимам нельзя терять данные.
  function normalizeEffect(raw, defaults) {
    const e = raw && typeof raw === 'object' ? raw : {};
    const d = defaults || {};
    const ef = {};
    ef.mode = EFFECT_MODES[e.mode] ? e.mode : (EFFECT_MODES[d.mode] ? d.mode : 'add');
    ef.field = e.field != null ? String(e.field) : (d.field != null ? String(d.field) : 'bonus');
    ef.value = e.value == null ? (d.value == null ? '' : String(d.value)) : String(e.value);
    ef.label = String(e.label == null ? (d.label || '') : e.label);
    ef.target = e.target != null ? String(e.target) : (d.target != null ? String(d.target) : null);
    if (e.timing != null) ef.timing = String(e.timing);
    if (e.duration != null) ef.duration = e.duration;
    Object.keys(e).forEach(function (k) { if (!(k in ef)) ef[k] = e[k]; });
    return ef;
  }

  // v107: реестр источников эффектов. Хранилища остаются разными (бафф, снимок,
  // строка инвентаря, временный эффект), но потребители видят один список.
  function collectEffects(ch) {
    const out = [];
    if (!ch) return out;
    (ch.cards || []).forEach(function (card) {
      if (card.type === 'buff') {
        if (!card.on) return;
        (card.effects || []).forEach(function (ef) {
          out.push({ ef: ef, kind: 'buff', srcId: card.id, name: card.name || '', color: card.color || '', card: card });
        });
        return;
      }
      if (card.type === 'condition') {
        (card.conditions || []).forEach(function (s) {
          (s.effects || []).forEach(function (ef) {
            out.push({ ef: ef, kind: 'condition', srcId: card.id, name: s.name || '', color: s.color || '', card: card, snap: s });
          });
        });
        return;
      }
      if (card.type === 'inventory') {
        // снаряжение работает только когда надето; истинная форма подставляется
        (card.items || []).forEach(function (row) {
          if (!row.equipped) return;
          const e = effectiveInventoryRow(row);
          (e.effects || []).forEach(function (ef) {
            out.push({ ef: ef, kind: 'equipment', srcId: card.id + ':' + row.id, name: e.name || '', color: '', card: card, row: row });
          });
        });
        // v124: активные эффекты предметов (тики, временные, adv/dis)
        (card.itemActive || []).forEach(function (a) {
          if (!a || !a.ef) return;
          out.push({ ef: a.ef, kind: 'itemActive', srcId: card.id + ':' + a.id, name: a.name || '', color: '', card: card, active: a });
        });
      }
    });
    return out;
  }

  // v110: какие карточки листа могут принять эффект этого поля.
  // 'current' — разовое применение к счётчику, а не модификатор: цель такого
  // эффекта выбирается при использовании, в «цель эффекта» она не идёт.
  function effectTargetCards(field) {
    const ch = activeChar();
    if (!ch) return [];
    return (ch.cards || []).filter(function (c) {
      if (field === 'current' || field === 'shield') return c.type === 'counter';
      return (MOD_FIELDS[c.type] || []).indexOf(field) !== -1;
    });
  }

  // v111: эффект готов сработать: живая цель и значение (запрету и
  // преимуществу/помехе значение не нужно).
  function effectReady(ef) {
    if (!ef || !ef.target || !findCard(ef.target)) return false;
    const flag = ef.mode === 'block' || ef.mode === 'adv' || ef.mode === 'dis';
    if (!flag && String(ef.value == null ? '' : ef.value).trim() === '') return false;
    return true;
  }

  // v111: модификатор для чисел. Разовое «текущее» и щит сюда не входят:
  // это события, а не постоянные модификаторы.
  function effectWorks(ef) {
    const f = effectField(ef);
    return f !== 'current' && f !== 'shield' && effectReady(ef);
  }

  // v110: какие эффекты строки сейчас дают механику (для бейджа на карточке).
  // Разовая «текущая» механика сюда не входит: это не модификатор.
  function activeRowEffects(row) {
    const e = effectiveInventoryRow(row);
    return (e.effects || []).filter(function (ef) {
      return effectField(ef) !== 'current' && effectWorks(ef);
    });
  }

  // Индекс строится один раз за рендер: так каждая карточка не бегает по всем
  // состояниям листа (иначе O(карточки × состояния) на каждый render).
  let modIndexCache = null;
  function invalidateMods() { modIndexCache = null; }
  function modIndex() {
    if (modIndexCache) return modIndexCache;
    const byTarget = {}, blocks = {};
    collectEffects(activeChar()).forEach(function (it) {
      const ef = it.ef;
      if (!ef || !ef.target) return;              // флаг без цели на числа не влияет
      if (ef.mode === 'block') { blocks[ef.target] = ef.label || it.name || ''; return; }
      (byTarget[ef.target] || (byTarget[ef.target] = [])).push({ ef: ef, source: it.name || '', color: it.color || '' });
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

  // v119: преимущество/помеха — флаги на бонус. Источники складываются:
  // преимуществ больше — adv, помех больше — dis, при равенстве обычный бросок.
  function rollAdvantage(card) {
    let adv = 0, dis = 0;
    (modIndex().byTarget[card.id] || []).forEach(function (it) {
      if (effectField(it.ef) !== 'bonus') return;
      if (it.ef.mode === 'adv') adv++;
      else if (it.ef.mode === 'dis') dis++;
    });
    return adv > dis ? 'adv' : (dis > adv ? 'dis' : '');
  }

  // v121: у adv/dis значение — сколько бросков подряд действует эффект
  // (по умолчанию 1). После броска списываем один; на нуле убираем эффект.
  // Снаряжение не расходуем: пока надето — действует всегда.
  function consumeAdvantage(card) {
    collectEffects(activeChar()).forEach(function (it) {
      const ef = it.ef;
      if (!ef || ef.target !== card.id) return;
      if (ef.mode !== 'adv' && ef.mode !== 'dis') return;
      if (effectField(ef) !== 'bonus') return;
      if (it.kind === 'equipment') return;
      const n = Math.max(1, num(ef.value) || 1);
      if (n > 1) { ef.value = String(n - 1); return; }
      if (it.kind === 'itemActive' && it.card && it.active) {
        it.card.itemActive = (it.card.itemActive || []).filter(function (a) { return a !== it.active; });
      } else if (it.kind === 'buff' && it.card) {
        it.card.effects = (it.card.effects || []).filter(function (x) { return x !== ef; });
        if (!it.card.effects.length) { it.card.on = false; clearBuffShield(it.card); }
      } else if (it.kind === 'condition' && it.snap) {
        it.snap.effects = (it.snap.effects || []).filter(function (x) { return x !== ef; });
      }
    });
  }

  // значение эффекта — выражение: «-{Уровень}», «1/3». В режиме умножения люди пишут
  // «*0.5» — звёздочку прощаем. Битая ссылка и деление на ноль → эффект пропускается.
  function modNumber(card, expr, mode) {
    let s = String(expr == null ? '' : expr).trim();
    if (!s) return null;
    if (mode === 'mul' && /^[*×]/.test(s)) s = s.slice(1);
    if (mode === 'div' && /^[/÷]/.test(s)) s = s.slice(1);
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
      else if (ef.mode === 'div') { if (v == null || n === 0) return; v = v / n; }
      else if (ef.mode === 'set') v = n;
      else if (ef.mode === 'cap') { if (v == null) return; v = Math.min(v, n); }
    });
    return v;
  }

  // v115: щит — набор частей, чтобы временную часть можно было снять по
  // длительности, не задевая постоянную. card.shield — кэш суммы для отображения.
  function shieldPartsOf(card) {
    return card && Array.isArray(card.shieldParts) ? card.shieldParts : [];
  }
  function shieldTotal(card) {
    return shieldPartsOf(card).reduce(function (s, p) { return s + num(p.amount); }, 0);
  }
  function syncShield(card) {
    card.shield = shieldTotal(card);
    return card.shield;
  }
  function addShield(card, amount, left, meta) {
    const n = num(amount);
    if (!(n > 0)) return 0;
    if (!Array.isArray(card.shieldParts)) card.shieldParts = [];
    const part = { id: uid(), amount: n, left: num(left) > 0 ? num(left) : null };
    if (meta) {
      if (meta.name) part.name = String(meta.name);
      part.srcKey = meta.srcKey || '';
      part.from = meta.from || '';
    }
    card.shieldParts.push(part);
    syncShield(card);
    return n;
  }
  // v152: щит баффа. Живёт, пока бафф включён; часть помечена источником,
  // чтобы снятие одного баффа не задело щит предмета или другого баффа.
  function buffShieldKey(buffId) { return 'buff:' + buffId; }
  function clearBuffShield(buff) {
    const ch = activeChar();
    if (!ch || !buff) return;
    const key = buffShieldKey(buff.id);
    (ch.cards || []).forEach(function (c) {
      if (c.type !== 'counter' || !Array.isArray(c.shieldParts) || !c.shieldParts.length) return;
      const keep = c.shieldParts.filter(function (p) { return p.srcKey !== key; });
      if (keep.length !== c.shieldParts.length) {
        c.shieldParts = keep;
        syncShield(c);
      }
    });
  }
  function applyBuffShield(buff) {
    const ch = activeChar();
    if (!ch || !buff) return;
    clearBuffShield(buff);
    if (!buff.on) return;
    const key = buffShieldKey(buff.id);
    const byTarget = {};
    (buff.effects || []).forEach(function (ef) {
      if (effectField(ef) !== 'shield') return;
      const t = ef.target && findCard(ef.target);
      if (!t || t.type !== 'counter') return;
      const r = rollItemExpr(ef.value);
      if (!r) return;
      byTarget[t.id] = (byTarget[t.id] || 0) + r.total;
    });
    Object.keys(byTarget).forEach(function (tid) {
      const t = findCard(tid);
      if (t) addShield(t, byTarget[tid], null, { name: buff.name || '', srcKey: key, from: buff.id });
    });
  }
  function reconcileBuffShield(buff) {
    if (!buff) return;
    applyBuffShield(buff);   // сам снимает старые части и добавляет новые, если включён
  }
  // подпись щитовых эффектов: меняем щит только если поменялись цель/значение/подпись
  function buffShieldSig(effects) {
    return JSON.stringify((effects || []).filter(function (ef) {
      return effectField(ef) === 'shield';
    }).map(function (ef) {
      return [ef.target || '', String(ef.value == null ? '' : ef.value), ef.label || ''];
    }));
  }
  function spendShield(card, amount) {
    let left = Math.max(0, num(amount));
    let absorbed = 0;
    const parts = shieldPartsOf(card);
    parts.forEach(function (p) {
      if (left <= 0) return;
      const take = Math.min(num(p.amount), left);
      p.amount = num(p.amount) - take;
      left -= take;
      absorbed += take;
    });
    if (parts.length) card.shieldParts = parts.filter(function (p) { return num(p.amount) > 0; });
    syncShield(card);
    return absorbed;
  }

  // v107: единственная точка, где меняются текущее значение и щит счётчика.
  // kind: 'heal' (плюс в текущее, не выше максимума), 'damage' (сначала щит,
  // остаток в текущее), 'shield' (плюс в запас поглощения, ev.left — ходы).
  // v115: возвращает фактическое изменение { hp, shield } — для тостов.
  function applyEvent(card, ev) {
    const none = { hp: 0, shield: 0 };
    if (!card || card.type !== 'counter' || !ev) return none;
    const n = num(ev.value);
    if (!n) return none;
    if (ev.kind === 'shield') {
      const added = addShield(card, n, ev.left, { name: ev.name, srcKey: ev.srcKey, from: ev.from });
      return { hp: 0, shield: added };
    }
    if (ev.kind === 'heal') {
      const before = num(card.current);
      let after = before + n;
      const max = counterMaxNum(card);
      if (max != null && max > 0) after = Math.min(after, max);   // перелив отбрасываем
      card.current = after;
      return { hp: after - before, shield: 0 };
    }
    let left = Math.abs(n);
    const absorbed = spendShield(card, left);
    left -= absorbed;
    card.current = num(card.current) - left;
    return { hp: -left, shield: -absorbed };
  }

  // v89: «что на меня влияет» — сводка для бейджа в шапке карточки
  function modSummary(card) {
    const items = [];
    (modIndex().byTarget[card.id] || []).forEach(function (it) {
      if (it.ef.mode === 'adv' || it.ef.mode === 'dis') {
        const n = num(it.ef.value);
        items.push((it.source || '') + ': ' + fxModeShort(it.ef.mode) + (n > 1 ? ' ×' + n : ''));
        return;
      }
      if (!(MOD_ORDER[it.ef.mode] || it.ef.mode === 'dice')) return;
      items.push((it.ef.label || it.source || '') + ': ' + fxShort(it.ef));
    });
    const block = modIndex().blocks[card.id];
    if (block) items.push(block + ': ' + App.t('fxOpBlock'));
    return { count: items.length, items: items };
  }

  // v89: дельта у значения — «(−2)» рядом с числом; в подсказке — от кого
  function modDelta(card, field, base) {
    const list = modsFor(card, field);
    if (!list.length) return '';
    const val = applyMods(card, field, base);
    const b = (typeof base === 'number' && Number.isFinite(base)) ? base : null;
    const v = (typeof val === 'number' && Number.isFinite(val)) ? val : null;
    let txt = '';
    if (b != null && v != null && v !== b) {
      const d = v - b;
      txt = (d > 0 ? '+' : '−') + fmt(Math.abs(d));
    } else if (v != null) {
      txt = '→ ' + fmt(v);
    }
    if (!txt) return '';
    const tip = list.map(function (it) {
      return (it.ef.label || it.source || '') + ': ' + fxShort(it.ef);
    }).join(' · ');
    // v90: дельта красится цветом иконки состояния-источника
    const col = list[0] && list[0].color ? list[0].color : '';
    return '<span class="mod-delta"' + (col ? ' style="color:' + esc(col) + '"' : '') +
      ' title="' + esc(tip) + '">' + esc(txt) + '</span>';
  }

  // базовые значения без модификаторов — для расчёта дельты
  function cardBonusBase(card) {
    if (card.bonus != null && String(card.bonus).trim() !== '') {
      try { return evalCardExpr(card, card.bonus, 'bonus'); } catch (e) { return 0; }
    }
    return 0;
  }
  function skillValueBase(card) {
    if (card.value == null) return 0;
    if (typeof card.value === 'number') return num(card.value);
    try { return evalCardExpr(card, card.value, 'value'); } catch (e) { return 0; }
  }
  function counterMaxBase(card) { return exprNumber(card, card.max); }
  function chargesMaxBase(card) { return exprNumber(card, card.charges ? card.charges.max : null); }

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
  function showRollToast(o) {
    let host = document.getElementById('rollToast');
    if (!host) {
      host = document.createElement('div');
      host.id = 'rollToast';
      document.body.appendChild(host);
    }
    clearInterval(rollToastTimer);
    clearTimeout(rollToastHideTimer);
    const kind = o.crit || '';
    // v119: при преимуществе/помехе показываем второй бросок и выбранный.
    // Крит — только выбранный кубик, без бонуса и суммы («всё или ничего»).
    const dieText = o.n > 1 ? o.chosen.rolls.join(' + ') : String(o.chosen.dieSum);
    const altText = o.other ? (o.n > 1 ? o.other.rolls.join(' + ') : String(o.other.dieSum)) : '';
    const altHTML = (o.other && !kind)
      ? '<span class="rt-alt">' + esc(altText) + '</span><span class="rt-arrow">→</span>'
      : '';
    const chosenHTML = kind
      ? '<span class="rt-total">' + o.chosen.dieSum + '</span>'
      : (o.bonus
        ? '<span class="rt-die">' + esc(dieText) + '</span><span class="rt-bonus">' + (o.bonus > 0 ? '+' : '−') + Math.abs(o.bonus) + '</span><span class="rt-eq">=</span><span class="rt-total">' + o.total + '</span>'
        : '<span class="rt-total">' + o.total + '</span>');
    host.innerHTML =
      '<div class="rt-row">' + altHTML + chosenHTML + '</div>' +
      // разложка источников: на крите не показываем («всё или ничего»), иначе
      // игрок складывает 20 + бонус и спорит с правилами
      (!kind && o.modsHTML ? o.modsHTML : '') +
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
    const n = Math.max(1, Math.round(num(card.nDice) || 1));
    const advMode = rollAdvantage(card);
    const rollAttempt = function () {
      const rolls = [];
      for (let i = 0; i < n; i++) rolls.push(App.dice.roll(card.die));
      const dieSum = rolls.reduce(function (a, b) { return a + b; }, 0);
      const extra = rollEffectDice(card);   // доп. кубики от состояний/баффов
      return { rolls: rolls, dieSum: dieSum, extra: extra, total: dieSum + bonus + extra.total };
    };
    const attempts = [rollAttempt()];
    if (advMode) attempts.push(rollAttempt());
    let chosen = attempts[0];
    if (attempts.length > 1) {
      // v119: выбираем по итогу; для одного d20 это то же, что по кубику
      chosen = advMode === 'adv'
        ? (attempts[1].total > attempts[0].total ? attempts[1] : attempts[0])
        : (attempts[1].total < attempts[0].total ? attempts[1] : attempts[0]);
    }
    const other = attempts.length > 1 ? (chosen === attempts[0] ? attempts[1] : attempts[0]) : null;
    // крит — только одиночный d20; урон (d4, 2d6) не критует
    const critOk = card.die === 20 && n === 1;
    const attemptText = function (a) { return n > 1 ? a.rolls.join(' + ') + ' = ' + a.dieSum : String(a.dieSum); };
    const rollText = other
      ? '[' + attemptText(other) + ' | ' + attemptText(chosen) + '] → ' + attemptText(chosen)
      : (n > 1 ? attemptText(chosen) : String(chosen.dieSum));
    const text = card.name + ' (' + cardDiceLabel(card) + bonusStr(bonus) + '): ' + rollText +
      (chosen.extra.total ? ' + ' + chosen.extra.total + ' (состояния)' : '') +
      (bonus ? (bonus > 0 ? ' + ' : ' − ') + Math.abs(bonus) + ' = ' + chosen.total : (chosen.extra.total ? ' = ' + chosen.total : ''));
    logRoll(text);
    consumeAdvantage(card);   // v121: преимущество/помеха тратятся по броскам
    commit();
    showRollToast({
      chosen: chosen,
      other: other,
      n: n,
      bonus: bonus + chosen.extra.total,
      total: chosen.total,
      modsHTML: rollModsHTML(card, chosen.extra),
      crit: critOk ? critKind(chosen.dieSum) : ''
    });
  }

  // разложка модификаторов под тостом броска: без неё непонятно, откуда взялось число
  function rollModsHTML(card, extra) {
    const parts = [];
    (modIndex().byTarget[card.id] || []).filter(function (it) {
      return effectField(it.ef) === 'bonus';
    }).forEach(function (it) {
      const ef = it.ef;
      if (ef.mode === 'adv' || ef.mode === 'dis') {
        parts.push('<span class="rt-mod">' + esc((ef.label ? '✎ ' + ef.label : fxModeShort(ef.mode)) + ' ' + (it.source || '')) + '</span>');
        return;
      }
      if (ef.mode === 'set' || ef.mode === 'cap') return;   // замену и потолок словами не разложить
      if (!MOD_ORDER[ef.mode]) return;
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
    if (act === 'inc') mutate(function () {
      // v115: выше максимума не поднимаем; излишек — это щит, а не «переполнение»
      const step = counterStep(card.id);
      const max = counterMaxNum(card);
      let v = num(card.current) + step;
      if (max != null && max > 0) v = Math.min(v, max);
      card.current = v;
    });
    else if (act === 'dec') mutate(function () {
      // v118: ручной «−» — это урон: сначала щит, остаток в текущее.
      // Отрицательный шаг работает как прибавка (щит не трогаем).
      const step = counterStep(card.id);
      if (step < 0) {
        const max = counterMaxNum(card);
        let v = num(card.current) - step;
        if (max != null && max > 0) v = Math.min(v, max);
        card.current = v;
      } else if (step > 0) {
        applyEvent(card, { kind: 'damage', value: step });
      }
    });
    else if (act === 'card-menu') openCardMenu(card.id, e && e.currentTarget);
    else if (act === 'buff-expand') openBuffDetails(card.id);
    else if (act === 'item-view') {
      // v109: тап по иконке или имени — всегда просмотр. Правка своей вещи
      // живёт в кебабе и в ✎ окна просмотра, чтобы случайный тап не открывал форму.
      openInventoryItemView(card.id, ds.item);
    }
    else if (act === 'item-edit') openInventoryItemEditor(card.id, ds.item);
    else if (act === 'item-menu') openInventoryItemMenu(card.id, ds.item, e && e.currentTarget);
    else if (act === 'item-use') useInventoryItem(card.id, ds.item);
    else if (act === 'item-equip') toggleInventoryEquip(card.id, ds.item);
    else if (act === 'item-damage') rollInventoryDamage(card.id, ds.item);
    else if (act === 'item-add-menu') openInventoryAddMenu(card.id, e && e.currentTarget);
    else if (act === 'item-fx-del') {
      const a = (card.itemActive || []).find(function (x) { return x.id === ds.fx; });
      const nm = a ? a.name : '';
      mutateWithMaxFill(function () {
        card.itemActive = (card.itemActive || []).filter(function (x) { return x.id !== ds.fx; });
      });
      if (nm) toast(App.tf('deletedGeneric', { name: nm }));
    }
    else if (act === 'item-shield-del') {
      const target = findCard(ds.target);
      const part = target && (target.shieldParts || []).find(function (p) { return p.id === ds.part; });
      const nm = part ? part.name : '';
      if (!target) return;
      mutate(function () {
        target.shieldParts = (target.shieldParts || []).filter(function (p) { return p.id !== ds.part; });
        syncShield(target);
      });
      if (nm) toast(App.tf('deletedGeneric', { name: nm }));
    }
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
        const tgt = activeChargeCounter(card);
        if (tgt) toast(App.tf('refillRes', { name: tgt.name }));
      }
    }
    else if (act === 'note-page') {
      // v142: закладка заметки на карточке — переключить страницу.
      // v147: после выбора страницы полоса остаётся раскрытой (как в слое) и
      // сворачивается, только когда мышь ушла с неё или тап был мимо.
      // Полный render() здесь больше не нужен: он пересоздавал полосу, и она
      // на мгновение схлопывалась — отсюда было «закрылась и тут же вылезла».
      if (!ds.page) return;
      const rail = e && e.currentTarget ? e.currentTarget.closest('.note-tab-rail') : null;
      if (card.pageId === ds.page) {
        if (rail) rail.classList.toggle('open');
        return;
      }
      card.pageId = ds.page;
      save();
      const page = notePage(card);
      const cardEl = cardElOf(card.id);
      if (cardEl) {
        const txt = cardEl.querySelector('.note-text');
        if (txt) txt.textContent = page ? (page.text || '') : '';
        cardEl.querySelectorAll('.note-tab').forEach(function (b) {
          b.classList.toggle('on', b.dataset.page === ds.page);
        });
        const r2 = cardEl.querySelector('.note-tab-rail');
        if (r2) r2.classList.add('open');
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

    if (act === 'ini-self') {
      const row = iniRows(card).find(function (r) { return r.id === ds.row; });
      if (!row) return;
      mutate(function () {
        const turnOn = !row.self;
        iniRows(card).forEach(function (r) { r.self = (r.id === row.id) ? turnOn : false; });
      });
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
        mutateWithMaxFill(function () {
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
          mutateWithMaxFill(function () {
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
        mutateWithMaxFill(function () {
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
    let copyName = '';
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
      copyName = nm;
      // v91: копия активного баффа не должна молча удвоить эффекты
      if (copy.type === 'buff') {
        copy.on = false;
        // v114: копия не должна перехватывать обновления от предмета
        delete copy.srcKey;
      }
      // v124: копия инвентаря не наследует временные эффекты предметов
      if (copy.type === 'inventory') copy.itemActive = [];
      if (copy.x != null) { copy.x += 24; copy.y += 24; }
      ch.cards.push(copy);
    });
    toast(App.tf('duplicatedGeneric', { name: copyName }));
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
    askDelete({ text: confirmMsg, onYes: function () { doDeleteCard(cardId); } });
  }
  function doDeleteCard(cardId) {
    const ch = activeChar();
    if (!ch) return;
    const card = ch.cards.find(function (c) { return c.id === cardId; });
    const nm = card ? card.name : '';
    mutateWithMaxFill(function () {
      // v152: щит баффа не должен остаться на счётчике после удаления баффа
      if (card && card.type === 'buff') clearBuffShield(card);
      ch.cards = ch.cards.filter(function (c) { return c.id !== cardId; });
    });
    toast(App.tf('deletedGeneric', { name: nm }));
  }

  function doRest() {
    const ch = activeChar();
    if (!ch) return;
    // v146: для счётчиков без restores снятые временные эффекты могут опустить
    // максимум — текущее сдвигаем на разницу (у restores оно и так станет максимумом)
    const before = state.settings.fillMaxCurrent ? maxSnapshot() : null;
    mutate(function () {
      // v114: сначала снимаем временные эффекты — иначе максимум счётчика
      // посчитается вместе с ними, и «отдых» оставит current выше максимума
      ch.cards.forEach(function (c) {
        if (c.type === 'buff' && num(c.duration) > 0 && c.on) { c.on = false; c.left = 0; clearBuffShield(c); }
        // v115: отдых обнуляет щит (и постоянный, и временный)
        if (c.type === 'counter' && shieldPartsOf(c).length) { c.shieldParts = []; c.shield = 0; }
        // v124: временные эффекты предметов (с ходами) снимаются
        if (c.type === 'inventory' && (c.itemActive || []).length) {
          c.itemActive = c.itemActive.filter(function (a) { return !(num(a.left) > 0); });
        }
      });
      invalidateMods();
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
      if (before) {
        ch.cards.forEach(function (c) {
          if (c.type !== 'counter' || c.restores) return;
          const old = before[c.id];
          if (old == null) return;
          const after = counterMaxNum(c);
          if (after == null || after === old) return;
          let v = num(c.current) + (after - old);
          if (after > 0) v = Math.min(v, after);
          c.current = Math.max(0, v);
        });
      }
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
    commit();   // без pushUndo: отмена не должна попадать в историю
  }
  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    const s = redoStack.pop();
    state.characters = s.characters;
    state.activeCharacterId = s.activeCharacterId;
    commit();
  }

  // ===== Rendering =====
  // v106: render() пересобирает DOM, поэтому запоминаем фокус и прокрутку списков
  // до перерисовки и возвращаем после. Иначе ввод шага счётчика сбрасывался,
  // а список инвентаря прыгал в начало после каждого «надеть».
  function captureViewState() {
    const canvas = document.getElementById('canvas');
    const topbar = document.getElementById('topbar');
    const ae = document.activeElement;
    let focus = null;
    if (ae && ae !== document.body) {
      if (canvas.contains(ae)) {
        focus = { where: 'canvas', step: (ae.dataset && ae.dataset.step) || null, id: ae.id || null };
      } else if (topbar.contains(ae) && ae.id) {
        focus = { where: 'topbar', id: ae.id };
      }
      if (focus && typeof ae.selectionStart === 'number') {
        focus.start = ae.selectionStart;
        focus.end = ae.selectionEnd;
      }
    }
    const scrolls = [];
    canvas.querySelectorAll('.inv-list, .note-text, .desc-text').forEach(function (el) {
      if (!el.scrollTop) return;
      const card = el.closest('.card');
      scrolls.push({ card: card ? card.dataset.id : '', cls: el.classList[0], top: el.scrollTop });
    });
    return { focus: focus, scrolls: scrolls };
  }
  function restoreViewState(st) {
    if (!st) return;
    st.scrolls.forEach(function (s) {
      if (!s.card) return;
      const card = document.querySelector('.card[data-id="' + s.card + '"]');
      const el = card && card.querySelector('.' + s.cls);
      if (el) el.scrollTop = s.top;
    });
    const f = st.focus;
    if (!f) return;
    let el = null;
    if (f.step) el = document.querySelector('.step-input[data-step="' + f.step + '"]');
    else if (f.id) el = document.getElementById(f.id);
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    if (f.start != null && el.setSelectionRange) {
      try { el.setSelectionRange(f.start, f.end); } catch (e) { /* не текстовое поле */ }
    }
  }
  function render() {
    const view = captureViewState();
    // модификаторы пересобираются на каждый рендер: undo/redo и импорт меняют
    // состояние в обход commit(), а индекс обязан быть свежим (кэш — один на рендер)
    invalidateMods();
    renderHeader();
    renderTabs();
    renderCanvas();
    renderLog();
    updateFab();
    restoreViewState(view);
  }
  function updateFab() {
    const fab = document.getElementById('fab');
    fab.classList.toggle('hidden', !editMode || !activeChar());
    // v126: подпись для экранных дикторов (title с текстом уже есть, но он не диктуется)
    fab.setAttribute('aria-label', App.t('addCard'));
  }

  // Накладка ↺/↻: на ПК клавиши Ctrl+Z / Ctrl+Y (и Ctrl+Shift+Z), кнопки в шапке — только телефон
  function addUndoKeys() {
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // v106: в поле ввода Ctrl+Z отменяет текст, а не весь лист. Иначе одно
      // нажатие в имени персонажа откатывало карточки, и это выглядело как потеря.
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
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

    document.getElementById('brandBtn').addEventListener('click', function () { openSettings(); });
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
    if (type === 'skill') return 1;        // v127: навык — квадрат в одну клетку, как «квадрат 76» со стенда
    return 2;                              // заклинание/инвентарь/заметка
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

  // v91: цвет баффа используется и в рамке/свечении, и в чипах; альфу считаем
  // в JS, чтобы не зависеть от color-mix в старых браузерах.
  function hexAlpha(hex, a) {
    const c = condHexToRgb(hex || '#d4a93c');
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + a + ')';
  }

  function cardView(card, desktop) {
    const sel = (desktop && editMode && selIds.has(card.id)) ? ' selected' : '';
    const folded = foldable(card) && isCollapsed(card);
    let style = '--span:' + cardSpan(card) + ';';
    if (card.type === 'buff') {
      const col = card.color || '#d4a93c';
      style += '--buff-color:' + col + ';--buff-glow:' + hexAlpha(col, 0.32) + ';--buff-bg:' + hexAlpha(col, 0.10) + ';';
    }
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
      (function () {
        const n = card.type === 'inventory' ? inventoryActiveEntries(card).length : 0;
        return n ? '<span class="label-fx-count" title="' + esc(App.t('itemActiveEffects')) + '">' + n + '</span>' : '';
      })() +
      '<button class="fold-tab" title="' + esc(App.t(folded ? 'unfoldCard' : 'foldCard')) + '" aria-label="' + esc(App.t(folded ? 'unfoldCard' : 'foldCard')) + '"></button>' : '';
    const cls = 'card type-' + card.type + (card.type === 'buff' && card.on ? ' on' : '') + (card.mini ? ' mini' : '') + (folded ? ' collapsed' : '') + sel + (card.restores ? ' restores' : '');
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
        (desktop ? '' : '<button class="card-up" title="↑" aria-label="' + esc(App.t('moveUp')) + '">▲</button><button class="card-down" title="↓" aria-label="' + esc(App.t('moveDown')) + '">▼</button>') +
        // v102: у инвентаря нет редактора карточки — правка строк идёт в самих предметах
        (card.type === 'inventory' ? '' : '<button class="card-edit" title="' + esc(App.t('edit')) + '" aria-label="' + esc(App.t('edit')) + '">✎</button>') +
        '<button class="card-dup" title="' + esc(App.t('duplicate')) + '" aria-label="' + esc(App.t('duplicate')) + '">⧉</button>' +
        '<button class="card-del" title="' + esc(App.t('delete')) + '" aria-label="' + esc(App.t('delete')) + '">' + TRASH_SVG + '</button>' +
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
    // v91: развернуть бафф — единственный способ открыть полный текст;
    // клик по тексту карточки остаётся тумблером (см. bindCard).
    const buffExpand = (!editMode && card.type === 'buff')
      ? '<button type="button" class="buff-expand" data-act="buff-expand" title="' + esc(App.t('buffExpand')) + '" aria-label="' + esc(App.t('buffExpand')) + '">⤢</button>' : '';
    // v124: щит — в шапке рядом с бейджем модификаторов, а не поверх значения:
    // иначе плашка закрывала «−2» у максимума на узком счётчике
    const shield = card.type === 'counter' ? shieldTotal(card) : 0;
    const shieldChip = shield > 0
      ? '<span class="counter-shield" title="' + esc(App.t('shieldHint')) + '">🛡 ' + shield + '</span>'
      : '';
    return '<div class="card-head">' + handle + '<span class="card-name">' +
      (card.restores && card.type !== 'counter' ? '<span class="restore-ic">☾</span>' : '') + esc(card.name) +
      '</span>' + modBadgeHTML(card) + shieldChip + finfo + linktag + buffExpand + roller + tools + '</div>';
  }

  // v89: бейдж «на меня влияют»: число активных модификаторов, тап — список источников
  function modBadgeHTML(card) {
    if (editMode) return '';
    const s = modSummary(card);
    if (!s.count) return '';
    return '<span class="mod-badge" data-mod="' + esc(card.id) + '" title="' + esc(s.items.join('\n')) + '">' + s.count + '</span>';
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
      case 'buff': return buffBody(card);
    }
    return '';
  }

  function counterBody(card) {
    const cur = num(card.current);
    const max = counterMaxNum(card);
    const over = (max != null && cur > max);
    const under = cur < 0;
    const step = counterSteps.get(card.id);
    // v90: если по «текущему» бьют эффекты «раз в ход» — красим число цветом состояния
    const tickList = (modIndex().byTarget[card.id] || []).filter(function (it) { return it.ef.mode === 'tick'; });
    const curHtml = tickList.length
      ? '<span class="mod-tick" style="color:' + esc(tickList[0].color || '') + '" title="' +
          esc(tickList.map(function (it) { return (it.ef.label || it.source || '') + ': ' + (it.ef.value || ''); }).join(' · ')) +
        '">' + cur + '</span>'
      : String(cur);
    // v40: компактный вид — значение крупно по центру, ниже степпер «− [шаг] +».
    // Фиксированные +/− и ++/−− убраны: шаг задаётся полем (пусто = 1).
    return '<div class="card-body counter-body">' +
        '<div class="counter-val' + (over ? ' over' : '') + (under ? ' under' : '') + '">' + curHtml +
          (max != null ? '<small> / ' + max + '</small>' + modDelta(card, 'max', counterMaxBase(card)) : '') + '</div>' +
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
        modDelta(card, 'value', skillValueBase(card)) +
        (bonus ? '<span class="stat-bonus">(' + (bonus > 0 ? '+' : '') + bonus + ')' + modDelta(card, 'bonus', cardBonusBase(card)) + '</span>' : '') + '</div>';
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

  // v141: какой счётчик сейчас оплачивает заклинание. Если основной опустел,
  // а включён резерв — показываем и тратим резервный. Иначе интерфейс врёт:
  // рисует 0/3 от основного, а «Применить» списывает резерв.
  function activeChargeCounter(card) {
    const ch = card.charges || {};
    if (ch.mode !== 'link') return null;
    const cost = num(ch.cost) || 1;
    const main = findCard(ch.linkId);
    const mainOk = main && main.type === 'counter';
    if (mainOk && num(main.current) >= cost) return main;
    const emptyMode = ch.emptyMode || (ch.blockEmpty ? 'block' : 'negative');
    if (emptyMode === 'reserve') {
      const res = findCard(ch.reserveId);
      if (res && res.type === 'counter' && num(res.current) >= cost) return res;
    }
    return mainOk ? main : null;
  }

  // «единицы ресурса»: собственные — текущее число зарядов; связанные — floor(текущего счётчика / траты).
  // Счётчик без максимума тоже годится: единицы считаются, предела просто нет (тег без « / N»)
  function chargeUnits(card) {
    const ch = card.charges || {};
    if (ch.mode === 'link') {
      const t = activeChargeCounter(card);
      if (t) return Math.floor(num(t.current) / (num(ch.cost) || 1));
      return null;
    }
    return num(ch.current);
  }
  // предел в единицах; null — без предела
  function chargeMaxUnits(card) {
    const ch = card.charges || {};
    if (ch.mode === 'link') {
      const t = activeChargeCounter(card);
      // максимум счётчика может быть выражением ({Мана} + 2) — сначала считаем его
      const tm = t ? counterMaxNum(t) : null;
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
    // v90: зарядов больше предела (модификатор уменьшил максимум) — показываем излишек,
    // иначе «Применить» тратит невидимые треугольники и кажется, что кнопка не работает
    const units = Math.max(0, Math.floor(num(chargeUnits(card)) || 0));
    const overflow = Math.max(0, units - sk.slots);
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
      (overflow ? '<span class="chg-over" title="' + esc(App.t('chgOver')) + '">+' + overflow + '</span>' : '') +
      '</div>';
  }

  // тег с числом вместо фигур (предел > 12 или без предела), цвет — как у ячеек
  function chargeBadgeHTML(card) {
    const m = card.charges && card.charges.mode === 'link' ? 'link' : 'own';
    const cur = Math.floor(num(chargeUnits(card)) || 0);
    const maxU = chargeMaxUnits(card);
    const txt = cur + (maxU != null ? ' / ' + Math.floor(maxU) : '');
    // v89: дельта зарядов (модификаторы состояния)
    const delta = (m === 'own') ? modDelta(card, 'charges', chargesMaxBase(card)) : '';
    // v53: у СВОИХ зарядов тег открывает барабан (тап по «Х / N»);
    // у связанных — как раньше, плашка-подсказка «пополните счётчик»
    const act = m === 'link' ? ' data-act="pip"' : ' data-act="chg-drum"';
    return '<button type="button" class="chg-badge ' + m + '"' + act +
      ' title="' + esc(App.t('charges')) + '">' + txt + delta + '</button>';
  }

  function chargesInfo(card) {
    const ch = card.charges || {};
    // v32: галочка «показывать тег х/N вместо анимации» — принудительный тег
    const forceTag = !!ch.tag;
    const useWhy = blockedBy(card);
    const useBtn = useWhy
      ? '<button class="small primary use-btn" type="button" disabled title="' + esc(App.tf('useBlocked', { why: useWhy })) + '">' + esc(App.t('use')) + '</button>'
      : '<button class="small primary use-btn" data-act="use">' + esc(App.t('use')) + '</button>';
    if (ch.mode === 'link') {
      // v141: показываем тот счётчик, который сейчас оплатит заклинание:
      // основной, а когда он опустел — резервный (имя в подсказке тоже его)
      const act = activeChargeCounter(card);
      if (act) {
        // счётчик без предела — тег вместо фигур (как при зарядов больше 12)
        if (act.max == null || forceTag) return '<div class="charges-row">' + chargeBadgeHTML(card) + useBtn + '</div>';
        const tip = App.tf('linkPipTip', { cost: num(ch.cost) || 1, name: act.name });
        const figs = chargeFiguresHTML(card, tip);
        // ячеек больше 12 — тег вместо фигур
        return '<div class="charges-row">' + (figs || chargeBadgeHTML(card)) + useBtn + '</div>';
      }
      // потерянная ссылка — старый текстовый вид
      const linked = findCard(ch.linkId);
      const nm = linked ? linked.name : App.t('brokenRef');
      const remain = linked && linked.type === 'counter' ? num(linked.current) : 0;
      return '<div class="charges-row"><span class="meta">' + esc(App.tf('linkedCharges', { name: nm })) + ': ' + remain + '</span>' +
        useBtn + '</div>';
    }
    if (forceTag) return '<div class="charges-row">' + chargeBadgeHTML(card) + useBtn + '</div>';
    const figs = chargeFiguresHTML(card, App.t('pipFill'));
    // v89: у фигур нет числа — дельту ставим рядом с рядом, чтобы модификатор был виден
    return '<div class="charges-row">' + (figs ? figs + modDelta(card, 'charges', chargesMaxBase(card)) : chargeBadgeHTML(card)) + useBtn + '</div>';
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
        // v89: «своя» строка — по ней срабатывают тики состояний (вместо совпадения имён)
        '<button type="button" class="ini-self' + (r.self ? ' on' : '') + '" data-act="ini-self" data-row="' + esc(r.id) + '"' +
          ' title="' + esc(App.t('iniSelfTip')) + '" aria-pressed="' + (r.self ? 'true' : 'false') + '">Я</button>' +
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
      '<button type="button" class="ini-pass' + (prep ? ' start' : '') + '" data-act="ini-pass"' + (blocked ? ' disabled' : '') + '>' +
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

  // v125: щиты, выданные предметом, тоже попадают в полосу активных эффектов.
  // Сама часть живёт на счётчике (она поглощает урон), но чип показываем в
  // инвентаре того предмета, который её выдал.
  function itemShieldChips(card) {
    const ch = activeChar();
    const out = [];
    if (!ch || !card) return out;
    (ch.cards || []).forEach(function (c) {
      if (c.type !== 'counter') return;
      (c.shieldParts || []).forEach(function (p) {
        if (!p.name || p.from !== card.id) return;
        out.push({ target: c, part: p });
      });
    });
    return out;
  }
  function inventoryActiveEntries(card) {
    const out = (card.itemActive || []).map(function (a) { return { kind: 'fx', a: a }; });
    itemShieldChips(card).forEach(function (x) { out.push({ kind: 'shield', target: x.target, part: x.part }); });
    return out;
  }

  function inventoryBody(card) {
    const items = card.items || [];
    let totalW = 0;
    let hasWeight = false;
    const rows = items.map(function (it) {
      const e = effectiveInventoryRow(it);
      const w = (e.weight == null) ? 0 : num(e.weight);
      totalW += w * num(it.qty);
      if (e.weight != null) hasWeight = true;
      const actions = [];
      if (e.damage) {
        actions.push('<button type="button" class="inv-act dmg" data-act="item-damage" data-item="' + esc(it.id) + '">' + esc(e.damage) + '</button>');
      }
      if (e.category === 'consumable') {
        const cur = (e.effects || []).find(function (ef) { return ef.field === 'current'; });
        actions.push('<button type="button" class="inv-act use" data-act="item-use" data-item="' + esc(it.id) + '">' +
          esc(cur ? (cur.label || cur.value) : App.t('itemUse')) + '</button>');
      }
      if (e.category === 'equipment') {
        actions.push('<button type="button" class="inv-act' + (e.equipped ? ' on' : '') + '" data-act="item-equip" data-item="' + esc(it.id) + '">' +
          esc(App.t(e.equipped ? 'itemUnequip' : 'itemEquip')) + '</button>');
      }
      // v108: кебаб строки — «Изменить»/«Обновить из набора» и «Удалить».
      // v109: крестик убран — удаление живёт только здесь, чтобы в строке
      // не было двух путей к одному действию.
      actions.push('<button type="button" class="inv-menu-btn" data-act="item-menu" data-item="' + esc(it.id) + '"' +
        ' title="' + esc(App.t('menu')) + '" aria-label="' + esc(App.t('menu')) + '">⋮</button>');
      // v110: бейдж — только реально работающие эффекты (есть живая цель)
      const fxOn = activeRowEffects(it).length;
      const badge = (e.category === 'equipment' && e.equipped && fxOn)
        ? '<span class="inv-badge" title="' + esc(App.t('itemActiveEffects')) + '">' + fxOn + '</span>' : '';
      return '<div class="inv-row" data-item="' + esc(it.id) + '">' +
        '<span class="inv-ic">' + itemIconChar(e.icon, e.category) + '</span>' +
        '<button type="button" class="inv-main" data-act="item-view" data-item="' + esc(it.id) + '">' +
          '<span class="inv-name">' + esc(e.name) + badge + '</span>' +
          '<span class="inv-meta">' + esc(itemCategoryLabel(e.category)) + ' · ' + (e.weight == null ? '—' : fmt(e.weight) + ' кг') +
            (it.qty > 1 ? ' · ×' + it.qty : '') + '</span>' +
        '</button>' +
        '<span class="inv-actions">' + actions.join('') + '</span>' +
      '</div>';
    }).join('');
    const total = (card.showWeight && hasWeight) ? '<div class="inv-total">' + esc(App.t('totalWeight')) + ': ' + fmt(totalW) + '</div>' : '';
    // v124–v125: активные эффекты и выданные предметом щиты — в шапке, рядом с «＋»
    const entries = inventoryActiveEntries(card);
    const strip = entries.length
      ? '<div class="inv-effects">' + entries.map(function (e) {
          if (e.kind === 'shield') {
            const p = e.part, t = e.target, left = num(p.left);
            const title = p.name + ': ' + App.t('shieldShort') + ' ' + p.amount + ' → ' + t.name + (left > 0 ? ' · ⏱' + left : '');
            return '<span class="inv-fx-chip shield" title="' + esc(title) + '">' +
              '<b>' + esc(p.name) + '</b>' +
              '<span class="inv-fx-txt">' + esc(App.t('shieldShort')) + ' ' + p.amount + (left > 0 ? ' ⏱' + left : '') + '</span>' +
              '<button type="button" class="inv-fx-x" data-act="item-shield-del" data-target="' + esc(t.id) + '" data-part="' + esc(p.id) + '" title="' + esc(App.t('delete')) + '" aria-label="' + esc(App.t('delete')) + '">×</button>' +
            '</span>';
          }
          const a = e.a;
          const ef = a.ef || {};
          const tgt = findCard(ef.target);
          const full = (a.name ? a.name + ': ' : '') + fxShort(ef) + ' → ' + (tgt ? tgt.name : App.t('fxNoTarget'));
          const left = num(a.left);
          // у тика «⏱» уже есть в короткой подписи — второй не ставим
          const short = fxChipShort(ef).replace(/^⏱\s*/, '');
          return '<span class="inv-fx-chip" title="' + esc(full) + '">' +
            (a.name ? '<b>' + esc(a.name) + '</b>' : '') +
            '<span class="inv-fx-txt">' + esc(short) + (left > 0 ? ' ⏱' + left : '') + '</span>' +
            '<button type="button" class="inv-fx-x" data-act="item-fx-del" data-fx="' + esc(a.id) + '" title="' + esc(App.t('delete')) + '" aria-label="' + esc(App.t('delete')) + '">×</button>' +
          '</span>';
        }).join('') + '</div>'
      : '';
    return '<div class="card-body inv-body">' +
      '<div class="inv-top">' + strip +
        '<button type="button" class="inv-add" data-act="item-add-menu" aria-label="' + esc(App.t('packAddItem')) + '">＋</button></div>' +
      '<div class="inv-list">' + (rows || '<div class="inv-empty">' + esc(App.t('itemEmpty')) + '</div>') + '</div>' +
      total +
    '</div>';
  }

  function inventoryRow(card, itemId) {
    return (card && card.items || []).find(function (it) { return it.id === itemId; }) || null;
  }

  function itemMemoryKey(row) {
    return row && row.packId && row.itemId ? row.packId + ':' + row.itemId : '';
  }

  // v98: цели запоминаются по предмету набора и переживают удаление строки.
  // v111: теперь по каждой цели эффекта (массив), как у снаряжения; старая
  // запись-строка читается как общая цель разовых эффектов.
  function rememberItemTarget(card, row) {
    const key = itemMemoryKey(row);
    if (!key) return;
    if (!card.itemTargets || typeof card.itemTargets !== 'object') card.itemTargets = {};
    const list = (effectiveInventoryRow(row).effects || []).map(function (ef) { return ef.target || null; });
    if (list.some(Boolean)) card.itemTargets[key] = list;
    else delete card.itemTargets[key];
  }

  function growInventoryCard(card) {
    if (!card) return;
    const mn = minSize(card);
    if (!card.h || card.h < mn.h) card.h = mn.h;
  }

  function sameInventoryItem(a, b) {
    const fields = ['itemId', 'packId', 'name', 'icon', 'category', 'weight', 'damage', 'price', 'description', 'equipped', 'target', 'revealed'];
    for (let i = 0; i < fields.length; i++) {
      if (String(a[fields[i]] == null ? '' : a[fields[i]]) !== String(b[fields[i]] == null ? '' : b[fields[i]])) return false;
    }
    return JSON.stringify(a.effects || []) === JSON.stringify(b.effects || []) &&
      JSON.stringify(a.secret || null) === JSON.stringify(b.secret || null);
  }

  function rollItemExpr(expr) {
    let s = String(expr == null ? '' : expr).trim().replace(/\s+/g, '');
    if (!s) return null;
    if (/^[+-]?\d+(?:[.,]\d+)?$/.test(s)) {
      const n = Number(s.replace(',', '.'));
      return Number.isFinite(n) ? { total: n, text: s } : null;
    }
    const m = /^([+-]?)(\d*)d(\d+)([+-]\d+)?$/i.exec(s);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    const count = Math.max(1, parseInt(m[2], 10) || 1);
    const sides = parseInt(m[3], 10);
    if (!(sides > 1)) return null;
    let total = parseInt(m[4] || '0', 10) || 0;
    const parts = [];
    for (let i = 0; i < count; i++) { const v = 1 + Math.floor(Math.random() * sides); total += v; parts.push(v); }
    return { total: sign * total, text: (sign < 0 ? '−' : '') + parts.join(' + ') + (m[4] ? ' ' + m[4] : '') };
  }

  function closeInvMenu() { closeMenuById('invMenu'); }
  function openInvMenu(anchor, html, onClick, opts) {
    opts = opts || {};
    const menu = document.createElement('div');
    menu.className = 'ctxmenu inv-menu';
    menu.id = 'invMenu';
    menu.innerHTML = html;
    menu.addEventListener('click', function (e) { onClick(e, menu); });
    mountMenu(menu, anchor, { align: 'right', side: opts.left ? 'left' : '', toggle: !!opts.toggle });
  }

  function useInventoryItem(cardId, itemId) {
    const row = inventoryRow(findCard(cardId), itemId);
    if (!row) return;
    const e = effectiveInventoryRow(row);
    // v122: расходник-пустышка (реагент) ни на что не влияет — просто тратится,
    // цель ему не нужна
    if (!(e.effects || []).length) {
      useBlankItem(cardId, itemId);
      return;
    }
    // v111: цель живёт в каждом разовом эффекте, а не одна на строку.
    // v114: временные/тикающие эффекты тоже считаются готовыми к применению.
    // v115: выдача щита — тоже применение.
    const instant = (e.effects || []).filter(function (ef) {
      return (ef.field === 'current' || ef.field === 'shield') && ef.mode !== 'tick' && effectReady(ef);
    });
    const timed = (e.effects || []).filter(function (ef) {
      return timedItemEffect(ef);
    });
    if (!instant.length && !timed.length) {
      toast(App.t('itemChooseTarget'));
      openInventoryItemView(cardId, itemId);
      return;
    }
    applyInventoryItem(cardId, itemId);
  }

  // v122: «Использовать» без эффектов — только списать количество.
  function useBlankItem(cardId, itemId) {
    const card = findCard(cardId);
    const row = inventoryRow(card, itemId);
    if (!card || !row) return;
    const nm = effectiveInventoryRow(row).name;
    mutate(function () {
      row.qty = Math.max(0, num(row.qty) - 1);
      if (row.qty <= 0) card.items = card.items.filter(function (x) { return x.id !== row.id; });
    });
    closeInvMenu();
    closeModal();
    toast(App.tf('itemUsedBlank', { name: nm }));
  }

  // v114: эффект, который живёт во времени: тик или модификатор с длительностью.
  // Разовое «текущее» без длительности применяется сразу, а не создаёт бафф.
  // v115: щит — разовая выдача запаса, у него своя длительность на карточке.
  function timedItemEffect(ef) {
    if (!ef || !ef.target || !findCard(ef.target)) return false;
    if (ef.field === 'shield') return false;
    // v120: преимущество/помеха с предмета — это временный (или постоянный,
    // пока не выключат) бафф; без этого «Использовать» просил выбрать цель
    if (ef.mode === 'tick' || ef.mode === 'adv' || ef.mode === 'dis') return true;
    // v162: модификатор без ходов («заменить значение на 0») тоже применяется:
    // он живёт в полосе активных эффектов, пока его не снимут
    return effectField(ef) !== 'current';
  }

  // v124: временные эффекты предмета живут на карточке инвентаря, в полосе
  // активных эффектов. Ключ источника один на предмет: повторное применение
  // заменяет прошлые записи, а не плодит дубли.
  function addItemActive(card, row, effects, name) {
    if (!card) return;
    const key = row.packId ? 'pack:' + row.packId + ':' + row.itemId : 'own:' + row.id;
    if (!Array.isArray(card.itemActive)) card.itemActive = [];
    card.itemActive = card.itemActive.filter(function (a) { return a.srcKey !== key; });
    effects.forEach(function (ef) {
      const c = normalizeEffect(ef);
      c.target = ef.target || null;
      const uses = c.mode === 'adv' || c.mode === 'dis';
      const left = uses ? null : (num(c.duration) > 0 ? num(c.duration) : null);
      card.itemActive.push({ id: uid(), srcKey: key, name: name || '', ef: c, left: left });
    });
  }

  function applyInventoryItem(cardId, itemId) {
    const card = findCard(cardId);
    const row = inventoryRow(card, itemId);
    if (!row) return;
    const e = effectiveInventoryRow(row);
    // разовые эффекты: у каждого своя цель, одинаковые цели складываются
    const byTarget = {};
    const shieldBy = {};
    (e.effects || []).forEach(function (ef) {
      if (!ef.target || !findCard(ef.target)) return;
      if (ef.field === 'shield') {
        const r = rollItemExpr(ef.value);
        if (!r) return;
        const slot = shieldBy[ef.target] || (shieldBy[ef.target] = { sum: 0, left: 0 });
        slot.sum += r.total;
        slot.left = Math.max(slot.left, num(ef.duration) || 0);
        slot.name = e.name;
        slot.srcKey = row.packId ? 'pack:' + row.packId + ':' + row.itemId : 'own:' + row.id;
        slot.from = card.id;
        return;
      }
      if (ef.field !== 'current' || ef.mode === 'tick') return;
      const r = rollItemExpr(ef.value);
      if (!r) return;
      const slot = byTarget[ef.target] || (byTarget[ef.target] = { sum: 0 });
      slot.sum += r.total;
    });
    const ids = Object.keys(byTarget);
    const shieldIds = Object.keys(shieldBy);
    const timed = (e.effects || []).filter(timedItemEffect);
    if (!ids.length && !shieldIds.length && !timed.length) { toast(App.t('itemNoEffect')); return; }
    const applied = {};
    mutateWithMaxFill(function () {
      ids.forEach(function (tid) {
        const t = findCard(tid);
        const sum = byTarget[tid].sum;
        if (!t || t.type !== 'counter' || !sum) return;
        applied[tid] = applyEvent(t, sum >= 0 ? { kind: 'heal', value: sum } : { kind: 'damage', value: -sum });
      });
      shieldIds.forEach(function (tid) {
        const t = findCard(tid);
        if (!t || t.type !== 'counter') return;
        const r = applyEvent(t, { kind: 'shield', value: shieldBy[tid].sum, left: shieldBy[tid].left, name: shieldBy[tid].name, srcKey: shieldBy[tid].srcKey, from: shieldBy[tid].from });
        applied[tid] = applied[tid] || { hp: 0, shield: 0 };
        applied[tid].shield += r.shield;
      });
      if (timed.length) addItemActive(card, row, timed, e.name);
      rememberItemTarget(card, row);
      row.qty = Math.max(0, num(row.qty) - 1);
      if (row.qty <= 0) card.items = card.items.filter(function (x) { return x.id !== row.id; });
    });
    closeInvMenu();
    closeModal();
    const bits = Object.keys(applied).map(function (tid) {
      const t = findCard(tid);
      const r = applied[tid];
      const nm = t ? t.name : '';
      const sub = [];
      if (r.hp) sub.push((r.hp > 0 ? '+' : '−') + Math.abs(r.hp));
      if (r.shield) sub.push((r.shield > 0 ? '+' : '−') + Math.abs(r.shield) + ' ' + App.t('shieldShort'));
      return sub.length ? nm + ' ' + sub.join(' / ') : nm + ' ' + App.t('itemNoChange');
    }).filter(Boolean);
    if (timed.length) bits.push(App.t('itemTimedShort'));
    toast(row.name + ': ' + (bits.join(', ') || App.t('itemNoEffect')));
  }

  function rollInventoryDamage(cardId, itemId) {
    const row = inventoryRow(findCard(cardId), itemId);
    if (!row) return;
    const e = effectiveInventoryRow(row);
    const r = rollItemExpr(e.damage);
    toast(r ? App.tf('itemDamageResult', { n: r.total, dice: r.text }) : App.tf('itemDamageText', { text: e.damage }));
  }

  // v108: одно правило «надето» для кнопки строки и редактора.
  // Без своего mutate: вызывающий сам решает, когда сохранять.
  // При количестве > 1 надевается одна штука (строка делится), при снятии
  // одинаковая строка складывается обратно — иначе в списке копились бы
  // невидимые пары. Возвращает строку, которая осталась «живой».
  function setRowEquipped(card, row, on) {
    if (!card || !row || !!row.equipped === !!on) return row;
    if (!on) {
      row.equipped = false;
      const twin = card.items.find(function (x) {
        return x !== row && !x.equipped && !x.revealed && x.name === row.name &&
          x.category === row.category && x.packId === row.packId && !x.secret;
      });
      if (twin) { twin.qty += row.qty; card.items = card.items.filter(function (x) { return x !== row; }); return twin; }
      return row;
    }
    if (row.qty > 1) {
      const idx = card.items.indexOf(row);
      const one = JSON.parse(JSON.stringify(row));
      one.id = uid();
      one.qty = 1;
      one.equipped = true;
      row.qty -= 1;
      row.equipped = false;
      card.items.splice(idx, 1, one, row);
      return one;
    }
    row.equipped = true;
    return row;
  }

  function toggleInventoryEquip(cardId, itemId) {
    const card = findCard(cardId);
    const row = inventoryRow(card, itemId);
    if (!row) return;
    const wasEquipped = !!row.equipped;
    const nm = effectiveInventoryRow(row).name;
    mutateWithMaxFill(function () { setRowEquipped(card, row, !wasEquipped); });
    toast(nm + ' · ' + App.t(wasEquipped ? 'itemUnequipped' : 'itemEquipped'));
  }

  // v108: действия строки инвентаря в одном меню — и на холсте, и в слое.
  // «Открыть» оставляем для быстрого просмотра; «Изменить» — только у своей
  // вещи, предмет набора правится в настройках набора.
  function deleteInventoryRow(cardId, itemId, anchor) {
    const card = findCard(cardId);
    const row = inventoryRow(card, itemId);
    if (!row) return;
    const nm = effectiveInventoryRow(row).name;
    askDelete({ text: App.tf('itemDeleteConfirm', { name: nm }), anchor: anchor, onYes: function () {
      mutateWithMaxFill(function () {
        card.items = (card.items || []).filter(function (x) { return x.id !== itemId; });
      });
      toast(App.tf('deletedGeneric', { name: nm }));
    } });
  }

  function openInventoryItemMenu(cardId, itemId, anchor) {
    const card = findCard(cardId);
    const row = inventoryRow(card, itemId);
    if (!row) return;
    // v109: «Открыть» убрано — просмотр открывается тапом по иконке или имени.
    // В меню остаётся то, чего нельзя сделать тапом: правка/обновление и удаление.
    let html = '';
    if (!row.packId) html += '<button type="button" data-im="edit">' + esc(App.t('edit')) + '</button>';
    else html += '<button type="button" data-im="refresh">' + esc(App.t('itemRefresh')) + '</button>';
    html += '<button type="button" data-im="del">' + esc(App.t('delete')) + '</button>';
    openInvMenu(anchor, html, function (e) {
      const b = e.target.closest('[data-im]');
      if (!b) return;
      const what = b.dataset.im;
      closeInvMenu();
      if (what === 'edit') openInventoryItemEditor(cardId, itemId);
      else if (what === 'refresh') refreshInventoryFromPack(cardId, itemId);
      else if (what === 'del') deleteInventoryRow(cardId, itemId, anchor);
    }, { toggle: true });
  }

  // v102: круглая стрелка «Обновить» в шапке окна предмета (как иконка ресета)
  const ITEM_REFRESH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v5h5"/></svg>';

  function openInventoryItemView(cardId, itemId) {
    const card = findCard(cardId);
    const row = inventoryRow(card, itemId);
    if (!row) return;
    const e = effectiveInventoryRow(row);
    // v111: цель выбирается у каждого эффекта одинаково — и у разового
    // «текущего», и у модификатора. Для предмета набора это единственное место.
    // v112: у «Прочего» эффектов нет — в просмотре не показываем даже старые
    const fx = e.category === 'misc' ? '' : (e.effects || []).map(function (ef, i) {
      const field = effectField(ef);
      const chip = '<span class="inv-view-fx" title="' + esc(fxShort(ef)) + '">' +
        esc((ef.label ? '✎ ' : '') + (ef.label || fxShort(ef))) + '</span>';
      const live = effectReady(ef);
      const missing = ef.target && !findCard(ef.target);
      const opts = '<option value="">' + esc(App.t('fxNoTargetPick')) + '</option>' +
        (missing ? '<option value="' + esc(ef.target) + '" selected>' + esc(App.t('fxNoTarget')) + '</option>' : '') +
        effectTargetCards(field).map(function (c) {
          return '<option value="' + esc(c.id) + '"' + (ef.target === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
        }).join('');
      return '<div class="inv-fx-line' + (live ? '' : ' off') + '">' + chip +
        '<select class="inv-fx-target" data-fx-target="' + i + '" aria-label="' + esc(App.t('itemTarget')) + '">' + opts + '</select></div>';
    }).join('');
    // v102: в окне предмета — только «Обновить» (иконка в шапке); надеть/использовать
    // живут кнопками в строке инвентаря, закрытие — тап мимо или Esc
    const refreshBtn = row.packId
      ? '<button type="button" class="modal-icon-btn" data-item-refresh="1" title="' + esc(App.t('itemRefresh')) +
        '" aria-label="' + esc(App.t('itemRefresh')) + '">' + ITEM_REFRESH_SVG + '</button>'
      : '';
    // v108: у своей вещи из просмотра можно сразу перейти в редактор
    const editBtn = !row.packId
      ? '<button type="button" class="modal-icon-btn" data-item-edit="1" title="' + esc(App.t('edit')) +
        '" aria-label="' + esc(App.t('edit')) + '">✎</button>'
      : '';
    const trueTag = (row.secret && row.revealed)
      ? '<div class="inv-true">' + esc(App.t('itemTrueItem')) + '</div>' : '';
    const strange = (row.secret && !row.revealed)
      ? '<div class="inv-strange">' + esc(App.tf('itemStrange', { name: e.name })) + '</div>' : '';
    openModal(e.name,
      refreshBtn + editBtn +
      '<div class="inv-view-head"><span class="inv-view-ic">' + itemIconChar(e.icon, e.category) + '</span>' +
        '<span class="inv-view-meta">' + esc(itemCategoryLabel(e.category)) +
        (e.weight != null ? ' · ' + fmt(e.weight) + ' кг' : '') +
        ' · ×' + row.qty + (e.equipped ? ' · ' + esc(App.t('itemEquipped')) : '') +
        (e.price ? ' · ' + esc(e.price) : '') + '</span></div>' +
      (e.damage ? '<button type="button" class="inv-view-dmg" data-item-damage="1">' + esc(e.damage) + '</button>' : '') +
      (fx ? '<div class="inv-view-fxrow">' + fx + '</div>' : '') +
      '<div class="full-text">' + esc(e.description || '') + '</div>' +
      trueTag + strange,
      []);
    const modal = document.getElementById('modal');
    // v111: цель эффекта меняется прямо в окне просмотра — у предметов набора
    // другого места нет, а у своей вещи это быстрый способ без полной формы.
    // Здесь же выбирается цель разового эффекта (раньше был отдельный селект).
    const fxHost = modal.querySelector('.inv-view-fxrow');
    if (fxHost) fxHost.addEventListener('change', function (ev) {
      const sel = ev.target.closest('[data-fx-target]');
      if (!sel) return;
      const i = +sel.dataset.fxTarget;
      const val = sel.value || null;
      mutate(function () {
        const live = effectiveInventoryRow(inventoryRow(card, itemId));
        if (live.effects && live.effects[i]) live.effects[i].target = val;
        rememberItemTarget(card, row);
      });
      const line = sel.closest('.inv-fx-line');
      const liveEf = effectiveInventoryRow(inventoryRow(card, itemId)).effects[i];
      if (line) line.classList.toggle('off', !effectReady(liveEf));
      toast(App.t('itemTargetSaved'));
    });
    const refreshBtnEl = modal.querySelector('[data-item-refresh]');
    if (refreshBtnEl) refreshBtnEl.addEventListener('click', function () { refreshInventoryFromPack(cardId, itemId); });
    const editBtnEl = modal.querySelector('[data-item-edit]');
    if (editBtnEl) editBtnEl.addEventListener('click', function () {
      closeModal();
      openInventoryItemEditor(cardId, itemId);
    });
    const dmgBtn = modal.querySelector('[data-item-damage]');
    if (dmgBtn) dmgBtn.addEventListener('click', function () { rollInventoryDamage(cardId, itemId); });
  }


  function refreshInventoryFromPack(cardId, itemId) {
    const card = findCard(cardId);
    const row = inventoryRow(card, itemId);
    const pack = row && row.packId ? packById(row.packId) : null;
    const src = pack && (pack.items || []).find(function (x) { return x.id === row.itemId; });
    if (!row || !src) { toast(App.t('packItemNotFound')); return; }
    const tpl = normalizePackItem(src);
    mutate(function () {
      // v110: цель эффекта живёт в строке, а не в наборе. Обновление не должно
      // стирать выбор игрока: переносим цель, если поле эффекта не изменилось.
      const prev = (row.effects || []).slice();
      row.effects = (tpl.effects || []).map(function (ef, i) {
        const old = prev[i];
        if (old && old.field === ef.field && old.target && findCard(old.target)) ef.target = old.target;
        return ef;
      });
      row.name = tpl.name; row.icon = tpl.icon; row.category = tpl.category;
      row.weight = tpl.weight; row.damage = tpl.damage; row.price = tpl.price;
      row.description = tpl.description;
      row.secret = tpl.secret;
    });
    closeModal();
    toast(App.tf('itemRefreshed', { name: row.name }));
  }

  function openInventoryAddMenu(cardId, anchor) {
    openInvMenu(anchor,
      '<button type="button" data-add-create="1">' + esc(App.t('itemCreate')) + '</button>' +
      '<button type="button" data-add-picker="1">' + esc(App.t('itemAdd')) + '</button>',
      function (e) {
        if (e.target.closest('[data-add-create]')) { closeInvMenu(); addCustomInventoryItem(cardId); }
        else if (e.target.closest('[data-add-picker]')) { closeInvMenu(); openItemPicker(cardId); }
      }, { toggle: true, left: true });
  }

  function addCustomInventoryItem(cardId) {
    const card = findCard(cardId);
    if (!card) return;
    const row = normalizeInventoryRow({
      id: uid(), name: App.t('packItemNew'), category: 'misc', qty: 1,
      weight: null, damage: '', price: '', description: '', effects: [], secret: null
    });
    mutate(function () { card.items.push(row); growInventoryCard(card); });
    pendingNewItem = { cardId: cardId, itemId: row.id };
    openInventoryItemEditor(cardId, row.id);
  }

  function openItemPicker(cardId) {
    const ch = activeChar();
    if (!ch) return;
    const packs = packsList().filter(function (p) { return charPacks(ch)[p.id]; });
    if (!packs.length) { toast(App.t('itemNoPacks')); return; }
    const catOpts = '<option value="">' + esc(App.t('itemAllCategories')) + '</option>' +
      ITEM_CATEGORIES.map(function (c) { return '<option value="' + c.id + '">' + esc(App.t(c.labelKey)) + '</option>'; }).join('');
    openModal(App.t('itemPickerTitle'),
      '<div class="field"><input id="item-pick-search" type="text" autocomplete="off" spellcheck="false" placeholder="' + esc(App.t('itemSearch')) + '"></div>' +
      '<div class="fx-pair"><div class="field"><label>' + esc(App.t('itemCategory')) + '</label><select id="item-pick-cat">' + catOpts + '</select></div>' +
      '<div class="field"><label>' + esc(App.t('itemQty')) + '</label><input id="item-pick-qty" type="number" min="1" value="1"></div></div>' +
      '<div id="item-pick-list" class="item-pick-list"></div>',
      [{ label: App.t('close'), cls: 'primary' }]);
    const list = document.getElementById('item-pick-list');
    function render() {
      const q = (document.getElementById('item-pick-search').value || '').trim().toLowerCase();
      const cat = document.getElementById('item-pick-cat').value;
      const rows = [];
      packs.forEach(function (pack) {
        (pack.items || []).forEach(function (it) {
          if (cat && it.category !== cat) return;
          if (q && String(it.name || '').toLowerCase().indexOf(q) === -1) return;
          rows.push('<button type="button" class="item-pick-row" data-pack="' + esc(pack.id) + '" data-item="' + esc(it.id) + '">' +
            '<span class="inv-ic">' + itemIconChar(it.icon, it.category) + '</span>' +
            '<span class="item-pick-txt"><b>' + esc(it.name) + '</b><small>' + esc(itemCategoryLabel(it.category)) +
              (it.weight != null ? ' · ' + fmt(it.weight) + ' кг' : '') + (it.damage ? ' · ' + esc(it.damage) : '') + '</small></span>' +
            '<span class="item-pick-plus">+</span></button>');
        });
      });
      list.innerHTML = rows.join('') || '<div class="set-empty">' + esc(App.t('itemPickerEmpty')) + '</div>';
    }
    document.getElementById('item-pick-search').addEventListener('input', render);
    document.getElementById('item-pick-cat').addEventListener('change', render);
    list.addEventListener('click', function (e) {
      const b = e.target.closest('[data-pack]');
      if (!b) return;
      const qty = Math.max(1, parseInt(document.getElementById('item-pick-qty').value, 10) || 1);
      addFromPack(cardId, b.dataset.pack, b.dataset.item, qty);
    });
    render();
  }

  function addFromPack(cardId, packId, itemId, qty) {
    const card = findCard(cardId);
    const pack = packById(packId);
    const src = pack && (pack.items || []).find(function (it) { return it.id === itemId; });
    if (!card || !src) return;
    const row = normalizeInventoryRow(Object.assign({}, src, {
      id: uid(), itemId: src.id, packId: pack.id, qty: Math.max(1, qty || 1),
      equipped: false, targets: null, revealed: false
    }));
    const memKey = pack.id + ':' + src.id;
    const mem = card.itemTargets && card.itemTargets[memKey];
    // v111: помним цели по эффектам (массив); старая запись-строка — общая
    // цель разовых эффектов
    if (mem) {
      if (Array.isArray(mem)) {
        row.effects.forEach(function (ef, i) {
          if (mem[i] && findCard(mem[i])) ef.target = mem[i];
        });
      } else if (findCard(mem)) {
        row.effects.forEach(function (ef) {
          if (ef.field === 'current' && !ef.target) ef.target = mem;
        });
      }
    }
    mutate(function () {
      const same = card.items.find(function (x) { return sameInventoryItem(x, row); });
      if (same) same.qty += row.qty;
      else card.items.push(row);
      growInventoryCard(card);
    });
    closeModal();
    toast(App.tf('itemAdded', { name: row.name }));
  }

  // v108: своя вещь правится тем же компонентом, что и предмет набора.
  // Дополнительно — количество, «надето» и цель применения. «Надето»
  // меняем помощником setRowEquipped: при количестве > 1 надевается одна
  // штука, при снятии одинаковые строки снова складываются.
  function openInventoryItemEditor(cardId, itemId) {
    const card = findCard(cardId);
    const row = inventoryRow(card, itemId);
    if (!row || row.packId) return;
    const e = effectiveInventoryRow(row);
    openItemForm({
      mode: 'own',
      title: App.t('itemEditTitle'),
      draft: {
        name: row.name, category: e.category, icon: e.icon, weight: row.weight,
        price: row.price, damage: row.damage, description: row.description,
        effects: row.effects || [], secret: row.secret || null,
        qty: row.qty, equipped: !!row.equipped
      },
      onSave: function (out) {
        const wasEquipped = !!row.equipped;
        const wantEquipped = !!out.equipped;
        const isNew = !!pendingNewItem;
        mutateWithMaxFill(function () {
          const next = normalizeInventoryRow(Object.assign({}, row, out, {
            id: row.id, itemId: row.itemId, packId: row.packId,
            equipped: row.equipped,   // «надето» — отдельным помощником, см. ниже
            revealed: row.revealed
          }));
          Object.keys(next).forEach(function (k) { row[k] = next[k]; });
          if (wantEquipped !== wasEquipped) setRowEquipped(card, row, wantEquipped);
          growInventoryCard(card);
        }, isNew);
        pendingNewItem = null;
        toast(App.tf(isNew ? 'createdGeneric' : 'savedGeneric', { name: out.name }));
        return true;
      },
      onDelete: function () {
        const nm = effectiveInventoryRow(row).name;
        mutateWithMaxFill(function () {
          card.items = (card.items || []).filter(function (x) { return x.id !== row.id; });
        });
        pendingNewItem = null;
        toast(App.tf('deletedGeneric', { name: nm }));
        closeModal();
      },
      onSaveToPack: function (packId, out) {
        const pack = packById(packId);
        if (!pack) return;
        // цель — привязка к карточкам листа; в общий набор она не переносится
        const stripTarget = function (ef) { const c = normalizeEffect(ef); c.target = null; return c; };
        const copy = normalizePackItem({
          id: uid(), name: out.name, category: out.category, icon: out.icon,
          weight: out.weight, damage: out.damage, price: out.price, description: out.description,
          effects: (out.effects || []).map(stripTarget),
          secret: out.secret ? Object.assign({}, out.secret, {
            effects: (out.secret.effects || []).map(stripTarget)
          }) : null
        });
        pack.items.push(copy);
        savePacks();
        toast(App.tf('itemSavedToPack', { name: pack.name || App.t('packDefaultName') }));
      }
    });
  }

  // ===== Страницы заметки (v142) =====
  // Заметка — набор листов (title/color/text). Раньше был один card.text;
  // ensureNotePages переносит его в первую страницу и убирает старое поле.
  const NOTE_COLORS = ['#e6c25a', '#a79bff', '#7fd6a5', '#f09a7f', '#9fd8ff', '#f2a7c3'];
  function notePages(card) {
    if (!Array.isArray(card.pages)) card.pages = [];
    return card.pages;
  }
  function notePage(card) {
    const list = notePages(card);
    let p = list.find(function (x) { return x.id === card.pageId; });
    if (!p && list.length) { p = list[0]; card.pageId = p.id; }
    return p || null;
  }
  function ensureNotePages(card) {
    if (!card || card.type !== 'note') return false;
    let changed = false;
    if (!Array.isArray(card.pages) || !card.pages.length) {
      card.pages = [{
        id: uid(),
        title: '',
        color: NOTE_COLORS[0],
        text: typeof card.text === 'string' ? card.text : ''
      }];
      card.pageId = card.pages[0].id;
      changed = true;
    }
    if (!card.pages.some(function (p) { return p.id === card.pageId; })) {
      card.pageId = card.pages[0].id;
      changed = true;
    }
    if ('text' in card) { delete card.text; changed = true; }
    return changed;
  }
  function notePageColor(p, i) {
    return (p && /^#[0-9a-f]{6}$/i.test(p.color || '')) ? p.color : NOTE_COLORS[(i || 0) % NOTE_COLORS.length];
  }
  function notePageTitle(p) {
    return (p && p.title || '').trim() || App.t('notePageNoName');
  }
  // Закладки на карточке: номера; подписи раскрываются наведением на полосу
  function noteTabsHTML(card) {
    const list = notePages(card);
    if (list.length < 2) return '';
    return '<div class="note-tab-rail">' + list.map(function (p, i) {
      return '<div class="note-tab-wrap"><button type="button" class="note-tab' + (p.id === card.pageId ? ' on' : '') + '"' +
        ' data-act="note-page" data-page="' + esc(p.id) + '"' +
        ' style="--tab:' + esc(notePageColor(p, i)) + '"' +
        ' aria-label="' + esc(notePageTitle(p)) + '">' +
        '<span class="nt-num">' + (i + 1) + '</span>' +
        '<span class="nt-nm">' + esc(notePageTitle(p)) + '</span>' +
      '</button></div>';
    }).join('') + '</div>';
  }
  function noteBody(card) {
    ensureNotePages(card);
    const p = notePage(card);
    return '<div class="card-body"><div class="note-text">' + esc(p ? (p.text || '') : '') + '</div>' + noteTabsHTML(card) + '</div>';
  }

  // v98: долгий тап по иконке предмета раскрывает «истинный предмет».
  // v99: иконка кликабельна у всех предметов; удержание даёт одинаковый отклик,
  // а анимация — только если у предмета есть скрытая часть. Отпускание после
  // начала вспышки не прерывает: вспышка догорает, затем строка обновляется.
  // Тайминги: 0.5 с удержание, 2.8 с линия, 1.2 с затухающая вспышка. Без тостов.
  function bindInventoryReveal(card, el) {
    el.querySelectorAll('.inv-row').forEach(function (rowEl) {
      const icon = rowEl.querySelector('.inv-ic');
      if (!icon) return;
      let holdTimer = null;
      let timers = [];
      let phase = '';            // '' | 'hold' | 'draw' | 'flash'
      let suppressClick = false;

      function clearTimers() {
        timers.forEach(clearTimeout);
        timers = [];
      }
      function cancelHold() {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        rowEl.classList.remove('holding');
        if (phase === 'hold') phase = '';
      }
      function clearReveal() {
        clearTimers();
        phase = '';
        rowEl.classList.remove('revealing', 'inv-flash', 'inv-flash-solo', 'holding');
        const layer = rowEl.querySelector('.inv-reveal-layer');
        if (layer) layer.remove();
      }
      function makeLayer(w, h) {
        // путь строим в пикселях строки: так скругления не плющит, как при preserveAspectRatio
        const r = 7;
        const cx = Math.round(w / 2), t = 1, b = h - 1, l = 1, rt = w - 1;
        const rightPath = 'M' + cx + ',' + t + ' H' + (rt - r) +
          ' Q' + rt + ',' + t + ' ' + rt + ',' + (t + r) +
          ' V' + (b - r) + ' Q' + rt + ',' + b + ' ' + (rt - r) + ',' + b + ' H' + cx;
        const leftPath = 'M' + cx + ',' + t + ' H' + (l + r) +
          ' Q' + l + ',' + t + ' ' + l + ',' + (t + r) +
          ' V' + (b - r) + ' Q' + l + ',' + b + ' ' + (l + r) + ',' + b + ' H' + cx;
        const layer = document.createElement('div');
        layer.className = 'inv-reveal-layer';
        layer.innerHTML = '<svg class="inv-reveal-stroke" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
          '<path pathLength="100" d="' + rightPath + '"/>' +
          '<path pathLength="100" d="' + leftPath + '"/>' +
        '</svg><div class="inv-reveal-flash"></div><div class="inv-reveal-ring"></div>';
        return layer;
      }
      function addLayer(row) {
        const w = Math.max(40, Math.round(row.clientWidth));
        const h = Math.max(20, Math.round(row.clientHeight));
        row.appendChild(makeLayer(w, h));
        return row;
      }
      // v100: раскрытие применяется В МОМЕНТ вспышки, а не после затухания —
      // под вспышкой уже новая строка, вспышка только плавно гаснет.
      function revealNow() {
        const live = inventoryRow(findCard(card.id), rowEl.dataset.item);
        if (live) {
          pushUndo();
          live.revealed = true;
          if (live.secret && (live.secret.category || live.category) === 'equipment') live.equipped = true;
          save();
        }
        // render() пересобирает список — сохраняем прокрутку, иначе строка улетает вверх
        const scrollers = Array.prototype.slice.call(document.querySelectorAll('.inv-list'))
          .map(function (el) { return { el: el, top: el.scrollTop }; });
        render();
        if (layerCardId) refreshLayer();
        scrollers.forEach(function (s) { if (s.el.isConnected) s.el.scrollTop = s.top; });

        const itemId = rowEl.dataset.item;
        const rows = [];
        const canvasRow = document.querySelector('.card[data-id="' + card.id + '"] .inv-row[data-item="' + itemId + '"]');
        if (canvasRow) rows.push(canvasRow);
        document.querySelectorAll('#labelLayer .inv-row[data-item="' + itemId + '"]').forEach(function (r2) { rows.push(r2); });
        rows.forEach(function (r2) {
          addLayer(r2);
          r2.classList.add('inv-flash', 'inv-flash-solo');
        });
      }
      function start() {
        phase = 'draw';
        addLayer(rowEl);
        rowEl.classList.add('revealing');
        timers.push(setTimeout(function () {
          if (phase !== 'draw') return;
          phase = 'flash';
          revealNow();
        }, 2800));
        timers.push(setTimeout(function () {
          clearTimers();
          phase = '';
          document.querySelectorAll('.inv-flash-solo').forEach(function (r2) {
            r2.classList.remove('inv-flash', 'inv-flash-solo', 'revealing');
            const l = r2.querySelector('.inv-reveal-layer');
            if (l) l.remove();
          });
        }, 4400));
      }

      icon.addEventListener('pointerdown', function (e) {
        if (editMode || phase) return;
        suppressClick = false;
        if (icon.setPointerCapture && e.pointerId != null) {
          try { icon.setPointerCapture(e.pointerId); } catch (_) {}
        }
        cancelHold();
        phase = 'hold';
        rowEl.classList.add('holding');
        holdTimer = setTimeout(function () {
          holdTimer = null;
          rowEl.classList.remove('holding');
          suppressClick = true;    // удержание — это не клик по предмету
          const live = inventoryRow(findCard(card.id), rowEl.dataset.item);
          if (!live || !live.secret || live.revealed) { phase = ''; return; }
          start();
        }, 500);
      });
      icon.addEventListener('pointerup', function () {
        cancelHold();
        if (phase === 'draw') clearReveal();   // после начала вспышки не прерываем
      });
      icon.addEventListener('pointerleave', function () {
        cancelHold();
      });
      icon.addEventListener('pointercancel', function () {
        cancelHold();
        if (phase === 'draw' || phase === 'flash') clearReveal();
      });
      icon.addEventListener('click', function () {
        if (suppressClick) { suppressClick = false; return; }
        openInventoryItemView(card.id, rowEl.dataset.item);
      });
      icon.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    });
  }

  function buffTargetName(ef) {
    const t = ef && findCard(ef.target);
    return t ? t.name : App.t('fxNoTarget');
  }

  // v91: на карточке баффа — только короткие чипы. Полная формулировка
  // («−2 максимум → Здоровье») живёт в подсказке и в развёрнутом окне,
  // иначе три эффекта превращают карточку в простыню.
  function buffBody(card) {
    const list = (card.effects || []).filter(function (ef) { return ef && ef.target; });
    const h = Math.round(num(card.h) || 120);
    const desk = isDesktop();
    // на телефоне высота карточки auto (сетка), поэтому ориентируемся на ширину
    // и показываем описание всегда; на ПК — по фактической высоте
    const maxChips = desk ? (h >= 200 ? 4 : (h >= 160 ? 3 : 2)) : 4;
    const shown = list.slice(0, maxChips);
    const more = list.length - shown.length;
    const chips = shown.map(function (ef) {
      const full = fxShort(ef) + ' → ' + buffTargetName(ef);
      return '<span class="buff-chip" title="' + esc(full) + '">' +
        '<span class="buff-chip-v">' + esc((ef.label ? '✎ ' : '') + (ef.label || fxChipShort(ef))) + '</span>' +
        '<span class="buff-chip-t">' + esc(buffTargetName(ef)) + '</span>' +
      '</span>';
    }).join('');
    const moreBtn = more > 0
      ? '<button type="button" class="buff-chip buff-chip-more" data-act="buff-expand" title="' + esc(App.t('buffAllEffects')) + '">+' + more + '</button>'
      : '';
    const desc = (card.description || '').trim();
    // v114: таймер — только у временного баффа
    const dur = num(card.duration);
    const left = Math.max(0, num(card.left));
    const timer = dur > 0
      ? '<span class="buff-chip buff-timer" title="' + esc(App.tf('buffTimerHint', { n: left })) + '">⏱ ' + left + '</span>'
      : '';
    // v91: описание показываем всегда — на 120 одной строкой, на 200 двумя.
    // Длинный текст всё равно живёт в ⤢; пустое место внизу карточки выглядело
    // как незаконченный макет.
    const showDesc = !!desc;
    const descCls = (desk && h < 200) ? ' one-line' : '';
    return '<div class="card-body buff-body">' +
      (chips || moreBtn || timer
        ? '<div class="buff-chips">' + timer + chips + moreBtn + '</div>'
        : '<div class="buff-empty">' + esc(App.t('buffNoEffects')) + '</div>') +
      (showDesc ? '<div class="desc-text buff-desc' + descCls + '">' + esc(desc) + '</div>' : '') +
    '</div>';
  }

  function bindCard(card) {
    const el = document.querySelector('.card[data-id="' + card.id + '"]');
    if (!el) return;
    el.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { handleAction(card.id, btn.dataset, e); });
    });
    // v147: полоса закладок заметки после выбора страницы остаётся раскрытой,
    // пока мышь на ней. Ушла мышь — сворачиваем. Для тача не срабатываем:
    // палец «уходит» сразу после касания, и полоса закрывалась бы на каждом тапе.
    const noteRail = el.querySelector('.note-tab-rail');
    if (noteRail) {
      noteRail.addEventListener('pointerleave', function (ev) {
        if (ev.pointerType !== 'mouse') return;
        noteRail.classList.remove('open');
      });
    }
    // описание целиком: клик по тексту — модалка «просмотр полностью»
    // v91: у баффа клик по тексту — это тумблер, поэтому «развернуть» только кнопкой ⤢
    const desc = el.querySelector('.desc-text');
    if (card.type !== 'buff' && desc && (card.description || '').trim()) {
      desc.classList.add('readable');
      desc.addEventListener('click', function () { openTextModal(card.name, card.description); });
    }
    // заметка: прокрутка внутри карточки + клик — страницы во втором слое
    const note = el.querySelector('.note-text');
    if (note) {
      note.classList.add('readable');
      note.addEventListener('click', function () { openLabelLayer(card.id); });
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
    // v91: бафф — тап по карточке включает/выключает. В правке не трогаем,
    // иначе перетаскивание карточки заканчивалось бы переключением эффектов.
    if (card.type === 'buff') {
      let downX = 0, downY = 0, downT = 0;
      el.addEventListener('pointerdown', function (e) {
        downX = e.clientX; downY = e.clientY; downT = Date.now();
      });
      el.addEventListener('click', function (e) {
        if (editMode || e.ctrlKey || e.metaKey) return;
        if (e.target.closest('button, .handle, .resize-handle, .kebab, .tools')) return;
        if (Math.abs(e.clientX - downX) > 10 || Math.abs(e.clientY - downY) > 10) return;
        if (downT && Date.now() - downT > 650) return;
        mutateWithMaxFill(function () {
          const c = findCard(card.id);
          if (!c) return;
          c.on = !c.on;
          // v114: включили временный бафф — таймер начинается заново
          if (c.on && num(c.duration) > 0) c.left = num(c.duration);
          // v152: щит баффа живёт, пока бафф включён
          reconcileBuffShield(c);
        });
      });
    }
    if (card.type === 'inventory') bindInventoryReveal(card, el);
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
  function stateEntries(ch) {
    const set = stateSetOf(ch);
    return set && Array.isArray(set.entries) ? set.entries : [];
  }

  // ===== Паки предметов (v94) =====
  // Отдельный ключ: каталог не входит в state, не попадает в undo и не
  // переписывается при каждом изменении листа. У персонажа — только галочки.
  let packsStore = null;

  function itemCategoryLabel(id) {
    const cat = ITEM_CATEGORIES.find(function (c) { return c.id === id; }) || ITEM_CATEGORIES[2];
    return App.t(cat.labelKey);
  }

  function normalizePackItem(raw) {
    const it = raw && typeof raw === 'object' ? raw : {};
    const cat = ITEM_CATEGORIES.some(function (c) { return c.id === it.category; }) ? it.category : 'misc';
    const secret = it.secret && typeof it.secret === 'object' ? {
      text: String(it.secret.text || ''),
      name: String(it.secret.name || ''),
      category: ITEM_CATEGORIES.some(function (c) { return c.id === it.secret.category; }) ? it.secret.category : '',
      damage: String(it.secret.damage || ''),
      weight: (it.secret.weight === '' || it.secret.weight == null) ? null : num(it.secret.weight),
      price: String(it.secret.price || ''),
      description: String(it.secret.description || ''),
      effects: Array.isArray(it.secret.effects) ? it.secret.effects.map(normalizeItemEffect) : []
    } : null;
    return {
      id: String(it.id || uid()),
      name: String(it.name || ''),
      icon: itemIconId(it.icon, cat),
      category: cat,
      weight: (it.weight === '' || it.weight == null) ? null : num(it.weight),
      damage: String(it.damage || ''),
      price: String(it.price || ''),
      description: String(it.description || it.effect || ''),
      secret: secret,
      effects: Array.isArray(it.effects) ? it.effects.map(normalizeItemEffect) : []
    };
  }

  // v115: старые «переполнения» (current > max) становятся явным щитом.
  // Максимум берём только числовой: выражения на этапе загрузки не посчитать,
  // такие карточки оставляем как есть (их поправит первый рендер/правка).
  function migrateShields(st) {
    (st.characters || []).forEach(function (ch) {
      (ch.cards || []).forEach(function (card) {
        if (card.type !== 'counter') return;
        if (!Array.isArray(card.shieldParts)) card.shieldParts = [];
        const old = num(card.shield);
        if (old > 0 && !card.shieldParts.length) {
          card.shieldParts.push({ id: uid(), amount: old, left: null });
        }
        const rawMax = typeof card.max === 'number' ? card.max
          : (typeof card.max === 'string' && /^\s*-?\d+(?:[.,]\d+)?\s*$/.test(card.max) ? Number(String(card.max).replace(',', '.')) : null);
        if (rawMax != null && rawMax > 0 && num(card.current) > rawMax) {
          const excess = num(card.current) - rawMax;
          card.current = rawMax;
          card.shieldParts.push({ id: uid(), amount: excess, left: null });
        }
        card.shield = card.shieldParts.reduce(function (s, p) { return s + num(p.amount); }, 0);
      });
    });
  }

  // v111: старая цель строки (row.target / targets) переезжает в разовые эффекты.
  // Идемпотентно: если у эффекта уже есть цель, не трогаем.
  function migrateItemTargets(st) {
    (st.characters || []).forEach(function (ch) {
      (ch.cards || []).forEach(function (card) {
        if (card.type !== 'inventory') return;
        (card.items || []).forEach(function (row) {
          const legacy = row.target || (Array.isArray(row.targets) && row.targets[0]);
          if (!legacy) return;
          const fill = function (list) {
            (list || []).forEach(function (ef) {
              if (ef && ef.field === 'current' && !ef.target) ef.target = String(legacy);
            });
          };
          fill(row.effects);
          if (row.secret) fill(row.secret.effects);
        });
      });
    });
  }

  function normalizeInventoryRow(raw) {
    const base = normalizePackItem(raw);
    const row = Object.assign(base, {
      itemId: raw && raw.itemId ? String(raw.itemId) : null,
      packId: raw && raw.packId ? String(raw.packId) : null,
      qty: Math.max(1, Math.round(num(raw && raw.qty) || 1)),
      equipped: !!(raw && raw.equipped),
      target: raw && raw.target ? String(raw.target) : (raw && Array.isArray(raw.targets) && raw.targets[0] ? String(raw.targets[0]) : null),
      targets: raw && Array.isArray(raw.targets) ? raw.targets.slice() : null,
      revealed: !!(raw && raw.revealed)
    });
    // v111: цель разового эффекта переехала из строки в сам эффект.
    // Старые строки (row.target, массив targets) читаем без потери выбора.
    const legacy = row.target || (row.targets && row.targets[0]);
    if (legacy) {
      row.effects.forEach(function (ef) {
        if (ef.field === 'current' && !ef.target) ef.target = String(legacy);
      });
    }
    return row;
  }

  function effectiveInventoryRow(row) {
    if (!row.revealed || !row.secret) return row;
    const s = row.secret;
    const cat = s.category || row.category;
    return Object.assign({}, row, {
      name: s.name || row.name,
      icon: itemIconId(row.icon, cat),
      category: cat,
      damage: s.damage || row.damage,
      weight: (s.weight !== '' && s.weight != null) ? s.weight : row.weight,
      price: s.price || row.price,
      description: s.description || row.description,
      effects: (s.effects && s.effects.length) ? s.effects : row.effects,
      equipped: row.equipped
    });
  }

  // v107: эффект предмета нормализуется общим способом и больше не теряет
  // цель/длительность/незнакомые поля (раньше timing и target выбрасывались).
  function normalizeItemEffect(ef) {
    return normalizeEffect(ef, { mode: 'add', field: 'bonus', target: null });
  }

  function readPacks() {
    if (packsStore) return packsStore;
    try {
      const raw = JSON.parse(localStorage.getItem(PACKS_KEY) || 'null');
      if (raw && Array.isArray(raw.packs)) {
        packsStore = {
          version: 1,
          seeded: true,
          packs: raw.packs.map(function (p) {
            return {
              id: String(p.id || uid()),
              name: String(p.name || App.t('packDefaultName')),
              items: Array.isArray(p.items) ? p.items.map(normalizePackItem) : []
            };
          })
        };
        return packsStore;
      }
    } catch (e) { /* битый файл — начинаем с пустого */ }
    packsStore = { version: 1, seeded: false, packs: [] };
    return packsStore;
  }

  function savePacks() {
    try { localStorage.setItem(PACKS_KEY, JSON.stringify(readPacks())); }
    catch (e) { toast(App.t('packSaveError')); }
  }

  function packsList() { return readPacks().packs; }
  function packById(id) { return packsList().find(function (p) { return p.id === id; }) || null; }
  function charPacks(ch) {
    if (!ch) return {};
    if (!ch.packs || typeof ch.packs !== 'object') ch.packs = {};
    return ch.packs;
  }
  function packUsedBy(packId) {
    return state.characters.filter(function (c) { return !!charPacks(c)[packId]; }).length;
  }

  function ensurePacks() {
    const store = readPacks();
    let changed = false;
    state.characters.forEach(function (ch) {
      if (!ch.packs || typeof ch.packs !== 'object') { ch.packs = {}; changed = true; }
    });
    if (!store.packs.length && !store.seeded) {
      // миграция старой заготовки наборов предметов (v71), если там что-то было
      const legacySets = state.libraries && Array.isArray(state.libraries.items) ? state.libraries.items : [];
      const legacy = legacySets.find(function (s) { return s && Array.isArray(s.entries) && s.entries.length; });
      const pack = {
        id: uid(),
        name: legacy ? setDisplayName(legacy) : App.t('packDefaultName'),
        items: legacy ? legacy.entries.map(function (e) { return normalizePackItem(e); }) : []
      };
      store.packs.push(pack);
      store.seeded = true;
      changed = true;
      if (legacy) {
        state.characters.forEach(function (ch) {
          if (ch.itemSets && ch.itemSets[0] === legacy.id) charPacks(ch)[pack.id] = true;
        });
      }
    }
    if (changed) savePacks();
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
  // v142: старые заметки хранили один card.text — переносим в первую страницу
  function migrateNotePages() {
    let changed = false;
    state.characters.forEach(function (ch) {
      (ch.cards || []).forEach(function (card) {
        if (ensureNotePages(card)) changed = true;
      });
    });
    if (changed) save();
  }

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
    mutateWithMaxFill(function () {
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
    mutateWithMaxFill(function () { card.conditions = []; });
  }

  // v153: шаблон → активный снимок. Тем же кодом обновляем состояния сразу
  // после сохранения шаблона (этап 3.6); отдельной кнопки «обновить» больше нет.
  // Правила: meta берём из шаблона; личные эффекты с целью сохраняются,
  // ручные переопределения (custom) не затираются, цели остаются по индексу.
  function applyEntryToSnapshot(card, snap, entry, setId) {
    const memKey = condMemoryKey(snap);
    const own = condPersonalEffects(card, memKey, snap.key);
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
    if (setId) snap.setId = setId;
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
      if (!card.condEffects) card.condEffects = {};
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
  }

  function snapshotMatchesEntry(snap, entry) {
    return !!((entry.entryId && snap.entryId === entry.entryId) ||
      (entry.key && snap.key === entry.key));
  }

  // v153: активные снимки персонажа, который перешёл на копию набора, должны
  // ссылаться на копию — иначе «обновить из набора» ищет запись в старом наборе.
  function relinkSnapshotsToSet(fromId, toId) {
    (state.characters || []).forEach(function (ch) {
      if (!(ch.stateSets || [])[0] || ch.stateSets[0] !== toId) return;
      (ch.cards || []).forEach(function (card) {
        if (card.type !== 'condition') return;
        (card.conditions || []).forEach(function (snap) {
          if (snap.setId === fromId || snap.setId === toId) snap.setId = toId;
        });
      });
    });
  }

  // v153: после сохранения шаблона обновляем активные состояния у ВСЕХ
  // персонажей: набор общий на устройстве, иначе у второго листа остались бы
  // старые числа. Цели сохраняются (см. applyEntryToSnapshot).
  function syncEntryToCharacters(set, entry) {
    let n = 0;
    (state.characters || []).forEach(function (ch) {
      (ch.cards || []).forEach(function (card) {
        if (card.type !== 'condition') return;
        (card.conditions || []).forEach(function (snap) {
          if (!snapshotMatchesEntry(snap, entry)) return;
          applyEntryToSnapshot(card, snap, entry, set.id);
          n++;
        });
      });
    });
    return n;
  }

  // ===== Тики (слой 2) =====
  // Тик — не модификатор: он меняет current один раз. Источником может быть
  // состояние, бафф с тиком или надетое снаряжение — все они приходят из
  // collectEffects. Длительность уменьшается в конце хода/при ручном
  // применении; у состояния на нуле оно снимается, у баффа — выключается.
  function hasTicksOrDuration(ch) {
    return (ch && ch.cards || []).some(function (card) {
      if (card.type === 'condition') {
        return (card.conditions || []).some(function (s) {
          return (s.effects || []).some(function (ef) { return ef.mode === 'tick'; }) || num(s.duration) > 0;
        });
      }
      if (card.type === 'buff') {
        return !!card.on && (num(card.duration) > 0 ||
          (card.effects || []).some(function (ef) { return ef.mode === 'tick'; }));
      }
      if (card.type === 'inventory') {
        return (card.items || []).some(function (row) {
          return row.equipped && (effectiveInventoryRow(row).effects || []).some(function (ef) { return ef.mode === 'tick'; });
        }) || (card.itemActive || []).some(function (a) {
          return a.ef && (a.ef.mode === 'tick' || num(a.left) > 0);
        });
      }
      if (card.type === 'counter') {
        return shieldPartsOf(card).some(function (p) { return num(p.left) > 0; });
      }
      return false;
    });
  }
  function applyTicksForChar(ch, timing, manual) {
    const parts = [], expired = [];
    let durationChanged = false;
    // 1. события: кто угодно с mode:'tick' — через единый реестр эффектов
    collectEffects(ch).forEach(function (it) {
      const ef = it.ef;
      if (!ef || ef.mode !== 'tick') return;
      if (!manual && (ef.timing || 'start') !== timing) return;
      const t = findCard(ef.target);
      if (!t || t.type !== 'counter') return;
      const delta = exprNumber(t, ef.value);
      if (delta == null || !Number.isFinite(delta) || delta === 0) return;
      const res = applyEvent(t, delta > 0 ? { kind: 'heal', value: delta } : { kind: 'damage', value: -delta });
      const bits = [];
      if (res.hp) bits.push((res.hp > 0 ? '+' : '−') + Math.abs(res.hp));
      if (res.shield) bits.push((res.shield > 0 ? '+' : '−') + Math.abs(res.shield) + ' ' + App.t('shieldShort'));
      if (!bits.length) return;   // лечение в полный максимум ничего не изменило
      // v88: в тосте — кто сработал и что изменилось: «Яд: Здоровье −1»
      parts.push((it.name ? it.name + ': ' : '') + t.name + ' ' + bits.join(' / '));
    });
    // 2. длительности — один раз за проход
    if (manual || timing === 'end') {
      (ch.cards || []).forEach(function (card) {
        if (card.type === 'condition') {
          const keep = [];
          (card.conditions || []).forEach(function (snap) {
            const dur = num(snap.duration);
            if (dur > 0) {
              snap.duration = dur - 1;
              durationChanged = true;
              if (snap.duration <= 0) { expired.push(snap.name || ''); return; }
            }
            keep.push(snap);
          });
          card.conditions = keep;
        } else if (card.type === 'buff' && card.on) {
          const dur = num(card.duration);
          if (dur > 0) {
            const at = num(card.left) > 0 ? num(card.left) : dur;
            card.left = Math.max(0, at - 1);
            durationChanged = true;
            if (card.left <= 0) { card.on = false; clearBuffShield(card); expired.push(card.name || ''); }
          }
        } else if (card.type === 'inventory') {
          // v124: временные эффекты предметов тикают в карточке инвентаря
          const list = card.itemActive || [];
          if (!list.length) return;
          let changed = false;
          const keep = [];
          list.forEach(function (a) {
            const l = num(a.left);
            if (l > 0) {
              a.left = l - 1;
              changed = true;
              durationChanged = true;
              if (a.left > 0) keep.push(a);
            } else {
              keep.push(a);
            }
          });
          if (changed) card.itemActive = keep;
        } else if (card.type === 'counter') {
          // v115: временный щит снимается по ходам, постоянный остаётся
          const parts = shieldPartsOf(card);
          if (!parts.length) return;
          let changed = false;
          const keep = [];
          parts.forEach(function (p) {
            const l = num(p.left);
            if (l > 0) {
              p.left = l - 1;
              changed = true;
              durationChanged = true;
              if (p.left > 0) keep.push(p);
            } else {
              keep.push(p);
            }
          });
          if (changed) { card.shieldParts = keep; syncShield(card); }
        }
      });
    }
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
    if (!hasTicksOrDuration(ch)) { toast(App.t('condTicksNone')); return; }
    let sum = null;
    mutateWithMaxFill(function () { sum = applyTicksForChar(ch, 'end', true); });
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
  // v148: сохранить изменения состояния в набор и снять состояние (не удалить)
  const COND_UNSET_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M6.5 17.5L17.5 6.5"/></svg>';
  // Иконка «экспорт набора» в шапке набора (в настройках)
  const SET_EXPORT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v11"/><path d="M8 10l4 4 4-4"/><path d="M4 17v3h16v-3"/></svg>';

  // ===== Эффекты состояния: «на что влияет» (v77) =====
  // Эффект хранится на карточке (card.condEffects по ключу состояния), а не в наборе:
  // набор общий для всех персонажей устройства, а цель — id карточки конкретного листа.
  // Поэтому набор может отключаться/сменяться без потери привязок.
  const FX_MODE_KEYS = { add: 'fxOpAdd', mul: 'fxOpMul', div: 'fxOpDiv', set: 'fxOpSet', cap: 'fxOpCap', dice: 'fxOpDice', block: 'fxOpBlock', tick: 'fxOpTick', adv: 'fxOpAdv', dis: 'fxOpDis' };
  const FX_MODE_SHORT_KEYS = { add: 'fxOpAddShort' };
  function fxModeShort(mode) { return App.t(FX_MODE_SHORT_KEYS[mode] || FX_MODE_KEYS[mode] || 'fxOpAdd'); }
  const FX_FIELD_KEYS = { bonus: 'fxFieldBonus', max: 'fxFieldMax', value: 'fxFieldValue', charges: 'fxFieldCharges', current: 'fxFieldCurrent', shield: 'fxFieldShield' };
  // v91: короткие имена полей для чипов на карточке; полные остаются в редакторе
  // и в подсказке, чтобы «−2 макс» не превращалось в «−2 максимум → Здоровье».
  const FX_SHORT_FIELD_KEYS = { bonus: 'fxShortBonus', max: 'fxShortMax', value: 'fxShortValue', charges: 'fxShortCharges', current: 'fxShortCurrent', shield: 'fxShortShield' };
  function fxFieldText(field) { return App.t(FX_FIELD_KEYS[field] || 'fxFieldBonus'); }
  function fxChipShort(ef) {
    const f = App.t(FX_SHORT_FIELD_KEYS[effectField(ef)] || 'fxShortBonus');
    if (ef.mode === 'block') return App.t('fxOpBlockShort');
    if (effectField(ef) === 'shield') return '🛡 ' + String(ef.value == null ? '' : ef.value).replace(/^\+/, '').trim();
    if (ef.mode === 'adv') return App.t('fxOpAdvShort') + (num(ef.value) > 1 ? ' ×' + num(ef.value) : '');
    if (ef.mode === 'dis') return App.t('fxOpDisShort') + (num(ef.value) > 1 ? ' ×' + num(ef.value) : '');
    let s = String(ef.value == null ? '' : ef.value).trim();
    if (ef.mode === 'dice') return '+' + s.replace(/^\+/, '');
    if (ef.mode === 'mul') return '×' + s.replace(/^[*×]/, '') + ' ' + f;
    if (ef.mode === 'div') return '÷' + s.replace(/^[/÷]/, '') + ' ' + f;
    if (ef.mode === 'set') return '= ' + s + ' ' + f;
    if (ef.mode === 'cap') return '≤ ' + s + ' ' + f;
    if (ef.mode === 'tick') return '⏱ ' + s + ' ' + f;
    s = s.replace(/^\+/, '');
    return (s.charAt(0) === '-' ? '−' + s.slice(1) : '+' + s) + ' ' + f;
  }
  function fxShort(ef) {
    const f = fxFieldText(effectField(ef));
    if (ef.mode === 'block') return App.t('fxOpBlock');
    if (effectField(ef) === 'shield') return '🛡 ' + String(ef.value == null ? '' : ef.value).replace(/^\+/, '').trim();
    if (ef.mode === 'adv') return App.t('fxOpAdv') + ' → ' + f + (num(ef.value) > 1 ? ' ×' + num(ef.value) : '');
    if (ef.mode === 'dis') return App.t('fxOpDis') + ' → ' + f + (num(ef.value) > 1 ? ' ×' + num(ef.value) : '');
    if (ef.mode === 'tick') return '⏱ ' + (ef.value == null ? '' : ef.value) + ' ' + f;
    if (ef.mode === 'dice') return '+' + (ef.value || '') + ' ' + f;
    if (ef.mode === 'mul') return '×' + String(ef.value == null ? '' : ef.value).replace(/^[*×]/, '') + ' ' + f;
    if (ef.mode === 'div') return '÷' + String(ef.value == null ? '' : ef.value).replace(/^[/÷]/, '') + ' ' + f;
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

  // ===== v153: общий редактор эффекта (модалка) =====
  // Хранимый эффект не меняется: {mode, field, value, label, target, timing}.
  // Черновик переводит его в «суть» (Число / Бросок / Доп. кубик / Каждый ход /
  // Запрет / Щит) и обратно, поэтому старые записи открываются без потерь.
  // Контекст задаёт только доступное: цели, поля, режимы — форма одна.
  const FX_KIND_ORDER = ['number', 'roll', 'die', 'tick', 'block', 'shield'];
  const FX_KIND_GLYPHS = { roll: '▲▼', die: '🎲', tick: '⏱', block: '⊘', shield: '🛡' };
  const FX_KIND_LABEL_KEYS = { number: 'fxKindNumber', roll: 'fxKindRoll', die: 'fxKindDie', tick: 'fxKindTick', block: 'fxKindBlock', shield: 'fxKindShield' };
  const FX_KIND_HINT_KEYS = { number: 'fxHintNumber', roll: 'fxHintRoll', die: 'fxHintDie', tick: 'fxHintTick', block: 'fxHintBlock', shield: 'fxHintShield' };
  const FX_KIND_FIELDS = { roll: 'bonus', die: 'bonus', tick: 'current', block: 'charges', shield: 'shield' };
  const FX_MATH_MODES = ['add', 'mul', 'div', 'set', 'cap'];
  const FX_DIE_SIDES = [4, 6, 8, 10, 12, 20];

  let fxLayerState = null;   // {d, cfg, error, edit}
  let fxLayerReturn = null;  // куда вернуть фокус после закрытия

  function fxIsOpen() {
    const m = document.getElementById('fxModal');
    return !!m && !m.classList.contains('hidden');
  }

  // «Изменить» — это +, −, × или ÷: операцию задаёт первый символ значения.
  // Без символа считаем прибавлением — одна кнопка покрывает всё.
  function fxResolveValueMode(uiMode, raw) {
    let value = String(raw == null ? '' : raw).trim();
    let mode = uiMode;
    if (uiMode === 'edit') {
      if (/^[×*]/.test(value)) { mode = 'mul'; value = value.replace(/^[×*]\s*/, ''); }
      else if (/^[/÷]/.test(value)) { mode = 'div'; value = value.replace(/^[/÷]\s*/, ''); }
      else { mode = 'add'; value = value.replace(/^\+\s*/, ''); }
    } else if (uiMode === 'set') {
      value = value.replace(/^=\s*/, '');
    } else if (uiMode === 'cap') {
      value = value.replace(/^≤\s*/, '');
    }
    return { mode: mode, value: value };
  }

  // «2d6»; старые записи «6» читаем как 1d6, мусор — как 1d6
  function fxDieParts(raw) {
    const s = String(raw == null ? '' : raw).trim();
    const m = /^(\d*)d(\d+)$/i.exec(s);
    if (m) {
      return { count: Math.max(1, Math.min(99, parseInt(m[1] || '1', 10) || 1)), sides: parseInt(m[2], 10) };
    }
    const n = parseInt(s, 10);
    if (isFinite(n) && n > 1) return { count: 1, sides: n };
    return { count: 1, sides: 6 };
  }

  function fxHasMode(cfg, field, mode, target) {
    return (cfg.modesFor(field, target) || []).indexOf(mode) !== -1;
  }
  // поля для «Числа»: текущее и щит — отдельные виды эффекта, не поле числа
  function fxNumberFields(cfg, target) {
    return (cfg.fieldsFor(target) || []).filter(function (f) {
      if (f === 'shield' || f === 'current') return false;
      return FX_MATH_MODES.some(function (m) { return fxHasMode(cfg, f, m, target); });
    });
  }
  function fxAvailableKinds(cfg, target) {
    return (cfg.kinds || FX_KIND_ORDER).filter(function (k) {
      if (k === 'number') return fxNumberFields(cfg, target).length > 0;
      if (k === 'roll') return fxHasMode(cfg, 'bonus', 'adv', target) || fxHasMode(cfg, 'bonus', 'dis', target);
      if (k === 'die') return fxHasMode(cfg, 'bonus', 'dice', target);
      if (k === 'tick') return fxHasMode(cfg, 'current', 'tick', target);
      if (k === 'block') return fxHasMode(cfg, 'charges', 'block', target);
      if (k === 'shield') return (cfg.fieldsFor(target) || []).indexOf('shield') !== -1;
      return false;
    });
  }
  function fxTargetsFor(cfg, kind, field) {
    if (!cfg.targetsFor) return null;
    return cfg.targetsFor(kind, field) || [];
  }

  function fxNewDraft() {
    return { kind: 'number', mode: 'edit', field: '', target: null,
             value: '', label: '', timing: 'start', duration: '' };
  }

  function fxDraftFromEffect(ef) {
    const d = fxNewDraft();
    if (!ef) return d;
    const mode = ef.mode || 'add';
    const field = effectField(ef);
    let value = String(ef.value == null ? '' : ef.value);
    d.label = ef.label || '';
    d.target = ef.target || null;
    d.timing = ef.timing === 'end' ? 'end' : 'start';
    d.duration = ef.duration == null ? '' : String(ef.duration);
    if (mode === 'adv' || mode === 'dis') {
      d.kind = 'roll'; d.mode = mode; d.field = 'bonus';
      d.value = String(Math.max(1, num(ef.value) || 1));
    } else if (mode === 'dice') {
      const p = fxDieParts(value);
      d.kind = 'die'; d.mode = 'dice'; d.field = 'bonus';
      d.value = p.count + 'd' + p.sides;
    } else if (mode === 'tick') {
      d.kind = 'tick'; d.mode = 'tick'; d.field = 'current'; d.value = value;
    } else if (mode === 'block') {
      d.kind = 'block'; d.mode = 'block'; d.field = 'charges'; d.value = '';
    } else if (field === 'shield') {
      d.kind = 'shield'; d.mode = 'edit'; d.field = 'shield'; d.value = value.replace(/^\+/, '');
    } else {
      d.kind = 'number'; d.field = field;
      if (mode === 'mul') { d.mode = 'edit'; d.value = '×' + value.replace(/^[*×]\s*/, ''); }
      else if (mode === 'div') { d.mode = 'edit'; d.value = '÷' + value.replace(/^[/÷]\s*/, ''); }
      else if (mode === 'set') { d.mode = 'set'; d.value = value.replace(/^=\s*/, ''); }
      else if (mode === 'cap') { d.mode = 'cap'; d.value = value.replace(/^≤\s*/, ''); }
      else { d.mode = 'edit'; d.value = value; }
    }
    return d;
  }

  // подгоняем черновик под контекст: цель, вид, поле.
  // Вид из старой записи не выкидываем, иначе эффект молча потеряет смысл.
  function fxClampDraft(d, cfg, keepKind) {
    const targets = fxTargetsFor(cfg, d.kind, d.field);
    if (targets) {
      if (!targets.some(function (c) { return c.id === d.target; })) {
        d.target = targets.length ? targets[0].id : null;
      }
    } else {
      d.target = null;
    }
    const kinds = fxAvailableKinds(cfg, d.target);
    if (kinds.indexOf(d.kind) === -1 && !keepKind) d.kind = kinds[0] || 'number';
    if (d.kind === 'number') {
      const fields = fxNumberFields(cfg, d.target);
      if (fields.indexOf(d.field) === -1) d.field = fields[0] || '';
      if (['edit', 'set', 'cap'].indexOf(d.mode) === -1) d.mode = 'edit';
    } else {
      d.field = FX_KIND_FIELDS[d.kind] || d.field;
      if (d.kind === 'roll') {
        if (d.mode !== 'adv' && d.mode !== 'dis') d.mode = 'adv';
      } else if (d.kind === 'die') d.mode = 'dice';
      else if (d.kind === 'tick') d.mode = 'tick';
      else if (d.kind === 'block') d.mode = 'block';
      else if (d.kind === 'shield') d.mode = 'edit';
    }
  }

  function fxEffectFromDraft(d, cfg) {
    const ef = { mode: 'add', field: 'bonus', value: '', label: (d.label || '').trim(), target: null };
    if (cfg.targetsFor) {
      if (!d.target && !cfg.targetOptional) {
        const list = fxTargetsFor(cfg, d.kind, d.field) || [];
        return { error: { where: 'target', key: list.length ? 'fxNeedTarget' : 'fxNoTargets' } };
      }
      ef.target = d.target || null;
    }
    const raw = String(d.value == null ? '' : d.value).trim();
    if (d.kind === 'number') {
      const r = fxResolveValueMode(d.mode, raw);
      if (!r.value) return { error: { where: 'value', key: 'fxValueNeeded' } };
      if (r.mode === 'div' && /^[-+]?0+(\.0+)?$/.test(r.value)) {
        return { error: { where: 'value', key: 'fxDivByZero' } };
      }
      ef.mode = r.mode;
      ef.field = d.field;
      ef.value = r.value;
    } else if (d.kind === 'roll') {
      if (!/^\d+$/.test(raw) || parseInt(raw, 10) < 1) {
        return { error: { where: 'value', key: 'fxBadRolls' } };
      }
      ef.mode = d.mode === 'dis' ? 'dis' : 'adv';
      ef.field = 'bonus';
      ef.value = String(Math.min(99, parseInt(raw, 10)));
    } else if (d.kind === 'die') {
      const p = fxDieParts(raw);
      if (FX_DIE_SIDES.indexOf(p.sides) === -1) return { error: { where: 'value', key: 'fxBadDie' } };
      ef.mode = 'dice';
      ef.field = 'bonus';
      ef.value = p.count + 'd' + p.sides;
    } else if (d.kind === 'tick') {
      if (!raw) return { error: { where: 'value', key: 'fxValueNeeded' } };
      ef.mode = 'tick';
      ef.field = 'current';
      ef.value = raw;
      ef.timing = d.timing === 'end' ? 'end' : 'start';
    } else if (d.kind === 'block') {
      ef.mode = 'block';
      ef.field = 'charges';
      ef.value = '';
    } else if (d.kind === 'shield') {
      if (!raw) return { error: { where: 'value', key: 'fxValueNeeded' } };
      ef.mode = 'add';
      ef.field = 'shield';
      ef.value = raw;
    }
    if (cfg.allowDuration && d.kind !== 'block') {
      ef.duration = num(d.duration) > 0 ? Math.round(num(d.duration)) : null;
    }
    // битую формулу ловим сразу, но только когда есть цель: в шаблоне
    // ссылки на карточки ещё не к чему привязать
    if (cfg.targetsFor && d.target && (d.kind === 'number' || d.kind === 'tick')) {
      const t = findCard(d.target);
      if (t && exprNumber(t, ef.value) == null) {
        return { error: { where: 'value', key: 'fxBadFormula' } };
      }
    }
    return { ef: ef };
  }

  function fxKindChip(kind, active) {
    const g = FX_KIND_GLYPHS[kind];
    return '<button type="button" class="fx-chip' + (active ? ' on' : '') + '" data-fx-kind="' + kind + '"' +
      ' aria-pressed="' + (active ? 'true' : 'false') + '">' +
      (g ? '<span class="fx-g">' + g + '</span>' : '') + esc(App.t(FX_KIND_LABEL_KEYS[kind])) + '</button>';
  }

  // тело модалки: собирается заново на каждое изменение вида/цели/поля
  function fxEditorHTML(d, cfg, error) {
    const kinds = fxAvailableKinds(cfg, d.target);
    if (kinds.indexOf(d.kind) === -1) kinds.push(d.kind);
    const targets = fxTargetsFor(cfg, d.kind, d.field);
    const targetCard = d.target ? findCard(d.target) : null;
    let h = '';

    h += '<div class="fx-group"><div class="fx-group-label">' + esc(App.t('fxGroupDoes')) + '</div>' +
      '<div class="fx-chips">' + kinds.map(function (k) { return fxKindChip(k, k === d.kind); }).join('') + '</div>' +
      '<div class="fx-hint">' + esc(App.t(FX_KIND_HINT_KEYS[d.kind] || 'fxHintNumber')) + '</div></div>';

    if (targets) {
      h += '<div class="fx-group"><div class="fx-group-label">' + esc(App.t('fxGroupWhere')) + '</div>' +
        '<button type="button" class="fx-target-btn' + (!targetCard && !cfg.targetOptional ? ' fx-invalid' : '') + '" data-fx-target-btn aria-haspopup="menu">' +
          '<span>' + esc(targetCard ? targetCard.name : App.t('fxPickTarget')) + '</span>' +
          '<span class="fx-arr">▾</span>' +
        '</button>' +
        (error && error.where === 'target' ? '<div class="fx-error">' + esc(App.t(error.key)) + '</div>' : '') +
        '</div>';
    }

    if (d.kind === 'number') {
      const modes = FX_MATH_MODES.filter(function (m) { return fxHasMode(cfg, d.field, m, d.target); });
      const modeChips = [
        { id: 'edit', on: d.mode === 'edit', key: 'fxModeEdit', need: ['add'] },
        { id: 'set', on: d.mode === 'set', key: 'fxModeSet', need: ['set'] },
        { id: 'cap', on: d.mode === 'cap', key: 'fxModeCap', need: ['cap'] }
      ].filter(function (m) { return m.need.some(function (n) { return modes.indexOf(n) !== -1; }); });
      const fields = fxNumberFields(cfg, d.target);
      h += '<div class="fx-group"><div class="fx-group-label">' + esc(App.t('fxMode')) + '</div>' +
        '<div class="fx-chips">' + modeChips.map(function (m) {
          return '<button type="button" class="fx-chip' + (m.on ? ' on' : '') + '" data-fx-mode="' + m.id + '"' +
            ' aria-pressed="' + (m.on ? 'true' : 'false') + '">' + esc(App.t(m.key)) + '</button>';
        }).join('') + '</div></div>';
      if (fields.length) {
        h += '<div class="fx-group"><div class="fx-group-label">' + esc(App.t('fxField')) + '</div>' +
          '<div class="fx-chips">' + fields.map(function (f) {
            if (fields.length === 1) {
              return '<span class="fx-chip fx-chip-static">' + esc(fxFieldText(f)) + '</span>';
            }
            return '<button type="button" class="fx-chip' + (f === d.field ? ' on' : '') + '" data-fx-field="' + f + '"' +
              ' aria-pressed="' + (f === d.field ? 'true' : 'false') + '">' + esc(fxFieldText(f)) + '</button>';
          }).join('') + '</div></div>';
      }
    }

    if (d.kind !== 'block') {
      let label = App.t('fxGroupValue');
      let row = '';
      if (d.kind === 'roll') {
        label = App.t('fxRollsDir');
        row = '<span class="fx-roll-dirs">' +
            '<button type="button" class="fx-chip' + (d.mode !== 'dis' ? ' on' : '') + '" data-fx-roll="adv"' +
              ' aria-pressed="' + (d.mode !== 'dis' ? 'true' : 'false') + '">▲ ' + esc(App.t('fxOpAdv')) + '</button>' +
            '<button type="button" class="fx-chip' + (d.mode === 'dis' ? ' on' : '') + '" data-fx-roll="dis"' +
              ' aria-pressed="' + (d.mode === 'dis' ? 'true' : 'false') + '">▼ ' + esc(App.t('fxOpDis')) + '</button>' +
          '</span>' +
          '<input type="number" min="1" max="99" step="1" inputmode="numeric" data-fx-input="rolls"' +
            ' value="' + esc(Math.max(1, parseInt(d.value, 10) || 1)) + '" aria-label="' + esc(App.t('fxRollsDir')) + '">';
      } else if (d.kind === 'die') {
        label = App.t('fxDieLabel');
        const p = fxDieParts(d.value);
        row = '<input type="number" min="1" max="99" step="1" inputmode="numeric" data-fx-input="dieCount"' +
            ' value="' + p.count + '" aria-label="' + esc(App.t('fxDieLabel')) + '">' +
          FX_DIE_SIDES.map(function (n) {
            return '<button type="button" class="fx-chip' + (p.sides === n ? ' on' : '') + '" data-fx-die="' + n + '"' +
              ' aria-pressed="' + (p.sides === n ? 'true' : 'false') + '">d' + n + '</button>';
          }).join('');
      } else {
        const ph = d.kind === 'shield' ? '10' : d.kind === 'tick' ? App.t('fxPhTick')
          : d.mode === 'set' ? App.t('fxPhSet') : d.mode === 'cap' ? App.t('fxPhCap') : App.t('fxPhAdd');
        if (d.kind === 'shield') label = App.t('fxShieldAmount');
        row = '<input type="text" autocomplete="off" spellcheck="false" data-fx-input="value"' +
            ' value="' + esc(d.value) + '" placeholder="' + esc(ph) + '" aria-label="' + esc(label) + '">' +
          '<button type="button" class="fx-step" data-fx-step="-1" aria-label="−">−</button>' +
          '<button type="button" class="fx-step" data-fx-step="1" aria-label="+">+</button>';
      }
      h += '<div class="fx-group"><div class="fx-group-label">' + esc(label) + '</div>' +
        '<div class="fx-value-row' + (d.kind === 'die' ? ' fx-die' : d.kind === 'roll' ? ' fx-roll' : '') + '">' + row + '</div>' +
        (error && error.where === 'value' ? '<div class="fx-error">' + esc(App.t(error.key)) + '</div>' : '') +
        '</div>';
    }

    if (d.kind === 'tick') {
      h += '<div class="fx-group"><div class="fx-group-label">' + esc(App.t('fxGroupWhen')) + '</div>' +
        '<div class="fx-chips">' +
          '<button type="button" class="fx-chip' + (d.timing !== 'end' ? ' on' : '') + '" data-fx-timing="start"' +
            ' aria-pressed="' + (d.timing !== 'end' ? 'true' : 'false') + '">' + esc(App.t('fxTimingStart')) + '</button>' +
          '<button type="button" class="fx-chip' + (d.timing === 'end' ? ' on' : '') + '" data-fx-timing="end"' +
            ' aria-pressed="' + (d.timing === 'end' ? 'true' : 'false') + '">' + esc(App.t('fxTimingEnd')) + '</button>' +
        '</div></div>';
    }

    h += '<details class="fx-details"' + ((d.label || (cfg.allowDuration && d.duration)) ? ' open' : '') + '>' +
      '<summary>' + esc(App.t('fxLabelField')) + '</summary>' +
      '<div class="fx-details-body">' +
        '<div class="field"><input type="text" data-fx-input="label" autocomplete="off" spellcheck="false"' +
          ' maxlength="60" value="' + esc(d.label) + '" placeholder="' + esc(App.t('fxLabelPh')) + '"' +
          ' aria-label="' + esc(App.t('fxLabelField')) + '"></div>' +
        (cfg.allowDuration
          ? '<div class="field"><label>' + esc(App.t('fxDuration')) + '</label>' +
              '<input type="number" min="0" max="999" step="1" inputmode="numeric" data-fx-input="duration"' +
              ' value="' + esc(d.duration) + '" placeholder="—"></div>'
          : '') +
      '</div></details>';
    return h;
  }

  function renderFxEditor() {
    const st = fxLayerState;
    const modal = document.getElementById('fxModal');
    if (!st || !modal) return;
    const edit = st.edit;
    document.getElementById('fxTitle').textContent = edit ? App.t('fxEdit') : App.t('fxEffectNewTitle');
    document.getElementById('fxBody').innerHTML = fxEditorHTML(st.d, st.cfg, st.error);
    const act = document.getElementById('fxActions');
    act.innerHTML = '';
    const addBtn = function (label, cls, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (cls) b.className = cls;
      b.addEventListener('click', onClick);
      act.appendChild(b);
    };
    // v154: удаление и дублирование живут только на плашке — в окне не дублируем
    addBtn(App.t('cancel'), '', function () { closeFxEditor(); });
    addBtn(App.t('save'), 'primary', function () { fxTrySave('save'); });
  }

  function fxTrySave(mode) {
    const st = fxLayerState;
    if (!st) return;
    const res = fxEffectFromDraft(st.d, st.cfg);
    if (res.error) {
      st.error = res.error;
      renderFxEditor();
      return;
    }
    st.error = null;
    const cb = st.cfg.onSave;
    closeFxEditor();
    if (cb) cb(res.ef, mode || 'save');
  }

  function fxOpenTargetMenu(anchor) {
    const st = fxLayerState;
    if (!st) return;
    const list = fxTargetsFor(st.cfg, st.d.kind, st.d.field) || [];
    const menu = document.createElement('div');
    menu.className = 'ctxmenu';
    menu.id = 'fxTargetMenu';
    menu.innerHTML = list.length
      ? list.map(function (c) {
          return '<button type="button" data-fx-target="' + esc(c.id) + '">' + esc(c.name) + '</button>';
        }).join('')
      : '<div class="fx-empty">' + esc(App.t('fxNoTargetsHere')) + '</div>';
    menu.addEventListener('click', function (e) {
      const b = e.target.closest('[data-fx-target]');
      if (!b) return;
      st.d.target = b.dataset.fxTarget;
      st.error = null;
      closeMountedMenu(false);
      fxClampDraft(st.d, st.cfg);
      renderFxEditor();
    });
    mountMenu(menu, anchor, { toggle: true });
  }

  function openFxEditor(cfg) {
    if (fxIsOpen()) return;
    const st = {
      cfg: cfg,
      d: fxDraftFromEffect(cfg.effect),
      edit: !!cfg.effect,
      error: null
    };
    fxClampDraft(st.d, cfg, true);
    fxLayerState = st;
    fxLayerReturn = cfg.anchor || document.activeElement;
    const modal = document.getElementById('fxModal');
    document.getElementById('fxBackdrop').classList.remove('hidden');
    modal.classList.remove('hidden');
    renderFxEditor();
    try { modal.focus({ preventScroll: true }); } catch (e) { modal.focus(); }
  }

  function closeFxEditor() {
    if (!fxIsOpen()) return;
    const ret = fxLayerReturn;
    fxLayerReturn = null;
    fxLayerState = null;
    closeMountedMenu(false);
    document.getElementById('fxBackdrop').classList.add('hidden');
    const modal = document.getElementById('fxModal');
    modal.classList.add('hidden');
    document.getElementById('fxTitle').textContent = '';
    document.getElementById('fxBody').innerHTML = '';
    document.getElementById('fxActions').innerHTML = '';
    let target = ret;
    if (!target || !target.isConnected) target = document.querySelector('.fx-add');
    if (target && target.focus) {
      try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
    }
  }

  // один обработчик на всё тело формы: разметка перерисовывается, слушатель остаётся
  function fxOnBodyClick(e) {
    const st = fxLayerState;
    if (!st) return;
    const d = st.d;
    if (e.target.closest('[data-fx-target-btn]')) {
      fxOpenTargetMenu(e.target.closest('[data-fx-target-btn]'));
      return;
    }
    const kind = e.target.closest('[data-fx-kind]');
    if (kind) {
      d.kind = kind.dataset.fxKind;
      d.value = '';
      if (d.kind === 'roll') { d.mode = 'adv'; d.value = '1'; }
      if (d.kind === 'die') d.value = '1d6';
      st.error = null;
      fxClampDraft(d, st.cfg);
      renderFxEditor();
      return;
    }
    const mode = e.target.closest('[data-fx-mode]');
    if (mode) { d.mode = mode.dataset.fxMode; st.error = null; renderFxEditor(); return; }
    const field = e.target.closest('[data-fx-field]');
    if (field) { d.field = field.dataset.fxField; st.error = null; fxClampDraft(d, st.cfg); renderFxEditor(); return; }
    const timing = e.target.closest('[data-fx-timing]');
    if (timing) { d.timing = timing.dataset.fxTiming; renderFxEditor(); return; }
    const roll = e.target.closest('[data-fx-roll]');
    if (roll) { d.mode = roll.dataset.fxRoll; renderFxEditor(); return; }
    const die = e.target.closest('[data-fx-die]');
    if (die) {
      const p = fxDieParts(d.value);
      d.value = p.count + 'd' + die.dataset.fxDie;
      renderFxEditor();
      return;
    }
    const step = e.target.closest('[data-fx-step]');
    if (step) {
      const n = parseInt(d.value, 10);
      if (!isFinite(n)) return;
      d.value = String(n + (step.dataset.fxStep === '1' ? 1 : -1));
      renderFxEditor();
      return;
    }
  }

  function fxOnBodyInput(e) {
    const st = fxLayerState;
    if (!st) return;
    const input = e.target.closest('[data-fx-input]');
    if (!input) return;
    const what = input.dataset.fxInput;
    const d = st.d;
    if (what === 'value') d.value = input.value;
    else if (what === 'label') d.label = input.value;
    else if (what === 'duration') d.duration = input.value;
    else if (what === 'rolls') d.value = String(Math.max(1, Math.min(99, parseInt(input.value, 10) || 1)));
    else if (what === 'dieCount') {
      const p = fxDieParts(d.value);
      d.value = Math.max(1, Math.min(99, parseInt(input.value, 10) || 1)) + 'd' + p.sides;
    }
    if (st.error) {
      st.error = null;
      const errs = document.querySelectorAll('#fxBody .fx-error');
      Array.prototype.forEach.call(errs, function (n) { n.remove(); });
    }
  }

  // Плашки списка эффектов: одна разметка у состояний, предметов и баффов.
  // opts: { emptyText, targets } — targets включает подпись цели (в шаблоне её нет).
  function fxRowSub(ef, opts) {
    const parts = [];
    if (opts && opts.targets && ef.target) {
      const c = findCard(ef.target);
      parts.push(c ? c.name : App.t('fxNoTarget'));
    }
    if (ef.mode === 'tick') parts.push(App.t(ef.timing === 'end' ? 'fxTimingEnd' : 'fxTimingStart'));
    if (num(ef.duration) > 0) parts.push(App.tf('condDurShort', { n: num(ef.duration) }));
    return parts.join(' · ');
  }

  function fxRowsHTML(list, opts) {
    opts = opts || {};
    const items = list || [];
    if (!items.length) {
      return '<div class="fx-empty">' + esc(App.t(opts.emptyText || 'fxNoEffectsYet')) + '</div>';
    }
    return items.map(function (ef, i) {
      const sub = fxRowSub(ef, opts);
      return '<div class="fx-row" data-fx-row="' + i + '">' +
        '<button type="button" class="fx-row-main" data-fx-edit="' + i + '"' +
          ' title="' + esc(fxShort(ef)) + '">' +
          '<b>' + esc(ef.label ? '✎ ' + ef.label : fxChipShort(ef)) + '</b>' +
          (sub ? '<small>' + esc(sub) + '</small>' : '') +
        '</button>' +
        '<button type="button" class="fx-row-btn" data-fx-edit="' + i + '"' +
          ' aria-label="' + esc(App.t('edit')) + '" title="' + esc(App.t('edit')) + '">✎</button>' +
        '<button type="button" class="fx-row-btn" data-fx-dup="' + i + '"' +
          ' aria-label="' + esc(App.t('duplicate')) + '" title="' + esc(App.t('duplicate')) + '">' + DUP_SVG + '</button>' +
        '<button type="button" class="fx-row-btn fx-del" data-fx-del="' + i + '"' +
          ' aria-label="' + esc(App.t('delete')) + '" title="' + esc(App.t('delete')) + '">' + TRASH_SVG + '</button>' +
        '</div>';
    }).join('');
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
  // v155: в игре у эффекта меняется только цель — значение и подпись приходят
  // из шаблона. Пишем в личную память, чтобы цель пережила снятие состояния.
  function setEffectTarget(cardId, stateId, index, targetId) {
    const card = findCard(cardId);
    const live = card && (card.conditions || []).find(function (s) { return s.id === stateId; });
    if (!live) return;
    const list = condEffectList(card, live);
    const ef = list[index];
    if (!ef) return;
    const next = targetId || null;
    if ((ef.target || null) === next) return;
    ef.target = next;
    mutate(function () {
      savePersonalEffects(cardId, condMemoryKey(live) || live.key, list, live.key);
    });
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
          '<button type="button" class="cond-new-state" data-role="newstate">＋ ' + esc(App.t('stAddState')) + '</button>' +
          '<div class="cond-pick" data-role="pick"></div>' +
        '</div>' +
        // справа — живая кукла, кнопки тиков/обновления и список активных состояний
        '<div class="cond-col cond-col-live">' +
          '<div class="cond-preview" data-role="preview"></div>' +
          '<div class="cond-actions">' +
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
        // v155: значение эффекта приходит из шаблона и в игре не правится.
        // У каждого эффекта — только выбор цели, как у предметов.
        const fx = (s.effects || []).map(function (ef, i) {
          const field = effectField(ef);
          const full = fxShort(ef);
          const short = fxChipShort(ef);
          const inactive = ef.mode === 'dice' && field !== 'bonus';
          const lbl = (inactive ? '⚠ ' : (ef.label ? '✎ ' : '')) + (ef.label || short);
          const tip = inactive ? App.t('fxDiceOnlyBonus')
            : (ef.label ? App.tf('fxCustomTip', { text: full }) : full);
          const targets = effectTargetCards(field);
          const chosen = ef.target ? targets.find(function (c) { return c.id === ef.target; }) : null;
          const missing = !!(ef.target && !chosen);
          const noTarget = !chosen;
          const off = inactive || noTarget;
          let opts = '<option value="">' + esc(App.t('fxPickTarget')) + '</option>';
          opts += targets.map(function (c) {
            return '<option value="' + esc(c.id) + '"' + (chosen && c.id === chosen.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
          }).join('');
          if (missing) {
            opts += '<option value="' + esc(ef.target) + '" selected disabled>' + esc(App.t('fxNoTarget')) + '</option>';
          }
          const selTip = missing ? App.t('fxNoTarget') : App.t('itemTarget');
          return '<span class="cond-fx-line">' +
            '<span class="cond-fx' + (off ? ' off' : '') + '" title="' + esc(tip) + '">' + esc(lbl) + '</span>' +
            '<select class="cond-fx-sel' + (noTarget ? ' invalid' : '') + '" data-fxt="' + esc(s.id) + '" data-fi="' + i + '"' +
              ' title="' + esc(selTip) + '" aria-label="' + esc(selTip) + '">' + opts + '</select>' +
          '</span>';
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
          '<button type="button" class="cond-row-del cond-row-unset" data-cond="' + esc(s.id) + '" title="' + esc(App.t('condUnset')) + '" aria-label="' + esc(App.t('condUnset')) + '">' + COND_UNSET_SVG + '</button>' +
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
          ds = fx.map(function (ef) { return ef.label || fxChipShort(ef); }).join(' · ');
        }
        return '<div class="cond-pick-line">' +
          '<button type="button" class="cond-pick-row' + (on ? ' on' : '') + '" data-key="' + esc(p.key) + '">' +
            '<span class="cond-pick-ic" data-ic="' + esc(p.icon) + '">' + condIcon(p.icon, p.color, p.shade, p.hi) + '</span>' +
            '<span class="cond-pick-txt"><span class="cond-pick-name">' + esc(nm) + '</span>' +
            '<span class="cond-pick-desc">' + esc(ds) + '</span></span>' +
            (on ? '<span class="cond-pick-check">✓</span>' : '') +
          '</button>' +
          '<button type="button" class="cond-pick-edit" data-editkey="' + esc(p.entryId || p.key) + '"' +
            ' title="' + esc(App.t('edit')) + '" aria-label="' + esc(App.t('edit')) + '">✎</button>' +
        '</div>';
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
      const tickBtn = q('applyticks');
      if (tickBtn) tickBtn.disabled = !hasTicksOrDuration(activeChar());
    }

    panel._condRefresh = refresh;

    panel.addEventListener('click', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.editkey) {
        const set = stateSetOf(activeChar());
        if (set) openStateEditor(set.id, b.dataset.editkey, { returnCardId: card.id });
        return;
      }
      if (b.dataset.cond) {
        mutateWithMaxFill(function () {
          const c = cur();
          c.conditions = (c.conditions || []).filter(function (s) { return s.id !== b.dataset.cond; });
        });
        return;
      }
      if (b.dataset.key) { toggleCondition(card.id, b.dataset.key); return; }
      // v156: новое состояние создаётся тем же редактором, что в настройках
      if (b.dataset.role === 'newstate') {
        const set = stateSetOf(activeChar());
        if (set) openStateEditor(set.id, null, { returnCardId: card.id });
        return;
      }
      // v70: сброс без подтверждения и без тоста — решение юзера
      if (b.dataset.role === 'reset') { clearConditions(card.id); return; }
      if (b.dataset.role === 'applyticks') { applyTicksManual(); }
    });
    panel.addEventListener('input', function (e) {
      if (e.target && e.target.dataset.role === 'search') refresh();
    });
    // v88: длительность ходов правится прямо в слое — как в редакторе набора
    panel.addEventListener('change', function (e) {
      // v155: цель эффекта выбирается прямо в строке состояния
      const sel = e.target && e.target.closest ? e.target.closest('[data-fxt]') : null;
      if (sel) {
        setEffectTarget(card.id, sel.dataset.fxt, parseInt(sel.dataset.fi, 10), sel.value || null);
        return;
      }
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
    ov.setAttribute('aria-label', card.name || App.t('typeCondition'));
    ov.classList.remove('hidden');
    updateScrollLock();
    // v127: фокус в диалог — как у слоя ярлыка (первая кнопка шапки панели)
    const first = ov.querySelector('button, input, textarea, [tabindex="0"]');
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) { first.focus(); } }
  }

  // ===== Modals =====
  // Пока открыто окно или второй слой, страница под ним не прокручивается
  // (иначе колесо/палец уводит лист и окно «уезжает» из вида).
  function updateScrollLock() {
    const modalOpen = !document.getElementById('modal').classList.contains('hidden');
    const layerOpen = !document.getElementById('labelLayer').classList.contains('hidden');
    document.body.classList.toggle('no-scroll', modalOpen || layerOpen);
  }

  let modalReturnFocus = null;
  let modalPrimaryBtn = null;
  function openModal(title, bodyHTML, actions) {
    document.getElementById('backdrop').classList.remove('hidden');
    const m = document.getElementById('modal');
    // v126: запоминаем, откуда открыли, и возвращаем фокус после закрытия.
    // При замене одного окна другим (настройки из формы) не перезаписываем.
    const wasHidden = m.classList.contains('hidden');
    if (wasHidden) modalReturnFocus = document.activeElement;
    m.classList.remove('settings-modal');
    m.classList.remove('hidden');
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-label', title || '');
    m.setAttribute('tabindex', '-1');   // v126: фокус на само окно — диктор читает заголовок
    m.innerHTML = '<h2>' + esc(title) + '</h2>' + bodyHTML + '<div class="m-actions"></div>';
    modalPrimaryBtn = null;
    const actDiv = m.querySelector('.m-actions');
    (actions || []).forEach(function (a) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.className = a.cls || '';
      // Enter в форме = «Сохранить»; «Закрыть» и подтверждения Enter не жмут
      if (a.cls === 'primary' && a.label === App.t('save')) modalPrimaryBtn = btn;
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
    // v126: фокус внутрь диалога. Именно на окно, а не на первое поле:
    // иначе на телефоне сразу выезжает клавиатура и перекрывает форму.
    if (wasHidden) {
      try { m.focus({ preventScroll: true }); } catch (e) { m.focus(); }
    }
  }
  // v106: редактор только что созданной сущности закрыли без сохранения —
  // убираем пустышку. Для существующих объектов pending пуст, их не трогаем.
  // Создание было последним mutate, поэтому его шаг отката тоже убираем:
  // иначе Ctrl+Z после «Отмены» возвращал пустую карточку.
  function cancelPendingCreation() {
    const ch = activeChar();
    const cardId = pendingNewCardId;
    const item = pendingNewItem;
    pendingNewCardId = null;
    pendingNewItem = null;
    if (!ch) return;
    const hasCard = !!(cardId && ch.cards.some(function (c) { return c.id === cardId; }));
    const inv = item ? ch.cards.find(function (c) { return c.id === item.cardId; }) : null;
    const hasItem = !!(inv && (inv.items || []).some(function (x) { return x.id === item.itemId; }));
    if (!hasCard && !hasItem) return;
    editScratch.editCard = null;
    if (hasCard) ch.cards = ch.cards.filter(function (c) { return c.id !== cardId; });
    if (hasItem) inv.items = inv.items.filter(function (x) { return x.id !== item.itemId; });
    if (undoStack.length) undoStack.pop();
    commit();
  }
  function closeModal() {
    cancelPendingCreation();
    closeRefMenu();   // пикер живёт на document.body — прибираем за модалкой
    const modal = document.getElementById('modal');
    const wasOpen = !modal.classList.contains('hidden');
    const ret = modalReturnFocus;
    modalReturnFocus = null;
    modalPrimaryBtn = null;
    document.getElementById('backdrop').classList.add('hidden');
    modal.classList.remove('settings-modal');
    modal.classList.add('hidden');
    modal.innerHTML = '';
    updateScrollLock();
    // v126: фокус возвращается на кнопку, которая открыла окно
    if (wasOpen && ret && ret.isConnected && !modal.contains(ret)) {
      try { ret.focus({ preventScroll: true }); } catch (e) { ret.focus(); }
    }
  }

  // v126: клавиатура в модалке — Esc закрывает, Enter сохраняет, Tab не уходит наружу
  function onModalKey(e) {
    const modal = document.getElementById('modal');
    if (!modal || modal.classList.contains('hidden')) return;
    // открытое меню/пикер/вопрос забирают клавишу себе (их обработчики выше)
    if (mountedMenu || document.getElementById('refmenu') || document.getElementById('inlineAsk')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
      return;
    }
    if (e.key === 'Enter') {
      const t = e.target;
      if (!t || t.isContentEditable) return;
      const tag = (t.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'button' || tag === 'select' || tag === 'a') return;
      if (t.type === 'checkbox' || t.type === 'radio') return;
      if (modalPrimaryBtn && !modalPrimaryBtn.disabled && modal.contains(modalPrimaryBtn)) {
        e.preventDefault();
        e.stopPropagation();
        modalPrimaryBtn.click();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    const items = Array.from(modal.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    )).filter(function (el) { return el.offsetParent !== null; });
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const a = document.activeElement;
    // фокус на самом окне (tabindex -1) считаем «вне списка»: Shift+Tab с него
    // иначе уходил бы к кнопке под окном
    const outside = a === modal || !modal.contains(a);
    if (e.shiftKey) {
      if (a === first || outside) {
        e.preventDefault();
        last.focus();
      }
    } else if (a === last || outside) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener('keydown', onModalKey, true);

  function confirmDialog(msg, onYes, title, labels) {
    labels = labels || {};
    openModal(title || App.t('delete'), '<p class="confirm-text">' + esc(msg) + '</p>', [
      { label: labels.no || App.t('cancel') },
      { label: labels.yes || App.t('delete'), cls: labels.yesCls || 'danger', onClick: onYes }
    ]);
  }

  // v106: одно подтверждение удаления на всё приложение. Крупный объект —
  // модалка (его видно целиком), строку списка — инлайн у кнопки (не уводит
  // взгляд). Текст и кнопки одни и те же, поэтому «Выбросить» больше не
  // встречается рядом с «Удалить предмет».
  function askDelete(opts) {
    if (opts.anchor) askInline(opts.anchor, opts.text, opts.onYes);
    else confirmDialog(opts.text, opts.onYes, opts.title || App.t('delete'));
  }

  // Полный текст (описание перка/заклинания) отдельным окном
  function openTextModal(title, text) {
    openModal(title || App.t('description'), '<div class="full-text">' + esc(text) + '</div>',
      [{ label: App.t('close'), cls: 'primary' }]);
  }

  // v91: ⤢ и «+N» открывают одно и то же — полный список эффектов и текст.
  // Клик по описанию на карточке сюда НЕ ведёт: там он переключает бафф.
  function openBuffDetails(cardId) {
    const card = findCard(cardId);
    if (!card || card.type !== 'buff') return;
    const list = (card.effects || []).filter(function (ef) { return ef && ef.target; });
    const rows = list.map(function (ef) {
      const full = fxShort(ef);
      return '<div class="buff-details-row">' +
        '<span class="buff-details-main">' + esc(ef.label || full) + '</span>' +
        '<span class="buff-details-sub">' + (ef.label ? esc(full) + ' · ' : '') + esc(buffTargetName(ef)) + '</span>' +
      '</div>';
    }).join('');
    const desc = (card.description || '').trim();
    openModal(card.name || App.t('typeBuff'),
      '<div class="buff-details">' +
        '<div class="buff-details-state' + (card.on ? ' on' : '') + '">' + esc(App.t(card.on ? 'buffOn' : 'buffOff')) + '</div>' +
        (rows || '<div class="meta">' + esc(App.t('buffNoEffects')) + '</div>') +
        (desc ? '<div class="full-text buff-details-text">' + esc(desc) + '</div>' : '') +
      '</div>',
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
    if (!card || !foldable(card)) return;
    // v142: заметку открываем и развёрнутой (клик по тексту), остальные ярлыки — только свёрнутыми
    if (card.type !== 'note' && !isCollapsed(card)) return;
    const ov = document.getElementById('labelLayer');
    layerCardId = cardId;
    ov.innerHTML = '';
    if (card.type === 'note') {
      ensureNotePages(card);
      ov.appendChild(buildNotePanel(card));
    } else {
      // Валюта/инвентарь — ТОЧНАЯ копия развернутой карточки, без доп рамок:
      // единственное отличие — активные кнопки правки (✎⧉✕ + ресайз) в шапке
      ov.appendChild(buildLayerCard(card));
    }
    ov.setAttribute('aria-label', card.name || App.t('menu'));
    ov.classList.remove('hidden');
    updateScrollLock();
    // v126: диалог получает фокус (на телефоне поле заметки не автофокусим —
    // иначе сразу выезжает клавиатура, поэтому берём первую кнопку шапки)
    const firstFocus = ov.querySelector('button, textarea, input, [tabindex="0"]');
    if (firstFocus) {
      try { firstFocus.focus({ preventScroll: true }); } catch (e) { firstFocus.focus(); }
    }
  }

  // Тулзы шапки слоя. На телефоне — ТОЛЬКО кебаб (меню с теми же действиями
  // плюс «Размер» и «На страницу…»): иначе в шапке оказывались и кебаб, и три
  // кнопки с ПК-версии (баг v48).
  function layerToolsHTML(card) {
    if (!isDesktop()) {
      return '<div class="tools">' +
        '<button type="button" class="layer-menu" title="' + esc(App.t('menu')) + '" aria-label="' + esc(App.t('menu')) + '">' +
          '<span></span><span></span><span></span></button></div>';
    }
    // v108: у инвентаря нет полей самой карточки — ✎ вела в пустоту
    const canEdit = !card || card.type !== 'inventory';
    return '<div class="tools">' +
      (canEdit ? '<button class="card-edit" title="' + esc(App.t('edit')) + '">✎</button>' : '') +
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
      // v142: у заметки сначала сохраняем несохранённый текст страницы
      const np = ov.querySelector('.note-pages-panel');
      if (np && np._noteFlush) np._noteFlush();
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
      '<span class="card-name">' + esc(card.name) + '</span>' + layerToolsHTML(card);
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
      '<span class="card-name">' + esc(card.name) + '</span>' + layerToolsHTML(card);
    wireLayerTools(head, card);
    el.appendChild(head);
    // cardBody уже возвращает обёртку .card-body — вставляем как есть
    const body = document.createElement('div');
    body.innerHTML = cardBody(card);
    while (body.firstChild) el.appendChild(body.firstChild);
    el.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function (e) { handleAction(card.id, btn.dataset, e); });
    });
    // v98: раскрытие «истинного предмета» работает и в слое ярлыка (мобилка)
    if (card.type === 'inventory') bindInventoryReveal(card, el);
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

  // ===== Заметка: страницы во втором слое (v142) =====
  // Панель нарочно повторяет карточку: та же шапка, текст и закладки справа.
  // По умолчанию закладки сжаты до номеров; наведение (ПК) или тап по активной
  // (телефон) раскрывает подписи. Кебаб закладки — цвет/переименовать/удалить.
  function buildNotePanel(card) {
    ensureNotePages(card);
    const panel = document.createElement('div');
    panel.className = 'layer-panel note-pages-panel';

    const head = buildLayerHead(card);
    panel.appendChild(head);

    const body = document.createElement('div');
    body.className = 'note-pages-body';
    const ta = document.createElement('textarea');
    ta.className = 'note-pages-text';
    ta.placeholder = App.t('text') + '…';
    body.appendChild(ta);
    const rail = document.createElement('div');
    rail.className = 'note-pages-rail';
    body.appendChild(rail);
    panel.appendChild(body);

    const menu = document.createElement('div');
    menu.className = 'note-tab-menu hidden';
    panel.appendChild(menu);

    let railOpen = false;
    let menuFor = -1;
    let menuAnchor = null;

    function pages() { return notePages(card); }
    function curPage() { return notePage(card); }
    function setRailOpen(v) { railOpen = v; rail.classList.toggle('open', v); }

    // текст страницы пишем в данные только при уходе/закрытии: иначе undo
    // получал бы шаг на каждую букву
    function flushText(commit) {
      const p = curPage();
      if (!p) return;
      const txt = ta.value;
      if (txt === (p.text || '')) return;
      if (commit) mutate(function () { p.text = txt; });
      else p.text = txt;
    }

    function cardTabs() {
      return document.querySelectorAll('.card[data-id="' + card.id + '"] .note-tab');
    }

    function renderTabs() {
      rail.innerHTML = '';
      pages().forEach(function (p, i) {
        const wrap = document.createElement('div');
        wrap.className = 'note-tab-wrap';
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'note-ltab' + (p.id === card.pageId ? ' on' : '');
        b.style.setProperty('--tab', notePageColor(p, i));
        b.setAttribute('aria-label', notePageTitle(p));
        const num = document.createElement('span');
        num.className = 'nt-num';
        num.textContent = String(i + 1);
        const nm = document.createElement('span');
        nm.className = 'nt-nm';
        nm.textContent = notePageTitle(p);
        b.appendChild(num);
        b.appendChild(nm);
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          if (e.target.tagName === 'INPUT') return;
          if (p.id === card.pageId) { setRailOpen(!railOpen); return; }
          flushText(true);
          card.pageId = p.id;
          save();
          render();
          renderTabs();
          renderText();
          setRailOpen(false);
          closeMenu();
        });
        wrap.appendChild(b);

        const k = document.createElement('button');
        k.type = 'button';
        k.className = 'note-ltab-kebab';
        k.textContent = '⋮';
        k.setAttribute('aria-label', App.t('menu'));
        k.addEventListener('click', function (e) {
          e.stopPropagation();
          openMenu(i, k);
        });
        wrap.appendChild(k);
        rail.appendChild(wrap);
      });

      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'note-rail-add';
      add.textContent = '＋ ' + App.t('addPage');
      add.setAttribute('aria-label', App.t('addPage'));
      add.addEventListener('click', addPage);
      rail.appendChild(add);
      rail.classList.toggle('open', railOpen);
    }

    function renderText() {
      const p = curPage();
      ta.value = p ? (p.text || '') : '';
    }

    function renderAll() {
      renderTabs();
      renderText();
    }

    function addPage() {
      flushText(true);
      const id = uid();
      mutate(function () {
        card.pages.push({
          id: id,
          title: '',
          color: NOTE_COLORS[pages().length % NOTE_COLORS.length],
          text: ''
        });
        card.pageId = id;
      });
      setRailOpen(true);
      renderAll();
      startRename(pages().length - 1);
    }

    function askDelete(i) {
      const p = pages()[i];
      if (!p || pages().length <= 1) return;
      const name = notePageTitle(p);
      confirmDialog(App.tf('confirmDeletePage', { name: name }), function () {
        flushText(true);
        mutate(function () {
          const list = pages();
          const idx = list.findIndex(function (x) { return x.id === p.id; });
          if (idx < 0) return;
          const wasCur = card.pageId === p.id;
          list.splice(idx, 1);
          if (wasCur) card.pageId = list[Math.max(0, idx - 1)].id;
        });
        setRailOpen(false);
        renderAll();
        toast(App.tf('deletedGeneric', { name: name }));
      }, App.t('delete'));
    }

    function startRename(i) {
      setRailOpen(true);
      const wrap = rail.querySelectorAll('.note-tab-wrap')[i];
      const tab = wrap && wrap.querySelector('.note-ltab');
      const nm = tab && tab.querySelector('.nt-nm');
      if (!nm || tab.querySelector('input')) return;
      const input = document.createElement('input');
      input.className = 'note-tab-input';
      input.value = (pages()[i].title || '');
      input.setAttribute('aria-label', App.t('pageName'));
      nm.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const commit = function (saveIt) {
        if (done) return;
        done = true;
        if (saveIt) {
          const v = input.value.trim();
          mutate(function () { pages()[i].title = v; });
        }
        renderAll();
      };
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(true); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(false); }
      });
      input.addEventListener('blur', function () { commit(true); });
    }

    function openMenu(i, anchor) {
      menuFor = i;
      menuAnchor = anchor;
      setRailOpen(true);
      buildMenu();
      document.addEventListener('pointerdown', onMenuDocDown, true);
    }

    function buildMenu() {
      const i = menuFor;
      const p = pages()[i];
      if (!p) return;
      menu.innerHTML = '';
      menu.classList.remove('hidden');

      // круглый ярлык цвета; нажатие открывает нативную палитру, без подписи и кода цвета
      const row = document.createElement('div');
      row.className = 'note-menu-color';
      const dot = document.createElement('span');
      dot.className = 'note-color-dot';
      dot.style.setProperty('--c', notePageColor(p, i));
      const color = document.createElement('input');
      color.type = 'color';
      color.className = 'note-color-input';
      color.value = notePageColor(p, i);
      color.setAttribute('aria-label', App.t('notePageColor'));
      color.addEventListener('input', function () {
        p.color = color.value;
        dot.style.setProperty('--c', color.value);
        const tab = rail.querySelectorAll('.note-ltab')[i];
        if (tab) tab.style.setProperty('--tab', color.value);
        const ct = cardTabs()[i];
        if (ct) ct.style.setProperty('--tab', color.value);
      });
      color.addEventListener('change', function () { save(); });
      row.appendChild(dot);
      row.appendChild(color);
      menu.appendChild(row);

      const ren = document.createElement('button');
      ren.type = 'button';
      ren.className = 'note-menu-item';
      ren.textContent = App.t('noteRename');
      ren.addEventListener('click', function () { closeMenu(); startRename(i); });
      menu.appendChild(ren);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'note-menu-item danger';
      del.textContent = App.t('delete');
      del.disabled = pages().length <= 1;
      del.addEventListener('click', function () { closeMenu(); askDelete(i); });
      menu.appendChild(del);

      placeMenu();
    }

    function placeMenu() {
      if (!menuAnchor) return;
      const pr = panel.getBoundingClientRect();
      const ar = menuAnchor.getBoundingClientRect();
      const mw = menu.offsetWidth, mh = menu.offsetHeight;
      const left = Math.max(8, Math.min(ar.left - pr.left - mw - 8, pr.width - mw - 8));
      const top = Math.max(8, Math.min(ar.top - pr.top, pr.height - mh - 8));
      menu.style.left = Math.round(left) + 'px';
      menu.style.top = Math.round(top) + 'px';
    }

    function onMenuDocDown(e) {
      if (menu.contains(e.target)) return;
      if (menuAnchor && menuAnchor.contains(e.target)) return;
      closeMenu();
    }

    function closeMenu() {
      menuFor = -1;
      menuAnchor = null;
      menu.classList.add('hidden');
      menu.innerHTML = '';
      document.removeEventListener('pointerdown', onMenuDocDown, true);
    }

    // клик по тексту/пустому месту закрывает раскрытую полосу и меню
    body.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.note-pages-rail') || e.target.closest('.note-tab-menu')) return;
      setRailOpen(false);
      closeMenu();
    });

    renderAll();
    // закрытие/редактор сначала сохраняют несохранённый текст текущей страницы
    panel._noteFlush = function () { flushText(true); };
    return panel;
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
    // v142: заметка сама обновляет панель страниц; слой не закрываем, даже когда
    // карточка развёрнута (обычный ярлык в этом случае закрывается)
    if (card.type === 'note') {
      const ov = document.getElementById('labelLayer');
      const panel = ov.querySelector('.note-pages-panel');
      if (panel) {
        const nameEl = panel.querySelector('.layer-head .card-name');
        if (nameEl) nameEl.textContent = card.name;
      }
      return;
    }
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
    const old = ov.querySelector('.layer-card');
    if (old) old.replaceWith(buildLayerCard(card));
    else closeLabelLayer();
  }

  function closeLabelLayer() {
    const ov = document.getElementById('labelLayer');
    if (ov.classList.contains('hidden')) return;
    const closedCardId = layerCardId;
    // v142: заметка — сохраняем несохранённый текст текущей страницы,
    // но только если карточка ещё существует (её могли удалить из слоя)
    const np = ov.querySelector('.note-pages-panel');
    if (np && np._noteFlush && layerCardId && findCard(layerCardId)) np._noteFlush();
    layerCardId = null;
    ov.classList.add('hidden');
    ov.innerHTML = '';
    ov.removeAttribute('aria-label');
    updateScrollLock();
    // v126: фокус возвращается на язычок ярлыка, который открыл слой
    if (closedCardId) {
      const el = document.querySelector('.card[data-id="' + closedCardId + '"] .fold-tab');
      if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
    }
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

  // ===== Бафф: поля редактора (v91) =====
  // v114: у баффа появились тики (урон/лечение по ходам), поэтому счётчику
  // доступно ещё и «текущее» — только для режима «тик».
  function buffTargetFields(type) {
    const f = (MOD_FIELDS[type] || []).slice();
    // «текущее» — для тика; щит — только у счётчика
    if (type === 'counter') f.push('current', 'shield');
    return f;
  }
  function buffTargets() {
    return (activeChar().cards || []).filter(function (c) {
      return c.type !== 'buff' && buffTargetFields(c.type).length;
    });
  }
  function buffModesFor(t, field) {
    // щит — только выдача запаса; «как» не предлагаем
    if (field === 'shield') return ['add'];
    // «текущее» в баффе — только событие по ходам, иначе режим молча не работает
    if (field === 'current') return ['tick'];
    const out = ['add', 'mul', 'set', 'cap'];
    // кубик — только к бонусу и только если у цели вообще есть кубик;
    // преимущество/помеха — к бонусу любой карточки с кубиком
    if (t && t.die && (t.type === 'skill' || t.type === 'spell') && field === 'bonus') out.push('dice');
    if (t && t.die && field === 'bonus') out.push('adv', 'dis');
    if (t && t.type === 'spell' && field === 'charges') out.push('block');
    return out;
  }
  function normalizeBuffEffect(ef) {
    if (ef.mode === 'tick') ef.field = 'current';
    const t = findCard(ef.target);
    if (t) {
      const fields = buffTargetFields(t.type);
      if (fields.indexOf(ef.field) === -1) ef.field = fields[0] || 'bonus';
      const modes = buffModesFor(t, ef.field);
      if (modes.indexOf(ef.mode) === -1) ef.mode = modes[0];
    }
    if (ef.mode === 'block') ef.value = '';
    return ef;
  }
  function buffFields(card) {
    editScratch.buffEffects = (card.effects || []).map(function (ef) {
      return {
        mode: ef.mode || 'add', field: effectField(ef),
        value: ef.value == null ? '' : String(ef.value), label: ef.label || '',
        target: ef.target || null, timing: ef.timing || 'start'
      };
    });
    const col = card.color || '#d4a93c';
    return '<div class="field"><label>' + esc(App.t('description')) + '</label>' +
        '<textarea id="f-desc" placeholder="' + esc(App.t('description')) + '…">' + esc(card.description || '') + '</textarea></div>' +
      '<div class="field"><label>' + esc(App.t('buffDuration')) + '</label>' +
        '<input id="f-buff-duration" type="number" min="0" max="999" step="1" inputmode="numeric" value="' + (num(card.duration) > 0 ? num(card.duration) : '') + '" placeholder="—">' +
        '<div class="formula-help">' + esc(App.t('buffDurationHint')) + '</div></div>' +
      '<div class="field"><label>' + esc(App.t('buffEffects')) + '</label>' +
        '<div id="f-bfx-list" class="fx-rows"></div>' +
        '<button type="button" id="f-bfx-add" class="fx-add">＋ ' + esc(App.t('fxAdd')) + '</button>' +
        '<div class="formula-help">' + esc(App.t('buffTapHint')) + '</div></div>' +
      '<div class="field"><label>' + esc(App.t('buffColor')) + '</label>' +
        '<div class="st-color-row"><input id="f-buff-color" type="color" value="' + esc(col) + '">' +
        '<span class="st-meta" id="f-buff-color-hex">' + esc(col) + '</span></div></div>';
  }
  // v158: эффекты баффа — общие плашки и общее окно. Цель у каждого эффекта:
  // от типа цели зависит и поле, и доступные режимы (кубик, тик, запрет, щит).
  function buffTargetsForKind(kind) {
    const all = buffTargets();
    if (kind === 'tick' || kind === 'shield') return all.filter(function (c) { return c.type === 'counter'; });
    if (kind === 'block') return all.filter(function (c) { return c.type === 'spell'; });
    if (kind === 'roll' || kind === 'die') {
      return all.filter(function (c) { return c.die && (c.type === 'skill' || c.type === 'spell'); });
    }
    return all;
  }
  function buffFieldsFor(targetId) {
    const t = targetId ? findCard(targetId) : null;
    return t ? buffTargetFields(t.type) : [];
  }
  function buffModesForTarget(field, targetId) {
    const t = targetId ? findCard(targetId) : null;
    return buffModesFor(t, field);
  }
  function openBuffFxEditor(index, anchor) {
    openFxEditor({
      effect: index == null ? null : editScratch.buffEffects[index],
      kinds: ['number', 'roll', 'die', 'tick', 'block', 'shield'],
      targetsFor: function (kind) { return buffTargetsForKind(kind); },
      fieldsFor: buffFieldsFor,
      modesFor: buffModesForTarget,
      anchor: anchor,
      onSave: function (ef) {
        normalizeBuffEffect(ef);
        if (index == null) editScratch.buffEffects.push(ef);
        else editScratch.buffEffects[index] = ef;
        renderBuffFx();
      }
    });
  }
  function renderBuffFx() {
    const host = document.getElementById('f-bfx-list');
    if (!host) return;
    host.innerHTML = fxRowsHTML(editScratch.buffEffects || [], { targets: true, emptyText: 'buffNoEffects' });
  }
  function bindBuffEditor() {
    renderBuffFx();
    const add = document.getElementById('f-bfx-add');
    if (add) add.addEventListener('click', function (e) {
      if (!buffTargets().length) { toast(App.t('fxNoTargets')); return; }
      openBuffFxEditor(null, e.currentTarget);
    });
    const host = document.getElementById('f-bfx-list');
    if (!host) return;
    host.addEventListener('click', function (e) {
      const edit = e.target.closest('[data-fx-edit]');
      if (edit) { openBuffFxEditor(+edit.dataset.fxEdit, edit); return; }
      const dup = e.target.closest('[data-fx-dup]');
      if (dup) {
        const i = +dup.dataset.fxDup;
        const src = editScratch.buffEffects[i];
        if (src) { editScratch.buffEffects.splice(i + 1, 0, JSON.parse(JSON.stringify(src))); renderBuffFx(); }
        return;
      }
      const del = e.target.closest('[data-fx-del]');
      if (del) { editScratch.buffEffects.splice(+del.dataset.fxDel, 1); renderBuffFx(); }
    });
    const col = document.getElementById('f-buff-color');
    const hex = document.getElementById('f-buff-color-hex');
    if (col) col.addEventListener('input', function () { if (hex) hex.textContent = col.value; });
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
      case 'note': return noteFields(card);
      case 'initiative': return initiativeFields(card);
      // v65: у состояния настраивается только подпись — сами состояния в слое
      case 'condition': return '<div class="formula-help">' + esc(App.t('condTitleHint')) + '</div>';
      // v91: бафф живёт на листе: описание, цвет, эффекты с целями
      case 'buff': return buffFields(card);
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
    return '<div class="formula-help">' + esc(App.t('noteTextInLayer')) + '</div>';
  }

  function currencyFields(card) {
    editScratch.units = JSON.parse(JSON.stringify(card.units || []));
    return '<div class="field"><label>' + esc(App.t('units')) + '</label>' +
      '<div class="sublist" id="f-units"></div>' +
      '<button type="button" class="small" id="f-addunit">+ ' + esc(App.t('addUnit')) + '</button>' +
      '<div class="formula-help">' + esc(App.t('currencyHint')) + '</div></div>' +
      checkField('f-autoconv', App.t('autoconvert'), !!card.autoconvert);
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

  function postInitEditor(card) {
    if (card.type === 'currency') bindCurrencyEditor();
    if (card.type === 'buff') bindBuffEditor();
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
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', App.t('fxTarget'));
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
    window.addEventListener('keydown', onRefMenuKey, true);
    window.addEventListener('scroll', onRefMenuScroll, true);
  }
  function onRefMenuKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeRefMenu(true);
  }
  function onRefMenuScroll(e) {
    const menu = document.getElementById('refmenu');
    if (menu && !menu.contains(e.target)) closeRefMenu();
  }
  function onRefMenuDocDown(e) {
    const menu = document.getElementById('refmenu');
    if (menu && !menu.contains(e.target) && !(refMenuAnchor && refMenuAnchor.contains(e.target))) closeRefMenu();
  }
  function closeRefMenu(refocus) {
    const menu = document.getElementById('refmenu');
    if (menu) menu.parentNode.removeChild(menu);
    document.removeEventListener('pointerdown', onRefMenuDocDown, true);
    window.removeEventListener('resize', placeRefMenu);
    window.removeEventListener('keydown', onRefMenuKey, true);
    window.removeEventListener('scroll', onRefMenuScroll, true);
    const anchor = refMenuAnchor;
    refMenuAnchor = null;
    if (refocus && anchor && anchor.isConnected) {
      try { anchor.focus({ preventScroll: true }); } catch (e) { anchor.focus(); }
    }
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
      case 'note':
        // текст и страницы правятся во втором слое, в окне — только имя
        break;
      case 'buff': {
        const shieldBefore = buffShieldSig(card.effects);
        // v91: эффекты храним только с существующей целью; пустую строку,
        // добавленную и не заполненную, молча не сохраняем.
        card.description = readText('f-desc');
        const colEl = document.getElementById('f-buff-color');
        card.color = (colEl && /^#[0-9a-f]{6}$/i.test(colEl.value)) ? colEl.value : (card.color || '#d4a93c');
        // v114: длительность в ходах; пусто — постоянный бафф.
        const durEl = document.getElementById('f-buff-duration');
        const dur = durEl ? Math.max(0, parseInt(durEl.value, 10) || 0) : 0;
        const prevDur = num(card.duration);
        card.duration = dur > 0 ? dur : null;
        if (card.duration) {
          // новая длительность или истёкший счётчик — начинаем заново
          if (!(num(card.left) > 0) || dur !== prevDur) card.left = card.duration;
          else card.left = Math.min(num(card.left), card.duration);
        } else {
          card.left = null;
        }
        card.effects = (editScratch.buffEffects || []).map(function (ef) {
          const e = {
            mode: ef.mode, field: effectField(ef),
            value: ef.value == null ? '' : String(ef.value),
            label: ef.label || '', target: ef.target || null
          };
          if (e.mode === 'tick') { e.field = 'current'; e.timing = ef.timing || 'start'; }
          if (e.mode === 'block') e.value = '';
          return e;
        }).filter(function (ef) {
          return ef.target && findCard(ef.target) &&
            (ef.mode === 'block' || ef.mode === 'adv' || ef.mode === 'dis' || String(ef.value).trim() !== '');
        });
        // v152: правка эффектов включённого баффа пересобирает щит,
        // но только если изменились сами щитовые эффекты (не длительность/цвет)
        if (card.on && shieldBefore !== buffShieldSig(card.effects)) reconcileBuffShield(card);
        else if (!card.on) clearBuffShield(card);
        break;
      }
    }
  }

  function openCardEditor(cardId) {
    const card = findCard(cardId);
    if (!card) return;
    // v102: у инвентаря нет редактора карточки — всё живёт в строках предметов
    if (card.type === 'inventory') return;
    editScratch.editCard = card;   // для живого предпросмотра в полях-выражениях
    if (card._new) pendingNewCardId = card.id;
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
    const wasNew = !!card._new;
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
    }, wasNew);
    pendingNewCardId = null;
    toast(App.tf(wasNew ? 'createdGeneric' : 'savedGeneric', { name: card.name }));
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
        if (fx.length) ds = fx.map(function (ef) { return ef.label || fxChipShort(ef); }).join(' · ');
        const ic = isStates
          ? '<span class="set-ic" data-ic="' + esc(e.icon) + '">' + condIcon(e.icon, e.color, e.shade, e.hi) + '</span>'
          : '<span class="set-ic"></span>';
        const eid = e.entryId || e.key;
        return '<div class="set-row' + (editable ? ' editable' : '') + '"' +
          (editable ? ' data-edit-state="' + esc(eid) + '" data-set-id="' + esc(set.id) + '"' : '') + '>' + ic +
          '<span class="set-txt"><span class="set-name">' + esc(nm) + '</span>' +
          '<span class="set-desc">' + esc(ds) + '</span></span>' +
          (editable ? '<button type="button" class="set-row-edit" aria-label="' + esc(App.t('edit')) + '">✎</button>' : '') +
          (editable
            ? '<button type="button" class="set-row-dup" data-dup-state="' + esc(eid) + '" data-set-id="' + esc(set.id) + '" aria-label="' + esc(App.t('duplicate')) + '" title="' + esc(App.t('duplicate')) + '">' + DUP_SVG + '</button>'
            : '') +
          (editable && !set.builtin
            ? '<button type="button" class="set-row-del" data-del-state="' + esc(eid) + '" data-set-id="' + esc(set.id) + '" aria-label="' + esc(App.t('stDelete')) + '">' + TRASH_SVG + '</button>'
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
          (isStates ? '<button type="button" class="set-plus" data-add-state="' + esc(set.id) + '" aria-label="' + esc(App.t('stAddState')) + '">+</button>' : '') +
          (isStates ? '<button type="button" class="set-chars" data-state-chars="' + esc(set.id) + '" aria-label="' + esc(App.t('setStatesLabel')) + '">👥 ' + used + '</button>' : '') +
          (!set.builtin ? '<button type="button" class="set-ren" data-rename-set="' + esc(set.id) + '" aria-label="' + esc(App.t('setRename')) + '">✎</button>' : '') +
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

  // v94: паки предметов — отдельный экран. В отличие от наборов состояний
  // паков может быть много, у персонажа — галочки, а содержимое строки — снимок.
  function settingsPacksPanel(ch) {
    const packs = packsList();
    const cards = packs.map(function (pack) {
      const items = pack.items || [];
      const used = packUsedBy(pack.id);
      const rows = items.map(function (it) {
        const cat = ITEM_CATEGORIES.find(function (c) { return c.id === it.category; }) || ITEM_CATEGORIES[2];
        const wt = it.weight == null ? '—' : fmt(it.weight) + ' кг';
        return '<div class="set-row editable" data-edit-pack-item="' + esc(it.id) + '" data-pack-id="' + esc(pack.id) + '">' +
          '<span class="set-ic">' + itemIconChar(it.icon, it.category) + '</span>' +
          '<span class="set-txt"><span class="set-name">' + esc(it.name || '—') + '</span>' +
          '<span class="set-desc">' + esc(App.t(cat.labelKey)) + ' · ' + esc(wt) + (it.damage ? ' · ' + esc(it.damage) : '') + '</span></span>' +
          '<button type="button" class="set-row-edit" aria-label="' + esc(App.t('edit')) + '">✎</button>' +
          '<button type="button" class="set-row-dup" data-dup-pack-item="' + esc(it.id) + '" data-pack-id="' + esc(pack.id) + '" aria-label="' + esc(App.t('duplicate')) + '" title="' + esc(App.t('duplicate')) + '">' + DUP_SVG + '</button>' +
          '<button type="button" class="set-row-del" data-del-pack-item="' + esc(it.id) + '" data-pack-id="' + esc(pack.id) + '" aria-label="' + esc(App.t('delete')) + '">' + TRASH_SVG + '</button>' +
        '</div>';
      }).join('');
      return '<div class="set-card open" data-pack="' + esc(pack.id) + '">' +
        '<div class="set-head">' +
          '<span class="set-chev"></span>' +
          '<span class="set-title"><b>' + esc(pack.name) + '</b>' +
            '<span class="set-meta">' + esc(App.tf('packItemsCount', { n: items.length })) +
            ' · ' + esc(App.tf('packUsedBy', { n: used })) + '</span></span>' +
          '<button type="button" class="set-plus" data-add-pack-item="' + esc(pack.id) + '" aria-label="' + esc(App.t('packAddItem')) + '">+</button>' +
          '<button type="button" class="set-chars" data-pack-chars="' + esc(pack.id) + '" aria-label="' + esc(App.t('tabPacks')) + '">👥 ' + used + '</button>' +
          '<button type="button" class="set-ren" data-rename-pack="' + esc(pack.id) + '" aria-label="' + esc(App.t('packRename')) + '">✎</button>' +
          '<button type="button" class="set-exp" data-export-pack="' + esc(pack.id) + '" aria-label="' + esc(App.t('packExport')) + '">' + SET_EXPORT_SVG + '</button>' +
          '<button type="button" class="set-del" data-del-pack="' + esc(pack.id) + '" aria-label="' + esc(App.t('delete')) + '">' + TRASH_SVG + '</button>' +
        '</div>' +
        '<div class="set-body"><div class="set-rows">' +
          (rows || '<div class="set-empty">' + esc(App.t('packEmpty')) + '</div>') +
        '</div></div></div>';
    }).join('');
    return '<div class="s-panel hidden" data-panel="items">' +
      '<div class="set-cards">' + (cards || '<div class="set-empty">' + esc(App.t('packNone')) + '</div>') + '</div>' +
      '<div class="set-foot"><button type="button" id="s-pack-add">+ ' + esc(App.t('packAdd')) + '</button>' +
      '<button type="button" id="s-pack-import">' + esc(App.t('packImport')) + '</button></div></div>';
  }

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
    return entry;
  }

  // v159: копия шаблона состояния — в списке настроек. Глубокая копия
  // (иконка, цвета, длительность, эффекты), новые entryId/key, имя «… (2)».
  // Базовый набор править нельзя: копия состояния создаёт копию набора.
  function duplicateStateEntry(setId, entryId) {
    rememberSettingsScroll();
    const sourceSet = libSetById('states', setId);
    if (!sourceSet) return;
    const src = (sourceSet.entries || []).find(function (e) {
      return (e.entryId && e.entryId === entryId) || e.key === entryId;
    });
    if (!src) return;
    const srcName = src.nameKey ? App.t(src.nameKey) : (src.name || '');
    let made = null;
    mutate(function () {
      let set = sourceSet;
      if (set.builtin) {
        const ch = activeChar();
        const active = !!(ch && stateSetOf(ch) && stateSetOf(ch).id === set.id);
        set = copyStateSetForEdit(set, active);
        if (active) relinkSnapshotsToSet(sourceSet.id, set.id);
      }
      const baseEntry = (set.entries || []).find(function (e) {
        return (src.entryId && e.entryId === src.entryId) || e.key === src.key;
      });
      if (!baseEntry) return;
      const copy = JSON.parse(JSON.stringify(baseEntry));
      copy.entryId = 'st-' + uid();
      copy.key = 'custom_' + uid();
      const baseName = String(srcName).replace(/\s*\(\d+\)\s*$/, '');
      const used = (set.entries || []).map(function (e) {
        return e.nameKey ? App.t(e.nameKey) : (e.name || '');
      });
      let n = 2;
      let name = baseName + ' (' + n + ')';
      while (used.indexOf(name) !== -1) { n++; name = baseName + ' (' + n + ')'; }
      copy.name = name;
      delete copy.nameKey;
      if (src.descKey) { copy.effect = App.t(src.descKey); delete copy.descKey; }
      copy.effects = (copy.effects || []).map(function (ef) { return Object.assign({}, ef); });
      set.entries.splice(set.entries.indexOf(baseEntry) + 1, 0, copy);
      made = { name: name };
    });
    if (made) {
      toast(App.tf('duplicatedGeneric', { name: made.name }));
      openSettings('states');
    }
  }

  function removeStateEntry(set, entryId) {
    set.entries = (set.entries || []).filter(function (e) {
      return !(e.entryId === entryId || e.key === entryId);
    });
    return set;
  }

  function deleteStateFromSet(setId, entryId, anchor) {
    rememberSettingsScroll();
    const set = libSetById('states', setId);
    if (!set || set.builtin) return;   // базовые 15 состояний не удаляем
    const entry = (set.entries || []).find(function (e) { return e.entryId === entryId || e.key === entryId; });
    if (!entry) return;
    const name = entry.nameKey ? App.t(entry.nameKey) : (entry.name || '');
    const msg = App.tf('stDeleteConfirm', { name: name });
    askDelete({ text: msg, anchor: anchor, onYes: function () {
      mutate(function () { removeStateEntry(set, entryId); });
      toast(App.tf('deletedGeneric', { name: name }));
      openSettings('states');
    } });
  }

  function openPackCharsMenu(packId, anchor) {
    closePackCharsMenu();
    const pack = packById(packId);
    if (!pack) return;
    const menu = document.createElement('div');
    menu.className = 'ctxmenu pack-chars-menu';
    menu.id = 'packCharsMenu';
    menu.innerHTML = '<div class="ask-text">' + esc(App.t('packChars')) + '</div>' +
      (state.characters.length ? state.characters.map(function (c) {
        const on = !!charPacks(c)[packId];
        return '<button type="button" data-char="' + esc(c.id) + '"><span class="pcm-check">' + (on ? '✓' : '') + '</span> ' + esc(c.name) + '</button>';
      }).join('') : '<div class="ask-text">—</div>') +
      '<div class="ask-actions"><button type="button" data-close="1">' + esc(App.t('close')) + '</button></div>';
    menu.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-char]');
      if (btn) {
        const ch = state.characters.find(function (c) { return c.id === btn.dataset.char; });
        if (!ch) return;
        const on = !charPacks(ch)[packId];
        mutate(function () { charPacks(ch)[packId] = on; });
        btn.querySelector('.pcm-check').textContent = on ? '✓' : '';
        anchor.textContent = '👥 ' + packUsedBy(packId);
        const meta = anchor.closest('.set-card').querySelector('.set-meta');
        if (meta) meta.textContent = App.tf('packItemsCount', { n: (pack.items || []).length }) + ' · ' + App.tf('packUsedBy', { n: packUsedBy(packId) });
        return;
      }
      if (e.target.closest('[data-close]')) closePackCharsMenu();
    });
    mountMenu(menu, anchor, { align: 'right' });
  }

  function closePackCharsMenu() { closeMenuById('packCharsMenu'); }

  // v150: активный набор состояний выбирается иконкой 👥 на карточке набора,
  // как подключение паков предметов. В меню — листы устройства.
  function openStateCharsMenu(setId, anchor) {
    closeStateCharsMenu();
    const set = libSetById('states', setId);
    if (!set) return;
    const menu = document.createElement('div');
    menu.className = 'ctxmenu pack-chars-menu';
    menu.id = 'stateCharsMenu';
    menu.innerHTML = '<div class="ask-text">' + esc(App.t('setStatesLabel')) + '</div>' +
      (state.characters.length ? state.characters.map(function (c) {
        const on = charSetId(c, 'states') === setId;
        return '<button type="button" data-char="' + esc(c.id) + '"><span class="pcm-check">' + (on ? '✓' : '') + '</span> ' + esc(c.name) + '</button>';
      }).join('') : '<div class="ask-text">—</div>') +
      '<div class="ask-actions"><button type="button" data-close="1">' + esc(App.t('close')) + '</button></div>';
    menu.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-char]');
      if (btn) {
        setCharSet(btn.dataset.char, 'states', setId);
        closeStateCharsMenu();
        openSettings('states');
        return;
      }
      if (e.target.closest('[data-close]')) closeStateCharsMenu();
    });
    mountMenu(menu, anchor, { align: 'right' });
  }

  function closeStateCharsMenu() { closeMenuById('stateCharsMenu'); }

  function renamePackInline(packId, anchor) {
    const pack = packById(packId);
    if (!pack) return;
    askInlineInput(anchor, pack.name, function (name) {
      pack.name = name;
      savePacks();
      const card = anchor.closest('.set-card');
      const title = card && card.querySelector('.set-title b');
      if (title) title.textContent = name;
      toast(App.tf('renamedGeneric', { name: name }));
    });
  }

  function askInlineInput(anchor, initial, onDone) {
    closeInlineAsk();
    if (!anchor) return;
    askAnchor = anchor;
    const pop = document.createElement('div');
    pop.className = 'ctxmenu inline-ask';
    pop.id = 'inlineAsk';
    pop.innerHTML = '<div class="ask-text">' + esc(App.t('packRename')) + '</div>' +
      '<input class="ask-input" type="text" autocomplete="off" spellcheck="false" value="' + esc(initial) + '">' +
      '<div class="ask-actions">' +
        '<button type="button" class="ask-yes" data-yes="1">' + esc(App.t('save')) + '</button>' +
        '<button type="button" data-no="1">' + esc(App.t('cancel')) + '</button>' +
      '</div>';
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 8) + 'px';
    const inp = pop.querySelector('.ask-input');
    inp.focus();
    inp.select();
    pop.addEventListener('click', function (e) {
      if (e.target.closest('[data-no]')) { closeInlineAsk(); return; }
      if (e.target.closest('[data-yes]')) {
        const v = inp.value.trim();
        if (!v) { inp.focus(); return; }
        const fn = onDone;
        closeInlineAsk();
        fn(v);
      }
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); pop.querySelector('[data-yes]').click(); }
    });
    document.addEventListener('pointerdown', onAskDocDown, true);
    window.addEventListener('keydown', onAskKey, true);
  }

  function openPackNameModal(packId) {
    const pack = packId ? packById(packId) : null;
    openModal(pack ? App.t('packRename') : App.t('packAdd'),
      '<div class="field"><label>' + esc(App.t('packName')) + '</label>' +
      '<input id="packNameInput" type="text" autocomplete="off" spellcheck="false" value="' + esc(pack ? pack.name : App.t('packDefaultName')) + '"></div>',
      [
        { label: App.t('cancel'), onClick: function () { openSettings('items'); return false; } },
        { label: App.t('save'), cls: 'primary', onClick: function () {
          const inp = document.getElementById('packNameInput');
          const name = inp ? inp.value.trim() : '';
          if (!name) { toast(App.t('packNameNeeded')); return false; }
          if (pack) pack.name = name;
          else packsList().push({ id: uid(), name: name, items: [] });
          savePacks();
          openSettings('items');
          return false;
        } }
      ]);
    const inp = document.getElementById('packNameInput');
    if (inp) { inp.focus(); inp.select(); }
  }

  function deletePack(packId, anchor) {
    rememberSettingsScroll();
    const pack = packById(packId);
    if (!pack) return;
    askDelete({ text: App.tf('packDeleteConfirm', { name: pack.name }), anchor: anchor, onYes: function () {
      packsStore.packs = packsList().filter(function (p) { return p.id !== packId; });
      state.characters.forEach(function (ch) { delete charPacks(ch)[packId]; });
      savePacks();
      save();
      toast(App.tf('deletedGeneric', { name: pack.name }));
      openSettings('items');
    } });
  }

  function deletePackItem(packId, itemId, anchor) {
    rememberSettingsScroll();
    const pack = packById(packId);
    const item = pack && (pack.items || []).find(function (it) { return it.id === itemId; });
    if (!item) return;
    askDelete({ text: App.tf('packItemDeleteConfirm', { name: item.name || '—' }), anchor: anchor, onYes: function () {
      pack.items = (pack.items || []).filter(function (it) { return it.id !== itemId; });
      savePacks();
      toast(App.tf('deletedGeneric', { name: item.name || '—' }));
      openSettings('items');
    } });
  }

  function exportPack(packId) {
    const pack = packById(packId);
    if (!pack) return;
    download(safeName(pack.name || 'pack') + '.json', JSON.stringify({
      app: 'custplay', kind: 'items-pack', version: 1,
      pack: { id: pack.id, name: pack.name, items: pack.items }
    }, null, 2));
    toast(App.t('packExported'));
  }

  function importPack(txt) {
    try {
      const data = JSON.parse(txt);
      const src = data && data.pack;
      if (!src || !Array.isArray(src.items)) throw new Error('bad');
      const incoming = {
        id: String(src.id || uid()),
        name: String(src.name || App.t('packDefaultName')),
        items: src.items.map(normalizePackItem)
      };
      const sameId = packById(incoming.id);
      if (sameId) {
        sameId.name = incoming.name;
        sameId.items = incoming.items;
      } else {
        incoming.id = uid();
        let name = incoming.name, i = 2;
        while (packsList().some(function (p) { return p.name === name; })) { name = incoming.name + ' (' + i + ')'; i++; }
        incoming.name = name;
        packsList().push({ id: incoming.id, name: incoming.name, items: incoming.items });
      }
      savePacks();
      toast(App.t('packImported'));
      openSettings('items');
    } catch (e) { toast(App.t('packImportError')); }
  }

  // v114: тик — эффект-событие, он меняет текущее значение счётчика. Поэтому
  // режим доступен только для поля «Текущее». Остальные режимы — как раньше.
  // v115: щит — разовая выдача запаса, только «прибавить».
  function effectModesFor(field) {
    if (field === 'shield') return ['add'];
    const out = ['add', 'mul', 'set', 'cap'];
    if (field === 'current') out.push('tick');
    if (field === 'bonus') out.push('dice', 'adv', 'dis');
    if (field === 'charges') out.push('block');
    return out;
  }

  // v108: старые записи с mode:'block' могли хранить поле bonus; приводим
  // к зарядам, иначе форма покажет несовместимую пару «бонус + запрет».
  // v114: тик всегда работает по текущему значению.
  function draftItemEffect(ef) {
    const n = normalizeEffect(ef);
    if (n.mode === 'block') n.field = 'charges';
    if (n.mode === 'tick') n.field = 'current';
    return n;
  }

  // v108: один редактор предмета на два места — набор и свою вещь.
  // Поля и эффекты общие. Разница в обвязке: у строки инвентаря есть
  // количество, «надето» и цель применения; у предмета набора их нет —
  // цель там выбирается в игре. Запись и удаление приходят колбэками:
  // набор пишет в свой ключ, вещь — в состояние листа через commit().
  function openItemForm(cfg) {
    const own = cfg.mode === 'own';
    const draft = cfg.draft;
    const ch = own ? activeChar() : null;
    let fx = (draft.effects || []).map(draftItemEffect);
    let secFx = draft.secret ? (draft.secret.effects || []).map(draftItemEffect) : [];
    const el = function (id) { return document.getElementById(id); };
    const val = function (id) { const n = el(id); return n ? n.value : ''; };
    const chk = function (id) { const n = el(id); return !!(n && n.checked); };
    const FIELD_IDS = ['bonus', 'max', 'value', 'charges', 'current'];
    const packs = own ? packsList().filter(function (p) { return charPacks(ch)[p.id]; }) : [];

    // v112: «Прочее» — без эффектов. Поведение задаёт категория, как у кнопок
    // «Надеть»/«Использовать»: у прочего нет действия, которое включает эффект.
    // Истинная часть проверяется по своей эффективной категории: пустая
    // наследует базовую, поэтому «истинный прочий» тоже без эффектов.
    const fxAllowedFor = function (cat) { return cat !== 'misc'; };
    const baseCatNow = function () { return val('if-cat') || draft.category; };
    const secCatNow = function () { return val('if-sec-cat') || baseCatNow(); };
    let baseFxOk = null, secFxOk = null;

    function updateFxAvailability() {
      const baseOk = fxAllowedFor(baseCatNow());
      const box = el('if-fx-on');
      if (box) {
        // при переходе «прочее ↔ остальное» возвращаем/снимаем галочку по факту
        if (baseOk !== baseFxOk) { box.checked = baseOk ? fx.length > 0 : false; baseFxOk = baseOk; }
        box.disabled = !baseOk;
      }
      const wrap = el('if-fx-wrap');
      if (wrap) wrap.style.display = (baseOk && chk('if-fx-on')) ? '' : 'none';
      // v113: у «Прочего» блока эффектов нет совсем — ни галочки, ни подсказки
      const sect = el('if-fx-sect');
      if (sect) sect.style.display = baseOk ? '' : 'none';

      const secOk = fxAllowedFor(secCatNow());
      const sbox = el('if-secfx-on');
      if (sbox) {
        if (secOk !== secFxOk) { sbox.checked = secOk ? secFx.length > 0 : false; secFxOk = secOk; }
        sbox.disabled = !secOk;
      }
      const swrap = el('if-secfx-wrap');
      if (swrap) swrap.style.display = (secOk && chk('if-secfx-on')) ? '' : 'none';
      const ssect = el('if-secfx-sect');
      if (ssect) ssect.style.display = secOk ? '' : 'none';
    }

    // цели эффекта: поле решает, какие карточки вообще могут его принять
    function targetsFor(field) {
      return own ? effectTargetCards(field) : [];
    }

    // v115: щит — только у расходников (разовая выдача запаса)
    function fieldIdsFor() {
      const out = FIELD_IDS.slice();
      if (draft.category === 'consumable') out.push('shield');
      return out;
    }

    function renderFx() {
      const host = el('if-fx-list');
      if (host) host.innerHTML = fxRowsHTML(fx, { targets: own, emptyText: 'itemNoEffects' });
      const secHost = el('if-sec-fx-list');
      if (secHost) secHost.innerHTML = fxRowsHTML(secFx, { targets: own, emptyText: 'itemNoEffects' });
      const hint = el('if-fx-hint');
      if (hint) {
        hint.textContent = own
          ? (draft.category === 'equipment' ? App.t('itemFxEquippedHint') : '')
          : App.t('itemTargetInGame');
      }
    }

    function renderIcons() {
      const host = el('if-icons');
      if (!host) return;
      host.innerHTML = itemIconsFor(draft.category).map(function (ic) {
        return '<button type="button" class="item-icon' + (ic.id === draft.icon ? ' on' : '') + '" data-if-icon="' + ic.id + '">' + ic.ch + '</button>';
      }).join('');
    }

    // у своей вещи — количество и «надето» (снаряжение); цели живут в эффектах
    function ownExtraHTML() {
      let h = '<div class="fx-pair">' +
        '<div class="field"><label>' + esc(App.t('itemQty')) + '</label>' +
          '<input id="if-qty" type="number" min="1" value="' + esc(draft.qty || 1) + '"></div>';
      if (draft.category === 'equipment') {
        h += '<div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" id="if-equipped"' +
          (draft.equipped ? ' checked' : '') + '> ' + esc(App.t('itemEquip')) + '</label></div>';
      }
      return h + '</div>';
    }
    function renderOwnExtra() {
      const host = el('if-own-extra');
      if (!host) return;
      const qtyEl = el('if-qty');
      const qty = qtyEl ? qtyEl.value : null;
      host.innerHTML = ownExtraHTML();
      const nextQty = el('if-qty');
      if (nextQty && qty != null) nextQty.value = qty;
    }

    function exportEffect(ef) {
      const out = normalizeEffect(ef);
      if (out.mode === 'block') out.value = '';
      // v114: длительность — только если задана; «когда» нужно только тику
      const dur = num(out.duration);
      out.duration = dur > 0 ? dur : null;
      if (out.mode !== 'tick') delete out.timing;
      if (!own) out.target = null;
      return out;
    }

    // единый сборщик: «Сохранить» и «Сохранить в набор» берут одно и то же
    function collect() {
      const name = val('if-name').trim();
      if (!name) { toast(App.t('packNameNeeded')); return null; }
      const cat = val('if-cat');
      const w = val('if-weight').trim();
      const out = {
        name: name,
        category: cat,
        icon: itemIconId(draft.icon, cat),
        weight: w === '' ? null : num(w),
        price: val('if-price').trim(),
        damage: val('if-dmg').trim(),
        description: val('if-desc').trim(),
        // v112: у «Прочего» эффектов нет — чистим при сохранении
        effects: fxAllowedFor(cat) && chk('if-fx-on') ? fx.map(exportEffect) : [],
        secret: null
      };
      if (chk('if-sec-on')) {
        const sw = val('if-sec-weight').trim();
        const secCat = val('if-sec-cat') || cat;
        out.secret = {
          text: val('if-sec-text').trim(),
          name: val('if-sec-name').trim(),
          category: val('if-sec-cat'),
          damage: val('if-sec-dmg').trim(),
          weight: sw === '' ? null : num(sw),
          price: val('if-sec-price').trim(),
          description: val('if-sec-desc').trim(),
          // истинная часть без категории наследует базовую — «истинный прочий» без эффектов
          effects: fxAllowedFor(secCat) && chk('if-secfx-on') ? secFx.map(exportEffect) : []
        };
      }
      if (own) {
        out.qty = Math.max(1, parseInt(val('if-qty'), 10) || 1);
        out.equipped = cat === 'equipment' ? chk('if-equipped') : false;
      }
      return out;
    }

    const catOpts = ITEM_CATEGORIES.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === draft.category ? ' selected' : '') + '>' + esc(App.t(c.labelKey)) + '</option>';
    }).join('');
    const secCatOpts = '<option value="">— ' + esc(App.t('packKeep')) + ' —</option>' + ITEM_CATEGORIES.map(function (c) {
      return '<option value="' + c.id + '"' + (draft.secret && draft.secret.category === c.id ? ' selected' : '') + '>' + esc(App.t(c.labelKey)) + '</option>';
    }).join('');
    const sec = draft.secret || {};
    const packOpts = packs.map(function (p) {
      return '<option value="' + esc(p.id) + '">' + esc(p.name || App.t('packDefaultName')) + '</option>';
    }).join('');

    const body =
      (own ? '<button type="button" class="modal-icon-btn" id="if-del" title="' + esc(App.t('delete')) + '" aria-label="' + esc(App.t('delete')) + '">' + TRASH_SVG + '</button>' : '') +
      '<div class="field"><label>' + esc(App.t('name')) + '</label><input id="if-name" value="' + esc(draft.name) + '"></div>' +
      '<div class="fx-pair">' +
        '<div class="field"><label>' + esc(App.t('itemCategory')) + '</label><select id="if-cat">' + catOpts + '</select></div>' +
        '<div class="field"><label>' + esc(App.t('weight')) + '</label><input id="if-weight" value="' + esc(draft.weight == null ? '' : draft.weight) + '" placeholder="—"></div>' +
      '</div>' +
      '<div class="field"><label>' + esc(App.t('itemIcon')) + '</label><div id="if-icons" class="item-icon-grid"></div></div>' +
      '<div class="fx-pair">' +
        '<div class="field"><label>' + esc(App.t('itemPrice')) + '</label><input id="if-price" value="' + esc(draft.price || '') + '"></div>' +
        '<div class="field"><label>' + esc(App.t('itemDamage')) + '</label><input id="if-dmg" value="' + esc(draft.damage || '') + '" placeholder="2d8+1"></div>' +
      '</div>' +
      '<div class="field"><label>' + esc(App.t('description')) + '</label><textarea id="if-desc">' + esc(draft.description || '') + '</textarea></div>' +
      (own ? '<div id="if-own-extra"></div>' : '') +
      '<div class="sect" id="if-fx-sect"><label class="check"><input type="checkbox" id="if-fx-on"' + (fx.length ? ' checked' : '') + '> ' + esc(App.t('itemHasEffects')) + '</label>' +
        '<div id="if-fx-wrap" style="margin-top:8px' + (fx.length ? '' : ';display:none') + '">' +
          '<div id="if-fx-list" class="fx-rows"></div>' +
          '<button type="button" id="if-fx-add" class="fx-add">＋ ' + esc(App.t('fxAdd')) + '</button>' +
          '<div class="formula-help" id="if-fx-hint"></div>' +
        '</div></div>' +
      '<div class="sect"><label class="check"><input type="checkbox" id="if-sec-on"' + (draft.secret ? ' checked' : '') + '> ' + esc(App.t('itemTrueItem')) + '</label>' +
        '<div id="if-sec-wrap" style="margin-top:8px' + (draft.secret ? '' : ';display:none') + '">' +
          '<div class="field"><label>' + esc(App.t('itemSecretText')) + '</label><input id="if-sec-text" value="' + esc(sec.text || '') + '"></div>' +
          '<div class="fx-pair">' +
            '<div class="field"><label>' + esc(App.t('itemSecretName')) + '</label><input id="if-sec-name" value="' + esc(sec.name || '') + '"></div>' +
            '<div class="field"><label>' + esc(App.t('itemSecretCategory')) + '</label><select id="if-sec-cat">' + secCatOpts + '</select></div>' +
          '</div>' +
          '<div class="fx-pair">' +
            '<div class="field"><label>' + esc(App.t('itemSecretDamage')) + '</label><input id="if-sec-dmg" value="' + esc(sec.damage || '') + '"></div>' +
            '<div class="field"><label>' + esc(App.t('itemSecretWeight')) + '</label><input id="if-sec-weight" value="' + esc(sec.weight != null ? sec.weight : '') + '"></div>' +
          '</div>' +
          '<div class="field"><label>' + esc(App.t('itemSecretPrice')) + '</label><input id="if-sec-price" value="' + esc(sec.price || '') + '"></div>' +
          '<div class="field"><label>' + esc(App.t('itemSecretDesc')) + '</label><textarea id="if-sec-desc">' + esc(sec.description || '') + '</textarea></div>' +
          '<div class="sect" id="if-secfx-sect" style="margin-top:8px"><label class="check"><input type="checkbox" id="if-secfx-on"' + (secFx.length ? ' checked' : '') + '> ' + esc(App.t('itemHasTrueEffects')) + '</label>' +
            '<div id="if-secfx-wrap" style="margin-top:8px' + (secFx.length ? '' : ';display:none') + '">' +
              '<div id="if-sec-fx-list" class="fx-rows"></div>' +
              '<button type="button" id="if-sec-fx-add" class="fx-add">＋ ' + esc(App.t('fxAdd')) + '</button>' +
              '<div class="formula-help">' + esc(App.t('itemTargetInGame')) + '</div>' +
            '</div></div>' +
        '</div></div>' +
      (own && packs.length ? '<div class="field" style="margin-top:10px"><label>' + esc(App.t('itemSaveToPack')) + '</label>' +
        '<div class="fx-add-row" style="margin-top:0"><select id="if-pack">' + packOpts + '</select>' +
        '<button type="button" id="if-to-pack" class="add-btn">' + esc(App.t('itemSaveToPack')) + '</button></div></div>' : '');

    openModal(cfg.title, body, [
      { label: App.t('cancel'), onClick: function () { if (cfg.onCancel) return cfg.onCancel(); } },
      { label: App.t('save'), cls: 'primary', onClick: function () {
        const out = collect();
        if (!out) return false;
        return cfg.onSave(out) === false ? false : undefined;
      } }
    ]);

    renderFx();
    renderIcons();
    renderOwnExtra();
    updateFxAvailability();

    el('if-cat').addEventListener('change', function (e) {
      draft.category = e.target.value;
      draft.icon = itemIconId(draft.icon, draft.category);
      renderIcons();
      renderOwnExtra();
      renderFx();
      updateFxAvailability();
    });
    el('if-icons').addEventListener('click', function (e) {
      const b = e.target.closest('[data-if-icon]');
      if (!b) return;
      draft.icon = b.dataset.ifIcon;
      renderIcons();
    });
    el('if-fx-on').addEventListener('change', function (e) {
      el('if-fx-wrap').style.display = e.target.checked ? '' : 'none';
    });
    el('if-sec-on').addEventListener('change', function (e) {
      el('if-sec-wrap').style.display = e.target.checked ? '' : 'none';
      updateFxAvailability();
    });
    el('if-secfx-on').addEventListener('change', function (e) {
      el('if-secfx-wrap').style.display = e.target.checked ? '' : 'none';
    });
    el('if-sec-cat').addEventListener('change', updateFxAvailability);

    // v157: эффекты предмета — те же плашки и то же окно, что у состояний.
    // Цель есть только у своей вещи; у предмета набора её выбирают в игре.
    function openItemFxEditor(arr, index, anchor) {
      openFxEditor({
        effect: index == null ? null : arr[index],
        kinds: ['number', 'roll', 'die', 'tick', 'block', 'shield'],
        fieldsFor: function () { return fieldIdsFor(); },
        modesFor: function (field) { return effectModesFor(field); },
        targetsFor: own ? function (kind, field) { return effectTargetCards(field || 'bonus'); } : null,
        targetOptional: true,
        allowDuration: draft.category === 'consumable',
        anchor: anchor,
        onSave: function (ef) {
          if (index == null) arr.push(ef);
          else arr[index] = ef;
          renderFx();
        }
      });
    }

    function bindFxRows(listId, arr) {
      const host = el(listId);
      if (!host) return;
      host.addEventListener('click', function (e) {
        const edit = e.target.closest('[data-fx-edit]');
        if (edit) { openItemFxEditor(arr, +edit.dataset.fxEdit, edit); return; }
        const dup = e.target.closest('[data-fx-dup]');
        if (dup) {
          const i = +dup.dataset.fxDup;
          const src = arr[i];
          if (src) { arr.splice(i + 1, 0, JSON.parse(JSON.stringify(src))); renderFx(); }
          return;
        }
        const del = e.target.closest('[data-fx-del]');
        if (del) { arr.splice(+del.dataset.fxDel, 1); renderFx(); }
      });
    }
    bindFxRows('if-fx-list', fx);
    bindFxRows('if-sec-fx-list', secFx);

    el('if-fx-add').addEventListener('click', function (e) {
      openItemFxEditor(fx, null, e.currentTarget);
    });
    el('if-sec-fx-add').addEventListener('click', function (e) {
      openItemFxEditor(secFx, null, e.currentTarget);
    });

    const ownHost = el('if-own-extra');
    if (ownHost) {
      ownHost.addEventListener('input', function (e) {
        if (e.target.id === 'if-qty') draft.qty = Math.max(1, parseInt(e.target.value, 10) || 1);
      });
      ownHost.addEventListener('change', function (e) {
        if (e.target.id === 'if-equipped') draft.equipped = !!e.target.checked;
      });
    }

    const delBtn = el('if-del');
    if (delBtn) delBtn.addEventListener('click', function () {
      askDelete({
        text: App.tf('itemDeleteConfirm', { name: val('if-name').trim() || draft.name }),
        anchor: delBtn,
        onYes: function () { cfg.onDelete(); }
      });
    });
    const toPackBtn = el('if-to-pack');
    if (toPackBtn) toPackBtn.addEventListener('click', function () {
      const out = collect();
      if (out) cfg.onSaveToPack(val('if-pack'), out);
    });
  }

  // v157: копия предмета набора — только в настройках, в инвентаре её нет.
  // Редактор после копии не открываем: видно новую строку в списке.
  function duplicatePackItem(packId, itemId) {
    rememberSettingsScroll();
    const pack = packById(packId);
    if (!pack) return;
    const src = (pack.items || []).find(function (it) { return it.id === itemId; });
    if (!src) return;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uid();
    const base = String(src.name || App.t('packItemNew')).replace(/\s*\(\d+\)\s*$/, '');
    let n = 2;
    let name = base + ' (' + n + ')';
    while ((pack.items || []).some(function (it) { return it.name === name; })) {
      n++;
      name = base + ' (' + n + ')';
    }
    copy.name = name;
    pack.items.push(copy);
    savePacks();
    toast(App.tf('duplicatedGeneric', { name: name }));
    openSettings('items');
  }

  // v108: предмет набора — та же форма, но без количества/«надето»/цели
  // и с записью в отдельный ключ наборов, а не в состояние листа.
  function openPackItemEditor(packId, itemId) {
    rememberSettingsScroll();
    const pack = packById(packId);
    if (!pack) return;
    const existing = itemId ? (pack.items || []).find(function (it) { return it.id === itemId; }) : null;
    const draft = normalizePackItem(existing || {
      id: uid(), name: App.t('packItemNew'), category: 'misc', weight: null,
      damage: '', price: '', description: '', secret: null, effects: []
    });
    openItemForm({
      mode: 'pack',
      title: existing ? App.t('packItemEdit') : App.t('packItemNew'),
      draft: draft,
      onCancel: function () { openSettings('items'); return false; },
      onSave: function (out) {
        const next = normalizePackItem(Object.assign({}, draft, out, { id: draft.id }));
        if (existing) {
          const idx = pack.items.findIndex(function (it) { return it.id === existing.id; });
          if (idx !== -1) pack.items[idx] = next;
        } else {
          pack.items.push(next);
        }
        savePacks();
        openSettings('items');
        return false;
      }
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
          toast(App.tf('renamedGeneric', { name: name }));
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
    if (field === 'bonus') out.push('dice', 'adv', 'dis');
    if (field === 'charges') out.push('block');
    return out;
  }

  function openStateEditor(setId, entryId, opts) {
    opts = opts || {};
    if (!opts.returnCardId) rememberSettingsScroll();
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

    // v153: эффекты шаблона — плашки и общий редактор эффекта. Цели в шаблоне
    // нет: она выбирается при применении, поэтому targetsFor не задаём.
    const STATE_FX_KINDS = ['number', 'roll', 'die', 'tick', 'block'];

    function stateFxCfg(index) {
      return {
        effect: index == null ? null : draft.effects[index],
        kinds: STATE_FX_KINDS,
        fieldsFor: function () { return STATE_FIELDS; },
        modesFor: function (field) { return stateModesFor(field); },
        allowDuration: false,
        anchor: el('st-fx-add'),
        onSave: function (ef, mode) {
          if (index == null) draft.effects.push(ef);
          else if (mode === 'duplicate') draft.effects.splice(index + 1, 0, ef);
          else draft.effects[index] = ef;
          renderFxList();
          renderPreview();
        }
      };
    }

    function renderFxList() {
      const host = el('st-fx-list');
      if (!host) return;
      host.innerHTML = fxRowsHTML(draft.effects, { emptyText: 'stNoEffects' });
    }

    function duplicateFx(i) {
      const src = draft.effects[i];
      if (!src) return;
      draft.effects.splice(i + 1, 0, JSON.parse(JSON.stringify(src)));
      renderFxList();
      renderPreview();
    }

    function deleteFx(i) {
      draft.effects.splice(i, 1);
      renderFxList();
      renderPreview();
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
          // v153: базовый набор активен и без записи в stateSets, поэтому
          // «активный» определяем по фактическому набору, иначе копия терялась
          const active = !!(ch && stateSetOf(ch) && stateSetOf(ch).id === sourceSet.id);
          target = copyStateSetForEdit(sourceSet, active);
          if (active) relinkSnapshotsToSet(sourceSet.id, target.id);
        }
        const saved = saveStateEntry(target, sourceEntry, draft, isNew);
        // v153: обновляем активные состояния сразу, не дожидаясь кнопки
        if (saved) syncEntryToCharacters(target, saved);
      });
      return true;
    }

    // куда вернуться после сохранения/отмены: из настроек — в список,
    // из игры (карандаш в каталоге) — обратно в слой состояния
    const leave = function () {
      if (opts.returnCardId) {
        closeModal();
        openConditionLayer(opts.returnCardId);
        return false;
      }
      openSettings('states');
      return false;
    };

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
            '<div id="st-fx-list" class="fx-rows"></div>' +
            '<button type="button" id="st-fx-add" class="fx-add">＋ ' + esc(App.t('fxAdd')) + '</button>' +
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
      { label: App.t('cancel'), onClick: leave },
      { label: App.t('save'), cls: 'primary', onClick: function () {
        if (!saveDraft()) return false;
        return leave();
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
    el('st-back').addEventListener('click', leave);

    // эффекты: плашки, правка и добавление — в общем редакторе (без цели)
    el('st-fx-add').addEventListener('click', function () {
      openFxEditor(stateFxCfg(null));
    });
    el('st-fx-list').addEventListener('click', function (e) {
      const edit = e.target.closest('[data-fx-edit]');
      if (edit) {
        openFxEditor(stateFxCfg(parseInt(edit.dataset.fxEdit, 10)));
        return;
      }
      const del = e.target.closest('[data-fx-del]');
      if (del) { deleteFx(parseInt(del.dataset.fxDel, 10)); return; }
      const dup = e.target.closest('[data-fx-dup]');
      if (dup) duplicateFx(parseInt(dup.dataset.fxDup, 10));
    });

    renderIcons();
    renderPreview();
    renderFxList();
  }

  // v160: настройки пересоздаются после редактора, поэтому запоминаем,
  // где листали список, и возвращаем туда же при открытии вкладки.
  let settingsScroll = null;
  function rememberSettingsScroll() {
    const modal = document.getElementById('modal');
    if (!modal || modal.classList.contains('hidden')) return;
    const panel = modal.querySelector('.s-panel:not(.hidden)');
    if (!panel) return;
    const seen = { tab: panel.dataset.panel, panel: panel.scrollTop, rows: {} };
    panel.querySelectorAll('.set-card').forEach(function (card) {
      const key = card.dataset.set || card.dataset.pack;
      const rows = card.querySelector('.set-rows');
      if (key && rows) seen.rows[key] = rows.scrollTop;
    });
    settingsScroll = seen;
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
        '<button type="button" class="s-tab" data-tab="items">' + esc(App.t('tabPacks')) + '</button>' +
        '<button type="button" class="s-tab" data-tab="data">' + esc(App.t('tabData')) + '</button>' +
      '</div>';

    const general =
      '<div class="s-panel" data-panel="general">' +
        '<div class="field"><label>' + esc(App.t('languageLabel')) + '</label>' +
        '<select id="s-lang"><option value="ru"' + (lang === 'ru' ? ' selected' : '') + '>Русский</option>' +
        '<option value="en"' + (lang === 'en' ? ' selected' : '') + '>English</option></select></div>' +
        '<div class="field check"><input id="s-anim" type="checkbox"' + (state.settings.diceAnimation !== false ? ' checked' : '') + '><label for="s-anim">' + esc(App.t('diceAnimation')) + '</label></div>' +
        '<div class="field check"><input id="s-fillmax" type="checkbox"' + (state.settings.fillMaxCurrent ? ' checked' : '') + '><label for="s-fillmax">' + esc(App.t('fillMaxCurrent')) + '</label></div>' +
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

    openModal(App.t('settings'), tabs + general + settingsSetPanel('states', ch) + settingsPacksPanel(ch) + dataPanel,
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

    document.getElementById('s-lang').addEventListener('change', function (e) {
      state.settings.language = e.target.value;
      commit();
    });
    document.getElementById('s-anim').addEventListener('change', function (e) { state.settings.diceAnimation = e.target.checked; save(); });
    document.getElementById('s-fillmax').addEventListener('change', function (e) { state.settings.fillMaxCurrent = e.target.checked; save(); });
    document.getElementById('s-crit').addEventListener('change', function (e) { state.settings.critSuccess = e.target.value.trim(); save(); });
    document.getElementById('s-critfail').addEventListener('change', function (e) { state.settings.critFail = e.target.value.trim(); save(); });
    document.getElementById('s-char').addEventListener('change', function (e) {
      state.activeCharacterId = e.target.value;
      commit();
      // v84: пересобрать настройки, иначе вкладка «Состояния» и выбор набора
      // остаются от предыдущего персонажа до повторного открытия меню.
      openSettings('general');
    });
    document.getElementById('s-newchar').addEventListener('click', function () {
      closeModal();
      openNewCharModal();
    });
    if (ch) document.getElementById('s-delchar').addEventListener('click', function () {
      closeModal();
      askDelete({ text: App.tf('confirmDeleteChar', { name: ch.name }), onYes: deleteActiveCharacter, title: App.t('deleteCharacter') });
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
      confirmDialog(App.t('resetConfirm'), function () { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(PACKS_KEY); location.reload(); }, App.t('settings'));
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
    m.querySelectorAll('[data-dup-state]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        duplicateStateEntry(b.dataset.setId, b.dataset.dupState);
      });
    });

    // v94: паки предметов
    const packAdd = document.getElementById('s-pack-add');
    if (packAdd) packAdd.addEventListener('click', function () { openPackNameModal(null); });
    const packImport = document.getElementById('s-pack-import');
    if (packImport) packImport.addEventListener('click', function () { pickFile(importPack); });
    m.querySelectorAll('[data-add-pack-item]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); openPackItemEditor(b.dataset.addPackItem, null); });
    });
    m.querySelectorAll('[data-edit-pack-item]').forEach(function (row) {
      row.addEventListener('click', function () { openPackItemEditor(row.dataset.packId, row.dataset.editPackItem); });
    });
    m.querySelectorAll('[data-dup-pack-item]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        duplicatePackItem(b.dataset.packId, b.dataset.dupPackItem);
      });
    });
    m.querySelectorAll('[data-del-pack-item]').forEach(function (b) {
      b.addEventListener('click', function (e) {
        e.stopPropagation();
        deletePackItem(b.dataset.packId, b.dataset.delPackItem, b);
      });
    });
    m.querySelectorAll('[data-rename-pack]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); renamePackInline(b.dataset.renamePack, b); });
    });
    m.querySelectorAll('[data-del-pack]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); deletePack(b.dataset.delPack, b); });
    });
    m.querySelectorAll('[data-export-pack]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); exportPack(b.dataset.exportPack); });
    });
    m.querySelectorAll('[data-pack-chars]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); openPackCharsMenu(b.dataset.packChars, b); });
    });
    m.querySelectorAll('[data-state-chars]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); openStateCharsMenu(b.dataset.stateChars, b); });
    });

    // v160: вернуть прокрутку списка после сохранения/отмены редактора
    if (settingsScroll && settingsScroll.tab === startTab) {
      const panel = m.querySelector('.s-panel[data-panel="' + startTab + '"]');
      if (panel) panel.scrollTop = settingsScroll.panel;
      Object.keys(settingsScroll.rows || {}).forEach(function (key) {
        const rows = m.querySelector('.set-card[data-set="' + key + '"] .set-rows') ||
          m.querySelector('.set-card[data-pack="' + key + '"] .set-rows');
        if (rows) rows.scrollTop = settingsScroll.rows[key];
      });
      settingsScroll = null;
    }
  }

  // Привязать персонажа к набору (массив ссылок — задел на уровень 3)
  function setCharSet(charId, kind, setId) {
    const ch = state.characters.find(function (c) { return c.id === charId; });
    if (!ch || !libSetById(kind, setId)) return;
    const key = kind === 'states' ? 'stateSets' : 'itemSets';
    mutate(function () { ch[key] = [setId]; });
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
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    closeInlineAsk();
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
    // Слушатели ставим сразу: событие, которым открыли вопрос, уже не всплывёт
    // повторно, а setTimeout(0) мог добавить их уже после закрытия.
    document.addEventListener('pointerdown', onAskDocDown, true);
    window.addEventListener('keydown', onAskKey, true);
  }

  // Удалить набор (только свой, не базовый). Ничего никуда не переносим:
  // у карточек состояния — снимки, они остаются как есть; листы падают на базовый.
  function deleteLibrarySet(kind, id, anchor) {
    rememberSettingsScroll();
    const set = libSetById(kind, id);
    if (!set || set.builtin) return;
    const used = state.characters.filter(function (c) { return charSetId(c, kind) === id; }).length;
    const nm = setDisplayName(set);
    const msg = used ? App.tf('setDeleteUsed', { name: nm, n: used }) : App.tf('setDeleteConfirm', { name: nm });
    askDelete({ text: msg, anchor: anchor, onYes: function () {
      mutate(function () {
        state.libraries[kind] = libSets(kind).filter(function (s) { return s.id !== id; });
        const key = kind === 'states' ? 'stateSets' : 'itemSets';
        const fallback = libSets(kind).find(function (s) { return s.builtin; }) || libSets(kind)[0];
        state.characters.forEach(function (ch) {
          if (Array.isArray(ch[key])) ch[key] = ch[key].filter(function (x) { return x !== id; });
          // явно переводим на базовый набор, а не оставляем пустой массив
          if ((!ch[key] || !ch[key].length) && fallback) ch[key] = [fallback.id];
        });
      });
      toast(App.tf('deletedGeneric', { name: nm }));
      openSettings(kind);
    } });
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
      if (Array.isArray(data.packs)) {
        packsStore = { version: 1, seeded: true, packs: data.packs.map(function (p) {
          return { id: String(p.id || uid()), name: String(p.name || App.t('packDefaultName')), items: Array.isArray(p.items) ? p.items.map(normalizePackItem) : [] };
        }) };
        savePacks();
      }
      state.activeCharacterId = fresh.length ? fresh[0].id : null;
    });
    toast(App.t('imported'));
  }
  function exportAll() {
    download('custplay-backup.json', JSON.stringify({ app: 'custplay', kind: 'backup', version: 1, characters: state.characters.map(stripTransient), settings: state.settings, packs: packsList() }, null, 2));
    toast(App.t('exported'));
  }

  // проверка и нормализация импортируемого персонажа: старые типы (stat → навык,
  // perk → заклинание, formula → навык), незнакомые карточки отбрасываем, битые поля подставляем.
  // Кидает ошибку для кривого файла.
  function normalizeImport(src) {
    if (!src || typeof src !== 'object' || !Array.isArray(src.cards)) throw new Error('bad');
    const ch = { id: uid(), name: String(src.name || App.t('newCharName')), pages: [], cards: [] };
    if (src.packs && typeof src.packs === 'object') ch.packs = src.packs;
    if (src.itemSets) ch.itemSets = src.itemSets;
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
    // v115: старые «переполнения» и щит приводим к новой модели и при импорте
    migrateShields({ characters: [ch] });
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
      const modBadge = e.target.closest ? e.target.closest('.mod-badge') : null;
      const finf = e.target.closest ? e.target.closest('.finf') : null;
      const linktag = e.target.closest ? e.target.closest('.linktag') : null;
      const old = document.getElementById('finfPop');
      if (!finf && !linktag && !modBadge) { if (old) old.remove(); closeAll(); return; }
      closeAll();
      const cardEl = (finf || linktag || modBadge).closest('.card');
      const card = cardEl ? findCard(cardEl.dataset.id) : null;
      if (!card) return;
      const pop = document.createElement('div');
      pop.id = 'finfPop';
      pop.className = 'finf-pop';
      if (modBadge) {
        const s = modSummary(card);
        pop.className = 'finf-pop mod-pop';
        pop.innerHTML = '<div class="mod-pop-title">' + esc(App.t('modsTitle')) + '</div>' +
          (s.items.length
            ? s.items.map(function (t) { return '<div class="mod-pop-row">' + esc(t) + '</div>'; }).join('')
            : '<div class="mod-pop-row">—</div>');
      } else if (finf) {
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

  // ===== Что нового (v139) =====
  // Версия приложения для окна обновлений. При выпуске новой версии подними
  // APP_VERSION, добавь запись в NEWS (только новые пункты) и не забудь
  // style.css?v= в index.html и CACHE_NAME в sw.js.
  const APP_VERSION = 162;
  const NEWS_SEEN_KEY = 'custplay-news-seen';   // отдельно от state: не попадает в undo и экспорт
  const NEWS = {
    // 140–141 — хотфиксы, 142–145 — заметки со страницами, 146 — режим максимума,
    // 147 — полоса закладок заметки, 148–151 — состояния, 152 — щит баффов.
    162: { ru: [], en: [] },
    161: {
      ru: [
        'Более удобный редактор эффектов: состояния, предметы и баффы в одном окне.',
        'Свои названия в баффах.',
        'Щит в баффах.',
        'Копии состояний и предметов.'
      ],
      en: [
        'A cleaner effect editor: conditions, items and buffs in one window.',
        'Custom labels for buffs.',
        'Shield in buffs.',
        'Copy conditions and items.'
      ]
    },
    160: { ru: [], en: [] },
    159: { ru: [], en: [] },
    158: { ru: [], en: [] },
    157: { ru: [], en: [] },
    156: { ru: [], en: [] },
    155: { ru: [], en: [] },
    154: { ru: [], en: [] },
    153: { ru: [], en: [] },
    152: { ru: [], en: [] },
    151: { ru: [], en: [] },
    150: { ru: [], en: [] },
    149: { ru: [], en: [] },
    148: { ru: [], en: [] },
    147: { ru: [], en: [] },
    146: { ru: [], en: [] },
    145: { ru: [], en: [] },
    144: { ru: [], en: [] },
    143: { ru: [], en: [] },
    142: { ru: [], en: [] },
    141: { ru: [], en: [] },
    140: { ru: [], en: [] },
    139: {
      ru: [
        'Инвентарь: наборы предметов, свои вещи и предметы из наборов — количество, вес, цена, урон, «Надеть» и «Использовать», поиск и категории. Своя вещь правится прямо в игре и обновляется из набора.',
        'Эффекты предметов: меняют выбранную карточку — значение, длительность, тики. Преимущество и помеха тоже задаются эффектом предмета — числом бросков. Активные эффекты видны полосой в шапке инвентаря, на свёрнутом ярлыке — счётчиком.',
        'Щиты: запас, который принимает урон первым. Бывает постоянным и временным, с ходами; лечение щит не трогает, «Отдых» снимает.',
        'Состояния и баффы: эффекты меняют другие карточки (максимум, бонус, заряды), у состояний и баффов есть длительность и тики. Бафф включается тапом, эффектов у него может быть несколько.',
        'Телефон: плиточная сетка — инициатива занимает два ряда, состояние три, рядом с ними встают обычные карточки. Навык — компактный квадрат, валюта больше не вылезает за край.'
      ],
      en: [
        'Inventory: item packs, your own items and pack items — quantity, weight, price, damage, Equip and Use, search and categories. Your item is edited right in play and refreshed from its pack.',
        'Item effects: they change a chosen card — value, duration, ticks. Advantage and disadvantage are set as an item effect too — by the number of rolls. Active effects show in the inventory header; a collapsed label shows a counter.',
        'Shields: a pool that takes damage first. It can be permanent or temporary, with rounds; healing does not touch it, Rest clears it.',
        'Conditions and buffs: effects change other cards (max, bonus, charges); conditions and buffs have a duration and ticks. A buff toggles on tap and can hold several effects.',
        'Phone: a tile grid — initiative takes two rows, a condition three, and regular cards fit beside them. The skill card is a compact square, currency no longer spills over the edge.'
      ]
    }
  };
  function newsSeenVersion() {
    try { return Math.round(num(localStorage.getItem(NEWS_SEEN_KEY)) || 0); } catch (e) { return APP_VERSION; }
  }
  function markNewsSeen() {
    try { localStorage.setItem(NEWS_SEEN_KEY, String(APP_VERSION)); } catch (e) {}
  }
  function clearNewsSeen() {
    try { localStorage.removeItem(NEWS_SEEN_KEY); } catch (e) {}
  }
  // Пункты всех версий, которые пользователь ещё не отметил. У старой версии
  // с GitHub отметки нет вовсе — ей показываем сразу весь накопленный список.
  function newsItems() {
    const lang = (state.settings && state.settings.language) === 'en' ? 'en' : 'ru';
    const seen = newsSeenVersion();
    let out = [];
    Object.keys(NEWS).map(Number).sort(function (a, b) { return a - b; }).forEach(function (v) {
      if (v <= seen) return;
      out = out.concat(NEWS[v][lang] || NEWS[v].ru);
    });
    return out;
  }
  function maybeShowNews(hadSave) {
    // первый запуск: сравнивать не с чем, окно не нужно
    if (!hadSave) { markNewsSeen(); return; }
    if (newsSeenVersion() >= APP_VERSION) return;
    const items = newsItems();
    if (!items.length) { markNewsSeen(); return; }
    const modal = document.getElementById('modal');
    if (modal && !modal.classList.contains('hidden')) return;   // не перебиваем уже открытое окно
    setTimeout(function () { showNews(items); }, 600);
  }
  function showNews(items) {
    openModal(App.t('newsTitle'),
      '<ul class="news-list">' + items.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' +
      '<label class="field check news-off"><input type="checkbox" id="news-off"><span>' + esc(App.t('newsDontShow')) + '</span></label>',
      [{ label: App.t('newsOk'), cls: 'primary' }]);
    // галочка действует до следующей версии: снял — окно снова появится при запуске
    const cb = document.getElementById('news-off');
    if (cb) cb.addEventListener('change', function () {
      if (cb.checked) markNewsSeen(); else clearNewsSeen();
    });
  }

  function init() {
    let hadSave = false;
    try { hadSave = !!localStorage.getItem(STORAGE_KEY); } catch (e) {}
    ensureLibraries();
    ensurePacks();
    migrateCondEntryIds();
    migrateNotePages();
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
    // v153: слой редактора эффекта — своя Esc-ловушка и Tab, поверх окна.
    // Слушаем window в capture: иначе Esc сначала закроет окно под слоем,
    // а меню цели (тоже window capture) должно получать клавишу первым.
    document.getElementById('fxBackdrop').addEventListener('click', closeFxEditor);
    document.getElementById('fxBody').addEventListener('click', fxOnBodyClick);
    document.getElementById('fxBody').addEventListener('input', fxOnBodyInput);
    window.addEventListener('keydown', function (e) {
      if (!fxIsOpen()) return;
      if (e.key === 'Escape') {
        if (mountedMenu) return;   // открытое меню закроется само
        e.preventDefault();
        e.stopImmediatePropagation();
        closeFxEditor();
        return;
      }
      if (e.key === 'Tab') {
        const modal = document.getElementById('fxModal');
        const all = modal.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
        const list = Array.prototype.filter.call(all, function (el) { return el.offsetParent !== null; });
        if (!list.length) return;
        const first = list[0], last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const t = e.target;
        if (!t) return;
        const tag = (t.tagName || '').toLowerCase();
        if (tag === 'button' || tag === 'textarea' || t.isContentEditable) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        fxTrySave('save');
      }
    }, true);
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
    // v147: раскрытая полоса закладок заметки закрывается тапом мимо неё —
    // на мыши это делает pointerleave, а на телефоне наведения нет
    document.addEventListener('pointerdown', function (e) {
      const t = e.target;
      if (t && t.closest && t.closest('.note-tab-rail')) return;
      document.querySelectorAll('.note-tab-rail.open').forEach(function (r) { r.classList.remove('open'); });
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
    // v139: «что нового» — после первой отрисовки, чтобы окно не мигало поверх загрузки
    maybeShowNews(hadSave);
  }

  init();
})();
