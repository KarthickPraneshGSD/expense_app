// ═══════════════════════════════════════════════════════════════════════════
//  SpendWise — Firebase Backend (Subcollection Architecture)
//
//  Firestore Structure:
//    users/{uid}                          → profile doc { username, createdAt }
//    users/{uid}/expenses/{expenseId}     → { desc, amt, date, createdAt }
//    users/{uid}/budgets/{YYYY-MM-DD}     → { amount }
//
//  This design supports unlimited expenses across months/years with fast
//  date-range queries and no document size limits.
//
//  ⚠️  Replace firebaseConfig below with YOUR project's config from:
//      Firebase Console → Project Settings → Your apps → SDK setup
// ═══════════════════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyDWK1OWN57XvaDT96cJvPhKOXz3hCz9USA",
  authDomain: "spendwise-8b6fb.firebaseapp.com",
  projectId: "spendwise-8b6fb",
  storageBucket: "spendwise-8b6fb.firebasestorage.app",
  messagingSenderId: "571217380551",
  appId: "1:571217380551:web:c1f766f860a296706a2ae2"
};

// ─── Admin credentials ────────────────────────────────────────────────────────
const ADMIN_USER = 'adminsystem';
const ADMIN_PASS = btoa('kratos');
// ← Set the admin's real contact email here ↓
const ADMIN_EMAIL = 'karthickpraneshgsd@gmail.com';

// ─── Init Firebase ──────────────────────────────────────────────────────────
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// NOTE: enablePersistence() / enableIndexedDbPersistence() are both deprecated
// in Firebase 10.x. The new FirestoreSettings.cache API requires the modular
// SDK with a bundler, which this plain-CDN app does not use.
// Data persistence across page refreshes is handled by Firebase cloud (Firestore),
// so no local IndexedDB setup is needed here.

// ─── State ──────────────────────────────────────────────────────────────────
let _currentUID = null;
let _currentUsername = null;
let _expenses = [];          // local cache: array of { id, desc, amt, date, createdAt }
let _budgets = {};          // local cache: { 'YYYY-MM-DD': amount }
let _unsubExpenses = null;        // Firestore real-time listener cleanup
let _unsubBudgets = null;
let _income = [];           // local cache: array of { id, desc, amt, date }
let _unsubIncome = null;
let _incomeTotal = 0;       // sum of all active income sources
let _incomeEarliestDate = null; // earliest income date — expenses from here count

// ─── Shortcuts ──────────────────────────────────────────────────────────────
const userRef = (uid) => db.collection('users').doc(uid);
const expsRef = (uid) => userRef(uid).collection('expenses');
const budgRef = (uid) => userRef(uid).collection('budgets');
const incRef = (uid) => userRef(uid).collection('income');

// ═══════════════════════════════════════════════════════════════════════════
//  ROLE TOGGLE
// ═══════════════════════════════════════════════════════════════════════════
let selectedRole = 'user';

