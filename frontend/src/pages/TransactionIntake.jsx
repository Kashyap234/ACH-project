// frontend/src/pages/TransactionIntake.jsx — Full NACHA field form
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { transactionsApi } from '../api/client';

const SEC_CODES = [
  { code:'PPD', label:'PPD – Prearranged Payment & Deposit (Consumer)' },
  { code:'CCD', label:'CCD – Corporate Credit or Debit' },
  { code:'WEB', label:'WEB – Internet-Initiated (higher risk)' },
  { code:'TEL', label:'TEL – Telephone-Initiated (higher risk)' },
  { code:'IAT', label:'IAT – International ACH (OFAC required)' },
  { code:'CTX', label:'CTX – Corporate Trade Exchange' },
  { code:'POS', label:'POS – Point-of-Sale Entry' },
  { code:'ARC', label:'ARC – Accounts Receivable Entry' },
  { code:'BOC', label:'BOC – Back Office Conversion' },
  { code:'CIE', label:'CIE – Customer Initiated Entry' },
];

const TX_CODES = [
  { code:'22', label:'22 – Checking Credit (Deposit)' },
  { code:'27', label:'27 – Checking Debit (Payment)' },
  { code:'32', label:'32 – Savings Credit (Deposit)' },
  { code:'37', label:'37 – Savings Debit (Payment)' },
  { code:'42', label:'42 – GL Account Credit' },
  { code:'47', label:'47 – GL Account Debit' },
  { code:'52', label:'52 – Loan Account Credit' },
  { code:'55', label:'55 – Loan Account Debit' },
];

const AUTH_TYPES = [
  { value:'PPD_WRITTEN', label:'PPD Written Authorization' },
  { value:'WEB_CLICK',   label:'WEB Click-through Agreement' },
  { value:'TEL_VERBAL',  label:'TEL Verbal Authorization (Recorded)' },
  { value:'CCD_SIGNED',  label:'CCD Signed Agreement' },
  { value:'CTX_EDI',     label:'CTX EDI Trading Partner Agreement' },
];

const QUICK_FILLS = [
  { label:'✅ PPD Payroll Credit', data:{ sec_code:'PPD', transaction_code:'22', company_name:'Acme Corp Payroll', company_id:'ACMECORP01', amount:'3250.00', transaction_type:'credit', account_number:'1234567890', routing_number:'021000021', account_type:'checking', entry_description:'PAYROLL', individual_name:'Jane Smith', authorization_type:'PPD_WRITTEN', odfi_routing:'021000021', company_entry_description:'PAYROLL' }},
  { label:'🟡 CCD Vendor Debit', data:{ sec_code:'CCD', transaction_code:'27', company_name:'GlobalTech LLC', company_id:'GTECH2024X', amount:'22000.00', transaction_type:'debit', account_number:'9876543210', routing_number:'071000013', account_type:'checking', entry_description:'VENDOR PMT', individual_name:'GlobalTech LLC', authorization_type:'CCD_SIGNED', odfi_routing:'071000013', company_entry_description:'VENDORPMT' }},
  { label:'🟡 WEB Online Purchase', data:{ sec_code:'WEB', transaction_code:'27', company_name:'QuickShop Online', company_id:'QSHOP09870', amount:'15000.00', transaction_type:'debit', account_number:'5512334455', routing_number:'122000247', account_type:'checking', entry_description:'PURCHASE', individual_name:'Robert Chen', authorization_type:'WEB_CLICK', odfi_routing:'122000247', company_entry_description:'PURCHASE' }},
  { label:'🔴 IAT International', data:{ sec_code:'IAT', transaction_code:'27', company_name:'Offshore Holdings Ltd', company_id:'OFFSHR0010', amount:'95000.00', transaction_type:'debit', account_number:'1112233445', routing_number:'026009593', account_type:'checking', entry_description:'INTL XFER', individual_name:'Offshore Holdings', iso_destination_country_code:'GB', originator_country:'US', receiver_country:'GB', odfi_routing:'026009593', company_entry_description:'INTLXFER' }},
  { label:'🔴 High-Value Round $', data:{ sec_code:'CCD', transaction_code:'27', company_name:'Suspect Corp Inc', company_id:'SUSPC12345', amount:'50000.00', transaction_type:'debit', account_number:'7788990011', routing_number:'111000025', account_type:'checking', entry_description:'TRANSFER', individual_name:'Suspect Corp', odfi_routing:'111000025', company_entry_description:'TRANSFER' }},
];

