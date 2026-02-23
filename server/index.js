const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const app = express();
app.use(cors());
app.use(express.json());

function generateToken(user){
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req,res,next){
  const auth = req.headers.authorization;
  if(!auth) return res.status(401).json({ error: 'Missing token' });
  const parts = auth.split(' ');
  if(parts.length!==2) return res.status(401).json({ error: 'Invalid token' });
  const token = parts[1];
  try{
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data; next();
  }catch(e){ res.status(401).json({ error: 'Invalid token' }); }
}

// Register
app.post('/api/register', (req,res)=>{
  const { username, password } = req.body;
  if(!username || !password) return res.status(400).json({ error: 'Missing fields' });
  const hashed = bcrypt.hashSync(password, 8);
  const stmt = db.prepare('INSERT INTO users (username,password) VALUES (?,?)');
  stmt.run(username, hashed, function(err){
    if(err){ return res.status(400).json({ error: 'User exists or DB error' }); }
    const user = { id: this.lastID, username };
    const token = generateToken(user);
    res.json({ user, token });
  });
});

// Login
app.post('/api/login', (req,res)=>{
  const { username, password } = req.body;
  if(!username || !password) return res.status(400).json({ error: 'Missing fields' });
  db.get('SELECT id,username,password,budget FROM users WHERE username=?', [username], (err, row)=>{
    if(err || !row) return res.status(400).json({ error: 'Invalid credentials' });
    if(!bcrypt.compareSync(password, row.password)) return res.status(400).json({ error: 'Invalid credentials' });
    const user = { id: row.id, username: row.username };
    const token = generateToken(user);
    res.json({ user, token, budget: row.budget });
  });
});

// Protected: get profile (budget + expenses)
app.get('/api/profile', authMiddleware, (req,res)=>{
  const userId = req.user.id;
  db.get('SELECT id,username,budget FROM users WHERE id=?', [userId], (err,row)=>{
    if(err || !row) return res.status(404).json({ error: 'User not found' });
    db.all('SELECT id,description,amount,date FROM expenses WHERE user_id=? ORDER BY id DESC', [userId], (err2, rows)=>{
      res.json({ user: { id: row.id, username: row.username, budget: row.budget }, expenses: rows || [] });
    });
  });
});

// Set budget
app.post('/api/budget', authMiddleware, (req,res)=>{
  const userId = req.user.id; const { budget } = req.body;
  db.run('UPDATE users SET budget=? WHERE id=?', [budget || 0, userId], function(err){
    if(err) return res.status(500).json({ error: 'DB error' });
    res.json({ success: true });
  });
});

// Expenses CRUD
app.get('/api/expenses', authMiddleware, (req,res)=>{
  const userId = req.user.id;
  db.all('SELECT id,description,amount,date FROM expenses WHERE user_id=? ORDER BY id DESC', [userId], (err, rows)=>{
    if(err) return res.status(500).json({ error: 'DB error' });
    res.json({ expenses: rows || [] });
  });
});

app.post('/api/expenses', authMiddleware, (req,res)=>{
  const userId = req.user.id; const { description, amount, date } = req.body;
  if(!description || !(amount>0)) return res.status(400).json({ error: 'Invalid payload' });
  const stmt = db.prepare('INSERT INTO expenses (user_id,description,amount,date) VALUES (?,?,?,?)');
  stmt.run(userId, description, amount, date || new Date().toISOString().split('T')[0], function(err){
    if(err) return res.status(500).json({ error: 'DB error' });
    res.json({ id: this.lastID, description, amount, date });
  });
});

app.delete('/api/expenses/:id', authMiddleware, (req,res)=>{
  const userId = req.user.id; const id = parseInt(req.params.id);
  db.run('DELETE FROM expenses WHERE id=? AND user_id=?', [id, userId], function(err){
    if(err) return res.status(500).json({ error: 'DB error' });
    if(this.changes===0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, ()=>{ console.log('Server running on port', PORT); });
