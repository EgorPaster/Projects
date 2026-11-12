window.App = window.App || {};

App.formula = (function () {
  // юникод-операторы → ASCII: телефоны и копипаст дают − × ÷ вместо - * /
  // заменяем только ВНЕ {...}: имена карточек в ссылках не трогаем
  function normalizeOps(input) {
    let out = '';
    let inRef = false;
    for (const c of String(input)) {
      if (c === '{') inRef = true;
      else if (c === '}') inRef = false;
      if (!inRef) {
        if (c === '−' || c === '–' || c === '—') { out += '-'; continue; }
        if (c === '×') { out += '*'; continue; }
        if (c === '÷') { out += '/'; continue; }
      }
      out += c;
    }
    return out;
  }
  function tokenize(input) {
    input = normalizeOps(input);
    const tokens = [];
    let i = 0;
    while (i < input.length) {
      const c = input[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '+' || c === '-' || c === '*' || c === '/' || c === '(' || c === ')') {
        tokens.push({ type: c });
        i++;
        continue;
      }
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < input.length && /[0-9.]/.test(input[j])) j++;
        const str = input.slice(i, j);
        const val = parseFloat(str);
        if (Number.isNaN(val)) throw new Error('bad number: ' + str);
        tokens.push({ type: 'num', value: val });
        i = j;
        continue;
      }
      throw new Error('unexpected: ' + c);
    }
    return tokens;
  }

  function evaluateArithmetic(input) {
    const tokens = tokenize(input);
    let p = 0;

    function peek(t) { return tokens[p] && tokens[p].type === t; }
    function next() { return tokens[p++]; }
    function expect(t) { if (!peek(t)) throw new Error('expected ' + t); return next(); }

    function expr() {
      let v = term();
      while (peek('+') || peek('-')) {
        const op = next().type;
        const r = term();
        v = (op === '+') ? v + r : v - r;
      }
      return v;
    }
    function term() {
      let v = fact();
      while (peek('*') || peek('/')) {
        const op = next().type;
        const r = fact();
        if (op === '*') v = v * r;
        else {
          if (r === 0) throw new Error('division by zero');
          v = v / r;
        }
      }
      return v;
    }
    function fact() {
      if (peek('-')) { next(); return -fact(); }
      if (peek('+')) { next(); return fact(); }
      if (peek('(')) { next(); const v = expr(); expect(')'); return v; }
      if (peek('num')) return next().value;
      throw new Error('expected number');
    }

    const val = expr();
    if (p < tokens.length) throw new Error('unexpected token');
    return val;
  }

  // expression uses {Name} and {Name.бонус} / {Name.bonus} tokens.
  // resolveRef(name, part) -> number, throws on error.
  function evaluate(expression, resolveRef) {
    const replaced = expression.replace(/\{([^{}]*)\}/g, function (m, inner) {
      inner = inner.trim();
      let name = inner;
      let part = 'value';
      const m2 = inner.match(/^(.*?)\s*\.\s*(бонус|bonus)$/i);
      if (m2) { name = m2[1].trim(); part = 'bonus'; }
      const v = resolveRef(name, part);
      const n = Number(v);
      if (v === undefined || v === null || Number.isNaN(n)) throw new Error('ref:' + name);
      return '(' + n + ')';
    });
    return evaluateArithmetic(replaced);
  }

  // rename references from oldName to newName inside a formula string
  function renameRefs(expression, oldName, newName) {
    return expression.replace(/\{([^{}]*)\}/g, function (m, inner) {
      const raw = inner.trim();
      const m2 = raw.match(/^(.*?)\s*\.\s*(бонус|bonus)$/i);
      const name = m2 ? m2[1].trim() : raw;
      const suffix = m2 ? '.' + m2[2] : '';
      if (name === oldName) return '{' + newName + suffix + '}';
      return m;
    });
  }

  function hasRef(expression, name) {
    let found = false;
    expression.replace(/\{([^{}]*)\}/g, function (m, inner) {
      const raw = inner.trim();
      const m2 = raw.match(/^(.*?)\s*\.\s*(бонус|bonus)$/i);
      const n = m2 ? m2[1].trim() : raw;
      if (n === name) found = true;
      return m;
    });
    return found;
  }

  return {
    evaluate: evaluate,
    evaluateArithmetic: evaluateArithmetic,
    renameRefs: renameRefs,
    hasRef: hasRef
  };
})();
