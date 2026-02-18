// Daily Expense App - script.js
const STORAGE_USERS = 'de_users_v1';
const STORAGE_CURRENT = 'de_currentUser';
const ADMIN_USER = 'adminsystem';
const ADMIN_PASS = btoa('kratos');     // change this to your preferred password
const STORAGE_ROLE = 'de_role';          // 'user' | 'admin'

// ─── Storage Helpers ───────────────────────────────────────────────────────────
function getUsers() {
  try {
    const raw = localStorage.getItem(STORAGE_USERS);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveUsers(users) {
  localStorage.setItem(STORAGE_USERS, JSON.stringify(users));
}

function getCurrentUser() {
  return localStorage.getItem(STORAGE_CURRENT);
}

function getCurrentRole() {
  return localStorage.getItem(STORAGE_ROLE) || 'user';
}

// Auto-logout on page refresh/close
window.addEventListener('beforeunload', function () {
  localStorage.removeItem(STORAGE_CURRENT);
  localStorage.removeItem(STORAGE_ROLE);
});

// ─── Role Toggle (auth screen) ─────────────────────────────────────────────────
let selectedRole = 'user';   // tracks which role button is active

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
    // Switch back to login form if on register
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


// ─── UI Helpers ────────────────────────────────────────────────────────────────
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
  setTimeout(() => n.remove(), 3000);
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
function registerUser() {
  const u = document.getElementById('reg-username').value.trim();
  const p = document.getElementById('reg-password').value;
  if (!u) return notify('Enter a username', 'error');
  if (!p) return notify('Enter a password', 'error');

  const users = getUsers();
  if (users[u]) return notify('Username already taken', 'error');

  users[u] = { password: btoa(p), expenses: [], dailyBudgets: {} };
  saveUsers(users);

  document.getElementById('reg-username').value = '';
  document.getElementById('reg-password').value = '';

  // Switch to login form
  hide(document.getElementById('register-form'));
  show(document.getElementById('login-form'));

  notify('Account created! Please log in.', 'success');
}

function loginUser() {
  const u = document.getElementById('login-username').value.trim();
  const p = document.getElementById('login-password').value;

  if (!u) return notify('Enter your username', 'error');
  if (!p) return notify('Enter your password', 'error');

  // ── Admin login ──
  if (selectedRole === 'admin') {
    if (u !== ADMIN_USER || btoa(p) !== ADMIN_PASS) {
      return notify('Invalid admin credentials', 'error');
    }
    localStorage.setItem(STORAGE_CURRENT, ADMIN_USER);
    localStorage.setItem(STORAGE_ROLE, 'admin');
    document.getElementById('login-username').value = '';
    document.getElementById('login-password').value = '';
    openAdminDashboard();
    notify('Welcome, Administrator!', 'success');
    return;
  }

  // ── Regular user login ──
  const users = getUsers();
  if (!users[u]) return notify('User not found. Please register first.', 'error');
  if (users[u].password !== btoa(p)) return notify('Wrong password', 'error');

  localStorage.setItem(STORAGE_CURRENT, u);
  localStorage.setItem(STORAGE_ROLE, 'user');
  document.getElementById('login-username').value = '';
  document.getElementById('login-password').value = '';
  openDashboard();
  notify('Welcome back, ' + u + '!', 'success');
}

function logoutUser() {
  localStorage.removeItem(STORAGE_CURRENT);
  localStorage.removeItem(STORAGE_ROLE);
  hide(document.getElementById('dashboard'));
  hide(document.getElementById('admin-dashboard'));
  show(document.getElementById('auth-card'));
  // Reset role toggle to user
  setRole('user');
  show(document.getElementById('login-form'));
  hide(document.getElementById('register-form'));
  resetCalculator();
  notify('Logged out', 'info');
}

// ─── Admin Dashboard ───────────────────────────────────────────────────────────
let _editingUser = null;   // tracks which user is being edited in the modal

function openAdminDashboard() {
  hide(document.getElementById('auth-card'));
  hide(document.getElementById('dashboard'));
  show(document.getElementById('admin-dashboard'));
  renderAdminUsers();
  renderAdminStats();
}

function renderAdminUsers() {
  const users = getUsers();
  const keys = Object.keys(users);
  const tbody = document.getElementById('admin-users-tbody');
  if (!tbody) return;

  // Update summary cards
  let totalExp = 0, totalSpent = 0;
  keys.forEach(k => {
    const u = users[k];
    totalExp += (u.expenses || []).length;
    totalSpent += (u.expenses || []).reduce((s, e) => s + e.amt, 0);
  });
  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setEl('admin-total-users', keys.length);
  setEl('admin-total-expenses', totalExp);
  setEl('admin-total-spent', totalSpent.toFixed(2));
  setEl('admin-user-count', keys.length + ' user' + (keys.length !== 1 ? 's' : ''));

  tbody.innerHTML = '';
  if (keys.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px;">No users registered yet</td></tr>';
    return;
  }

  keys.forEach((username, idx) => {
    const u = users[username];
    const exps = (u.expenses || []);
    const spent = exps.reduce((s, e) => s + e.amt, 0);
    const initial = username.charAt(0).toUpperCase();

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="color:#94a3b8;font-weight:600;">${idx + 1}</td>
      <td>
        <div class="user-name-cell">
          <div class="admin-avatar">${initial}</div>
          ${username}
        </div>
      </td>
      <td>${exps.length}</td>
      <td>₹${spent.toFixed(2)}</td>
      <td class="actions-cell">
        <button class="btn-table btn-table-edit" data-user="${username}">✏️ Edit</button>
        <button class="btn-table btn-table-del"  data-user="${username}">🗑️ Delete</button>
      </td>
    `;
    tbody.appendChild(tr);

    tr.querySelector('.btn-table-edit').addEventListener('click', () => openEditModal(username));
    tr.querySelector('.btn-table-del').addEventListener('click', () => adminDeleteUser(username));
  });
}

function renderAdminStats() {
  const users = getUsers();
  const keys = Object.keys(users);
  const container = document.getElementById('admin-stats-list');
  if (!container) return;

  if (keys.length === 0) {
    container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:40px;">No users yet.</p>';
    return;
  }

  container.innerHTML = '';
  keys.forEach(username => {
    const u = users[username];
    const exps = u.expenses || [];
    const spent = exps.reduce((s, e) => s + e.amt, 0);
    const budgets = u.dailyBudgets || {};
    const totalBudget = Object.values(budgets).reduce((s, v) => s + v, 0);
    const initial = username.charAt(0).toUpperCase();

    const card = document.createElement('div');
    card.className = 'admin-stat-card';
    card.innerHTML = `
      <div class="admin-stat-user">
        <div class="admin-avatar" style="width:40px;height:40px;font-size:16px;">${initial}</div>
        <div class="admin-stat-info">
          <strong>${username}</strong>
          <span>${exps.length} expense${exps.length !== 1 ? 's' : ''} recorded</span>
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
          <div class="num-val" style="color:${totalBudget - spent >= 0 ? '#10b981' : '#ef4444'};">₹${(totalBudget - spent).toFixed(2)}</div>
          <div class="num-label">Remaining</div>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

function openEditModal(username) {
  _editingUser = username;
  const modal = document.getElementById('edit-user-modal');
  const tag = document.getElementById('modal-current-user');
  const title = document.getElementById('modal-edit-title');
  const newU = document.getElementById('modal-new-username');
  const newP = document.getElementById('modal-new-password');
  const confP = document.getElementById('modal-confirm-password');

  if (title) title.textContent = 'Edit: ' + username;
  if (tag) tag.textContent = '👤 ' + username;
  if (newU) newU.value = username;
  if (newP) newP.value = '';
  if (confP) confP.value = '';

  show(modal);
}

function closeEditModal() {
  _editingUser = null;
  hide(document.getElementById('edit-user-modal'));
}

function adminChangeUsername() {
  if (!_editingUser) return;
  const newName = document.getElementById('modal-new-username').value.trim();
  if (!newName) return notify('Enter a new username', 'error');
  if (newName === _editingUser) return notify('Username is the same', 'info');

  const users = getUsers();
  if (users[newName]) return notify('Username already taken', 'error');

  // Copy data under new key, delete old
  users[newName] = users[_editingUser];
  delete users[_editingUser];
  saveUsers(users);

  notify('Username changed: ' + _editingUser + ' → ' + newName, 'success');
  _editingUser = newName;
  const tag = document.getElementById('modal-current-user');
  const title = document.getElementById('modal-edit-title');
  if (tag) tag.textContent = '👤 ' + newName;
  if (title) title.textContent = 'Edit: ' + newName;
  renderAdminUsers();
  renderAdminStats();
}

function adminChangePassword() {
  if (!_editingUser) return;
  const newP = document.getElementById('modal-new-password').value;
  const confP = document.getElementById('modal-confirm-password').value;
  if (!newP) return notify('Enter a new password', 'error');
  if (newP !== confP) return notify('Passwords do not match', 'error');
  if (newP.length < 4) return notify('Password must be at least 4 characters', 'error');

  const users = getUsers();
  users[_editingUser].password = btoa(newP);
  saveUsers(users);

  document.getElementById('modal-new-password').value = '';
  document.getElementById('modal-confirm-password').value = '';
  notify('Password updated for ' + _editingUser, 'success');
}

function adminDeleteUser(username) {
  if (!confirm('Delete user "' + username + '" and ALL their data? This cannot be undone.')) return;
  const users = getUsers();
  delete users[username];
  saveUsers(users);
  notify('User "' + username + '" deleted', 'success');
  if (_editingUser === username) closeEditModal();
  renderAdminUsers();
  renderAdminStats();
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────
function openDashboard() {
  const u = getCurrentUser();
  if (!u) return;

  const users = getUsers();
  // Ensure user data structure exists
  if (!users[u]) {
    users[u] = { password: '', expenses: [], dailyBudgets: {} };
    saveUsers(users);
  }
  if (!users[u].expenses) users[u].expenses = [];
  if (!users[u].dailyBudgets) users[u].dailyBudgets = {};

  // Switch views
  hide(document.getElementById('auth-card'));
  show(document.getElementById('dashboard'));

  // Set greeting (desktop sidebar + mobile header)
  const greetEl = document.getElementById('greet');
  if (greetEl) greetEl.textContent = 'Hi, ' + u + ' 👋';
  const mobileGreetEl = document.getElementById('mobile-greet');
  if (mobileGreetEl) mobileGreetEl.textContent = 'Hi, ' + u;

  // Set today label
  const todayLabel = document.getElementById('today-label');
  if (todayLabel) {
    const d = new Date();
    todayLabel.textContent = d.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  renderExpenses();
  updateSummary();

}

// ─── Budget ────────────────────────────────────────────────────────────────────
function setBudget() {
  const v = parseFloat(document.getElementById('budget-input').value);
  if (isNaN(v) || v <= 0) return notify('Enter a valid amount', 'error');

  const dateInput = document.getElementById('budget-date');
  const today = new Date().toISOString().split('T')[0];
  const date = (dateInput && dateInput.value) ? dateInput.value : today;

  const u = getCurrentUser();
  const users = getUsers();
  if (!users[u].dailyBudgets) users[u].dailyBudgets = {};

  // ADD to existing budget instead of overwriting
  const existing = users[u].dailyBudgets[date] || 0;
  const newTotal = existing + v;
  users[u].dailyBudgets[date] = newTotal;
  saveUsers(users);

  // Update hint
  const hint = document.getElementById('budget-existing-hint');
  if (hint) {
    if (existing > 0) {
      hint.textContent = '✅ Added ₹' + v.toFixed(2) + ' → Total budget for ' + date + ': ₹' + newTotal.toFixed(2);
    } else {
      hint.textContent = '✅ Budget of ₹' + newTotal.toFixed(2) + ' set for ' + date;
    }
  }

  document.getElementById('budget-input').value = '';
  localStorage.removeItem('de_resetDate');
  updateSummary();
  notify('Budget updated for ' + date + ': ₹' + newTotal.toFixed(2), 'success');
}

function onBudgetDateChange() {
  const dateInput = document.getElementById('budget-date');
  const date = dateInput ? dateInput.value : '';
  if (!date) return;
  const u = getCurrentUser();
  const users = getUsers();
  const existing = (users[u] && users[u].dailyBudgets && users[u].dailyBudgets[date]) || 0;
  const hint = document.getElementById('budget-existing-hint');
  const budgetInput = document.getElementById('budget-input');
  if (existing > 0) {
    if (hint) hint.textContent = '✏️ Existing budget for ' + date + ': ₹' + existing.toFixed(2) + ' (edit above to change)';
    if (budgetInput) budgetInput.value = existing;
  } else {
    if (hint) hint.textContent = 'No budget set for ' + date + ' yet.';
    if (budgetInput) budgetInput.value = '';
  }
  updateSummary();
}

function resetBudget() {
  const dateInput = document.getElementById('budget-date');
  const today = new Date().toISOString().split('T')[0];
  const date = (dateInput && dateInput.value) ? dateInput.value : today;
  if (!confirm('Clear budget for ' + date + '?')) return;
  const u = getCurrentUser();
  const users = getUsers();
  if (users[u].dailyBudgets) delete users[u].dailyBudgets[date];
  saveUsers(users);
  const hint = document.getElementById('budget-existing-hint');
  if (hint) hint.textContent = 'Budget cleared for ' + date;
  const budgetInput = document.getElementById('budget-input');
  if (budgetInput) budgetInput.value = '';
  if (date === today) localStorage.setItem('de_resetDate', today);
  updateSummary();
  notify('Budget cleared for ' + date, 'success');
}

// ─── Expenses ──────────────────────────────────────────────────────────────────
function addExpense() {
  const expDateInput = document.getElementById('exp-date');
  const today = new Date().toISOString().split('T')[0];
  const date = (expDateInput && expDateInput.value) ? expDateInput.value : today;

  const desc = document.getElementById('exp-desc').value.trim();
  const amt = parseFloat(document.getElementById('exp-amt').value);
  if (!desc) return notify('Enter a description', 'error');
  if (isNaN(amt) || amt <= 0) return notify('Enter a valid amount', 'error');

  const u = getCurrentUser();
  const users = getUsers();
  const entry = { id: Date.now(), desc, amt, date };
  users[u].expenses.push(entry);
  saveUsers(users);

  document.getElementById('exp-desc').value = '';
  document.getElementById('exp-amt').value = '';
  renderExpenses();
  updateSummary();
  notify('Expense added for ' + date, 'success');
}

function renderExpenses() {
  const u = getCurrentUser();
  if (!u) return;
  const users = getUsers();
  let items = (users[u] && users[u].expenses) ? users[u].expenses : [];

  // Apply date filter if set
  const filterInput = document.getElementById('filter-date');
  const filterDate = filterInput ? filterInput.value : '';
  if (filterDate) {
    items = items.filter(e => e.date === filterDate);
  }

  const list = document.getElementById('expenses-list');
  if (!list) return;

  list.innerHTML = '';

  // Update total
  const total = items.reduce((sum, e) => sum + e.amt, 0);
  const totalEl = document.getElementById('expenses-total-val');
  if (totalEl) totalEl.textContent = total.toFixed(2);

  if (items.length === 0) {
    const li = document.createElement('li');
    li.textContent = filterDate ? 'No expenses for ' + filterDate : 'No expenses yet';
    li.style.cssText = 'text-align:center;color:#64748b;padding:20px;border:none;background:transparent;';
    list.appendChild(li);
    return;
  }

  items.slice().reverse().forEach(it => {
    const li = document.createElement('li');
    li.innerHTML = `<div><div><strong>${it.desc}</strong></div><div class="expense-meta">${it.date} &bull; &#8377;${it.amt.toFixed(2)}</div></div><div><button data-id="${it.id}">Delete</button></div>`;
    list.appendChild(li);
    li.querySelector('button').addEventListener('click', () => deleteExpense(it.id));
  });
}


function deleteExpense(id) {
  const u = getCurrentUser();
  const users = getUsers();
  users[u].expenses = users[u].expenses.filter(e => e.id !== id);
  saveUsers(users);
  renderExpenses();
  updateSummary();
  notify('Deleted', 'success');
}

function updateSummary() {
  const u = getCurrentUser();
  if (!u) return;
  const users = getUsers();
  const data = users[u] || {};
  const today = new Date().toISOString().split('T')[0];
  const resetDate = localStorage.getItem('de_resetDate');

  // Use budget-date selection if available, else today
  const budgetDateInput = document.getElementById('budget-date');
  const selectedDate = (budgetDateInput && budgetDateInput.value) ? budgetDateInput.value : today;

  // Sync budget display from storage for selected date
  const bud = (data.dailyBudgets && data.dailyBudgets[selectedDate]) || 0;
  const budEl = document.getElementById('budget-val');
  if (budEl) budEl.textContent = bud.toFixed(2);

  // Spent = expenses on selected date
  let spent = 0;
  if (!(resetDate === selectedDate && selectedDate === today)) {
    spent = (data.expenses || []).filter(e => e.date === selectedDate).reduce((s, e) => s + e.amt, 0);
  }

  const spentEl = document.getElementById('spent-val');
  const remEl = document.getElementById('remaining-val');
  if (spentEl) spentEl.textContent = spent.toFixed(2);
  if (remEl) remEl.textContent = (bud - spent).toFixed(2);
}

function clearData() {
  if (!confirm('Clear all your expense data?')) return;
  const u = getCurrentUser();
  const users = getUsers();
  users[u].expenses = [];
  users[u].dailyBudgets = {};
  saveUsers(users);
  renderExpenses();
  updateSummary();
  document.getElementById('budget-val').textContent = '0.00';
  notify('Data cleared', 'success');
}

function resetToday() {
  if (!confirm('Reset today\'s data?')) return;
  const u = getCurrentUser();
  const users = getUsers();
  const today = new Date().toISOString().split('T')[0];
  if (users[u].dailyBudgets) delete users[u].dailyBudgets[today];
  users[u].expenses = (users[u].expenses || []).filter(e => e.date !== today);
  saveUsers(users);
  document.getElementById('budget-val').textContent = '0.00';
  renderExpenses();
  updateSummary();
  notify('Today\'s data reset', 'success');
}

// ─── Print / Export ────────────────────────────────────────────────────────────
function printBill() {
  const u = getCurrentUser(); if (!u) return;
  const users = getUsers(); const data = users[u] || { expenses: [] };
  let date = prompt('Enter date to print (YYYY-MM-DD)', new Date().toISOString().split('T')[0]);
  if (!date) return; date = date.trim();
  const filtered = data.expenses.filter(e => e.date === date);
  const totalSpent = filtered.reduce((s, e) => s + e.amt, 0);
  const bud = (data.dailyBudgets && data.dailyBudgets[date]) || 0;

  const rows = filtered.map(e => `<li style="padding:8px 0;border-bottom:1px solid #eee;display:flex;justify-content:space-between;"><span>${e.desc}</span><span>Rs.${e.amt.toFixed(2)}</span></li>`).join('');
  const html = `<!DOCTYPE html><html><head><title>Expense Bill</title><style>body{font-family:sans-serif;max-width:400px;margin:auto;padding:20px}h2{color:#6366f1}ul{list-style:none;padding:0}.total{font-weight:bold;font-size:18px;margin-top:16px}</style></head><body><h2>Daily Expense Report</h2><p>Date: ${date}</p><p>User: ${u}</p><ul>${rows || '<li>No expenses</li>'}</ul><p class="total">Total: Rs.${totalSpent.toFixed(2)}</p><p>Budget: Rs.${bud.toFixed(2)} | Remaining: Rs.${(bud - totalSpent).toFixed(2)}</p></body></html>`;
  const w = window.open('', '', 'width=500,height=700');
  w.document.write(html);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

function downloadCSV() {
  const u = getCurrentUser(); if (!u) return;
  const users = getUsers(); const data = users[u] || { expenses: [] };
  let date = prompt('Enter date to export (YYYY-MM-DD)', new Date().toISOString().split('T')[0]);
  if (!date) return; date = date.trim();
  const filtered = data.expenses.filter(e => e.date === date);
  let csv = 'Date,Description,Amount\n';
  filtered.forEach(e => { csv += `${e.date},"${e.desc}",${e.amt.toFixed(2)}\n`; });
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `expenses_${u}_${date}.csv`;
  a.click();
  notify('CSV downloaded', 'success');
}

function downloadPDF() {
  const u = getCurrentUser(); if (!u) return;
  const users = getUsers(); const data = users[u] || { expenses: [] };
  let date = prompt('Enter date for PDF (YYYY-MM-DD)', new Date().toISOString().split('T')[0]);
  if (!date) return; date = date.trim();
  const filtered = data.expenses.filter(e => e.date === date);
  const totalSpent = filtered.reduce((s, e) => s + e.amt, 0);
  const bud = (data.dailyBudgets && data.dailyBudgets[date]) || 0;
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
      doc.text('Rs.' + e.amt.toFixed(2), 180, y, { align: 'right' });
      y += 8;
      if (y > 270) { doc.addPage(); y = 20; }
    });
    y += 4;
    doc.setFontSize(11); doc.setTextColor(99, 102, 241);
    doc.text(`Total: Rs.${totalSpent.toFixed(2)}`, 20, y); y += 8;
    doc.text(`Budget: Rs.${bud.toFixed(2)} | Remaining: Rs.${(bud - totalSpent).toFixed(2)}`, 20, y);
    doc.save(`expenses_${u}_${date}.pdf`);
    notify('PDF downloaded', 'success');
  } catch (e) {
    notify('PDF error: ' + e.message, 'error');
  }
}

// ─── Calculator ────────────────────────────────────────────────────────────────
let calcInput = '';

function updateCalcDisplay() {
  const d = document.getElementById('calc-display');
  if (d) d.textContent = calcInput || '0';
}

function resetCalculator() {
  calcInput = '';
  updateCalcDisplay();
}

function appendToCalc(v) {
  const ops = ['+', '-', '*', '/'];
  if (ops.includes(v)) {
    if (!calcInput) return;
    if (ops.includes(calcInput.slice(-1))) return;
  }
  if (v === '.') {
    const lastOp = Math.max(calcInput.lastIndexOf('+'), calcInput.lastIndexOf('-'), calcInput.lastIndexOf('*'), calcInput.lastIndexOf('/'));
    const lastNum = calcInput.slice(lastOp + 1);
    if (lastNum.includes('.')) return;
  }
  calcInput += v;
  updateCalcDisplay();
}

function calculateResult() {
  if (!calcInput) return;
  try {
    let expr = calcInput.replace(/[+\-*/]+$/, '');
    const tokens = [];
    let num = '';
    for (const c of expr) {
      if (['+', '-', '*', '/'].includes(c)) {
        if (num) { tokens.push(parseFloat(num)); num = ''; }
        tokens.push(c);
      } else { num += c; }
    }
    if (num) tokens.push(parseFloat(num));
    // Multiply/divide first
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
  } catch (e) {
    notify('Invalid calculation', 'error');
    calcInput = '';
    updateCalcDisplay();
  }
}

// ─── Wire Up ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {

  // Auth navigation
  const showRegister = document.getElementById('show-register');
  const showLogin = document.getElementById('show-login');
  if (showRegister) showRegister.addEventListener('click', function () {
    hide(document.getElementById('login-form'));
    show(document.getElementById('register-form'));
    document.getElementById('auth-title').textContent = 'Create account';
    document.getElementById('auth-subtitle').textContent = 'Join SpendWise today';
  });
  if (showLogin) showLogin.addEventListener('click', function () {
    show(document.getElementById('login-form'));
    hide(document.getElementById('register-form'));
    document.getElementById('auth-title').textContent = 'Welcome back';
    document.getElementById('auth-subtitle').textContent = 'Sign in to your account';
  });

  // Login button
  const loginBtn = document.getElementById('login-btn');
  if (loginBtn) loginBtn.addEventListener('click', loginUser);

  // Register button
  const registerBtn = document.getElementById('register-btn');
  if (registerBtn) registerBtn.addEventListener('click', registerUser);

  // Enter key on login inputs
  const loginUsername = document.getElementById('login-username');
  const loginPassword = document.getElementById('login-password');
  if (loginUsername) loginUsername.addEventListener('keydown', function (e) { if (e.key === 'Enter') loginUser(); });
  if (loginPassword) loginPassword.addEventListener('keydown', function (e) { if (e.key === 'Enter') loginUser(); });

  // Enter key on register inputs
  const regUsername = document.getElementById('reg-username');
  const regPassword = document.getElementById('reg-password');
  if (regUsername) regUsername.addEventListener('keydown', function (e) { if (e.key === 'Enter') registerUser(); });
  if (regPassword) regPassword.addEventListener('keydown', function (e) { if (e.key === 'Enter') registerUser(); });

  // Dashboard buttons
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);

  // Mobile logout buttons
  const mobileLogoutBtn = document.getElementById('mobile-logout-btn');
  if (mobileLogoutBtn) mobileLogoutBtn.addEventListener('click', logoutUser);
  const adminMobileLogoutBtn = document.getElementById('admin-mobile-logout-btn');
  if (adminMobileLogoutBtn) adminMobileLogoutBtn.addEventListener('click', logoutUser);

  const setBudgetBtn = document.getElementById('set-budget');
  if (setBudgetBtn) setBudgetBtn.addEventListener('click', setBudget);

  const resetBudgetBtn = document.getElementById('reset-budget');
  if (resetBudgetBtn) resetBudgetBtn.addEventListener('click', resetBudget);

  const addExpenseBtn = document.getElementById('add-expense');
  if (addExpenseBtn) addExpenseBtn.addEventListener('click', addExpense);

  const clearDataBtn = document.getElementById('clear-data');
  if (clearDataBtn) clearDataBtn.addEventListener('click', clearData);

  const resetTodayBtn = document.getElementById('reset-today');
  if (resetTodayBtn) resetTodayBtn.addEventListener('click', resetToday);

  const printBillBtn = document.getElementById('print-bill');
  if (printBillBtn) printBillBtn.addEventListener('click', printBill);

  const downloadPdfBtn = document.getElementById('download-pdf');
  if (downloadPdfBtn) downloadPdfBtn.addEventListener('click', downloadPDF);

  const downloadCsvBtn = document.getElementById('download-csv');
  if (downloadCsvBtn) downloadCsvBtn.addEventListener('click', downloadCSV);

  // ── Role Toggle Buttons ──
  const roleUserBtn = document.getElementById('role-user');
  const roleAdminBtn = document.getElementById('role-admin');
  if (roleUserBtn) roleUserBtn.addEventListener('click', () => setRole('user'));
  if (roleAdminBtn) roleAdminBtn.addEventListener('click', () => setRole('admin'));

  // ── Admin Logout ──
  const adminLogoutBtn = document.getElementById('admin-logout-btn');
  if (adminLogoutBtn) adminLogoutBtn.addEventListener('click', logoutUser);


  // ── Admin Refresh ──
  const adminRefreshBtn = document.getElementById('admin-refresh');
  if (adminRefreshBtn) adminRefreshBtn.addEventListener('click', function () {
    renderAdminUsers();
    renderAdminStats();
    notify('Refreshed', 'success');
  });

  // ── Admin Tab Navigation ──
  document.querySelectorAll('[data-admin-tab]').forEach(function (item) {
    item.addEventListener('click', function () {
      document.querySelectorAll('[data-admin-tab]').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('#admin-dashboard .tab-panel').forEach(p => p.classList.remove('active'));
      item.classList.add('active');
      const panel = document.getElementById('admin-tab-' + item.dataset.adminTab);
      if (panel) panel.classList.add('active');
    });
  });

  // ── Edit Modal Buttons ──
  const modalCloseBtn = document.getElementById('modal-close-btn');
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeEditModal);

  // Close modal on overlay click
  const modalOverlay = document.getElementById('edit-user-modal');
  if (modalOverlay) modalOverlay.addEventListener('click', function (e) {
    if (e.target === modalOverlay) closeEditModal();
  });

  const modalSaveUsername = document.getElementById('modal-save-username');
  if (modalSaveUsername) modalSaveUsername.addEventListener('click', adminChangeUsername);

  const modalSavePassword = document.getElementById('modal-save-password');
  if (modalSavePassword) modalSavePassword.addEventListener('click', adminChangePassword);

  const modalDeleteUser = document.getElementById('modal-delete-user');
  if (modalDeleteUser) modalDeleteUser.addEventListener('click', function () {
    if (_editingUser) adminDeleteUser(_editingUser);
  });

  // ── User Tab Navigation (desktop sidebar + mobile bottom nav) ──
  function switchUserTab(tab) {
    document.querySelectorAll('.nav-item[data-tab]').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.mob-nav-item[data-tab]').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('#dashboard .tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll(`.nav-item[data-tab="${tab}"]`).forEach(n => n.classList.add('active'));
    document.querySelectorAll(`.mob-nav-item[data-tab="${tab}"]`).forEach(n => n.classList.add('active'));
    const panel = document.getElementById('tab-' + tab);
    if (panel) panel.classList.add('active');
  }

  document.querySelectorAll('.nav-item[data-tab]').forEach(function (item) {
    item.addEventListener('click', () => switchUserTab(item.dataset.tab));
  });
  document.querySelectorAll('.mob-nav-item[data-tab]').forEach(function (item) {
    item.addEventListener('click', () => switchUserTab(item.dataset.tab));
  });

  // ── Initialize date inputs to today ──
  const today = new Date().toISOString().split('T')[0];

  // Set today label
  const todayLabel = document.getElementById('today-label');
  if (todayLabel) {
    const d = new Date();
    todayLabel.textContent = d.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  const budgetDateInput = document.getElementById('budget-date');
  if (budgetDateInput) {
    budgetDateInput.value = today;
    budgetDateInput.addEventListener('change', onBudgetDateChange);
    onBudgetDateChange();
  }

  const expDateInput = document.getElementById('exp-date');
  if (expDateInput) expDateInput.value = today;

  const filterDateInput = document.getElementById('filter-date');
  if (filterDateInput) {
    filterDateInput.addEventListener('change', renderExpenses);
  }
  const filterClearBtn = document.getElementById('filter-clear');
  if (filterClearBtn) filterClearBtn.addEventListener('click', function () {
    if (filterDateInput) filterDateInput.value = '';
    renderExpenses();
  });

  // ── Calculator (new class names) ──
  document.querySelectorAll('.calc-btn-pro[data-value]').forEach(function (btn) {
    btn.addEventListener('click', function () { appendToCalc(btn.dataset.value); });
  });
  const calcEqual = document.getElementById('calc-equal');
  if (calcEqual) calcEqual.addEventListener('click', calculateResult);
  const calcClear = document.getElementById('calc-clear');
  if (calcClear) calcClear.addEventListener('click', resetCalculator);
  const calcBackspace = document.getElementById('calc-backspace');
  if (calcBackspace) calcBackspace.addEventListener('click', function () {
    calcInput = calcInput.slice(0, -1);
    updateCalcDisplay();
  });

  // ── Calculator Keyboard Support ──
  function flashCalcBtn(selector) {
    const btn = document.querySelector(selector);
    if (!btn) return;
    btn.classList.add('key-active');
    setTimeout(() => btn.classList.remove('key-active'), 120);
  }

  document.addEventListener('keydown', function (e) {
    // Only handle when not typing in an input/textarea
    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    const key = e.key;

    // Digits 0-9 (regular + numpad)
    if (/^[0-9]$/.test(key)) {
      appendToCalc(key);
      flashCalcBtn(`.calc-btn-pro[data-value="${key}"]`);
    }
    // Decimal
    else if (key === '.') {
      appendToCalc('.');
      flashCalcBtn('.calc-btn-pro[data-value="."]');
    }
    // Operators
    else if (key === '+') { appendToCalc('+'); flashCalcBtn('.calc-btn-pro[data-value="+"]'); }
    else if (key === '-') { appendToCalc('-'); flashCalcBtn('.calc-btn-pro[data-value="-"]'); }
    else if (key === '*') { appendToCalc('*'); flashCalcBtn('.calc-btn-pro[data-value="*"]'); }
    else if (key === '/') { e.preventDefault(); appendToCalc('/'); flashCalcBtn('.calc-btn-pro[data-value="/"]'); }
    else if (key === '%') { appendToCalc('%'); flashCalcBtn('.calc-btn-pro[data-value="%"]'); }
    // Enter or = → calculate
    else if (key === 'Enter' || key === '=') {
      e.preventDefault();
      calculateResult();
      flashCalcBtn('#calc-equal');
    }
    // Backspace
    else if (key === 'Backspace') {
      calcInput = calcInput.slice(0, -1);
      updateCalcDisplay();
      flashCalcBtn('#calc-backspace');
    }
    // Escape → clear
    else if (key === 'Escape') {
      resetCalculator();
      flashCalcBtn('#calc-clear');
    }
  });


  // ── Auto-login if session exists ──
  const cur = getCurrentUser();
  const role = getCurrentRole();
  if (cur) {
    if (role === 'admin' && cur === ADMIN_USER) {
      openAdminDashboard();
    } else {
      const users = getUsers();
      if (users[cur]) {
        openDashboard();
      } else {
        localStorage.removeItem(STORAGE_CURRENT);
        localStorage.removeItem(STORAGE_ROLE);
      }
    }
  }

});

