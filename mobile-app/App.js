import React, {useEffect, useState} from 'react';
import { SafeAreaView, View, Text, TextInput, Button, FlatList, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const USERS_KEY = 'de_users_v1';

export default function App(){
  const [user, setUser] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [budget, setBudget] = useState('');
  const [desc, setDesc] = useState('');
  const [amt, setAmt] = useState('');
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(false);
  const API_URL = 'http://10.0.2.2:4000'; // use 10.0.2.2 for Android emulator; use localhost in other setups
  const USE_SERVER = true;

  // token key
  const TOKEN_KEY = 'de_token';

  useEffect(()=>{ (async()=>{ const cur = await AsyncStorage.getItem('de_currentUser'); const token = await AsyncStorage.getItem(TOKEN_KEY);
    if(cur){ if(USE_SERVER && token){ await loadUser(cur, token); } else { loadUser(cur); } }
  })(); },[]);

  async function getUsers(){ const raw = await AsyncStorage.getItem(USERS_KEY); return raw?JSON.parse(raw):{}; }
  async function saveUsers(u){ await AsyncStorage.setItem(USERS_KEY, JSON.stringify(u)); }

  async function register(){ if(!username||!password) return Alert.alert('Enter credentials');
    setLoading(true);
    if(USE_SERVER){ try{
      const r = await fetch(`${API_URL}/api/register`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username, password }) });
      const j = await r.json(); if(r.ok){ Alert.alert('Account created'); setUsername(''); setPassword(''); } else { Alert.alert(j.error || 'Register failed'); }
    }catch(e){ Alert.alert('Network error'); }
    setLoading(false); return; }
    const users = await getUsers(); if(users[username]){ setLoading(false); return Alert.alert('User exists'); }
    users[username]={password:btoa(password),budget:0,expenses:[]}; await saveUsers(users); setLoading(false); Alert.alert('Account created'); }

  async function login(){ if(!username||!password) return Alert.alert('Enter credentials');
    setLoading(true);
    if(USE_SERVER){ try{
      const r = await fetch(`${API_URL}/api/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ username, password }) });
      const j = await r.json(); if(!r.ok){ setLoading(false); return Alert.alert(j.error || 'Login failed'); }
      await AsyncStorage.setItem('de_currentUser', username); await AsyncStorage.setItem(TOKEN_KEY, j.token);
      await loadUser(username, j.token);
      setUsername(''); setPassword('');
    }catch(e){ Alert.alert('Network error'); }
    setLoading(false); return;
  }
    const users = await getUsers(); if(!users[username]||users[username].password!==btoa(password)){ setLoading(false); return Alert.alert('Invalid credentials'); }
    await AsyncStorage.setItem('de_currentUser', username); loadUser(username); setLoading(false); }

  async function loadUser(u, token=null){ if(USE_SERVER && token){ try{ const r = await fetch(`${API_URL}/api/profile`, { headers:{ Authorization:`Bearer ${token}` } }); const j = await r.json(); if(r.ok){ setUser(u); setExpenses(j.expenses||[]); setBudget(String(j.user.budget||0)); } else { Alert.alert('Session invalid'); await AsyncStorage.removeItem(TOKEN_KEY); await AsyncStorage.removeItem('de_currentUser'); }
    }catch(e){ Alert.alert('Network error'); }
    return; }
    const users = await getUsers(); setUser(u); setExpenses(users[u].expenses||[]); setBudget(String(users[u].budget||0)); }

  async function addExpense(){ if(!desc||!(parseFloat(amt)>0)) return Alert.alert('Enter valid description and amount');
    setLoading(true);
    if(USE_SERVER){ const token = await AsyncStorage.getItem(TOKEN_KEY); try{ const r = await fetch(`${API_URL}/api/expenses`, { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify({ description:desc, amount:parseFloat(amt) }) }); const j = await r.json(); if(r.ok){ setExpenses(prev=>[j,...prev]); setDesc(''); setAmt(''); notifyMobile('Expense added'); } else { Alert.alert(j.error||'Add failed'); } }catch(e){ Alert.alert('Network error'); } setLoading(false); return; }
    const users=await getUsers(); const e={id:Date.now(),desc,amt:parseFloat(amt),date:new Date().toISOString().split('T')[0]}; users[user].expenses.push(e); await saveUsers(users); setExpenses([...users[user].expenses]); setDesc(''); setAmt(''); setLoading(false); }

  async function setBudgetValue(){ const v=parseFloat(budget); if(!(v>0)) return Alert.alert('Enter valid budget'); setLoading(true);
    if(USE_SERVER){ const token = await AsyncStorage.getItem(TOKEN_KEY); try{ const r = await fetch(`${API_URL}/api/budget`, { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:JSON.stringify({ budget:v }) }); if(r.ok) { Alert.alert('Budget set'); } else { const j=await r.json(); Alert.alert(j.error||'Failed'); } }catch(e){ Alert.alert('Network error'); } setLoading(false); return; }
    const users=await getUsers(); users[user].budget=v; await saveUsers(users); setLoading(false); Alert.alert('Budget set'); }

  async function logout(){ await AsyncStorage.removeItem('de_currentUser'); await AsyncStorage.removeItem(TOKEN_KEY); setUser(null); setUsername(''); setPassword(''); setExpenses([]); }

  function currency(n){ return `₹${Number(n||0).toFixed(2)}`; }

  function todaySpent(){ const today = new Date().toISOString().split('T')[0]; return expenses.filter(e=>e.date===today).reduce((s,e)=>s + (e.amount||e.amt||0),0); }

  function notifyMobile(msg){ Alert.alert(msg); }

  if(!user) return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Daily Expense</Text>
      <TextInput placeholder="Username" value={username} onChangeText={setUsername} style={styles.input} autoCapitalize='none' />
      <TextInput placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry style={styles.input} />
      <View style={styles.rowActions}>
        <TouchableOpacity style={styles.btnPrimary} onPress={login} disabled={loading}>{loading? <ActivityIndicator color="#fff"/> : <Text style={styles.btnText}>Login</Text>}</TouchableOpacity>
        <TouchableOpacity style={styles.btnGhost} onPress={register} disabled={loading}>{loading? <ActivityIndicator /> : <Text style={styles.ghostText}>Register</Text>}</TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={{padding:16}}>
      <View style={styles.headerRow}><Text style={styles.title}>Hi, {user}</Text><TouchableOpacity onPress={logout}><Text style={styles.logout}>Logout</Text></TouchableOpacity></View>

      <View style={styles.card}>
        <Text style={styles.label}>Daily Budget</Text>
        <View style={styles.rowActions}>
          <TextInput placeholder="Enter amount" value={budget} onChangeText={setBudget} keyboardType="numeric" style={[styles.input, {flex:1}]} />
          <TouchableOpacity style={styles.btnSmall} onPress={setBudgetValue} disabled={loading}><Text style={styles.btnText}>Set</Text></TouchableOpacity>
        </View>
        <View style={styles.metricsRow}>
          <View style={styles.metric}><Text style={styles.metricLabel}>Budget</Text><Text style={styles.metricValue}>{currency(budget)}</Text></View>
          <View style={styles.metric}><Text style={styles.metricLabel}>Spent</Text><Text style={styles.metricValue}>{currency(todaySpent())}</Text></View>
          <View style={styles.metric}><Text style={styles.metricLabel}>Remaining</Text><Text style={[styles.metricValue, {color: (Number(budget||0)-todaySpent())<0 ? '#ef4444':'#065f46'}]}>{currency(Number(budget||0)-todaySpent())}</Text></View>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Add Expense</Text>
        <TextInput placeholder="Description" value={desc} onChangeText={setDesc} style={styles.input} />
        <TextInput placeholder="Amount" value={amt} onChangeText={setAmt} keyboardType="numeric" style={styles.input} />
        <TouchableOpacity style={styles.btnPrimary} onPress={addExpense} disabled={loading}><Text style={styles.btnText}>{loading? '...' : 'Add Expense'}</Text></TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={[styles.label, {marginBottom:8}]}>Expenses</Text>
        {expenses.length===0? <Text style={{color:'#6b7280'}}>No expenses yet</Text> : (
          <FlatList data={[...expenses]} keyExtractor={i=>String(i.id)} renderItem={({item})=> (
            <View style={styles.row}><View><Text style={{fontWeight:'600'}}>{item.description||item.desc}</Text><Text style={{color:'#6b7280'}}>{item.date} • {currency(item.amount||item.amt)}</Text></View>
            <TouchableOpacity onPress={async()=>{ if(!confirmDelete()) return; if(USE_SERVER){ const token = await AsyncStorage.getItem(TOKEN_KEY); try{ const r = await fetch(`${API_URL}/api/expenses/${item.id}`, { method:'DELETE', headers:{ Authorization:`Bearer ${token}` } }); if(r.ok){ setExpenses(prev=>prev.filter(p=>p.id!==item.id)); notifyMobile('Deleted'); } else { const j=await r.json(); Alert.alert(j.error||'Delete failed'); } }catch(e){ Alert.alert('Network error'); } } else { const users=await getUsers(); users[user].expenses = users[user].expenses.filter(e=>e.id!==item.id); await saveUsers(users); setExpenses(users[user].expenses); } }}><Text style={{color:'#ef4444'}}>Delete</Text></TouchableOpacity>
            </View>
          )} />
        )}
      </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function confirmDelete(){ return confirm('Delete this expense?'); }

const styles = StyleSheet.create({
  container:{flex:1,padding:16,backgroundColor:'#fcfcff'},
  title:{fontSize:20,fontWeight:'700',marginBottom:12,color:'#4f46e5'},
  input:{padding:12,borderRadius:10,backgroundColor:'#fff',borderWidth:1,borderColor:'#eef2ff',marginBottom:10},
  row:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',padding:10,backgroundColor:'#fff',borderRadius:8,marginTop:8},
  card:{backgroundColor:'#fff',padding:12,borderRadius:12,marginBottom:12,shadowColor:'#000',shadowOpacity:0.03,shadowRadius:6},
  label:{fontWeight:'700',marginBottom:8},
  btnPrimary:{backgroundColor:'#4f46e5',paddingVertical:10,paddingHorizontal:14,borderRadius:10,alignItems:'center',justifyContent:'center'},
  btnSmall:{backgroundColor:'#4f46e5',paddingVertical:8,paddingHorizontal:12,borderRadius:8,alignItems:'center',justifyContent:'center'},
  btnText:{color:'#fff',fontWeight:'700'},
  btnGhost:{borderWidth:1,borderColor:'#e6e9f2',paddingVertical:10,paddingHorizontal:14,borderRadius:10,alignItems:'center',justifyContent:'center'},
  ghostText:{color:'#374151'},
  rowActions:{flexDirection:'row',gap:8,alignItems:'center'},
  headerRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8},
  logout:{color:'#6b7280'},
  metricsRow:{flexDirection:'row',justifyContent:'space-between',marginTop:12},
  metric:{alignItems:'center'},
  metricLabel:{color:'#6b7280'},
  metricValue:{fontWeight:'700',marginTop:4}
});
