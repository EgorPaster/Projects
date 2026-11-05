window.App = window.App || {};

App.dice = (function () {
  const TYPES = [4, 6, 8, 10, 12, 20, 100];

  function roll(sides) {
    return 1 + Math.floor(Math.random() * sides);
  }

  // selection: array of { sides, count, bonus }
  function rollSet(selection) {
    const parts = [];
    let total = 0;
    selection.forEach(function (s) {
      for (let i = 0; i < s.count; i++) {
        const r = roll(s.sides);
        parts.push({ sides: s.sides, value: r });
        total += r;
      }
      if (s.bonus) {
        parts.push({ sides: 0, value: s.bonus, bonus: true });
        total += s.bonus;
      }
    });
    return { parts: parts, total: total };
  }

  function describeSet(selection) {
    const str = selection.map(function (s) {
      const b = s.bonus ? (s.bonus > 0 ? '+' : '−') + Math.abs(s.bonus) : '';
      return s.count + 'd' + s.sides + b;
    }).join(' + ');
    return str || '—';
  }

  return { TYPES: TYPES, roll: roll, rollSet: rollSet, describeSet: describeSet };
})();