function setRole(role) {
  selectedRole = role;
  const userBtn = document.getElementById('role-user');
  const adminBtn = document.getElementById('role-admin');
  const regLink = document.getElementById('register-link');
  const authTitle = document.getElementById('auth-title');
  const authSub = document.getElementById('auth-subtitle');

  if (role === 'admin') {
    userBtn.classList.remove('active');
    adminBtn.classList.add('active', 'admin-active');
    if (regLink) regLink.style.display = 'none';
    if (authTitle) authTitle.textContent = 'Admin Login';
    if (authSub) authSub.textContent = 'Restricted access — admins only';
    show(document.getElementById('login-form'));
    hide(document.getElementById('register-form'));
  } else {
    adminBtn.classList.remove('active', 'admin-active');
    userBtn.classList.add('active');
    if (regLink) regLink.style.display = '';
    if (authTitle) authTitle.textContent = 'Welcome back';
    if (authSub) authSub.textContent = 'Sign in to your account';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function show(el) { if (el) el.classList.remove('hidden'); }
function hide(el) { if (el) el.classList.add('hidden'); }

function notify(msg, type) {
  const n = document.createElement('div');
  n.className = 'notification';
  n.textContent = msg;
  if (type === 'success') n.style.background = '#10b981';
  else if (type === 'error') n.style.background = '#ef4444';
  else n.style.background = '#6366f1';
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 3500);
}

function setLoading(btnId, loading, label) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? '⏳ Please wait…' : label;
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

// ═══════════════════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════════════════

async function registerUser() {
  const username = document.getElementById('reg-username').value.trim();
  const realEmail = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  if (!username) return notify('Enter a username', 'error');
  if (!realEmail) return notify('Enter your real email address', 'error');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(realEmail)) return notify('Enter a valid email address', 'error');
  if (!password) return notify('Enter a password', 'error');
  if (password.length < 6) return notify('Password must be at least 6 characters', 'error');
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return notify('Username: only letters, numbers, underscores', 'error');

  setLoading('register-btn', true, 'Create Account →');
  try {
    const fbEmail = username.toLowerCase() + '@spendwise.internal';

    // Check if username exists in Firestore
    const snap = await db.collection('usernames').doc(username).get();
    let oldUid = null;

    if (snap.exists) {
      // Username exists — check for pendingReset flag or probe auth
      const data = snap.data();
      oldUid = data.uid;

      if (data.pendingReset === true) {
        // ✅ Reset authorized by admin
        notify('⏳ Restoring your account and migrating data...', 'info');
      } else {
        // Fallback to probe (optional, but keep it for robustness)
        try {
          await auth.signInWithEmailAndPassword(fbEmail, '___probe___');
          notify('Username already taken — please choose a different one', 'error');
          return;
        } catch (probeErr) {
          if (probeErr.code === 'auth/user-not-found') {
            notify('⏳ Restoring your account and migrating data...', 'info');
          } else if (probeErr.code === 'auth/wrong-password' ||
            probeErr.code === 'auth/invalid-credential' ||
            probeErr.code === 'auth/invalid-login-credentials') {
            notify('Username already taken — please choose a different one', 'error');
            return;
          } else {
            notify('Username already taken — please choose a different one', 'error');
            return;
          }
        }
      }
    }

    // Create new Firebase Auth account
    const cred = await auth.createUserWithEmailAndPassword(fbEmail, password);
    const newUid = cred.user.uid;

    if (oldUid && oldUid !== newUid) {
      // ── DATA MIGRATION: move all expenses & budgets from oldUid → newUid ──
      await migrateUserData(oldUid, newUid, username, realEmail);
      // Clear flag after successful migration
      await db.collection('usernames').doc(username).update({ pendingReset: firebase.firestore.FieldValue.delete() });
      notify('✅ Account restored! All your data has been migrated successfully.', 'success');
    } else {
      // ── Fresh registration ──
      const batch = db.batch();
      batch.set(db.collection('usernames').doc(username), { uid: newUid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      batch.set(userRef(newUid), { username, realEmail, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
      await batch.commit();
      notify('Account created! Please log in.', 'success');
    }

    document.getElementById('reg-username').value = '';
    document.getElementById('reg-email').value = '';
    document.getElementById('reg-password').value = '';
    hide(document.getElementById('register-form'));
    show(document.getElementById('login-form'));

  } catch (err) {
    const code = err.code || '';
    if (code === 'auth/email-already-in-use') {
      notify('Username already taken — please choose a different one', 'error');
    } else if (code === 'auth/weak-password') {
      notify('Password is too weak — use at least 6 characters', 'error');
    } else {
      notify('Error: ' + err.message, 'error');
    }
  } finally {
    setLoading('register-btn', false, 'Create Account →');
  }
}

// ── Migrate all Firestore data from oldUid → newUid (called after admin resets auth account) ──
async function migrateUserData(oldUid, newUid, username, realEmail) {
  const [expsSnap, budgSnap] = await Promise.all([
    expsRef(oldUid).get(),
    budgRef(oldUid).get()
  ]);

  // Write new profile + update username mapping + copy all expenses + budgets
  const BATCH_LIMIT = 490;
  let batch = db.batch();
  let count = 0;

  const flush = async () => { await batch.commit(); batch = db.batch(); count = 0; };

  // Profile + username mapping
  batch.set(userRef(newUid), { username, realEmail, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  batch.set(db.collection('usernames').doc(username), { uid: newUid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  count += 2;

  // Copy expenses
  for (const doc of expsSnap.docs) {
    if (count >= BATCH_LIMIT) await flush();
    batch.set(expsRef(newUid).doc(doc.id), doc.data());
    count++;
  }

  // Copy budgets
  for (const doc of budgSnap.docs) {
    if (count >= BATCH_LIMIT) await flush();
    batch.set(budgRef(newUid).doc(doc.id), doc.data());
    count++;
  }

  await flush();

  // Clean up old documents in background (non-blocking)
  try {
    const cleanBatch = db.batch();
    expsSnap.docs.forEach(d => cleanBatch.delete(d.ref));
    budgSnap.docs.forEach(d => cleanBatch.delete(d.ref));
    cleanBatch.delete(userRef(oldUid));
    await cleanBatch.commit();
  } catch (e) {
    console.warn('Old data cleanup skipped (non-critical):', e.message);
  }
}



async function loginUser() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;

  if (!username) return notify('Enter your username', 'error');
  if (!password) return notify('Enter your password', 'error');

  // ── Admin login ──
  if (selectedRole === 'admin') {
    if (username !== ADMIN_USER || btoa(password) !== ADMIN_PASS) {
      return notify('Invalid admin credentials', 'error');
    }
    localStorage.setItem('sw_admin', '1');
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    openAdminDashboard();
    notify('Welcome, Administrator!', 'success');
    return;
  }

  // ── Regular user login ──
  setLoading('login-btn', true, 'Sign In');
  try {
    const snap = await db.collection('usernames').doc(username).get();
    if (!snap.exists) {
      notify('User not found. Please register first.', 'error');
      return;
    }
    const email = username.toLowerCase() + '@spendwise.internal';
    await auth.signInWithEmailAndPassword(email, password);
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    // onAuthStateChanged handles the rest
  } catch (err) {
    const code = err.code || '';
    if (code.includes('wrong-password') || code.includes('invalid-credential')) {
      notify('Wrong password', 'error');
    } else {
      notify('Error: ' + err.message, 'error');
    }
    setLoading('login-btn', false, 'Sign In');
  }
}

function logoutUser() {
  // Admin logout
  if (localStorage.getItem('sw_admin')) {
    localStorage.removeItem('sw_admin');
    hide(document.getElementById('admin-dashboard'));
    show(document.getElementById('auth-card'));
    setRole('user');
    show(document.getElementById('login-form'));
    hide(document.getElementById('register-form'));
    resetCalculator();
    notify('Logged out', 'info');
    return;
  }
  // Firebase user logout — stop listeners first
  stopUserListeners();
  auth.signOut().then(() => {
    _currentUID = null; _currentUsername = null;
    _expenses = []; _budgets = {};
    hide(document.getElementById('dashboard'));
    show(document.getElementById('auth-card'));
    setRole('user');
    show(document.getElementById('login-form'));
    hide(document.getElementById('register-form'));
    resetCalculator();
    notify('Logged out', 'info');
  });
}

// ─── Firebase Auth Observer ──────────────────────────────────────────────────
auth.onAuthStateChanged(async (user) => {
  if (localStorage.getItem('sw_admin')) return; // admin session active

  if (user) {
    _currentUID = user.uid;
    try {
      const doc = await userRef(user.uid).get();
      if (doc.exists) {
        _currentUsername = doc.data().username;
        openDashboard();
        startUserListeners(user.uid);
      } else if (!doc.exists) {
        // Profile doc missing — could be newly registered, wait briefly and retry
        console.warn('User profile not found for uid:', user.uid, '— retrying in 2s');
        setTimeout(async () => {
          try {
            const retryDoc = await userRef(user.uid).get();
            if (retryDoc.exists) {
              _currentUsername = retryDoc.data().username;
              openDashboard();
              startUserListeners(user.uid);
            } else {
              auth.signOut();
            }
          } catch (retryErr) {
            // Still offline after retry — open with cached data
            openDashboard();
            startUserListeners(user.uid);
          }
        }, 2000);
      }
    } catch (err) {
      // Network error or offline: try to open dashboard with cached data
      console.warn('Auth state change error (possibly offline):', err.message);
      openDashboard();
      startUserListeners(user.uid);
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  REAL-TIME LISTENERS  (subcollections)
// ═══════════════════════════════════════════════════════════════════════════

function startUserListeners(uid) {
  stopUserListeners();

  // ── Expenses listener: ordered by date desc, then createdAt desc ──
  // NOTE: This requires a composite index in Firestore.
  // If index is missing, we fall back to a simple unordered query.
  function attachExpensesListener(ordered) {
    const query = ordered
      ? expsRef(uid).orderBy('date', 'desc').orderBy('createdAt', 'desc')
      : expsRef(uid);

    return query.onSnapshot(snap => {
      _expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Sort client-side if using fallback
      if (!ordered) {
        _expenses.sort((a, b) => {
          if (b.date < a.date) return -1;
          if (b.date > a.date) return 1;
          return 0;
        });
      }
      renderExpenses();
      updateSummary();
    }, err => {
      console.error('Expenses listener error:', err);
      if (ordered && (err.code === 'failed-precondition' || err.message.includes('index'))) {
        // Composite index missing — fall back to unordered query
        console.warn('⚠️ Firestore composite index missing. Falling back to unordered query.');
        console.warn('To fix: open browser console, find the Firebase index link, and click it to create the index.');
        notify('Creating search index… data will appear in a moment', 'info');
        if (_unsubExpenses) { _unsubExpenses(); }
        _unsubExpenses = attachExpensesListener(false);
      } else {
        notify('Error loading expenses: ' + err.message, 'error');
      }
    });
  }

  _unsubExpenses = attachExpensesListener(true);

  // ── Budgets listener ──
  _unsubBudgets = budgRef(uid)
    .onSnapshot(snap => {
      _budgets = {};
      snap.docs.forEach(d => { _budgets[d.id] = d.data().amount; });
      updateSummary();
      onBudgetDateChange();
    }, err => {
      console.error('Budgets listener error:', err);
      notify('Error loading budgets: ' + err.message, 'error');
    });

  // ── Income listener (subcollection — multiple sources) ──
  _unsubIncome = incRef(uid)
    .orderBy('date', 'desc')
    .onSnapshot(snap => {
      _income = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      _incomeTotal = _income.reduce((s, i) => s + (i.amt || 0), 0);
      const dates = _income.map(i => i.date).filter(Boolean).sort();
      _incomeEarliestDate = dates.length > 0 ? dates[0] : null;
      updateSummary();
      renderIncomeList();
    }, () => {
      // Index missing — fall back to unordered
      _unsubIncome = incRef(uid).onSnapshot(snap => {
        _income = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        _incomeTotal = _income.reduce((s, i) => s + (i.amt || 0), 0);
        const dates = _income.map(i => i.date).filter(Boolean).sort();
        _incomeEarliestDate = dates.length > 0 ? dates[0] : null;
        updateSummary();
        renderIncomeList();
      });
    });
}

function stopUserListeners() {
  if (_unsubExpenses) { _unsubExpenses(); _unsubExpenses = null; }
  if (_unsubBudgets) { _unsubBudgets(); _unsubBudgets = null; }
  if (_unsubIncome) { _unsubIncome(); _unsubIncome = null; }
}

// ═══════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

function openDashboard() {
  hide(document.getElementById('auth-card'));
  show(document.getElementById('dashboard'));

  const u = _currentUsername || 'User';
  const greetEl = document.getElementById('greet');
  if (greetEl) greetEl.textContent = 'Hi, ' + u + ' 👋';
  const mobileGreetEl = document.getElementById('mobile-greet');
  if (mobileGreetEl) mobileGreetEl.textContent = 'Hi, ' + u;

  const todayLabel = document.getElementById('today-label');
  if (todayLabel) {
    todayLabel.textContent = new Date().toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  setLoading('login-btn', false, 'Sign In');
}

// ═══════════════════════════════════════════════════════════════════════════
//  BUDGET  (each day = one Firestore doc: users/{uid}/budgets/YYYY-MM-DD)
// ═══════════════════════════════════════════════════════════════════════════

async function setBudget() {
  const v = parseFloat(document.getElementById('budget-input').value);
  if (isNaN(v) || v <= 0) return notify('Enter a valid amount', 'error');

  const dateInput = document.getElementById('budget-date');
  const date = (dateInput && dateInput.value) ? dateInput.value : todayStr();

  const existing = _budgets[date] || 0;
  const newTotal = existing + v;

  try {
    await budgRef(_currentUID).doc(date).set({ amount: newTotal });
    // listener will update _budgets automatically
    const hint = document.getElementById('budget-existing-hint');
    if (hint) {
      hint.textContent = existing > 0
        ? `✅ Added ₹${v.toFixed(2)} → Total budget for ${date}: ₹${newTotal.toFixed(2)}`
        : `✅ Budget of ₹${newTotal.toFixed(2)} set for ${date}`;
    }
    document.getElementById('budget-input').value = '';
    notify('Budget updated: ₹' + newTotal.toFixed(2), 'success');
  } catch (err) {
    notify('Error saving budget: ' + err.message, 'error');
  }
}

function onBudgetDateChange() {
  const dateInput = document.getElementById('budget-date');
  const date = dateInput ? dateInput.value : '';
  if (!date) return;
  const existing = _budgets[date] || 0;
  const hint = document.getElementById('budget-existing-hint');
  const budgetInput = document.getElementById('budget-input');
  if (existing > 0) {
    if (hint) hint.textContent = `✏️ Existing budget for ${date}: ₹${existing.toFixed(2)} (edit above to change)`;
    if (budgetInput) budgetInput.value = existing;
  } else {
    if (hint) hint.textContent = `No budget set for ${date} yet.`;
    if (budgetInput) budgetInput.value = '';
  }
  updateSummary();
}

async function resetBudget() {
  const dateInput = document.getElementById('budget-date');
  const date = (dateInput && dateInput.value) ? dateInput.value : todayStr();
  if (!confirm(`Clear budget for ${date}?`)) return;
  try {
    await budgRef(_currentUID).doc(date).delete();
    const hint = document.getElementById('budget-existing-hint');
    if (hint) hint.textContent = `Budget cleared for ${date}`;
    const budgetInput = document.getElementById('budget-input');
    if (budgetInput) budgetInput.value = '';
    notify('Budget cleared for ' + date, 'success');
  } catch (err) {
    notify('Error: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  EXPENSES  (each expense = one Firestore doc: users/{uid}/expenses/{id})
// ═══════════════════════════════════════════════════════════════════════════

// Tracks current entry mode: 'debit' | 'credit'
let _entryType = 'debit';

async function addExpense() {
  const expDateInput = document.getElementById('exp-date');
  const date = (expDateInput && expDateInput.value) ? expDateInput.value : todayStr();
  const desc = document.getElementById('exp-desc').value.trim();
  const amt = parseFloat(document.getElementById('exp-amt').value);

  if (!desc) return notify('Enter a description', 'error');
  if (isNaN(amt) || amt <= 0) return notify('Enter a valid amount', 'error');

  try {
    await expsRef(_currentUID).add({
      desc,
      amt,
      date,
      type: _entryType,   // 'debit' | 'credit'
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('exp-desc').value = '';
    document.getElementById('exp-amt').value = '';
    const label = _entryType === 'credit' ? 'Credit' : 'Expense';
    notify(`${label} added for ${date}`, 'success');
  } catch (err) {
    notify('Error: ' + err.message, 'error');
  }
}

function renderExpenses() {
  let items = _expenses || [];

  // Apply date filter
  const filterInput = document.getElementById('filter-date');
  const filterDate = filterInput ? filterInput.value : '';
  if (filterDate) items = items.filter(e => e.date === filterDate);

  const list = document.getElementById('expenses-list');
  if (!list) return;
  list.innerHTML = '';

  // Net total: debits - credits
  const netTotal = items.reduce((sum, e) => {
    return e.type === 'credit' ? sum - (e.amt || 0) : sum + (e.amt || 0);
  }, 0);
  const totalEl = document.getElementById('expenses-total-val');
  if (totalEl) totalEl.textContent = netTotal.toFixed(2);

  if (items.length === 0) {
    const li = document.createElement('li');
    li.textContent = filterDate ? `No entries for ${filterDate}` : 'No entries yet';
    li.style.cssText = 'text-align:center;color:#64748b;padding:20px;border:none;background:transparent;';
    list.appendChild(li);
    return;
  }

  items.forEach(it => {
    const isCredit = it.type === 'credit';
    const li = document.createElement('li');
    if (isCredit) li.classList.add('credit-row');
    li.innerHTML = `
      <div>
        <div><strong>${it.desc}</strong>${isCredit ? '<span class="credit-badge">Credit</span>' : ''}</div>
        <div class="expense-meta">${it.date} &bull;
          <span class="${isCredit ? 'credit-amount' : ''}">${isCredit ? '+' : ''}&#8377;${(it.amt || 0).toFixed(2)}</span>
        </div>
      </div>
      <div class="exp-actions">
        <button class="btn-edit" data-id="${it.id}">✏️</button>
        <button class="btn-del"  data-id="${it.id}">Delete</button>
      </div>`;
    list.appendChild(li);
    li.querySelector('.btn-edit').addEventListener('click', () => openEditExpenseModal(it));
    li.querySelector('.btn-del').addEventListener('click', () => deleteExpense(it.id));
  });
}

async function deleteExpense(id) {
  if (!confirm('Delete this expense?')) return;
  try {
    await expsRef(_currentUID).doc(id).delete();
    notify('Deleted', 'success');
    // listener auto-updates
  } catch (err) {
    notify('Error: ' + err.message, 'error');
  }
}

// ── Edit Expense Modal ──────────────────────────────────────────────────────
let _editExpId = null;
let _editExpType = 'debit';

function openEditExpenseModal(item) {
  _editExpId = item.id;
  _editExpType = item.type || 'debit';

  document.getElementById('edit-exp-date').value = item.date || '';
  document.getElementById('edit-exp-desc').value = item.desc || '';
  document.getElementById('edit-exp-amt').value = item.amt || '';
  setEditExpType(_editExpType);

  document.getElementById('edit-expense-modal').style.display = 'flex';
}

function setEditExpType(type) {
  _editExpType = type;
  const isCredit = type === 'credit';
  const dBtn = document.getElementById('edit-type-debit');
  const cBtn = document.getElementById('edit-type-credit');
  if (dBtn) { dBtn.classList.toggle('type-btn--active', !isCredit); dBtn.classList.toggle('exp-mode', !isCredit); }
  if (cBtn) { cBtn.classList.toggle('type-btn--active', isCredit); cBtn.classList.toggle('credit-mode', isCredit); }
}

function closeEditExpenseModal() {
  document.getElementById('edit-expense-modal').style.display = 'none';
  _editExpId = null;
}

async function saveEditExpense() {
  const date = document.getElementById('edit-exp-date').value;
  const desc = document.getElementById('edit-exp-desc').value.trim();
  const amt = parseFloat(document.getElementById('edit-exp-amt').value);
  if (!date) return notify('Pick a date', 'error');
  if (!desc) return notify('Enter a description', 'error');
  if (isNaN(amt) || amt <= 0) return notify('Enter a valid amount', 'error');
  try {
    await expsRef(_currentUID).doc(_editExpId).update({ date, desc, amt, type: _editExpType });
    notify('Entry updated ✅', 'success');
    closeEditExpenseModal();
  } catch (err) {
    notify('Error: ' + err.message, 'error');
  }
}

function updateSummary() {
  const budgetDateInput = document.getElementById('budget-date');
  const selectedDate = (budgetDateInput && budgetDateInput.value) ? budgetDateInput.value : todayStr();

  // Daily Stats (Date-specific)
  const bud = _budgets[selectedDate] || 0;

  // Global Stats — credits reduce totalSpent, only count from earliest income date
  const totalIncome = _incomeTotal || 0;
  const totalSpent = (_expenses || [])
    .filter(e => !_incomeEarliestDate || e.date >= _incomeEarliestDate)
    .reduce((s, e) => e.type === 'credit' ? s - (e.amt || 0) : s + (e.amt || 0), 0);
  const balance = totalIncome - Math.max(0, totalSpent);

  const budEl = document.getElementById('budget-val');
  const incEl = document.getElementById('income-val');
  const spentEl = document.getElementById('spent-val');
  const remEl = document.getElementById('remaining-val');

  if (budEl) budEl.textContent = bud.toFixed(2);
  if (incEl) incEl.textContent = totalIncome.toFixed(2);
  if (spentEl) spentEl.textContent = totalSpent.toFixed(2);
  if (remEl) {
    remEl.textContent = balance.toFixed(2);
    remEl.parentElement.style.color = balance < 0 ? '#ef4444' : '#1e293b';
  }
}

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
//  SPLIT BILL
// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

function updateSplitPreview() {
  const total = parseFloat(document.getElementById('split-total')?.value);
  const people = parseInt(document.getElementById('split-people')?.value);
  const preview = document.getElementById('split-preview');
  if (!preview) return;
  if (isNaN(total) || isNaN(people) || people < 2 || total <= 0) {
    preview.textContent = '';
    return;
  }
  const share = total / people;
  preview.textContent = `\u2714\ufe0f Your share: \u20b9${share.toFixed(2)}  (Total \u20b9${total.toFixed(2)} \u00f7 ${people} people)`;
}

async function splitBill() {
  const date = document.getElementById('split-date')?.value || todayStr();
  const desc = document.getElementById('split-desc')?.value.trim();
  const total = parseFloat(document.getElementById('split-total')?.value);
  const people = parseInt(document.getElementById('split-people')?.value);

  if (!desc) return notify('Enter a description (e.g. Tea break)', 'error');
  if (isNaN(total) || total <= 0) return notify('Enter the total bill amount', 'error');
  if (isNaN(people) || people < 2) return notify('Enter at least 2 people', 'error');

  const share = parseFloat((total / people).toFixed(2));

  try {
    await expsRef(_currentUID).add({
      desc: `${desc} (split \u00f7${people})`,
      amt: share,
      date,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('split-desc').value = '';
    document.getElementById('split-total').value = '';
    document.getElementById('split-people').value = '';
    document.getElementById('split-preview').textContent = '';
    notify(`\u2705 Your share \u20b9${share.toFixed(2)} added (Total \u20b9${total.toFixed(2)} \u00f7 ${people})`, 'success');
  } catch (err) {
    notify('Error: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  INCOME (subcollection — multiple sources: Salary, Emergency Fund, Bonus…)
// ═══════════════════════════════════════════════════════════════════════════

async function addIncome() {
  const incDateInput = document.getElementById('inc-date');
  const date = (incDateInput && incDateInput.value) ? incDateInput.value : todayStr();
  const desc = document.getElementById('inc-desc').value.trim();
  const amt = parseFloat(document.getElementById('inc-amt').value);

  if (!desc) return notify('Enter a source (e.g. Salary, Emergency Fund)', 'error');
  if (isNaN(amt) || amt <= 0) return notify('Enter a valid amount', 'error');

  try {
    await incRef(_currentUID).add({
      desc, amt, date,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('inc-desc').value = '';
    document.getElementById('inc-amt').value = '';
    notify('✅ ₹' + amt.toFixed(2) + ' added from ' + desc, 'success');
  } catch (err) {
    notify('Error adding income: ' + err.message, 'error');
  }
}

function renderIncomeList() {
  const list = document.getElementById('income-list');
  if (!list) return;
  list.innerHTML = '';

  if (!_income || _income.length === 0) {
    list.innerHTML = '<li style="text-align:center;color:#64748b;padding:20px;border:none;background:transparent;">No income sources added yet</li>';
    return;
  }

  // Show tip about expense cutoff
  if (_incomeEarliestDate) {
    const tip = document.createElement('li');
    tip.style.cssText = 'border:none;background:#f0fdf4;border-radius:8px;padding:10px 14px;font-size:12px;color:#166534;margin-bottom:4px;';
    tip.textContent = 'ℹ️ Expenses from ' + _incomeEarliestDate + ' onwards count toward your balance';
    list.appendChild(tip);
  }

  _income.forEach(it => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <div><strong>${it.desc}</strong></div>
        <div class="income-meta">${it.date} &bull; &#8377;${(it.amt || 0).toFixed(2)}</div>
      </div>
      <div><button data-id="${it.id}">Delete</button></div>`;
    list.appendChild(li);
    li.querySelector('button').addEventListener('click', () => deleteIncome(it.id));
  });

  // Show total if more than 1 source
  if (_income.length > 1) {
    const total = document.createElement('li');
    total.style.cssText = 'border-top:2px solid #bbf7d0;margin-top:8px;padding-top:12px;font-weight:700;color:#15803d;';
    total.innerHTML = `<span>Total from ${_income.length} sources</span><span>&#8377;${_incomeTotal.toFixed(2)}</span>`;
    list.appendChild(total);
  }
}

async function deleteIncome(id) {
  if (!confirm('Remove this income source?')) return;
  try {
    await incRef(_currentUID).doc(id).delete();
    notify('Income source removed', 'success');
  } catch (err) {
    notify('Error: ' + err.message, 'error');
  }
}

async function clearData() {
  if (!confirm('Clear ALL your expense data? This cannot be undone.')) return;
  try {
    // Delete all expenses in batches of 500
    const snap = await expsRef(_currentUID).get();
    const batches = [];
    let batch = db.batch();
    let count = 0;
    snap.docs.forEach(doc => {
      batch.delete(doc.ref);
      count++;
      if (count === 499) { batches.push(batch); batch = db.batch(); count = 0; }
    });
    batches.push(batch);

    // Delete all budgets
    const bSnap = await budgRef(_currentUID).get();
    let bBatch = db.batch();
    bSnap.docs.forEach(doc => bBatch.delete(doc.ref));
    batches.push(bBatch);

    await Promise.all(batches.map(b => b.commit()));
    notify('All data cleared', 'success');
  } catch (err) {
    notify('Error: ' + err.message, 'error');
  }
}

async function resetToday() {
  if (!confirm("Reset today's data?")) return;
  const today = todayStr();
  try {
    // Delete today's expenses
    const snap = await expsRef(_currentUID).where('date', '==', today).get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    // Delete today's budget
    batch.delete(budgRef(_currentUID).doc(today));
    await batch.commit();
    notify("Today's data reset", 'success');
  } catch (err) {
    notify('Error: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PRINT / EXPORT  (implementations wired in DOMContentLoaded at bottom)
// ═══════════════════════════════════════════════════════════════════════════
// Legacy function names kept so any inline onclick= references still resolve
function printBill() { document.getElementById('print-bill')?.click(); }
function downloadCSV() { document.getElementById('download-csv')?.click(); }
function downloadPDF() { document.getElementById('download-pdf')?.click(); }

// ═══════════════════════════════════════════════════════════════════════════
//  ADMIN PANEL
// ═══════════════════════════════════════════════════════════════════════════
let _editingUID = null;
let _editingUsername = null;
let _allUsers = [];

function openAdminDashboard() {
  hide(document.getElementById('auth-card'));
  hide(document.getElementById('dashboard'));
  show(document.getElementById('admin-dashboard'));
  loadAllUsers();
}

async function loadAllUsers() {
  try {
    // Fetch all user profiles
    const usersSnap = await db.collection('users').get();
    const profiles = usersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));

    // For each user, fetch their expense count + total + budget total
    _allUsers = await Promise.all(profiles.map(async (profile) => {
      const [expsSnap, budgSnap] = await Promise.all([
        expsRef(profile.uid).get(),
        budgRef(profile.uid).get()
      ]);
      const expenses = expsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const budgets = {};
      budgSnap.docs.forEach(d => { budgets[d.id] = d.data().amount; });
      return { ...profile, expenses, budgets };
    }));

    renderAdminUsers();
    renderAdminStats();
  } catch (err) {
    notify('Error loading users: ' + err.message, 'error');
  }
}

function renderAdminUsers() {
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;

  let totalExp = 0, totalSpent = 0;
  _allUsers.forEach(u => {
    totalExp += u.expenses.length;
    totalSpent += u.expenses.reduce((s, e) => s + (e.amt || 0), 0);
  });

  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setEl('admin-total-users', _allUsers.length);
  setEl('admin-total-expenses', totalExp);
  setEl('admin-total-spent', totalSpent.toFixed(2));
  setEl('admin-user-count', _allUsers.length + ' user' + (_allUsers.length !== 1 ? 's' : ''));

  tbody.innerHTML = '';
  if (_allUsers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px;">No users registered yet</td></tr>';
    return;
  }

  _allUsers.forEach((u, idx) => {
    const spent = u.expenses.reduce((s, e) => s + (e.amt || 0), 0);
    const initial = (u.username || '?').charAt(0).toUpperCase();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:#94a3b8;font-weight:600;">${idx + 1}</td>
      <td>
        <div class="user-name-cell">
          <div class="admin-avatar">${initial}</div>
          ${u.username}
        </div>
      </td>
      <td>${u.expenses.length}</td>
      <td>₹${spent.toFixed(2)}</td>
      <td class="actions-cell">
        <button class="btn-table btn-table-edit">✏️ Edit</button>
        <button class="btn-table btn-table-del">🗑️ Delete</button>
      </td>`;
    tbody.appendChild(tr);
    tr.querySelector('.btn-table-edit').addEventListener('click', () => openEditModal(u.uid, u.username));
    tr.querySelector('.btn-table-del').addEventListener('click', () => adminDeleteUser(u.uid, u.username));
  });
}

function renderAdminStats() {
  const container = document.getElementById('admin-stats-list');
  if (!container) return;

  if (_allUsers.length === 0) {
    container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:40px;">No users yet.</p>';
    return;
  }

  container.innerHTML = '';
  _allUsers.forEach(u => {
    const spent = u.expenses.reduce((s, e) => s + (e.amt || 0), 0);
    const totalBudget = Object.values(u.budgets || {}).reduce((s, v) => s + v, 0);
    const initial = (u.username || '?').charAt(0).toUpperCase();

    // Find date range of expenses
    const dates = u.expenses.map(e => e.date).sort();
    const dateRange = dates.length > 0
      ? (dates[0] === dates[dates.length - 1]
        ? dates[0]
        : `${dates[0]} → ${dates[dates.length - 1]}`)
      : 'No expenses';

    const card = document.createElement('div');
    card.className = 'admin-stat-card';
    card.innerHTML = `
      <div class="admin-stat-user">
        <div class="admin-avatar" style="width:40px;height:40px;font-size:16px;">${initial}</div>
        <div class="admin-stat-info">
          <strong>${u.username}</strong>
          <span>${u.expenses.length} expense${u.expenses.length !== 1 ? 's' : ''} &bull; ${dateRange}</span>
        </div>
      </div>
      <div class="admin-stat-nums">
        <div class="admin-num-box">
          <div class="num-val">₹${totalBudget.toFixed(2)}</div>
          <div class="num-label">Budget</div>
        </div>
        <div class="admin-num-box">
          <div class="num-val">₹${spent.toFixed(2)}</div>
          <div class="num-label">Spent</div>
        </div>
        <div class="admin-num-box">
          <div class="num-val" style="color:${totalBudget - spent >= 0 ? '#10b981' : '#ef4444'};">
            ₹${(totalBudget - spent).toFixed(2)}
          </div>
          <div class="num-label">Remaining</div>
        </div>
      </div>`;
    container.appendChild(card);
  });
}

async function openEditModal(uid, username) {
  _editingUID = uid; _editingUsername = username;
  const modal = document.getElementById('edit-user-modal');
  const tag = document.getElementById('modal-current-user');
  const title = document.getElementById('modal-edit-title');
  const newU = document.getElementById('modal-new-username');
  const emailBox = document.getElementById('modal-user-email');
  const guideHighlight = document.getElementById('guide-email-highlight');

  if (title) title.textContent = 'Edit: ' + username;
  if (tag) tag.textContent = '👤 ' + username;
  if (newU) newU.value = username;

  const fbEmail = username.toLowerCase() + '@spendwise.internal';
  if (emailBox) emailBox.textContent = fbEmail;
  if (guideHighlight) guideHighlight.textContent = fbEmail;

  // Reset edit email input
  const editEmailInput = document.getElementById('modal-edit-real-email');
  if (editEmailInput) editEmailInput.value = '';

  // Load real email from Firestore
  try {
    const doc = await userRef(uid).get();
    const realEmail = doc.exists && doc.data().realEmail ? doc.data().realEmail : null;
    const realEmailEl = document.getElementById('modal-real-email');
    const emailUserBtn = document.getElementById('modal-email-user');

    if (realEmailEl) realEmailEl.textContent = realEmail || '— not set —';
    if (editEmailInput && realEmail) editEmailInput.value = realEmail;

    // Enable Email button only if we have a real email
    if (emailUserBtn) {
      if (realEmail) {
        const subject = encodeURIComponent('Your SpendWise Account - Password Reset Request');
        const body = encodeURIComponent(`Hi ${username},\n\nYour admin has initiated a password reset for your SpendWise account.\n\nPlease open the app and re-register using the same username: "${username}"\n\nYou can choose any new password during registration.\nAll your data will be automatically restored.\n\nApp link: ${window.location.origin}\n\nThank you!`);
        emailUserBtn.href = `mailto:${realEmail}?subject=${subject}&body=${body}`;
        emailUserBtn.style.pointerEvents = '';
        emailUserBtn.style.opacity = '';
      } else {
        emailUserBtn.href = '#';
        emailUserBtn.style.pointerEvents = 'none';
        emailUserBtn.style.opacity = '.4';
      }
    }
  } catch (e) {
    const realEmailEl = document.getElementById('modal-real-email');
    if (realEmailEl) realEmailEl.textContent = '—';
  }

  // Reset Authorize Reset button state
  const authResetBtn = document.getElementById('modal-authorize-reset');
  if (authResetBtn) {
    authResetBtn.textContent = '🚀 Authorize Reset & Migration';
    authResetBtn.disabled = false;
  }

  show(modal);
}

function closeEditModal() {
  _editingUID = null; _editingUsername = null;
  const pwInput = document.getElementById('modal-new-password');
  if (pwInput) pwInput.value = '';
  const guideBox = document.getElementById('modal-reset-guide');
  if (guideBox) { guideBox.style.display = 'none'; guideBox.classList.remove('visible'); }
  hide(document.getElementById('edit-user-modal'));
}

async function adminChangeUsername() {
  if (!_editingUID) return;
  const newName = document.getElementById('modal-new-username').value.trim();
  if (!newName) return notify('Enter a new username', 'error');
  if (newName === _editingUsername) return notify('Username is the same', 'info');
  try {
    const snap = await db.collection('usernames').doc(newName).get();
    if (snap.exists) return notify('Username already taken', 'error');
    const batch = db.batch();
    batch.delete(db.collection('usernames').doc(_editingUsername));
    batch.set(db.collection('usernames').doc(newName), { uid: _editingUID, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    batch.update(userRef(_editingUID), { username: newName });
    await batch.commit();
    notify(`Username changed: ${_editingUsername} → ${newName}`, 'success');
    _editingUsername = newName;
    const tag = document.getElementById('modal-current-user');
    const title = document.getElementById('modal-edit-title');
    if (tag) tag.textContent = '👤 ' + newName;
    if (title) title.textContent = 'Edit: ' + newName;
    await loadAllUsers();
  } catch (err) { notify('Error: ' + err.message, 'error'); }
}

async function adminChangePassword() {
  // Client-side Firebase SDK cannot change another user's password.
  // Direct the admin to instruct the user to use the Settings tab.
  notify('ℹ️ Ask the user to go to Settings → Change Password in their own dashboard.', 'info');
}

async function adminDeleteUser(uid, username) {
  if (!confirm(`Delete user "${username}" and ALL their data? This cannot be undone.`)) return;
  try {
    // Delete all expenses (batch)
    const exSnap = await expsRef(uid).get();
    const buSnap = await budgRef(uid).get();
    const batches = [];
    let batch = db.batch();
    let count = 0;
    [...exSnap.docs, ...buSnap.docs].forEach(doc => {
      batch.delete(doc.ref);
      count++;
      if (count === 499) { batches.push(batch); batch = db.batch(); count = 0; }
    });
    batch.delete(userRef(uid));
    batch.delete(db.collection('usernames').doc(username));
    batches.push(batch);
    await Promise.all(batches.map(b => b.commit()));
    notify(`User "${username}" deleted`, 'success');
    if (_editingUID === uid) closeEditModal();
    await loadAllUsers();
  } catch (err) { notify('Error: ' + err.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SETTINGS — CHANGE PASSWORD
// ═══════════════════════════════════════════════════════════════════════════

async function changePassword() {
  const currentPw = document.getElementById('current-password').value;
  const newPw = document.getElementById('new-password').value;
  const confirmPw = document.getElementById('confirm-new-password').value;

  if (!currentPw) return notify('Enter your current password', 'error');
  if (!newPw) return notify('Enter a new password', 'error');
  if (newPw.length < 6) return notify('New password must be at least 6 characters', 'error');
  if (newPw !== confirmPw) return notify('Passwords do not match', 'error');
  if (newPw === currentPw) return notify('New password must be different from current', 'error');

  const btn = document.getElementById('change-password-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Updating…'; }

  try {
    const user = auth.currentUser;
    if (!user) return notify('Not logged in', 'error');

    // Re-authenticate first — Firebase requires this for password changes
    const email = _currentUsername.toLowerCase() + '@spendwise.internal';
    const credential = firebase.auth.EmailAuthProvider.credential(email, currentPw);
    await user.reauthenticateWithCredential(credential);

    // Now update the password
    await user.updatePassword(newPw);

    // Clear fields
    document.getElementById('current-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-new-password').value = '';

    notify('✅ Password updated successfully!', 'success');
  } catch (err) {
    const code = err.code || '';
    if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      notify('Current password is incorrect', 'error');
    } else if (code === 'auth/weak-password') {
      notify('New password is too weak — use at least 6 characters', 'error');
    } else if (code === 'auth/requires-recent-login') {
      notify('Session expired — please log out and log back in, then try again', 'error');
    } else {
      notify('Error: ' + err.message, 'error');
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔒 Update Password'; }
  }
}


let calcInput = '';

function updateCalcDisplay() {
  const d = document.getElementById('calc-display');
  if (d) d.textContent = calcInput || '0';
}
function resetCalculator() { calcInput = ''; updateCalcDisplay(); }
function appendToCalc(v) {
  const ops = ['+', '-', '*', '/'];
  if (ops.includes(v) && (!calcInput || ops.includes(calcInput.slice(-1)))) return;
  if (v === '.') {
    const lastOp = Math.max(calcInput.lastIndexOf('+'), calcInput.lastIndexOf('-'), calcInput.lastIndexOf('*'), calcInput.lastIndexOf('/'));
    if (calcInput.slice(lastOp + 1).includes('.')) return;
  }
  calcInput += v; updateCalcDisplay();
}
function calculateResult() {
  if (!calcInput) return;
  try {
    let expr = calcInput.replace(/[+\-*/]+$/, '');
    const tokens = []; let num = '';
    for (const c of expr) {
      if (['+', '-', '*', '/'].includes(c)) { if (num) { tokens.push(parseFloat(num)); num = ''; } tokens.push(c); }
      else num += c;
    }
    if (num) tokens.push(parseFloat(num));
    for (let i = 1; i < tokens.length; i += 2) {
      if (tokens[i] === '*') { tokens.splice(i - 1, 3, tokens[i - 1] * tokens[i + 1]); i -= 2; }
      else if (tokens[i] === '/') { tokens.splice(i - 1, 3, tokens[i - 1] / tokens[i + 1]); i -= 2; }
    }
    let result = tokens[0];
    for (let i = 1; i < tokens.length; i += 2) {
      if (tokens[i] === '+') result += tokens[i + 1];
      else if (tokens[i] === '-') result -= tokens[i + 1];
    }
    calcInput = (Math.round(result * 10000) / 10000).toString();
    updateCalcDisplay();
  } catch (e) { notify('Invalid calculation', 'error'); calcInput = ''; updateCalcDisplay(); }
}

// ═══════════════════════════════════════════════════════════════════════════
//  WIRE UP — DOMContentLoaded
// ═══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', function () {

  // ── Auth navigation ──
  const showRegister = document.getElementById('show-register');
  const showLogin = document.getElementById('show-login');
  if (showRegister) showRegister.addEventListener('click', () => {
    hide(document.getElementById('login-form'));
    show(document.getElementById('register-form'));
    document.getElementById('auth-title').textContent = 'Create account';
    document.getElementById('auth-subtitle').textContent = 'Join SpendWise today';
  });
  if (showLogin) showLogin.addEventListener('click', () => {
    show(document.getElementById('login-form'));
    hide(document.getElementById('register-form'));
    document.getElementById('auth-title').textContent = 'Welcome back';
    document.getElementById('auth-subtitle').textContent = 'Sign in to your account';
  });

  // ── Forgot Password Modal ──
  const showForgot = document.getElementById('show-forgot');
  const forgotModal = document.getElementById('forgot-modal');
  const forgotModalClose = document.getElementById('forgot-modal-close');
  const forgotCopyBtn = document.getElementById('forgot-copy-btn');

  if (showForgot) showForgot.addEventListener('click', () => {
    document.getElementById('forgot-username').value = document.getElementById('login-username').value.trim();
    // Update mailto link with admin email
    const emailAdminLink = document.getElementById('forgot-email-admin');
    if (emailAdminLink) {
      const uname = document.getElementById('login-username').value.trim();
      const subject = encodeURIComponent('Password Reset Request - SpendWise');
      const body = encodeURIComponent(`Hi Admin,

I forgot my password and need a reset.

My username: ${uname || '[enter username]'}

Please reset my password and share the temporary password with me.

Thank you!`);
      emailAdminLink.href = `mailto:${ADMIN_EMAIL}?subject=${subject}&body=${body}`;
    }
    show(forgotModal);
  });
  if (forgotModalClose) forgotModalClose.addEventListener('click', () => hide(forgotModal));
  if (forgotModal) forgotModal.addEventListener('click', e => { if (e.target === forgotModal) hide(forgotModal); });

  // Update mailto when username changes
  const forgotUsernameInput = document.getElementById('forgot-username');
  if (forgotUsernameInput) forgotUsernameInput.addEventListener('input', () => {
    const emailAdminLink = document.getElementById('forgot-email-admin');
    if (!emailAdminLink) return;
    const uname = forgotUsernameInput.value.trim();
    const subject = encodeURIComponent('Password Reset Request - SpendWise');
    const body = encodeURIComponent(`Hi Admin,

I forgot my password and need a reset.

My username: ${uname || '[enter username]'}

Please reset my password and share the temporary password with me.

Thank you!`);
    emailAdminLink.href = `mailto:${ADMIN_EMAIL}?subject=${subject}&body=${body}`;
  });

  if (forgotCopyBtn) forgotCopyBtn.addEventListener('click', () => {
    const uname = document.getElementById('forgot-username').value.trim();
    if (!uname) { notify('Enter your username first', 'error'); return; }
    navigator.clipboard.writeText(uname).then(() => {
      notify('Username copied! Share it with your admin 👍', 'success');
    }).catch(() => notify('Copy failed — please copy manually', 'error'));
  });

  // ── Login / Register ──
  const loginBtn = document.getElementById('login-btn');
  const registerBtn = document.getElementById('register-btn');
  if (loginBtn) loginBtn.addEventListener('click', loginUser);
  if (registerBtn) registerBtn.addEventListener('click', registerUser);

  // ── Enter key ──
  ['login-username', 'login-password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') loginUser(); });
  });
  ['reg-username', 'reg-email', 'reg-password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') registerUser(); });
  });

  // ── Role Toggle ──
  const roleUserBtn = document.getElementById('role-user');
  const roleAdminBtn = document.getElementById('role-admin');
  if (roleUserBtn) roleUserBtn.addEventListener('click', () => setRole('user'));
  if (roleAdminBtn) roleAdminBtn.addEventListener('click', () => setRole('admin'));

  // ── All logout buttons ──
  ['logout-btn', 'mobile-logout-btn', 'admin-logout-btn', 'admin-mobile-logout-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', logoutUser);
  });

  // ── Dashboard buttons ──
  const btns = {
    'set-budget': setBudget,
    'reset-budget': resetBudget,
    'add-expense': addExpense,
    'clear-data': clearData,
    'reset-today': resetToday,
    'print-bill': printBill,
    'download-pdf': downloadPDF,
    'download-csv': downloadCSV,
    'change-password-btn': changePassword,
  };
  Object.entries(btns).forEach(([id, fn]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  });

  // ── Enter key on password fields in settings ──
  ['current-password', 'new-password', 'confirm-new-password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') changePassword(); });
  });

  // ── Admin Refresh ──
  const adminRefreshBtn = document.getElementById('admin-refresh');
  if (adminRefreshBtn) adminRefreshBtn.addEventListener('click', () => { loadAllUsers(); notify('Refreshed', 'success'); });

  // ── Admin Tab Navigation ──
  function switchAdminTab(tab) {
    document.querySelectorAll('[data-admin-tab]').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('#admin-dashboard .tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll(`[data-admin-tab="${tab}"]`).forEach(n => n.classList.add('active'));
    const panel = document.getElementById('admin-tab-' + tab);
    if (panel) panel.classList.add('active');
  }
  document.querySelectorAll('[data-admin-tab]').forEach(item => {
    item.addEventListener('click', () => switchAdminTab(item.dataset.adminTab));
  });

  // ── Edit Modal ──
  const modalCloseBtn = document.getElementById('modal-close-btn');
  const modalOverlay = document.getElementById('edit-user-modal');
  const modalSaveUsername = document.getElementById('modal-save-username');
  const modalDeleteUser = document.getElementById('modal-delete-user');
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeEditModal);
  if (modalOverlay) modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeEditModal(); });
  if (modalSaveUsername) modalSaveUsername.addEventListener('click', adminChangeUsername);
  if (modalDeleteUser) modalDeleteUser.addEventListener('click', () => { if (_editingUID) adminDeleteUser(_editingUID, _editingUsername); });

  // ── Admin Copy Email button ──
  const modalCopyEmail = document.getElementById('modal-copy-email');
  if (modalCopyEmail) modalCopyEmail.addEventListener('click', () => {
    const email = document.getElementById('modal-user-email').textContent.trim();
    navigator.clipboard.writeText(email).then(() => {
      notify('Email copied to clipboard!', 'success');
      modalCopyEmail.textContent = '✅ Copied!';
      setTimeout(() => { modalCopyEmail.textContent = '📋 Copy'; }, 2000);
    }).catch(() => notify('Copy failed', 'error'));
  });

  // ── Admin Save Real Email button ──
  const modalSaveRealEmail = document.getElementById('modal-save-real-email');
  if (modalSaveRealEmail) modalSaveRealEmail.addEventListener('click', async () => {
    if (!_editingUID) return;
    const newEmail = document.getElementById('modal-edit-real-email').value.trim();
    if (!newEmail) { notify('Enter an email address first', 'error'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) { notify('Enter a valid email address', 'error'); return; }

    try {
      modalSaveRealEmail.textContent = 'Saving…';
      modalSaveRealEmail.disabled = true;
      await userRef(_editingUID).update({ realEmail: newEmail });

      // Update display
      const realEmailEl = document.getElementById('modal-real-email');
      if (realEmailEl) realEmailEl.textContent = newEmail;

      // Enable Email button
      const emailUserBtn = document.getElementById('modal-email-user');
      if (emailUserBtn) {
        const subject = encodeURIComponent('Your SpendWise Account - Password Reset Request');
        const body = encodeURIComponent(`Hi ${_editingUsername},\n\nYour admin has initiated a password reset for your SpendWise account.\n\nPlease open the app and re-register using the same username: "${_editingUsername}"\n\nYou can choose any new password during registration. All your data will be automatically restored.\n\nApp link: ${window.location.origin}\n\nThank you!`);
        emailUserBtn.href = `mailto:${newEmail}?subject=${subject}&body=${body}`;
        emailUserBtn.style.pointerEvents = '';
        emailUserBtn.style.opacity = '';
      }

      notify('✅ Real email saved successfully!', 'success');
    } catch (err) {
      notify('Error saving email: ' + err.message, 'error');
    } finally {
      modalSaveRealEmail.textContent = '💾 Save Email';
      modalSaveRealEmail.disabled = false;
    }
  });

  // ── Admin Authorize Reset button ──
  const modalAuthReset = document.getElementById('modal-authorize-reset');
  if (modalAuthReset) modalAuthReset.addEventListener('click', async () => {
    if (!_editingUsername) return;
    try {
      modalAuthReset.textContent = 'Authorizing…';
      modalAuthReset.disabled = true;
      await db.collection('usernames').doc(_editingUsername).update({
        pendingReset: true,
        resetAuthorizedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      notify('✅ Reset authorized! User can now re-register with this username.', 'success');
      modalAuthReset.textContent = '✅ Authorized';
    } catch (err) {
      notify('Error authorizing reset: ' + err.message, 'error');
      modalAuthReset.textContent = '🚀 Authorize Reset & Migration';
      modalAuthReset.disabled = false;
    }
  });

  // ── User Tab Navigation (desktop + mobile) ──
  function switchUserTab(tab) {
    document.querySelectorAll('.nav-item[data-tab]').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.mob-nav-item[data-tab]').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('#dashboard .tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll(`.nav-item[data-tab="${tab}"]`).forEach(n => n.classList.add('active'));
    document.querySelectorAll(`.mob-nav-item[data-tab="${tab}"]`).forEach(n => n.classList.add('active'));
    const panel = document.getElementById('tab-' + tab);
    if (panel) panel.classList.add('active');
  }
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => switchUserTab(item.dataset.tab));
  });
  document.querySelectorAll('.mob-nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', () => switchUserTab(item.dataset.tab));
  });

  // ── Date inputs ──
  const today = todayStr();
  const todayLabel = document.getElementById('today-label');
  if (todayLabel) {
    todayLabel.textContent = new Date().toLocaleDateString('en-IN', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }
  const budgetDateInput = document.getElementById('budget-date');
  if (budgetDateInput) {
    budgetDateInput.value = today;
    budgetDateInput.addEventListener('change', onBudgetDateChange);
  }
  const expDateInput = document.getElementById('exp-date');
  if (expDateInput) expDateInput.value = today;

  // ── Debit / Credit type toggle ──
  const typeDebitBtn = document.getElementById('type-debit');
  const typeCreditBtn = document.getElementById('type-credit');
  const addExpBtn = document.getElementById('add-expense');
  const panelTitle = document.getElementById('exp-panel-title');

  function setEntryType(type) {
    _entryType = type;
    const isCredit = type === 'credit';
    if (typeDebitBtn) { typeDebitBtn.classList.toggle('type-btn--active', !isCredit); typeDebitBtn.classList.toggle('exp-mode', !isCredit); }
    if (typeCreditBtn) { typeCreditBtn.classList.toggle('type-btn--active', isCredit); typeCreditBtn.classList.toggle('credit-mode', isCredit); }
    if (addExpBtn) {
      addExpBtn.className = isCredit ? 'btn-pro btn-indigo' : 'btn-pro btn-green';
      addExpBtn.textContent = isCredit ? '＋ Add Credit' : '＋ Add';
    }
    if (panelTitle) panelTitle.textContent = isCredit ? '➕ Add Credit / Refund' : '➕ Add Expense';
    const descInput = document.getElementById('exp-desc');
    if (descInput) descInput.placeholder = isCredit ? 'e.g. Refund, Cashback, Friend repaid' : 'What did you spend on?';
  }

  if (typeDebitBtn) typeDebitBtn.addEventListener('click', () => setEntryType('debit'));
  if (typeCreditBtn) typeCreditBtn.addEventListener('click', () => setEntryType('credit'));

  const incDateInput = document.getElementById('inc-date');
  if (incDateInput) incDateInput.value = today;

  const addIncBtn = document.getElementById('add-income');
  if (addIncBtn) addIncBtn.addEventListener('click', addIncome);

  // ── Edit Expense Modal buttons ──
  document.getElementById('edit-type-debit')?.addEventListener('click', () => setEditExpType('debit'));
  document.getElementById('edit-type-credit')?.addEventListener('click', () => setEditExpType('credit'));
  document.getElementById('edit-exp-save')?.addEventListener('click', saveEditExpense);
  document.getElementById('edit-exp-close')?.addEventListener('click', closeEditExpenseModal);
  document.getElementById('edit-exp-cancel')?.addEventListener('click', closeEditExpenseModal);
  document.getElementById('edit-expense-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('edit-expense-modal')) closeEditExpenseModal();
  });

  // ── Split Bill ──
  const splitDateInput = document.getElementById('split-date');
  if (splitDateInput) splitDateInput.value = today;
  const splitAddBtn = document.getElementById('split-add');
  if (splitAddBtn) splitAddBtn.addEventListener('click', splitBill);
  ['split-total', 'split-people'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateSplitPreview);
  });

  const filterDateInput = document.getElementById('filter-date');
  const filterTodayBtn = document.getElementById('filter-today');
  const filterYesterdayBtn = document.getElementById('filter-yesterday');

  function setQuickFilterActive(which) {
    // which: 'today' | 'yesterday' | null
    if (filterTodayBtn) filterTodayBtn.classList.toggle('active', which === 'today');
    if (filterYesterdayBtn) filterYesterdayBtn.classList.toggle('active', which === 'yesterday');
  }

  if (filterDateInput) filterDateInput.addEventListener('change', () => {
    setQuickFilterActive(null);
    renderExpenses();
  });
  const filterClearBtn = document.getElementById('filter-clear');
  if (filterClearBtn) filterClearBtn.addEventListener('click', () => {
    if (filterDateInput) filterDateInput.value = '';
    setQuickFilterActive(null);
    renderExpenses();
  });

  if (filterTodayBtn) filterTodayBtn.addEventListener('click', () => {
    const today = todayStr();
    if (filterDateInput) filterDateInput.value = today;
    setQuickFilterActive('today');
    renderExpenses();
  });

  if (filterYesterdayBtn) filterYesterdayBtn.addEventListener('click', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yStr = yesterday.toISOString().split('T')[0];
    if (filterDateInput) filterDateInput.value = yStr;
    setQuickFilterActive('yesterday');
    renderExpenses();
  });

  // ── Calculator ──
  document.querySelectorAll('.calc-btn-pro[data-value]').forEach(btn => {
    btn.addEventListener('click', () => appendToCalc(btn.dataset.value));
  });
  const calcEqual = document.getElementById('calc-equal');
  const calcClear = document.getElementById('calc-clear');
  const calcBackspace = document.getElementById('calc-backspace');
  if (calcEqual) calcEqual.addEventListener('click', calculateResult);
  if (calcClear) calcClear.addEventListener('click', resetCalculator);
  if (calcBackspace) calcBackspace.addEventListener('click', () => { calcInput = calcInput.slice(0, -1); updateCalcDisplay(); });

  // ── Calculator keyboard ──
  function flashCalcBtn(sel) {
    const btn = document.querySelector(sel);
    if (!btn) return;
    btn.classList.add('key-active');
    setTimeout(() => btn.classList.remove('key-active'), 150);
  }
  document.addEventListener('keydown', function (e) {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const key = e.key;
    if ('0123456789.'.includes(key)) { appendToCalc(key); flashCalcBtn(`[data-value="${key}"]`); }
    else if (key === '+') { appendToCalc('+'); flashCalcBtn('[data-value="+"]'); }
    else if (key === '-') { appendToCalc('-'); flashCalcBtn('[data-value="-"]'); }
    else if (key === '*') { appendToCalc('*'); flashCalcBtn('[data-value="*"]'); }
    else if (key === '/') { e.preventDefault(); appendToCalc('/'); flashCalcBtn('[data-value="/"]'); }
    else if (key === 'Enter' || key === '=') { e.preventDefault(); calculateResult(); flashCalcBtn('#calc-equal'); }
    else if (key === 'Backspace') { calcInput = calcInput.slice(0, -1); updateCalcDisplay(); flashCalcBtn('#calc-backspace'); }
    else if (key === 'Escape') { resetCalculator(); flashCalcBtn('#calc-clear'); }
  });

  // ── Admin session restore ──
  if (localStorage.getItem('sw_admin')) {
    openAdminDashboard();
  }
  // Firebase Auth session restored automatically via onAuthStateChanged

  // ── Print / PDF / CSV ──────────────────────────────────────────────────────
  function buildReportHTML(forPDF, filterDate, items) {
    const all = (items || (_expenses || [])).slice().sort((a, b) => a.date < b.date ? 1 : -1);
    const username = _currentUsername || '';
    const now = new Date().toLocaleString('en-IN');
    const rangeLabel = filterDate ? `Date: ${filterDate}` : 'All Records';

    const totalDebit = all.filter(e => e.type !== 'credit').reduce((s, e) => s + (e.amt || 0), 0);
    const totalCredit = all.filter(e => e.type === 'credit').reduce((s, e) => s + (e.amt || 0), 0);
    const net = totalDebit - totalCredit;

    const rows = all.map(e => {
      const isCredit = e.type === 'credit';
      const amtStr = (isCredit ? '+' : '-') + '₹' + (e.amt || 0).toFixed(2);
      return `<tr>
        <td>${e.date}</td>
        <td>${e.desc || ''}</td>
        <td class="${isCredit ? 'cr' : 'dr'}">${amtStr}</td>
        <td class="${isCredit ? 'cr' : 'dr'}">${isCredit ? 'Credit' : 'Expense'}</td>
      </tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>SpendWise Report — ${username}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 13px; color: #1e293b; padding: 32px; }
    h1 { font-size: 22px; font-weight: 800; margin-bottom: 4px; }
    .meta { color: #64748b; font-size: 12px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #1e293b; color: white; }
    thead th { padding: 10px 12px; text-align: left; font-size: 12px; letter-spacing: .5px; text-transform: uppercase; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    td { padding: 9px 12px; border-bottom: 1px solid #e2e8f0; }
    .dr { color: #ef4444; font-weight: 600; }
    .cr { color: #16a34a; font-weight: 600; }
    .summary { margin-top: 24px; display: flex; gap: 16px; flex-wrap: wrap; }
    .s-box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 20px; min-width: 160px; }
    .s-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; letter-spacing: .5px; }
    .s-val { font-size: 20px; font-weight: 800; margin-top: 4px; }
    @media print { body { padding: 16px; } button { display: none; } }
  </style>
</head>
<body>
  <h1>💸 SpendWise — Expense Report</h1>
  <div class="meta">Account: ${username} &nbsp;|&nbsp; Generated: ${now} &nbsp;|&nbsp; ${all.length} entries</div>
  <table>
    <thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Type</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" style="text-align:center;padding:20px;color:#94a3b8;">No records found</td></tr>'}</tbody>
  </table>
  <div class="summary">
    <div class="s-box"><div class="s-label">Total Expenses</div><div class="s-val dr">−₹${totalDebit.toFixed(2)}</div></div>
    <div class="s-box"><div class="s-label">Total Credits</div><div class="s-val cr">+₹${totalCredit.toFixed(2)}</div></div>
    <div class="s-box"><div class="s-label">Net Spent</div><div class="s-val" style="color:#1e293b;">₹${net.toFixed(2)}</div></div>
  </div>
  ${forPDF ? '<script>window.onload=function(){window.print();}<\/script>' : ''}
</body></html>`;
  }

  document.getElementById('print-bill')?.addEventListener('click', () => {
    const win = window.open('', '_blank');
    win.document.write(buildReportHTML(false));
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 600);
  });

  document.getElementById('download-pdf')?.addEventListener('click', () => {
    const win = window.open('', '_blank');
    win.document.write(buildReportHTML(true));
    win.document.close();
  });

  document.getElementById('download-csv')?.addEventListener('click', () => {
    const all = (_expenses || []).slice().sort((a, b) => a.date < b.date ? 1 : -1);
    const header = 'Date,Description,Amount,Type\n';
    const rows = all.map(e => {
      const type = e.type === 'credit' ? 'Credit' : 'Expense';
      const sign = e.type === 'credit' ? '' : '-';
      const desc = (e.desc || '').replace(/"/g, '""');
      return `${e.date},"${desc}",${sign}${(e.amt || 0).toFixed(2)},${type}`;
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spendwise_${_currentUsername || 'report'}_${todayStr()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── By Date export buttons ──────────────────────────────────────────────
  const exportDateInput = document.getElementById('export-date');
  if (exportDateInput) exportDateInput.value = todayStr();

  function getExportDate() {
    const d = exportDateInput?.value;
    if (!d) { notify('Pick a date in the "By Date" row first', 'error'); return null; }
    return d;
  }

  document.getElementById('print-date')?.addEventListener('click', () => {
    const date = getExportDate(); if (!date) return;
    const items = (_expenses || []).filter(e => e.date === date);
    const win = window.open('', '_blank');
    win.document.write(buildReportHTML(false, date, items));
    win.document.close(); win.focus();
    setTimeout(() => win.print(), 600);
  });

  document.getElementById('pdf-date')?.addEventListener('click', () => {
    const date = getExportDate(); if (!date) return;
    const items = (_expenses || []).filter(e => e.date === date);
    const win = window.open('', '_blank');
    win.document.write(buildReportHTML(true, date, items));
    win.document.close();
  });

  document.getElementById('csv-date')?.addEventListener('click', () => {
    const date = getExportDate(); if (!date) return;
    const items = (_expenses || []).filter(e => e.date === date);
    const header = 'Date,Description,Amount,Type\n';
    const rows = items.map(e => {
      const type = e.type === 'credit' ? 'Credit' : 'Expense';
      const sign = e.type === 'credit' ? '' : '-';
      const desc = (e.desc || '').replace(/"/g, '""');
      return `${e.date},"${desc}",${sign}${(e.amt || 0).toFixed(2)},${type}`;
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spendwise_${_currentUsername || 'report'}_${date}.csv`;
    a.click(); URL.revokeObjectURL(url);
  });
});
