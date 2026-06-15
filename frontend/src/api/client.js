// frontend/src/api/client.js
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
  getAll:          ()              => API.get('/accounts'),
  getById:         (id)           => API.get(`/accounts/${id}`),
  update:          (id, data)     => API.put(`/accounts/${id}`, data),
  addToWhitelist:  (id, data)     => API.post(`/accounts/${id}/whitelist`, data),
  removeFromWhitelist: (id, cid)  => API.delete(`/accounts/${id}/whitelist/${cid}`),
};

export const checkRegisterApi = {
  getAll:   (accountId, params = {}) => API.get(`/check-register/${accountId}`, { params }),
  addCheck: (accountId, data)        => API.post(`/check-register/${accountId}`, data),
  bulkUpload:(accountId, csv_text)   => API.post(`/check-register/${accountId}/bulk`, { csv_text }),
  matchCheck:(accountId, data)       => API.post(`/check-register/${accountId}/match`, data),
  voidCheck: (accountId, checkId, reason) => API.put(`/check-register/${accountId}/${checkId}/void`, { reason }),
};

export const exceptionsApi = {
  getAll:         (params = {})         => API.get('/exceptions', { params }),
  decide:         (txnId, dec, reason)  => API.post(`/exceptions/${txnId}/decide`, { decision: dec, reason }),
  applyDefaults:  ()                    => API.post('/exceptions/apply-defaults'),
};

export const healthApi = { check: () => API.get('/health') };

export const chatbotApi = {
  sendMessage: (message, history = []) => API.post('/chatbot/message', { message, history }),
  getContext:  ()                        => API.get('/chatbot/context'),
  crud:        (operation, transaction_id, data = {}) => API.post('/chatbot/crud', { operation, transaction_id, data }),
  decision:    (transaction_id, action, notes = '')   => API.post('/chatbot/decision', { transaction_id, action, notes }),
};

export const authApi = {
  login:          (data)       => API.post('/auth/login', data),
  me:             ()           => API.get('/auth/me'),
  // Admin-only
  createUser:     (data)       => API.post('/auth/create-user', data),
  listUsers:      ()           => API.get('/auth/users'),
  updateUser:     (id, data)   => API.patch('/auth/users/' + id, data),
  deleteUser:     (id)         => API.delete('/auth/users/' + id),
  // Any authenticated user
  changePassword: (data)       => API.post('/auth/change-password', data),
};

export default API;
