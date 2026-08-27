(() => {
  'use strict';

  const STORAGE_KEY = 'ledger_state_v1';

  const firebaseConfig = {
    apiKey: "AIzaSyCQw2gUFGzbwm0QP4c9sAw9MjVu1kWifEQ",
    authDomain: "yr-money.firebaseapp.com",
    projectId: "yr-money",
    storageBucket: "yr-money.firebasestorage.app",
    messagingSenderId: "181846143622",
    appId: "1:181846143622:web:38a6b638142ad7361f5707",
  };

  // 클라우드 연결이 준비되면 채워짐. 실패해도 앱은 로컬 저장만으로 정상 동작.
  let cloudDocRef = null;
  let cloudSetDoc = null;
  let lastSyncedJson = null;
  let firstSnapshot = true;

  /* ============ 상태 ============ */
  const defaultState = () => ({
    categories: [
      { id: uid(), name: '급여', type: 'income' },
      { id: uid(), name: '부수입', type: 'income' },
      { id: uid(), name: '기타수입', type: 'income' },
      { id: uid(), name: '식비', type: 'expense' },
      { id: uid(), name: '교통', type: 'expense' },
      { id: uid(), name: '주거/관리비', type: 'expense' },
      { id: uid(), name: '통신', type: 'expense' },
      { id: uid(), name: '문화/여가', type: 'expense' },
      { id: uid(), name: '의료/건강', type: 'expense' },
      { id: uid(), name: '저축/투자', type: 'expense' },
      { id: uid(), name: '기타지출', type: 'expense' },
    ],
    transactions: [],
    assets: [],
    assetSnapshots: {},
  });

  function uid() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      return {
        categories: parsed.categories || [],
        transactions: parsed.transactions || [],
        assets: parsed.assets || [],
        assetSnapshots: parsed.assetSnapshots || {},
      };
    } catch (e) {
      console.error('상태 로드 실패, 기본값 사용', e);
      return defaultState();
    }
  }

  let state = loadState();

  let cloudConnected = false;

  function setStamp(text, revertAfterMs) {
    const stamp = document.getElementById('dataStamp');
    if (!stamp) return;
    stamp.textContent = text;
    clearTimeout(setStamp._t);
    if (revertAfterMs) {
      const idleText = cloudConnected ? '☁ 실시간 동기화 중' : 'CLOUD SYNC';
      setStamp._t = setTimeout(() => { stamp.textContent = idleText; }, revertAfterMs);
    }
  }

  function saveState() {
    const json = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, json);

    if (!cloudDocRef || !cloudSetDoc) return; // 클라우드 미연결 시 로컬 저장까지만

    lastSyncedJson = json;
    setStamp('동기화 중...');

    // 8초 넘게 응답이 없으면 "멈춘 척" 하지 않고 상태를 알려줌
    // (실제 저장 요청은 백그라운드에서 계속 시도됨)
    let settled = false;
    const slowTimer = setTimeout(() => {
      if (!settled) setStamp('저장 지연 중... (네트워크 확인 필요)');
    }, 8000);

    cloudSetDoc(cloudDocRef, { json, updatedAt: Date.now() })
      .then(() => {
        settled = true;
        clearTimeout(slowTimer);
        setStamp('동기화됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }), 2000);
      })
      .catch((err) => {
        settled = true;
        clearTimeout(slowTimer);
        console.error('클라우드 저장 실패, 이 기기에만 저장됨', err);
        setStamp('오프라인 저장(이 기기만)', 3000);
      });
  }

  /* ============ 클라우드 동기화 (실패해도 앱 동작에는 영향 없음) ============ */
  async function initCloudSync() {
    try {
      const [{ initializeApp }, firestoreMod] = await Promise.all([
        import('https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js'),
        import('https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js'),
      ]);
      const { initializeFirestore, doc, setDoc, onSnapshot } = firestoreMod;

      const app = initializeApp(firebaseConfig);
      // 일부 와이파이/통신사 네트워크에서 기본 연결(WebSocket)이 막히는 경우가 있어
      // 자동으로 우회 방식(long polling)을 쓰도록 설정
      const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });
      cloudDocRef = doc(db, 'ledger', 'main');
      cloudSetDoc = setDoc;

      onSnapshot(cloudDocRef, (snap) => {
        cloudConnected = true;
        if (!snap.exists()) {
          // 클라우드에 데이터가 아직 없으면 현재(로컬) 상태를 최초 업로드
          firstSnapshot = false;
          saveState();
          return;
        }
        const data = snap.data();
        if (data.json === lastSyncedJson) {
          firstSnapshot = false;
          setStamp('☁ 실시간 동기화 중');
          return;
        }
        try {
          const parsed = JSON.parse(data.json);
          state = {
            categories: parsed.categories || [],
            transactions: parsed.transactions || [],
            assets: parsed.assets || [],
            assetSnapshots: parsed.assetSnapshots || {},
          };
          lastSyncedJson = data.json;
          localStorage.setItem(STORAGE_KEY, data.json);
          populateCategorySelect();
          renderDashboard();
          renderRecords();
          renderCategories();
          renderAssets();
          setStamp(firstSnapshot ? '☁ 실시간 동기화 중' : '다른 기기에서 업데이트됨', firstSnapshot ? 0 : 2500);
        } catch (e) {
          console.error('클라우드 데이터 파싱 실패', e);
        }
        firstSnapshot = false;
      }, (err) => {
        console.error('클라우드 연결 실패', err);
        setStamp('연결 오류(이 기기만 저장됨)');
      });
    } catch (e) {
      console.error('클라우드 동기화를 불러오지 못했습니다. 이 기기에만 저장됩니다.', e);
      setStamp('오프라인 모드(이 기기만)');
    }
  }

  /* ============ 유틸 ============ */
  function fmt(n) {
    const num = Number(n) || 0;
    return num.toLocaleString('ko-KR');
  }

  function currentMonthStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function prevMonthStr(monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function shiftMonthStr(monthStr, offset) {
    const [y, m] = monthStr.split('-').map(Number);
    const d = new Date(y, m - 1 + offset, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function monthLabel(monthStr) {
    const [, m] = monthStr.split('-').map(Number);
    return monthStr === currentMonthStr() ? '이번달' : `${m}월`;
  }

  function categoryById(id) {
    return state.categories.find(c => c.id === id);
  }

  function assetById(id) {
    return state.assets.find(a => a.id === id);
  }

  /* ============ 탭 전환 ============ */
  const navTabs = document.querySelectorAll('.nav-tab');
  const views = document.querySelectorAll('.view');

  navTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      navTabs.forEach(b => b.classList.remove('active'));
      views.forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
      if (btn.dataset.view === 'dashboard') renderDashboard();
      if (btn.dataset.view === 'records') renderRecords();
      if (btn.dataset.view === 'categories') renderCategories();
      if (btn.dataset.view === 'assets') renderAssets();
    });
  });

  /* ============ 월 선택기 초기화 ============ */
  const dashMonth = document.getElementById('dashMonth');
  const recMonth = document.getElementById('recMonth');
  const assetMonth = document.getElementById('assetMonth');
  const nowMonth = currentMonthStr();
  dashMonth.value = nowMonth;
  recMonth.value = nowMonth;
  assetMonth.value = nowMonth;

  dashMonth.addEventListener('change', renderDashboard);
  recMonth.addEventListener('change', renderRecords);
  assetMonth.addEventListener('change', renderAssets);

  /* ================================================================
     대시보드
  ================================================================ */
  function renderDashboard() {
    const month = dashMonth.value;
    const monthTx = state.transactions.filter(t => t.date.startsWith(month));

    const totalIncome = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const totalExpense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);

    document.getElementById('statIncome').textContent = fmt(totalIncome);
    document.getElementById('statExpense').textContent = fmt(totalExpense);
    const netEl = document.getElementById('statNet');
    netEl.textContent = fmt(totalIncome - totalExpense);

    // 카테고리별 지출
    const expenseTx = monthTx.filter(t => t.type === 'expense');
    const byCat = {};
    expenseTx.forEach(t => { byCat[t.categoryId] = (byCat[t.categoryId] || 0) + t.amount; });
    const catEntries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    const catMax = catEntries.length ? catEntries[0][1] : 0;

    const catBox = document.getElementById('catBreakdown');
    catBox.innerHTML = '';
    if (!catEntries.length) {
      catBox.innerHTML = '<p class="empty-note">이번 달 지출 기록이 없습니다.</p>';
    } else {
      catEntries.forEach(([catId, amt]) => {
        const cat = categoryById(catId);
        const row = document.createElement('div');
        row.className = 'bar-row';
        row.innerHTML = `
          <span class="bar-label">${cat ? escapeHtml(cat.name) : '삭제된 카테고리'}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${catMax ? (amt / catMax * 100) : 0}%"></span></span>
          <span class="bar-amount">${fmt(amt)}원</span>`;
        catBox.appendChild(row);
      });
    }

    // 카드/현금
    const byMethod = { card: 0, cash: 0 };
    expenseTx.forEach(t => { if (t.method) byMethod[t.method] = (byMethod[t.method] || 0) + t.amount; });
    const methodMax = Math.max(byMethod.card, byMethod.cash, 1);
    const methodBox = document.getElementById('methodBreakdown');
    methodBox.innerHTML = '';
    if (!totalExpense) {
      methodBox.innerHTML = '<p class="empty-note">이번 달 지출 기록이 없습니다.</p>';
    } else {
      [['카드', byMethod.card], ['현금', byMethod.cash]].forEach(([label, amt]) => {
        const row = document.createElement('div');
        row.className = 'bar-row';
        row.innerHTML = `
          <span class="bar-label">${label}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(amt / methodMax * 100)}%"></span></span>
          <span class="bar-amount">${fmt(amt)}원</span>`;
        methodBox.appendChild(row);
      });
    }

    // 자산
    const totalNow = computeAssetTotal(month);
    const totalPrev = computeAssetTotal(prevMonthStr(month), true);
    document.getElementById('dashAssetTotal').textContent = fmt(totalNow);
    const deltaEl = document.getElementById('dashAssetDelta');
    setDelta(deltaEl, totalNow, totalPrev);
  }

  function setDelta(el, now, prevOrNull) {
    if (prevOrNull === null) {
      el.textContent = '이전 기록 없음';
      el.className = 'stat-value delta';
      return;
    }
    const diff = now - prevOrNull;
    el.textContent = fmt(Math.abs(diff));
    el.className = 'stat-value delta ' + (diff >= 0 ? 'pos' : 'neg');
  }

  // 해당 월(또는 그 이전 가장 최근 스냅샷)의 총자산 계산
  function computeAssetTotal(month, allowMissing) {
    const snap = state.assetSnapshots[month];
    if (!snap) {
      if (allowMissing) return findLatestSnapshotBefore(month);
      return 0;
    }
    let total = 0;
    state.assets.forEach(a => {
      const v = Number(snap[a.id]) || 0;
      total += a.isDebt ? -v : v;
    });
    return total;
  }

  function findLatestSnapshotBefore(month) {
    const months = Object.keys(state.assetSnapshots).filter(m => m <= month).sort();
    if (!months.length) return null;
    const m = months[months.length - 1];
    let total = 0;
    state.assets.forEach(a => {
      const v = Number(state.assetSnapshots[m][a.id]) || 0;
      total += a.isDebt ? -v : v;
    });
    return total;
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  /* ================================================================
     기록 (수입/지출)
  ================================================================ */
  const entryForm = document.getElementById('entryForm');
  const entryDate = document.getElementById('entryDate');
  const entryAmount = document.getElementById('entryAmount');
  const entryCategory = document.getElementById('entryCategory');
  const entryMethod = document.getElementById('entryMethod');
  const entryMemo = document.getElementById('entryMemo');
  const entryId = document.getElementById('entryId');
  const methodWrap = document.getElementById('methodWrap');
  const entrySubmitBtn = document.getElementById('entrySubmitBtn');
  const entryCancelBtn = document.getElementById('entryCancelBtn');
  const toggleBtns = document.querySelectorAll('.toggle-btn');

  let currentEntryType = 'expense';
  entryDate.value = new Date().toISOString().slice(0, 10);

  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toggleBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentEntryType = btn.dataset.type;
      methodWrap.style.display = currentEntryType === 'expense' ? '' : 'none';
      populateCategorySelect();
    });
  });

  function populateCategorySelect() {
    const opts = state.categories.filter(c => c.type === currentEntryType);
    entryCategory.innerHTML = opts.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
      || '<option value="">카테고리를 먼저 추가하세요</option>';
  }

  entryForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const amount = Number(entryAmount.value);
    if (!amount || amount <= 0) return;
    if (!entryCategory.value) { alert('카테고리를 먼저 추가해주세요.'); return; }

    if (entryId.value) {
      const tx = state.transactions.find(t => t.id === entryId.value);
      if (tx) {
        Object.assign(tx, {
          date: entryDate.value,
          type: currentEntryType,
          amount,
          categoryId: entryCategory.value,
          method: currentEntryType === 'expense' ? entryMethod.value : null,
          memo: entryMemo.value.trim(),
        });
      }
    } else {
      state.transactions.push({
        id: uid(),
        date: entryDate.value,
        type: currentEntryType,
        amount,
        categoryId: entryCategory.value,
        method: currentEntryType === 'expense' ? entryMethod.value : null,
        memo: entryMemo.value.trim(),
      });
    }

    saveState();
    resetEntryForm();
    renderRecords();
  });

  entryCancelBtn.addEventListener('click', resetEntryForm);

  function resetEntryForm() {
    entryForm.reset();
    entryId.value = '';
    entryDate.value = new Date().toISOString().slice(0, 10);
    entrySubmitBtn.textContent = '기록 추가';
    entryCancelBtn.hidden = true;
    toggleBtns.forEach(b => b.classList.remove('active'));
    document.querySelector('.toggle-btn[data-type="expense"]').classList.add('active');
    currentEntryType = 'expense';
    methodWrap.style.display = '';
    populateCategorySelect();
  }

  function editTransaction(id) {
    const tx = state.transactions.find(t => t.id === id);
    if (!tx) return;
    entryId.value = tx.id;
    currentEntryType = tx.type;
    toggleBtns.forEach(b => b.classList.toggle('active', b.dataset.type === tx.type));
    methodWrap.style.display = tx.type === 'expense' ? '' : 'none';
    populateCategorySelect();
    entryDate.value = tx.date;
    entryAmount.value = tx.amount;
    entryCategory.value = tx.categoryId;
    if (tx.method) entryMethod.value = tx.method;
    entryMemo.value = tx.memo || '';
    entrySubmitBtn.textContent = '기록 수정';
    entryCancelBtn.hidden = false;
    document.getElementById('view-records').scrollIntoView({ behavior: 'smooth' });
  }

  function deleteTransaction(id) {
    if (!confirm('이 기록을 삭제할까요?')) return;
    state.transactions = state.transactions.filter(t => t.id !== id);
    saveState();
    renderRecords();
  }

  let groupByCategory = false;
  const groupToggleBtn = document.getElementById('groupToggleBtn');
  groupToggleBtn.addEventListener('click', () => {
    groupByCategory = !groupByCategory;
    groupToggleBtn.classList.toggle('active', groupByCategory);
    groupToggleBtn.textContent = groupByCategory ? '날짜순으로 보기' : '카테고리별로 보기';
    renderRecords();
  });

  function renderRecords() {
    const month = recMonth.value;
    const list = state.transactions.filter(t => t.date.startsWith(month));

    document.getElementById('recordCount').textContent = list.length + '건';

    const body = document.getElementById('recordBody');
    body.innerHTML = '';

    if (!list.length) {
      body.innerHTML = '<tr><td colspan="7" class="empty-note">이 달의 기록이 없습니다.</td></tr>';
      return;
    }

    if (groupByCategory) {
      renderGroupedRows(list, body);
    } else {
      list.sort((a, b) => b.date.localeCompare(a.date)).forEach(tx => body.appendChild(buildRecordRow(tx)));
    }

    body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => editTransaction(b.dataset.edit)));
    body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => deleteTransaction(b.dataset.del)));
  }

  function renderGroupedRows(list, body) {
    const groups = {};
    list.forEach(t => {
      if (!groups[t.categoryId]) groups[t.categoryId] = { type: t.type, total: 0, items: [] };
      groups[t.categoryId].total += t.amount;
      groups[t.categoryId].items.push(t);
    });

    const expenseGroups = Object.entries(groups).filter(([, g]) => g.type === 'expense').sort((a, b) => b[1].total - a[1].total);
    const incomeGroups = Object.entries(groups).filter(([, g]) => g.type === 'income').sort((a, b) => b[1].total - a[1].total);

    [...expenseGroups, ...incomeGroups].forEach(([catId, g]) => {
      const cat = categoryById(catId);
      const groupRow = document.createElement('tr');
      groupRow.className = 'group-row';
      groupRow.innerHTML = `
        <td colspan="7">
          <div class="group-head">
            <span class="type-pill ${g.type}">${g.type === 'income' ? '수입' : '지출'}</span>
            <span class="group-name">${cat ? escapeHtml(cat.name) : '삭제된 카테고리'}</span>
            <span class="group-count">${g.items.length}건</span>
            <span class="group-total ${g.type}">${g.type === 'income' ? '+' : '-'}${fmt(g.total)}원</span>
          </div>
        </td>`;
      body.appendChild(groupRow);

      g.items.sort((a, b) => b.date.localeCompare(a.date)).forEach(tx => body.appendChild(buildRecordRow(tx)));
    });
  }

  function buildRecordRow(tx) {
    const cat = categoryById(tx.categoryId);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${tx.date}</td>
      <td><span class="type-pill ${tx.type}">${tx.type === 'income' ? '수입' : '지출'}</span></td>
      <td>${cat ? escapeHtml(cat.name) : '삭제된 카테고리'}</td>
      <td>${escapeHtml(tx.memo || '-')}</td>
      <td>${tx.method ? (tx.method === 'card' ? '카드' : '현금') : '-'}</td>
      <td class="num amount-cell ${tx.type}">${tx.type === 'income' ? '+' : '-'}${fmt(tx.amount)}</td>
      <td>
        <div class="row-actions">
          <button class="icon-btn" data-edit="${tx.id}">수정</button>
          <button class="icon-btn danger" data-del="${tx.id}">삭제</button>
        </div>
      </td>`;
    return tr;
  }

  /* ================================================================
     카테고리 관리
  ================================================================ */
  document.querySelectorAll('.inline-add[data-cat-type]').forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = form.querySelector('input[type="text"]');
      const name = input.value.trim();
      if (!name) return;
      state.categories.push({ id: uid(), name, type: form.dataset.catType });
      input.value = '';
      saveState();
      renderCategories();
      populateCategorySelect();
    });
  });

  function renderCategories() {
    renderCatList('expense', document.getElementById('expenseCatList'));
    renderCatList('income', document.getElementById('incomeCatList'));
  }

  function renderCatList(type, ul) {
    const list = state.categories.filter(c => c.type === type);
    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = '<li class="empty-note" style="border:none;">카테고리가 없습니다.</li>';
      return;
    }
    list.forEach(cat => {
      const li = document.createElement('li');
      li.innerHTML = `
        <input type="text" value="${escapeHtml(cat.name)}" data-id="${cat.id}">
        <button class="icon-btn danger" data-del-cat="${cat.id}">삭제</button>`;
      ul.appendChild(li);
    });

    ul.querySelectorAll('input[data-id]').forEach(inp => {
      inp.addEventListener('change', () => {
        const cat = categoryById(inp.dataset.id);
        if (cat && inp.value.trim()) {
          cat.name = inp.value.trim();
          saveState();
          renderDashboard();
          populateCategorySelect();
        }
      });
    });

    ul.querySelectorAll('[data-del-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        const inUse = state.transactions.some(t => t.categoryId === btn.dataset.delCat);
        if (inUse && !confirm('이 카테고리를 사용하는 기록이 있습니다. 삭제해도 기록은 남지만 카테고리명이 표시되지 않습니다. 삭제할까요?')) return;
        state.categories = state.categories.filter(c => c.id !== btn.dataset.delCat);
        saveState();
        renderCategories();
        populateCategorySelect();
      });
    });
  }

  /* ================================================================
     자산 관리
  ================================================================ */
  document.getElementById('assetAddForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('newAssetName');
    const isDebtInput = document.getElementById('newAssetIsDebt');
    const name = nameInput.value.trim();
    if (!name) return;
    state.assets.push({ id: uid(), name, isDebt: isDebtInput.checked });
    nameInput.value = '';
    isDebtInput.checked = false;
    saveState();
    renderAssets();
  });

  function renderAssets() {
    const month = assetMonth.value;
    const snap = state.assetSnapshots[month] || {};
    const body = document.getElementById('assetBody');
    body.innerHTML = '';

    if (!state.assets.length) {
      body.innerHTML = '<tr><td colspan="4" class="empty-note">등록된 자산 항목이 없습니다.</td></tr>';
    } else {
      state.assets.forEach(asset => {
        const tr = document.createElement('tr');
        const val = snap[asset.id] !== undefined ? snap[asset.id] : '';
        tr.innerHTML = `
          <td>${escapeHtml(asset.name)}</td>
          <td><span class="type-pill ${asset.isDebt ? 'expense' : 'income'}">${asset.isDebt ? '부채' : '자산'}</span></td>
          <td class="num"><input class="asset-input" type="number" step="1" data-asset="${asset.id}" value="${val}" placeholder="0"></td>
          <td><div class="row-actions"><button class="icon-btn danger" data-del-asset="${asset.id}">삭제</button></div></td>`;
        body.appendChild(tr);
      });
    }

    body.querySelectorAll('[data-asset]').forEach(inp => {
      inp.addEventListener('change', () => {
        if (!state.assetSnapshots[month]) state.assetSnapshots[month] = {};
        state.assetSnapshots[month][inp.dataset.asset] = Number(inp.value) || 0;
        saveState();
        renderAssets();
      });
    });

    body.querySelectorAll('[data-del-asset]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('이 자산 항목과 모든 월별 잔액 기록을 삭제할까요?')) return;
        state.assets = state.assets.filter(a => a.id !== btn.dataset.delAsset);
        Object.values(state.assetSnapshots).forEach(s => { delete s[btn.dataset.delAsset]; });
        saveState();
        renderAssets();
      });
    });

    const totalNow = computeAssetTotal(month);
    const totalPrev = computeAssetTotal(prevMonthStr(month), true);
    document.getElementById('assetTotalNow').textContent = fmt(totalNow);
    setDelta(document.getElementById('assetTotalDelta'), totalNow, totalPrev);

    renderAssetTrend(month);
  }

  // 선택한 달을 기준으로 최근 12개월간의 월별 자산 변동(전월 대비 증감)을 막대그래프로 표시
  function renderAssetTrend(endMonth) {
    const headline = document.getElementById('trendHeadline');
    const box = document.getElementById('assetTrendChart');
    if (!headline || !box) return;

    if (!state.assets.length) {
      headline.textContent = '자산 항목을 등록하면 월별 변동 추이가 표시돼요.';
      box.innerHTML = '';
      return;
    }

    const months = [];
    for (let i = 11; i >= 0; i--) months.push(shiftMonthStr(endMonth, -i));

    const deltas = months.map(m => {
      const cur = computeAssetTotal(m, true);
      const prev = computeAssetTotal(prevMonthStr(m), true);
      if (cur === null || prev === null) return null;
      return cur - prev;
    });

    const maxAbs = Math.max(1, ...deltas.filter(v => v !== null).map(v => Math.abs(v)));
    const lastDelta = deltas[deltas.length - 1];

    if (lastDelta === null) {
      headline.textContent = '아직 비교할 이전 달 데이터가 없어요.';
    } else {
      headline.textContent = `총자산이 지난달보다 ${fmt(Math.abs(lastDelta))}원 ${lastDelta >= 0 ? '늘었어요' : '줄었어요'}`;
    }

    box.innerHTML = '';
    months.forEach((m, i) => {
      const delta = deltas[i];
      const isCurrent = i === months.length - 1;
      const pct = delta === null ? 4 : Math.max(4, Math.abs(delta) / maxAbs * 100);
      const item = document.createElement('div');
      item.className = 'trend-bar-item' + (isCurrent ? ' current' : '');
      item.innerHTML = `
        <span class="trend-value ${delta === null ? '' : (delta >= 0 ? 'pos' : 'neg')}">${delta === null ? '-' : (delta >= 0 ? '+' : '-') + fmt(Math.abs(delta))}</span>
        <div class="trend-bar-track"><div class="trend-bar-fill" style="height:${pct}%"></div></div>
        <span class="trend-month-label">${monthLabel(m)}</span>`;
      box.appendChild(item);
    });
  }

  /* ============ 초기 렌더 (네트워크 여부와 무관하게 항상 실행) ============ */
  populateCategorySelect();
  renderDashboard();
  renderRecords();
  renderCategories();
  renderAssets();

  /* ============ 클라우드 동기화는 비동기로 별도 시도 ============ */
  initCloudSync();
})();
