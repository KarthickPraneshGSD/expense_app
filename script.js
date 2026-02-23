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

// ─── Admin credentials ──────────────────────────────────────────────────────
const ADMIN_USER = 'adminsystem';
const ADMIN_PASS = btoa('kratos');

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

// ─── Shortcuts ──────────────────────────────────────────────────────────────
const userRef = (uid) => db.collection('users').doc(uid);
const expsRef = (uid) => userRef(uid).collection('expenses');
const budgRef = (uid) => userRef(uid).collection('budgets');

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
  const password = document.getElementById('reg-password').value;

  if (!username) return notify('Enter a username', 'error');
  if (!password) return notify('Enter a password', 'error');
  if (password.length < 6) return notify('Password must be at least 6 characters', 'error');
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return notify('Username: only letters, numbers, underscores', 'error');

  setLoading('register-btn', true, 'Create Account');
  try {
    // Check username uniqueness
    const snap = await db.collection('usernames').doc(username).get();
    if (snap.exists) {
      notify('Username already taken', 'error');
      return;
    }

    // Firebase Auth (use synthetic email)
    const email = username.toLowerCase() + '@spendwise.internal';
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const uid = cred.user.uid;

    // Write profile + username mapping atomically
    const batch = db.batch();
    batch.set(db.collection('usernames').doc(username), { uid, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    batch.set(userRef(uid), { username, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    await batch.commit();

    document.getElementById('reg-username').value = '';
    document.getElementById('reg-password').value = '';
    hide(document.getElementById('register-form'));
    show(document.getElementById('login-form'));
    notify('Account created! Please log in.', 'success');
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
    setLoading('register-btn', false, 'Create Account');
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
}

function stopUserListeners() {
  if (_unsubExpenses) { _unsubExpenses(); _unsubExpenses = null; }
  if (_unsubBudgets) { _unsubBudgets(); _unsubBudgets = null; }
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
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    document.getElementById('exp-desc').value = '';
    document.getElementById('exp-amt').value = '';
    notify('Expense added for ' + date, 'success');
    // listener auto-updates _expenses → renderExpenses()
  } catch (err) {
    notify('Error adding expense: ' + err.message, 'error');
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

  const total = items.reduce((sum, e) => sum + (e.amt || 0), 0);
  const totalEl = document.getElementById('expenses-total-val');
  if (totalEl) totalEl.textContent = total.toFixed(2);

  if (items.length === 0) {
    const li = document.createElement('li');
    li.textContent = filterDate ? `No expenses for ${filterDate}` : 'No expenses yet';
    li.style.cssText = 'text-align:center;color:#64748b;padding:20px;border:none;background:transparent;';
    list.appendChild(li);
    return;
  }

  // Already ordered by date desc, createdAt desc from Firestore
  items.forEach(it => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div>
        <div><strong>${it.desc}</strong></div>
        <div class="expense-meta">${it.date} &bull; &#8377;${(it.amt || 0).toFixed(2)}</div>
      </div>
      <div><button data-id="${it.id}">Delete</button></div>`;
    list.appendChild(li);
    li.querySelector('button').addEventListener('click', () => deleteExpense(it.id));
  });
}

async function deleteExpense(id) {
  try {
    await expsRef(_currentUID).doc(id).delete();
    notify('Deleted', 'success');
    // listener auto-updates
  } catch (err) {
    notify('Error: ' + err.message, 'error');
  }
}

function updateSummary() {
  const budgetDateInput = document.getElementById('budget-date');
  const selectedDate = (budgetDateInput && budgetDateInput.value) ? budgetDateInput.value : todayStr();

  const bud = _budgets[selectedDate] || 0;
  const spent = (_expenses || [])
    .filter(e => e.date === selectedDate)
    .reduce((s, e) => s + (e.amt || 0), 0);

  const budEl = document.getElementById('budget-val');
  const spentEl = document.getElementById('spent-val');
  const remEl = document.getElementById('remaining-val');
  if (budEl) budEl.textContent = bud.toFixed(2);
  if (spentEl) spentEl.textContent = spent.toFixed(2);
  if (remEl) remEl.textContent = (bud - spent).toFixed(2);
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
//  PRINT / EXPORT
// ═══════════════════════════════════════════════════════════════════════════

function printBill() {
  const u = _currentUsername || 'User';
  let date = prompt('Enter date to print (YYYY-MM-DD)', todayStr());
  if (!date) return; date = date.trim();
  const filtered = _expenses.filter(e => e.date === date);
  const totalSpent = filtered.reduce((s, e) => s + e.amt, 0);
  const bud = _budgets[date] || 0;
  const rows = filtered.map(e =>
    `<li style="padding:8px 0;border-bottom:1px solid #eee;display:flex;justify-content:space-between;">
      <span>${e.desc}</span><span>₹${e.amt.toFixed(2)}</span>
    </li>`).join('');
  const html = `<!DOCTYPE html><html><head><title>Expense Bill</title>
    <style>body{font-family:sans-serif;max-width:400px;margin:auto;padding:20px}
    h2{color:#6366f1}ul{list-style:none;padding:0}.total{font-weight:bold;font-size:18px;margin-top:16px}
    </style></head><body>
    <h2>Daily Expense Report</h2><p>Date: ${date}</p><p>User: ${u}</p>
    <ul>${rows || '<li>No expenses</li>'}</ul>
    <p class="total">Total: ₹${totalSpent.toFixed(2)}</p>
    <p>Budget: ₹${bud.toFixed(2)} | Remaining: ₹${(bud - totalSpent).toFixed(2)}</p>
    </body></html>`;
  const w = window.open('', '', 'width=500,height=700');
  w.document.write(html); w.document.close();
  setTimeout(() => w.print(), 300);
}

function downloadCSV() {
  const u = _currentUsername || 'User';
  let date = prompt('Enter date to export (YYYY-MM-DD)', todayStr());
  if (!date) return; date = date.trim();
  const filtered = _expenses.filter(e => e.date === date);
  let csv = 'Date,Description,Amount\n';
  filtered.forEach(e => { csv += `${e.date},"${e.desc}",${e.amt.toFixed(2)}\n`; });
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `expenses_${u}_${date}.csv`; a.click();
  notify('CSV downloaded', 'success');
}

function downloadPDF() {
  const u = _currentUsername || 'User';
  let date = prompt('Enter date for PDF (YYYY-MM-DD)', todayStr());
  if (!date) return; date = date.trim();
  const filtered = _expenses.filter(e => e.date === date);
  const totalSpent = filtered.reduce((s, e) => s + e.amt, 0);
  const bud = _budgets[date] || 0;
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 20;
    doc.setFontSize(16); doc.setTextColor(99, 102, 241);
    doc.text('Daily Expense Report', 105, y, { align: 'center' }); y += 12;
    doc.setFontSize(10); doc.setTextColor(80, 80, 80);
    doc.text(`Date: ${date} | User: ${u}`, 105, y, { align: 'center' }); y += 12;
    doc.setFontSize(9); doc.setTextColor(30, 41, 59);
    filtered.forEach(e => {
      doc.text(e.desc, 20, y);
      doc.text('₹' + e.amt.toFixed(2), 180, y, { align: 'right' });
      y += 8;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 4;
    doc.setFontSize(11); doc.setTextColor(99, 102, 241);
    doc.text(`Total: ₹${totalSpent.toFixed(2)}`, 20, y); y += 8;
    doc.text(`Budget: ₹${bud.toFixed(2)} | Remaining: ₹${(bud - totalSpent).toFixed(2)}`, 20, y);
    doc.save(`expenses_${u}_${date}.pdf`);
    notify('PDF downloaded', 'success');
  } catch (e) { notify('PDF library not loaded', 'error'); }
}

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

function openEditModal(uid, username) {
  _editingUID = uid; _editingUsername = username;
  const modal = document.getElementById('edit-user-modal');
  const tag = document.getElementById('modal-current-user');
  const title = document.getElementById('modal-edit-title');
  const newU = document.getElementById('modal-new-username');
  const emailBox = document.getElementById('modal-user-email');

  if (title) title.textContent = 'Edit: ' + username;
  if (tag) tag.textContent = '👤 ' + username;
  if (newU) newU.value = username;
  // Show the Firebase Auth email so admin can find this user in Firebase Console
  if (emailBox) emailBox.textContent = username.toLowerCase() + '@spendwise.internal';

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
    show(forgotModal);
  });
  if (forgotModalClose) forgotModalClose.addEventListener('click', () => hide(forgotModal));
  if (forgotModal) forgotModal.addEventListener('click', e => { if (e.target === forgotModal) hide(forgotModal); });
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
  ['reg-username', 'reg-password'].forEach(id => {
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

  // ── Admin Set Password button — shows step-by-step guide ──
  const modalSetPassword = document.getElementById('modal-set-password');
  if (modalSetPassword) modalSetPassword.addEventListener('click', () => {
    const newPw = document.getElementById('modal-new-password').value.trim();
    const email = document.getElementById('modal-user-email').textContent.trim();
    if (!newPw) { notify('Enter a new password first', 'error'); return; }
    if (newPw.length < 6) { notify('Password must be at least 6 characters', 'error'); return; }

    // Populate the step-by-step guide with exact values
    const guideEmail = document.getElementById('guide-email-highlight');
    const guidePass = document.getElementById('guide-password-highlight');
    if (guideEmail) guideEmail.textContent = email;
    if (guidePass) guidePass.textContent = newPw;

    // Show the guide box
    const guideBox = document.getElementById('modal-reset-guide');
    if (guideBox) { guideBox.style.display = 'block'; guideBox.classList.add('visible'); }

    // Also copy password to clipboard for convenience
    navigator.clipboard.writeText(newPw).then(() => {
      notify('📋 Password copied to clipboard! Paste it in Firebase Console.', 'success');
    }).catch(() => { });
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
});
