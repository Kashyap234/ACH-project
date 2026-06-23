// frontend/src/api/client.js
// CHANGE: Added infoRequestsApi and portalApi for MIR feature.
// All existing exports preserved exactly — new exports are ADDITIVE only.
import axios from 'axios';

const API = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api', timeout: 60000 });

// Attach JWT token from localStorage to every request
API.interceptors.request.use(c => {
  c.headers['Content-Type'] = 'application/json';
  const token = localStorage.getItem('ach_token');
  if (token) c.headers['Authorization'] = `Bearer ${token}`;
  return c;
});

API.interceptors.response.use(r => r.data, e => Promise.reject(new Error(e.response?.data?.error || e.message)));

// ── Existing exports (UNCHANGED) ──────────────────────────────────────────────
export const transactionsApi = {
  getAll:       (params = {})           => API.get('/transactions', { params }),
  getById:      (id)                    => API.get(`/transactions/${id}`),
  create:       (data)                  => API.post('/transactions', data),
  decide:       (id, decision, review)  => API.post(`/transactions/${id}/decision`, { decision, ...review }),
  returnCodes:  ()                      => API.get('/transactions/meta/return-codes'),
};

export const analyticsApi = {
  dashboard: () => API.get('/analytics/dashboard'),
  trends:    (days = 7) => API.get('/analytics/trends', { params: { days } }),
  rules:     () => API.get('/analytics/rules'),
  patterns:  () => API.get('/analytics/patterns'),
  audit:     (params = {}) => API.get('/analytics/audit', { params }),
};

export const bulkApi = {
  upload:   (data) => API.post('/bulk/upload', data),
  getJob:   (id)   => API.get(`/bulk/jobs/${id}`),
  listJobs: ()     => API.get('/bulk/jobs'),
};

export const accountsApi = {
  getAll:              ()              => API.get('/accounts'),
  getById:             (id)           => API.get(`/accounts/${id}`),
  update:              (id, data)     => API.put(`/accounts/${id}`, data),
  addToWhitelist:      (id, data)     => API.post(`/accounts/${id}/whitelist`, data),
  removeFromWhitelist: (id, cid)      => API.delete(`/accounts/${id}/whitelist/${cid}`),
};

export const checkRegisterApi = {
  getAll:    (accountId, params = {}) => API.get(`/check-register/${accountId}`, { params }),
  addCheck:  (accountId, data)        => API.post(`/check-register/${accountId}`, data),
  bulkUpload:(accountId, csv_text)    => API.post(`/check-register/${accountId}/bulk`, { csv_text }),
  matchCheck:(accountId, data)        => API.post(`/check-register/${accountId}/match`, data),
  voidCheck: (accountId, checkId, reason) => API.put(`/check-register/${accountId}/${checkId}/void`, { reason }),
};

export const exceptionsApi = {
  getAll:        (params = {})         => API.get('/exceptions', { params }),
  decide:        (txnId, dec, reason)  => API.post(`/exceptions/${txnId}/decide`, { decision: dec, reason }),
  applyDefaults: ()                    => API.post('/exceptions/apply-defaults'),
};

export const healthApi = { check: () => API.get('/health') };

export const chatbotApi = {
  sendMessage:      (message, history = [], session_id = null) => API.post('/chatbot/message', { message, history, session_id }),
  getContext:       ()                        => API.get('/chatbot/context'),
  crud:             (operation, transaction_id, data = {}) => API.post('/chatbot/crud', { operation, transaction_id, data }),
  decision:         (transaction_id, action, notes = '')   => API.post('/chatbot/decision', { transaction_id, action, notes }),
  manage:           (operation, data = {})                 => API.post('/chatbot/manage', { operation, data }),
  // Session persistence
  getSessions:      ()         => API.get('/chatbot/sessions'),
  createSession:    ()         => API.post('/chatbot/sessions'),
  deleteSession:    (id)       => API.delete(`/chatbot/sessions/${id}`),
  getSessionMsgs:   (id)       => API.get(`/chatbot/sessions/${id}/messages`),
  saveSessionMsgs:  (id, msgs) => API.post(`/chatbot/sessions/${id}/messages`, { messages: msgs }),
};

export const authApi = {
  login:          (data)       => API.post('/auth/login', data),
  me:             ()           => API.get('/auth/me'),
  createUser:     (data)       => API.post('/auth/create-user', data),
  listUsers:      ()           => API.get('/auth/users'),
  updateUser:     (id, data)   => API.patch('/auth/users/' + id, data),
  deleteUser:     (id)         => API.delete('/auth/users/' + id),
  changePassword: (data)       => API.post('/auth/change-password', data),
};

// ── NEW: MIR Info Requests (admin-authenticated) ──────────────────────────────
export const infoRequestsApi = {
  // Create a new info request for a transaction (admin only)
  createRequest: (txnId, data) =>
    API.post(`/transactions/${txnId}/request-info`, data),
  // List all info request rounds for a transaction
  listRequests: (txnId) =>
    API.get(`/transactions/${txnId}/info-requests`),
};

// ── NEW: Originator Portal (public, token-scoped — no auth header needed) ─────
// These calls deliberately bypass the JWT interceptor by using a separate
// axios instance with no Authorization header.
const PORTAL_API = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api',
  timeout: 30000,
});
PORTAL_API.interceptors.request.use(c => {
  c.headers['Content-Type'] = 'application/json';
  // Explicitly NO Authorization header — originator portal is public
  return c;
});
PORTAL_API.interceptors.response.use(r => r.data, e => Promise.reject(new Error(e.response?.data?.error || e.message)));

export const portalApi = {
  // Fetch the safe transaction summary + question for a given token
  getRequest: (token)                  => PORTAL_API.get(`/portal/${token}`),
  // Submit the originator's response
  respond:    (token, data)            => PORTAL_API.post(`/portal/${token}/respond`, data),
};

export default API;