const defaultForm = {
  // Batch header
  service_class_code:'200', company_name:'', company_id:'', sec_code:'PPD',
  company_entry_description:'', company_descriptive_date:'', odfi_routing:'',
  batch_number:'1', originator_status_code:'1',
  // Entry detail
  transaction_code:'27', transaction_type:'debit', account_type:'checking',
  routing_number:'', account_number:'', dfi_account_number:'',
  amount:'', individual_name:'', individual_id_number:'',
  trace_number:'', discretionary_data:'', addenda_record_indicator:'0',
  effective_date: new Date().toISOString().split('T')[0],
  entry_description:'',
  // Compliance
  originator_email:'', authorization_type:'', ofac_screened:false, aml_flag:false, prenote:false,
  // Positive Pay
  is_positive_pay:false, check_serial_number:'', issued_check_amount:'', issued_check_date:'', payee_name:'',
  // IAT
  iso_destination_country_code:'', originator_country:'US', receiver_country:'',
  originator_street:'', originator_city:'', originator_state:'', originator_postal:'',
  // Addenda
  addenda_type_code:'', payment_related_info:'',
};

export default function TransactionIntake({ onSubmit }) {
  const [form, setForm] = useState(defaultForm);
  const [tab, setTab]   = useState('batch');
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState(null);
  const [errors, setErrors]   = useState({});
  const navigate = useNavigate();

  const set = (f, v) => { setForm(p => ({ ...p, [f]: v })); setErrors(e => ({ ...e, [f]: undefined })); };

  const validate = () => {
    const e = {};
    if (!form.company_name.trim()) e.company_name = 'Required';
    if (!form.company_id.trim())   e.company_id   = 'Required';
    if (!form.amount || isNaN(+form.amount) || +form.amount <= 0) e.amount = 'Valid amount required';
    if (!form.account_number.trim()) e.account_number = 'Required';
    if (!form.routing_number.trim() || !/^\d{9}$/.test(form.routing_number.replace(/\D/g,''))) e.routing_number = '9-digit ABA routing number required';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true); setResult(null);
    try {
      const payload = { ...form, amount: parseFloat(form.amount), dfi_account_number: form.dfi_account_number || form.account_number };
      const res = await transactionsApi.create(payload);
      setResult(res); onSubmit?.();
    } catch(err) { setResult({ success:false, error: err.message }); }
    finally { setLoading(false); }
  };

  const applyQuickFill = (data) => { setForm(f => ({ ...f, ...data })); setResult(null); setErrors({}); };

  const F = ({ label, field, type='text', hint, req, maxLen, children }) => (
    <div className="form-group">
      <label className="form-label">{label}{req&&<span className="required">*</span>}</label>
      {children || <input className={`form-input${errors[field]?' form-input-error':''}`} type={type} value={form[field]||''} onChange={e=>set(field,e.target.value)} maxLength={maxLen} />}
      {hint && <span className="form-hint">{hint}</span>}
      {errors[field] && <span className="form-error">{errors[field]}</span>}
    </div>
  );

  const tabs = [
    { id:'batch',  label:'📋 Batch Header'  },
    { id:'entry',  label:'📝 Entry Detail'  },
    { id:'compliance', label:'🔒 Compliance' },
    { id:'pp',     label:'🏦 Positive Pay'  },
    { id:'iat',    label:'🌍 IAT / Addenda' },
  ];

  return (
    <div>
      <div className="page-header">
        <h2>➕ Add ACH Transaction</h2>
        <p>Full NACHA-compliant entry — all record fields available · <a href="#" style={{color:'var(--accent-blue)'}} onClick={e=>{e.preventDefault();navigate('/bulk')}}>Switch to Bulk Upload →</a></p>
      </div>

      {/* Quick Fill */}
      <div className="card" style={{marginBottom:20}}>
        <div className="card-title">⚡ Quick Fill Scenarios</div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
          {QUICK_FILLS.map(q=>(
            <button key={q.label} className="btn btn-ghost btn-sm" onClick={()=>applyQuickFill(q.data)}>{q.label}</button>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={()=>{setForm(defaultForm);setResult(null);setErrors({});}}>🔄 Reset</button>
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="card" style={{marginBottom:20,borderColor:result.success?(result.data?.risk_level===1?'rgba(16,185,129,0.4)':result.data?.risk_level===3?'rgba(239,68,68,0.4)':'rgba(245,158,11,0.4)'):'rgba(239,68,68,0.4)'}}>
          {result.success ? (
            <>
              <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:12}}>
                <div style={{fontSize:'2rem'}}>{result.data?.status==='auto_approved'?'✅':'⚠️'}</div>
                <div>
                  <div style={{fontWeight:700,color:result.data?.risk_level===1?'var(--accent-green)':result.data?.risk_level===3?'var(--accent-red)':'var(--accent-yellow)'}}>{result.message}</div>
                  <div className="monospace" style={{fontSize:'0.75rem',color:'var(--text-muted)',marginTop:2}}>{result.data?.transaction_id}</div>
                </div>
              </div>
              <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:10}}>
                <span className={`risk-badge level-${result.data?.risk_level}`}>Level {result.data?.risk_level}</span>
                <span style={{fontSize:'0.8rem',color:'var(--text-secondary)'}}>Score: <strong>{result.data?.risk_score}/100</strong></span>
                <span className={`status-badge ${result.data?.status}`}>{result.data?.status?.replace('_',' ').toUpperCase()}</span>
              </div>
              {(result.data?.risk_flags||[]).map(f=>(
                <span key={f.rule_code} className={`flag-pill ${f.severity}`} style={{marginRight:6,marginBottom:4,display:'inline-flex'}}>{f.rule_name}</span>
              ))}
              <div style={{marginTop:12,display:'flex',gap:8}}>
                {result.data?.status==='under_review'&&<button className="btn btn-primary btn-sm" onClick={()=>navigate('/queue')}>→ Review Queue</button>}
                <button className="btn btn-ghost btn-sm" onClick={()=>{setForm(defaultForm);setResult(null);}}>Add Another</button>
              </div>
            </>
          ) : (
            <div style={{color:'var(--accent-red)'}}><strong>❌ Error:</strong> {result.error}</div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Section Tabs */}
        <div style={{display:'flex',gap:4,marginBottom:16,flexWrap:'wrap'}}>
          {tabs.map(t=>(
            <button key={t.id} type="button" className={`btn btn-sm ${tab===t.id?'btn-primary':'btn-ghost'}`} onClick={()=>setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        <div className="card">
          {/* BATCH HEADER */}
          {tab==='batch' && (
            <>
              <div className="card-title">📋 Batch Header (NACHA Record Type 5)</div>
              <div className="form-grid" style={{marginTop:16}}>
                <F label="Company Name" field="company_name" req hint="Originator name (16 chars max)" maxLen={16} />
                <F label="Company ID" field="company_id" req hint="Tax ID / EIN (10 chars)" maxLen={10} />
                <F label="SEC Entry Class Code" field="sec_code" req>
                  <select className="form-select" value={form.sec_code} onChange={e=>set('sec_code',e.target.value)}>
                    {SEC_CODES.map(s=><option key={s.code} value={s.code}>{s.label}</option>)}
                  </select>
                </F>
                <F label="Service Class Code" field="service_class_code">
                  <select className="form-select" value={form.service_class_code} onChange={e=>set('service_class_code',e.target.value)}>
                    <option value="200">200 – Mixed (Credits & Debits)</option>
                    <option value="220">220 – Credits Only</option>
                    <option value="225">225 – Debits Only</option>
                  </select>
                </F>
                <F label="Company Entry Description" field="company_entry_description" hint="10-char purpose (PAYROLL, VENDOR PMT…)" maxLen={10} />
                <F label="Company Descriptive Date" field="company_descriptive_date" hint="Optional label date (MMDDYY)" maxLen={6} />
                <F label="ODFI Routing Number" field="odfi_routing" hint="Originating bank routing (8 digits)" maxLen={9} />
                <F label="Batch Number" field="batch_number" hint="Sequential batch ID" maxLen={7} />
                <F label="Originator Status Code" field="originator_status_code">
                  <select className="form-select" value={form.originator_status_code} onChange={e=>set('originator_status_code',e.target.value)}>
                    <option value="1">1 – ODFI (Bank)</option>
                    <option value="2">2 – Federal Reserve</option>
                  </select>
                </F>
                <F label="Effective Entry Date" field="effective_date" type="date" req />
              </div>
            </>
          )}

          {/* ENTRY DETAIL */}
          {tab==='entry' && (
            <>
              <div className="card-title">📝 Entry Detail (NACHA Record Type 6)</div>
              <div className="form-grid" style={{marginTop:16}}>
                <F label="Transaction Code" field="transaction_code" req>
                  <select className="form-select" value={form.transaction_code} onChange={e=>{ const tc=e.target.value; set('transaction_code',tc); set('transaction_type',['22','32','42','52'].includes(tc)?'credit':'debit'); set('account_type',['22','23','27','28'].includes(tc)?'checking':['32','33','37','38'].includes(tc)?'savings':['42','47'].includes(tc)?'gl':'loan'); }}>
                    {TX_CODES.map(t=><option key={t.code} value={t.code}>{t.label}</option>)}
                  </select>
                </F>
                <F label="Transaction Type" field="transaction_type">
                  <select className="form-select" value={form.transaction_type} onChange={e=>set('transaction_type',e.target.value)}>
                    <option value="debit">Debit (pull funds)</option>
                    <option value="credit">Credit (push funds)</option>
                  </select>
                </F>
                <F label="Account Type" field="account_type">
                  <select className="form-select" value={form.account_type} onChange={e=>set('account_type',e.target.value)}>
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                    <option value="gl">General Ledger</option>
                    <option value="loan">Loan</option>
                  </select>
                </F>
                <F label="Amount (USD)" field="amount" type="number" req hint="&gt;$10K→L2 · &gt;$50K→L3 · Round $100→flag" />
                <F label="RDFI Routing Number" field="routing_number" req hint="9-digit ABA routing (Mod-10 validated)" maxLen={9} />
                <F label="DFI Account Number" field="account_number" req hint="Receiver account (17 chars max)" maxLen={17} />
                <F label="Individual Name / Receiver" field="individual_name" hint="22 chars max per NACHA spec" maxLen={22} />
                <F label="Individual Identification Number" field="individual_id_number" hint="Originator's internal reference ID (15 chars)" maxLen={15} />
                <F label="Trace Number" field="trace_number" hint="ODFI routing + 7-digit sequence (15 chars)" maxLen={15} />
                <F label="Entry Description" field="entry_description" hint="10-char purpose override" maxLen={10} />
                <F label="Discretionary Data" field="discretionary_data" hint="2-char internal field" maxLen={2} />
                <F label="Addenda Record Indicator" field="addenda_record_indicator">
                  <select className="form-select" value={form.addenda_record_indicator} onChange={e=>set('addenda_record_indicator',e.target.value)}>
                    <option value="0">0 – No addenda record</option>
                    <option value="1">1 – Addenda record follows</option>
                  </select>
                </F>
              </div>
            </>
          )}

          {/* COMPLIANCE */}
          {tab==='compliance' && (
            <>
              <div className="card-title">🔒 Compliance & Risk Fields</div>
              <div className="form-grid" style={{marginTop:16}}>
                <F label="Originator Email" field="originator_email" type="email" hint="Used by the bot to send MIR portal links during auto-approval workflows" />
                <F label="Authorization Type" field="authorization_type">
                  <select className="form-select" value={form.authorization_type||''} onChange={e=>set('authorization_type',e.target.value||null)}>
                    <option value="">-- Select authorization type --</option>
                    {AUTH_TYPES.map(a=><option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </F>
                <div className="form-group">
                  <label className="form-label">OFAC Screened</label>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'10px 14px',background:'var(--bg-primary)',borderRadius:'var(--radius-sm)',border:'1px solid var(--border)'}}>
                    <input type="checkbox" checked={form.ofac_screened} onChange={e=>set('ofac_screened',e.target.checked)} style={{width:16,height:16,accentColor:'var(--accent-blue)'}} />
                    <span style={{fontSize:'0.875rem'}}>Mark as OFAC screened (SDN/watchlist checked)</span>
                  </label>
                  <span className="form-hint">Required for IAT entries and high-value transactions</span>
                </div>
                <div className="form-group">
                  <label className="form-label">AML / BSA Flag</label>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'10px 14px',background:'var(--bg-primary)',borderRadius:'var(--radius-sm)',border:'1px solid var(--border)'}}>
                    <input type="checkbox" checked={form.aml_flag} onChange={e=>set('aml_flag',e.target.checked)} style={{width:16,height:16,accentColor:'var(--accent-red)'}} />
                    <span style={{fontSize:'0.875rem',color:form.aml_flag?'var(--accent-red)':'inherit'}}>Flag for AML / BSA review</span>
                  </label>
                </div>
                <div className="form-group">
                  <label className="form-label">Pre-Notification Entry</label>
                  <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'10px 14px',background:'var(--bg-primary)',borderRadius:'var(--radius-sm)',border:'1px solid var(--border)'}}>
                    <input type="checkbox" checked={form.prenote} onChange={e=>set('prenote',e.target.checked)} style={{width:16,height:16,accentColor:'var(--accent-yellow)'}} />
                    <span style={{fontSize:'0.875rem'}}>Zero-dollar pre-note (must precede first live entry by 3 banking days)</span>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* POSITIVE PAY */}
          {tab==='pp' && (
            <>
              <div className="card-title">🏦 Positive Pay / Check Fraud Prevention</div>
              <div className="form-grid" style={{marginTop:16}}>
                <div className="form-group full-width">
                  <label style={{display:'flex',alignItems:'center',gap:10,cursor:'pointer'}}>
                    <input type="checkbox" checked={form.is_positive_pay} onChange={e=>set('is_positive_pay',e.target.checked)} style={{width:16,height:16,accentColor:'var(--accent-blue)'}} />
                    <span className="form-label" style={{margin:0}}>Enable Positive Pay (check fraud prevention)</span>
                  </label>
                </div>
                {form.is_positive_pay && (<>
                  <F label="Check Serial Number" field="check_serial_number" hint="Check number from issued register" />
                  <F label="Payee Name" field="payee_name" hint="Name on the check" />
                  <F label="Issued Check Amount" field="issued_check_amount" type="number" hint="Amount on issued check register (for mismatch detection)" />
                  <F label="Issued Check Date" field="issued_check_date" type="date" hint="Date check was issued (>90 days = stale)" />
                  <F label="ACH Filter Type" field="ach_filter_type">
                    <select className="form-select" value={form.ach_filter_type||''} onChange={e=>set('ach_filter_type',e.target.value||null)}>
                      <option value="">None</option>
                      <option value="block_all">Block All ACH Debits</option>
                      <option value="allow_list">Allow List Only</option>
                      <option value="positive_pay">Positive Pay Filter</option>
                    </select>
                  </F>
                </>)}
              </div>
            </>
          )}

          {/* IAT / ADDENDA */}
          {tab==='iat' && (
            <>
              <div className="card-title">🌍 IAT Fields & Addenda (NACHA Record Type 7)</div>
              <div style={{marginBottom:12,padding:'10px 14px',background:'rgba(239,68,68,0.08)',borderRadius:'var(--radius-sm)',border:'1px solid rgba(239,68,68,0.2)',fontSize:'0.8rem',color:'var(--accent-red)'}}>
                ⚠️ IAT requires 7 mandatory addenda records, OFAC screening, and Bank Secrecy Act (BSA) Travel Rule compliance.
              </div>
              <div className="form-grid">
                <F label="ISO Destination Country Code" field="iso_destination_country_code" hint="2-char ISO (US, GB, IN, CN…)" maxLen={2} />
                <F label="Originator Country" field="originator_country" hint="2-char ISO country" maxLen={2} />
                <F label="Receiver Country" field="receiver_country" hint="2-char ISO country" maxLen={2} />
                <F label="Originator Street" field="originator_street" />
                <F label="Originator City" field="originator_city" />
                <F label="Originator State" field="originator_state" maxLen={2} />
                <F label="Originator Postal" field="originator_postal" maxLen={10} />
                <div className="form-group"><div style={{height:1}} /></div>
                <F label="Addenda Type Code" field="addenda_type_code" hint="05=CCD+/PPD+ · 10-18=IAT mandatory" maxLen={2}>
                  <select className="form-select" value={form.addenda_type_code||''} onChange={e=>set('addenda_type_code',e.target.value||null)}>
                    <option value="">None</option>
                    <option value="05">05 – Remittance Info (CCD+/PPD+)</option>
                    <option value="10">10 – IAT: Originator Info</option>
                    <option value="11">11 – IAT: Receiver Info</option>
                    <option value="12">12 – IAT: ODFI Info</option>
                    <option value="13">13 – IAT: RDFI Info</option>
                  </select>
                </F>
                <div className="form-group full-width">
                  <label className="form-label">Payment Related Information</label>
                  <textarea className="form-input" rows={3} style={{resize:'vertical'}} value={form.payment_related_info||''} onChange={e=>set('payment_related_info',e.target.value)} placeholder="Free-text addenda (max 80 chars for Type 05)" maxLength={80} />
                  <span className="form-hint">Addenda sequence number auto-assigned</span>
                </div>
              </div>
            </>
          )}

          <div style={{marginTop:24,display:'flex',gap:12,borderTop:'1px solid var(--border)',paddingTop:20}}>
            <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
              {loading ? <><div className="spinner" style={{width:18,height:18,borderWidth:2}}/>Processing…</> : '🚀 Submit for AI Triage'}
            </button>
            <button type="button" className="btn btn-ghost" onClick={()=>navigate('/bulk')}>📦 Switch to Bulk Upload</button>
            <button type="button" className="btn btn-ghost" onClick={()=>{setForm(defaultForm);setResult(null);setErrors({});}}>Clear</button>
          </div>
        </div>
      </form>
    </div>
  );
}
