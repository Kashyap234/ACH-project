# 🏦 ACH Payment & Positive Pay AI Triage System v3.0

Welcome to the **ACH Payment & Positive Pay AI Triage System**! 

This system is a state-of-the-art, enterprise-grade banking compliance and fraud-prevention application. It merges strict **NACHA rules-based validation** with a **generative AI Risk Engine** powered by Google Gemini to intelligently triage ACH transactions.

---

## 📊 Tech Stack Overview

| Category | Technology | Percentage |
|----------|-----------|-----------|
| **Primary** | JavaScript | 88.9% |
| **Styling** | CSS | 9.2% |
| **Database** | PL/pgSQL | 1.3% |
| **Other** | Miscellaneous | 0.6% |

### Frontend Stack
- **Framework:** React with Vite
- **Language:** TypeScript 6.0.2
- **Build Tool:** Vite 8.0.12
- **HTTP Client:** Axios 1.16.1
- **Routing:** React Router DOM 7.15.1
- **Markdown:** React Markdown 10.1.0
- **Development:** Hot Module Reloading (HMR)

### Backend Stack
- **Runtime:** Node.js (v18+)
- **Framework:** Express.js 4.18.3
- **AI Engine:** Google Generative AI 0.21.0
- **Authentication:** JWT (jsonwebtoken 9.0.3)
- **Encryption:** bcryptjs 3.0.3
- **Email:** Nodemailer 8.0.10
- **Database:** Supabase (Firebase Admin compatible)
- **Utilities:** 
  - UUID 9.0.1
  - CORS 2.8.5
  - dotenv 16.4.5
  - PptxGenJS 4.0.1 (Report generation)
  - docx 9.7.1 (Document generation)
- **Development:** Nodemon 3.1.0

### Database
- **Primary:** Supabase (PostgreSQL)
- **Schema:** PL/pgSQL for stored procedures and business logic
- **Data Storage:** File-based JSON fallback for development

---

## 📑 Table of Contents
1. [Repository Structure](#-repository-structure)
2. [System Architecture](#-system-architecture)
3. [Core Features & Functionality](#-core-features--functionality)
   - [NACHA Rules Validation](#1-nacha-rules-validation)
   - [AI Risk Engine & Learning Pipeline](#2-ai-risk-engine--learning-pipeline)
   - [Positive Pay & Issued Check Register](#3-positive-pay--issued-check-register)
   - [Account ACH Filters](#4-account-ach-filters)
   - [Role-Based User Management & SMTP](#5-role-based-user-management--smtp)
   - [Context-Aware AI Chatbot](#6-context-aware-ai-chatbot)
   - [Bulk Upload & Transaction Intake](#7-bulk-upload--transaction-intake)
   - [Analytics & Audit Logging](#8-analytics--audit-logging)
4. [Transaction Lifecycle](#-transaction-lifecycle-flow)
5. [User Guide & Workflows](#-user-guide--workflows)
6. [Setup & Installation](#-setup--installation)
7. [Frequently Asked Questions (FAQ)](#-frequently-asked-questions)

---

## 📁 Repository Structure

```
ACH-project/
├── backend/                          # Node.js/Express Backend
│   ├── server.js                     # Main Express application
│   ├── package.json                  # Backend dependencies
│   ├── database/                     # Database layer
│   ├── routes/                       # API route handlers
│   │   ├── auth.js                   # Authentication endpoints
│   │   ├── transactions.js           # Transaction CRUD operations
│   │   ├── analytics.js              # Analytics & metrics
│   │   ├── bulk.js                   # Bulk upload processing
│   │   ├── accounts.js               # Account management
│   │   ├── positivePayRegister.js    # Check register management
│   │   ├── exceptions.js             # Exception dashboard
│   │   └── chatbot.js                # AI chatbot interface
│   ├── services/                     # Core business logic
│   │   ├── aiTriage.js               # Gemini AI integration & risk scoring
│   │   ├── nacha Validator.js        # NACHA rules engine
│   │   ├── positivePayEngine.js      # Check validation logic
│   │   └── learningPipeline.js       # ML feedback system
│   ├── middleware/                   # Express middleware
│   │   └── auth.js                   # JWT verification & RBAC
│   ├── generate_demo_dataset.js      # Demo data generator
│   ├── generate_ppt.js               # PowerPoint report generation
│   ├── generate_transactions.js      # Transaction synthetic data
│   └── delete_*.js                   # Database cleanup utilities
│
├── frontend/                         # React + Vite Frontend
│   ├── src/                          # Source code
│   │   ├── components/               # React components
│   │   ├── pages/                    # Page components
│   │   ├── styles/                   # CSS stylesheets (9.2%)
│   │   ├── utils/                    # Utility functions
│   │   ├── services/                 # API service layer
│   │   └── App.tsx                   # Main app component
│   ├── public/                       # Static assets
│   ├── index.html                    # HTML entry point
│   ├── tsconfig.json                 # TypeScript configuration
│   ├── package.json                  # Frontend dependencies
│   └── vite.config.ts                # Vite configuration
│
├── README.md                         # This file
├── package.json                      # Root dependencies (docx)
└── generate_manual.js                # Documentation generator
```

---

## 🏗️ System Architecture

The application is split into a modern React frontend and a Node.js/Express backend, with Supabase as the persistent data layer.

```mermaid
graph TD
    subgraph Frontend ["React / Vite Frontend (TypeScript)"]
        UI["Interactive Dashboards"]
        Chat["Floating AI Chatbot"]
        UM["Admin User Management"]
    end

    subgraph Backend ["Node.js / Express Backend (JavaScript)"]
        API["Express API Routes"]
        Auth["JWT Authentication & RBAC"]
        ChatService["Gemini Chat Orchestrator"]
        
        subgraph CoreEngines ["Core Engines"]
            Rule["NACHA Rules Engine"]
            Risk["AI Risk Engine / Gemini 1.5"]
            PosPay["Positive Pay Engine"]
            Learn["Learning Feedback Pipeline"]
        end
    end

    subgraph Storage ["Data Persistence"]
        DB["Supabase PostgreSQL + PL/pgSQL"]
        Cache["JSON File Cache"]
    end

    UI -->|REST API calls| API
    Chat -->|Conversations & Commands| ChatService
    UM -->|User CRUD| Auth
    
    API --> Rule
    API --> Risk
    API --> PosPay
    
    Rule --> DB
    Risk --> DB
    PosPay --> DB
    Auth --> DB
    ChatService --> Risk
    Learn -.->|Updates Prompts| Risk
    DB <-->|Sync| Cache
```

---

## ✨ Core Features & Functionality

### 1. NACHA Rules Validation
Every transaction submitted to the system undergoes rigorous structural validation before the AI even sees it. This prevents the system from processing fundamentally invalid ACH files.
* **SEC Code Validation:** Ensures the transaction uses valid Standard Entry Class codes (e.g., `PPD` for consumer, `CCD` for corporate, `WEB` for online, `IAT` for international).
* **Routing Number Verification:** Executes the Mod-10 checksum algorithm to ensure the receiving bank's ABA routing number is mathematically valid.
* **Effective Date Constraints:** Validates that transactions are not advance-dated beyond the NACHA-allowed 5-day window. Transactions failing these rules are immediately rejected with standardized error codes.

### 2. AI Risk Engine & Learning Pipeline
Once a transaction passes basic structural rules, it is sent to the Gemini-powered AI Risk Engine.
* **Intelligent Risk Scoring:** The AI analyzes the amount, company history, account type, and SEC code to generate a Risk Score from `0` to `100`.
* **Risk Levels:**
  * **Level 1 (Low Risk):** Transactions are auto-approved, bypassing manual review.
  * **Level 2 (Medium Risk):** Flagged for manual review due to unusual patterns (e.g., high amount for a new vendor).
  * **Level 3 (High Risk):** Severely flagged. Immediate attention required.
* **AI Briefs:** The AI generates a human-readable summary explaining *why* it assigned the score, highlighting specific red flags (e.g., "Amount is 300% higher than historical average for this SEC code").
* **Continuous Learning Pipeline:** When a human reviewer overrides or confirms the AI's decision, the Learning Pipeline extracts the reasoning and saves it as a new "learned pattern." The AI uses this feedback to improve future scoring.

### 3. Positive Pay & Issued Check Register
Positive Pay is an automated fraud detection tool primarily used for corporate checks.
* **Check Register:** Companies upload a manifest of checks they have legitimately issued (Check Number, Account, Payee, Amount).
* **Match Processing:** When an incoming transaction claims to be cashing a check, the system compares it against the register.
* **Exception Generation:** If there is a discrepancy (Amount Mismatch, Payee Mismatch, or Duplicate Check), the transaction is blocked and sent to the **Exception Dashboard**.
* **Exception Handling:** A reviewer must manually investigate exceptions and choose to either `Pay` (override) or `Return` (reject) the item.

### 4. Account ACH Filters
Administrators can set specific rules for specific bank accounts to override standard logic.
* **Block All:** Completely freezes an account from receiving ACH debits.
* **Allow All:** Whitelists the account for all transactions.
* **Review All:** Forces every single transaction hitting this account into the manual review queue, regardless of how low the AI risk score is.

### 5. Role-Based User Management & SMTP
A strictly locked-down administrative portal handles user access. There is no public registration.
* **Four System Roles:**
  * `Admin`: Full system access, can create/delete users, can process CRUD on transactions.
  * `Supervisor`: Can review transactions and override decisions made by standard reviewers.
  * `Analyst`: View-only access to metrics, dashboards, and audit logs.
  * `Reviewer`: Standard operational role; can only approve or decline pending items in the queue.
* **Automated SMTP Provisioning:** When an Admin creates a new user, the system generates a secure, randomized password and emails it directly to the user using Nodemailer.
* **User Control:** Admins can instantly deactivate users to revoke login access or trigger password resets.

### 6. Context-Aware AI Chatbot
A floating AI assistant remains available on all screens, functioning as a system co-pilot.
* **Live Database Injection:** The chatbot is dynamically injected with the exact, up-to-the-second state of the database (total volume, pending counts, risk distributions, learned patterns).
* **Analytical Q&A:** You can ask complex questions like *"Why do we have so many Level 3 risks today?"* or *"What is our current auto-resolution rate?"*
* **Transaction Lookup:** Typing a transaction ID (e.g., `TXN-A1B2C3D4`) prompts the bot to fetch the complete record, including audit trails and AI risk briefs, and present it in the chat.
* **Conversational Approvals (Admins/Reviewers):** Instead of navigating to the queue, authorized users can simply type *"Approve TXN-12345"* or *"Reject TXN-98765"*. The bot interprets the intent, executes the action, and logs it.

### 7. Bulk Upload & Transaction Intake
* **Single Intake:** A detailed form for submitting manual, one-off ACH transfers.
* **Bulk Upload (JSON/CSV):** Allows operators to drag-and-drop a file containing hundreds of transactions. The system processes them in batch, running NACHA validation and AI scoring simultaneously.
* **Report Generation:** Exports transactions and analytics as PowerPoint presentations or Word documents using PptxGenJS and docx libraries.

### 8. Analytics & Audit Logging
* **Dashboard Analytics:** Visual representations of system health, risk distributions, daily processed volumes, and AI learning milestones.
* **Immutable Audit Trail:** A strict, chronological log of every event. It records user logins, transaction creations, human decisions, exception handling, and user management changes. You always know who did what and when.

---

## 🔄 Transaction Lifecycle Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Submitter
    participant Intake as API / Bulk Upload
    participant Rule as NACHA Rules Engine
    participant PosPay as Positive Pay Engine
    participant AI as AI Risk Engine (Gemini)
    participant DB as Database
    actor Reviewer as Human Reviewer
    
    User->>Intake: Submits Transaction(s)
    Intake->>Rule: Validate Format (SEC, Routing, Date)
    
    alt Fails NACHA Rules
        Rule-->>User: Immediate Hard Reject (Error Code)
    else Passes Rules
        Rule->>PosPay: Check against Account Filters & Check Register
        
        alt Filter = Block or Exception Found
            PosPay->>DB: Send to Exception Dashboard
        else Normal Processing
            PosPay->>AI: Request Risk Analysis
            AI->>AI: Evaluate Amounts, History, SEC
            AI-->>DB: Save TXN + Risk Score + AI Brief
            
            alt Risk Level 1 (Low Risk)
                DB->>DB: Auto-Approve (No human needed)
            else Risk Level 2 or 3 (Med/High Risk)
                DB->>Reviewer: Send to Review Queue
                Reviewer->>DB: Investigate & Approve/Decline
                DB->>AI: Send feedback to Learning Pipeline
            end
        end
    end
```

---

## 📖 User Guide & Workflows

### Scenario A: Provisioning a New Employee
1. Log in as an **Admin** (`kash234`).
2. Navigate to the **User Management** page via the sidebar.
3. Click **Create New User**.
4. Enter the employee's Name, Username, Email, and select their Role (e.g., `Reviewer`).
5. Click **Create User Account**.
6. The system generates a password and emails it to the employee. (If SMTP is offline, the password is shown securely on your screen to copy/paste).

### Scenario B: Reviewing Pending Transactions
1. Log in as a **Reviewer** or **Supervisor**.
2. Notice the red badge on the **Review Queue** in the sidebar. Click it.
3. You will see all Level 2 and Level 3 transactions.
4. Expand a transaction to read the **AI Review Brief**, which explains exactly why the AI flagged it (e.g., "First time seeing this routing number").
5. Review the audit history and risk flags.
6. Click **Approve** or **Decline**. Your decision is recorded in the Audit Log and fed back into the AI Learning Pipeline.

### Scenario C: Using the AI Chatbot to Manage Exceptions
1. Open the Chatbot in the bottom right corner.
2. Type: *"How many Positive Pay exceptions do we have?"*
3. The bot reads the live database and replies: *"There are currently 3 exceptions pending review."*
4. Type: *"Show me details for TXN-EXCEPT1"*
5. The bot fetches the specific record and displays the mismatch details.
6. If authorized, type: *"Reject TXN-EXCEPT1 because the payee doesn't match the register."*
7. The bot executes the rejection, updates the database, logs your reasoning, and confirms success.

---

## 🛠 Setup & Installation

### System Prerequisites
* **Node.js**: Version 18.x or higher.
* **Google Gemini API Key**: Required for the AI Risk Engine and Chatbot. Get one from [Google AI Studio](https://aistudio.google.com).
* **Supabase Project**: For PostgreSQL database with PL/pgSQL support.
* **SMTP Credentials**: Required for automated user credential emails (optional: Gmail App Password recommended).

### 1. Clone & Install
Open two terminal windows.

**Terminal 1 (Backend):**
```bash
cd backend
npm install
```

**Terminal 2 (Frontend):**
```bash
cd frontend
npm install
```

### 2. Environment Configuration
In the `backend/` directory, create or edit the `.env` file:

```env
# Core Settings
PORT=3001
GEMINI_API_KEY=your_actual_gemini_api_key_here

# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_role_key

# Firebase (optional)
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_PRIVATE_KEY=your_firebase_private_key
FIREBASE_CLIENT_EMAIL=your_firebase_client_email

# SMTP settings for User Management emails
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=your_email@gmail.com

# JWT Secret
JWT_SECRET=your_jwt_secret_key
```

### 3. Database Setup (Supabase)
1. Create tables according to your PL/pgSQL schema.
2. Set up Row-Level Security (RLS) policies if needed.
3. Test the connection with `npm run test:db` (if available).

### 4. Launch the Application

**Start the Backend (Terminal 1):**
```bash
npm run dev
# or for production:
npm start
```
*You should see "✅ Gemini AI initialized" in the console.*

**Start the Frontend (Terminal 2):**
```bash
npm run dev
```

### 5. First Login
Open your browser to `http://localhost:5173`.
* **Default Admin Username:** `kash234`
* **Default Admin Password:** *(Set via environment or database seed)*

---

## ❓ Frequently Asked Questions (FAQ)

**Q: What happens if the Gemini API goes down?**
A: The system possesses a robust fallback mechanism. If the LLM fails to respond, transactions are temporarily scored using a secondary fallback heuristic (e.g., all transactions over $5,000 default to Level 2 for review).

**Q: Can a Reviewer create a transaction?**
A: No. Due to strict Role-Based Access Control, only `Admin` users can manually create, update, or delete transactions via the CRUD endpoints. Reviewers and Analysts are restricted to reading data.

**Q: How does the AI "Learn"?**
A: Every time a human overrides an AI decision (e.g., AI said "High Risk", Human says "Approve"), the `learningPipeline.js` logs the event. Once enough similar events occur, the system generates a new learned pattern and injects it into the Gemini prompt context.

**Q: What is a Positive Pay Exception?**
A: If a company uploads a list of checks they wrote (the Register), and a bank tries to cash a check that isn't on that list—or the amount is wrong—that is an Exception. It immediately halts processing and requires manual investigation.

**Q: Can I export transaction data?**
A: Yes! The system supports bulk export to PowerPoint (.pptx), Word (.docx), and standard JSON formats. Use the **Analytics Dashboard** or **Bulk Export** page.

**Q: Is the database Supabase, Firebase, or PostgreSQL?**
A: The primary production database is **Supabase** (PostgreSQL 15+), which includes PL/pgSQL for stored procedures. The system also supports Firebase for real-time features. Development can use file-based JSON.

**Q: What languages make up this codebase?**
A: **JavaScript 88.9%** (backend, frontend utilities), **CSS 9.2%** (styling), **PL/pgSQL 1.3%** (database), **Other 0.6%** (config files, etc.).

**Q: Why is my Create User modal transparent/glassy?**
A: This was a known issue fixed in v3.0! Ensure your `index.css` correctly uses `var(--bg-card)` for the `.um-premium-modal` class to ensure solid, opaque modals.

**Q: How do I generate demo data?**
A: Run `node backend/generate_demo_dataset.js` to populate sample transactions and learn patterns.

**Q: Can I customize the AI prompt?**
A: Yes! Modify the system prompt in `backend/services/aiTriage.js` to adjust risk scoring behavior.

---

## 📦 Key Dependencies Summary

### Backend
- **Express.js 4.18.3** — RESTful API framework
- **Google Generative AI 0.21.0** — Gemini integration
- **Supabase JS 2.108.1** — Database client
- **Firebase Admin 14.0.0** — Cloud functions & auth
- **Nodemailer 8.0.10** — Email notifications
- **PptxGenJS 4.0.1** — PowerPoint report generation
- **bcryptjs 3.0.3** — Password hashing

### Frontend
- **React** + **TypeScript** — UI framework with type safety
- **Vite 8.0.12** — Fast build tool
- **Axios 1.16.1** — HTTP client
- **React Router DOM 7.15.1** — Client-side routing
- **React Markdown 10.1.0** — Render markdown in UI

---

## 🔐 Security & Compliance

- **JWT-based Authentication:** Stateless, scalable user sessions.
- **Role-Based Access Control (RBAC):** Four distinct roles with granular permissions.
- **NACHA Compliance:** Full validation of ACH standards.
- **Audit Trail:** Immutable logging of all actions.
- **Password Hashing:** bcryptjs with salt rounds.
- **CORS Protection:** Whitelisted origins only.

---

## 🚀 Deployment

For production deployment, consider:
1. **Environment Variables:** Ensure all secrets are set via secure environment management.
2. **Database:** Use Supabase or a managed PostgreSQL service.
3. **API Server:** Deploy backend to Heroku, AWS, DigitalOcean, or Vercel.
4. **Frontend:** Deploy to Vercel, Netlify, or S3 + CloudFront.
5. **SSL/TLS:** Enforce HTTPS on all endpoints.
6. **Rate Limiting:** Implement rate limits on API endpoints.

---

*Developed for advanced, AI-driven financial compliance and operational security. v3.0*

*Last Updated: June 14, 2026*
