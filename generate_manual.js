const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, PageBreak, LevelFormat, TabStopType,
  TabStopPosition, Header, Footer, TableOfContents
} = require('docx');
const fs = require('fs');

// ── Color palette ─────────────────────────────────────────────────────────────
const C = {
  blue: '1E3A5F',
  blueLight: '2563EB',
  blueBtn: 'EBF2FF',
  green: '059669',
  greenBtn: 'ECFDF5',
  red: 'DC2626',
  redBtn: 'FEF2F2',
  yellow: 'D97706',
  yellowBtn: 'FFFBEB',
  purple: '7C3AED',
  purpleBtn: 'F5F3FF',
  cyan: '0891B2',
  cyanBtn: 'ECFEFF',
  white: 'FFFFFF',
  gray100: 'F8FAFC',
  gray200: 'E2E8F0',
  gray400: '94A3B8',
  gray600: '475569',
  gray800: '1E293B',
  black: '000000',
};

// ── Border helpers ────────────────────────────────────────────────────────────
const border = (color = C.gray200) => ({ style: BorderStyle.SINGLE, size: 1, color });
const borders = (color = C.gray200) => ({ top: border(color), bottom: border(color), left: border(color), right: border(color) });
const noBorder = () => ({ style: BorderStyle.NONE, size: 0, color: 'FFFFFF' });
const noBorders = () => ({ top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder() });

// ── Text helpers ──────────────────────────────────────────────────────────────
const t = (text, opts = {}) => new TextRun({ text, font: 'Arial', ...opts });
const tb = (text, opts = {}) => t(text, { bold: true, ...opts });
const tc = (text, color, opts = {}) => t(text, { color, ...opts });
const code = (text) => new TextRun({ text, font: 'Courier New', size: 18, color: C.purple, shading: { fill: 'F3F0FF', type: ShadingType.CLEAR } });

// ── Paragraph helpers ─────────────────────────────────────────────────────────
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text, font: 'Arial', bold: true, size: 36, color: C.blue })] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, font: 'Arial', bold: true, size: 28, color: C.blue })] });
const h3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun({ text, font: 'Arial', bold: true, size: 24, color: C.blueLight })] });
const h4 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_4, children: [new TextRun({ text, font: 'Arial', bold: true, size: 22, color: C.gray800 })] });
const p = (...children) => new Paragraph({ children, spacing: { after: 120 } });
const pCenter = (...children) => new Paragraph({ children, alignment: AlignmentType.CENTER, spacing: { after: 120 } });
const sp = () => new Paragraph({ children: [t('')], spacing: { after: 80 } });
const pb = () => new Paragraph({ children: [new PageBreak()] });

// ── Bullet list ───────────────────────────────────────────────────────────────
const bullet = (text, level = 0) => new Paragraph({
  numbering: { reference: 'bullets', level },
  children: [t(text, { size: 22 })],
  spacing: { after: 60 },
});
const bulletBold = (label, rest) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  children: [tb(label, { size: 22 }), t(rest, { size: 22 })],
  spacing: { after: 60 },
});
const numbered = (text, level = 0) => new Paragraph({
  numbering: { reference: 'numbers', level },
  children: [t(text, { size: 22 })],
  spacing: { after: 60 },
});

// ── Colored box paragraph ─────────────────────────────────────────────────────
const boxPara = (text, fillColor, textColor = C.gray800) => new Paragraph({
  children: [t(text, { color: textColor, size: 21 })],
  spacing: { before: 80, after: 80 },
  indent: { left: 360, right: 360 },
  shading: { fill: fillColor, type: ShadingType.CLEAR },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: C.blueLight } },
});

// ── Table helpers ─────────────────────────────────────────────────────────────
const cell = (children, w, opts = {}) => new TableCell({
  borders: borders(C.gray200),
  width: { size: w, type: WidthType.DXA },
  margins: { top: 80, bottom: 80, left: 120, right: 120 },
  shading: { fill: opts.fill || C.white, type: ShadingType.CLEAR },
  verticalAlign: VerticalAlign.TOP,
  children: Array.isArray(children) ? children : [new Paragraph({ children: Array.isArray(children) ? children : [children], spacing: { after: 0 } })],
});
const hcell = (text, w) => new TableCell({
  borders: borders(C.blue),
  width: { size: w, type: WidthType.DXA },
  margins: { top: 100, bottom: 100, left: 140, right: 140 },
  shading: { fill: C.blue, type: ShadingType.CLEAR },
  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [tb(text, { color: C.white, size: 20 })], spacing: { after: 0 } })],
});

const row = (cells) => new TableRow({ children: cells });
const hrow = (texts, widths) => new TableRow({ children: texts.map((t, i) => hcell(t, widths[i])), tableHeader: true });

// ── ASCII-art flow diagram rendered as a styled table ─────────────────────────
const flowBox = (label, color, fill) => new TableCell({
  width: { size: 1800, type: WidthType.DXA },
  borders: borders(color),
  margins: { top: 100, bottom: 100, left: 80, right: 80 },
  shading: { fill, type: ShadingType.CLEAR },
  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [tb(label, { color, size: 19 })], spacing: { after: 0 } })],
});
const arrow = () => new TableCell({
  width: { size: 240, type: WidthType.DXA },
  borders: noBorders(),
  margins: { top: 60, bottom: 60, left: 0, right: 0 },
  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t('\u2192', { bold: true, size: 26, color: C.gray600 })], spacing: { after: 0 } })],
});
const down = () => new TableCell({
  width: { size: 3600, type: WidthType.DXA },
  borders: noBorders(),
  margins: { top: 0, bottom: 0, left: 0, right: 0 },
  children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t('\u2193', { bold: true, size: 26, color: C.gray600 })], spacing: { after: 0 } })],
});
const flowTable = (rows, widths) => new Table({
  width: { size: 9360, type: WidthType.DXA },
  columnWidths: widths,
  rows,
  borders: noBorders(),
});

// ── Section divider ───────────────────────────────────────────────────────────
const divider = (label) => [
  sp(),
  new Paragraph({
    children: [
      new TextRun({ text: '  ' + label + '  ', font: 'Arial', bold: true, size: 22, color: C.white }),
    ],
    alignment: AlignmentType.LEFT,
    spacing: { before: 200, after: 200 },
    shading: { fill: C.blue, type: ShadingType.CLEAR },
    indent: { left: 0 },
  }),
  sp(),
];

// ── Badge span ────────────────────────────────────────────────────────────────
const badge = (label, fill, txtColor) => new TextRun({
  text: '  ' + label + '  ',
  font: 'Arial', bold: true, size: 19, color: txtColor || C.white,
  shading: { fill, type: ShadingType.CLEAR },
});

// =============================================================================
// DOCUMENT CONTENT
// =============================================================================

const children = [];

// ── COVER PAGE ──────────────────────────────────────────────────────────────
children.push(
  new Paragraph({ children: [t('')], spacing: { after: 1200 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [t('\uD83C\uDFE6 ACH Triage AI System', { font: 'Arial', bold: true, size: 60, color: C.blue })],
    spacing: { after: 240 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [t('Positive Pay \u00B7 NACHA Compliance \u00B7 AI-Powered Triage', { font: 'Arial', size: 30, color: C.gray600 })],
    spacing: { after: 120 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [t('Comprehensive User Manual \u2014 Version 3.0', { font: 'Arial', size: 28, color: C.blueLight })],
    spacing: { after: 800 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [t('Full NACHA Field Support \u00B7 Bulk Processing \u00B7 AI Learning Engine', { font: 'Arial', size: 22, color: C.gray600 })],
    spacing: { after: 120 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [t('Exception Dashboard \u00B7 Positive Pay Register \u00B7 Role-Based Access Control', { font: 'Arial', size: 22, color: C.gray600 })],
    spacing: { after: 1600 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [t('Prepared for: Banking Operations & Compliance Teams', { font: 'Arial', size: 22, color: C.gray800 })],
    spacing: { after: 120 },
  }),
  pb(),
);

// ── TABLE OF CONTENTS ───────────────────────────────────────────────────────
children.push(
  h1('Table of Contents'),
  sp(),
  ...([
    ['1', 'System Overview', 3],
    ['2', 'Architecture & Technology Stack', 4],
    ['3', 'Getting Started \u2014 First-Time Setup', 5],
    ['4', 'Authentication & User Roles', 6],
    ['5', 'Dashboard \u2014 Home Page', 8],
    ['6', 'Transaction Intake \u2014 Single Entry', 9],
    ['7', 'Bulk Upload \u2014 CSV, JSON & NACHA Files', 12],
    ['8', 'Risk Engine \u2014 How AI Scores Transactions', 14],
    ['9', 'Review Queue \u2014 Human Decision Workflow', 17],
    ['10', 'Exception Dashboard \u2014 Positive Pay Deadlines', 21],
    ['11', 'Account ACH Filter Settings', 23],
    ['12', 'Issued Check Register \u2014 Check Positive Pay', 25],
    ['13', 'AI Chatbot \u2014 Natural Language Interface', 27],
    ['14', 'Analytics & Reporting', 30],
    ['15', 'Audit Log', 31],
    ['16', 'User Management (Admin)', 32],
    ['17', 'AI Learning Engine \u2014 Pattern Promotion', 34],
    ['18', 'ACH Return Codes Reference', 36],
    ['19', 'NACHA Field Reference', 37],
    ['20', 'Troubleshooting & FAQ', 39],
    ['21', 'Security & Compliance Notes', 40],
    ['22', 'Glossary', 41],
  ].map(([num, title, pg]) =>
    new Paragraph({
      children: [
        tb(num + '. ', { size: 22, color: C.blueLight }),
        t(title, { size: 22 }),
        new TextRun({ text: '\t' + pg, font: 'Arial', size: 22, color: C.gray400 }),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: 9000, leader: TabStopType.DOT }],
      spacing: { after: 80 },
    })
  )),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 1 — SYSTEM OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('1. System Overview'),
  p(t('The ACH Payment & Positive Pay AI Triage System (version 3.0) is a full-stack banking application that automates the review, scoring, and approval of Automated Clearing House (ACH) transactions. It combines NACHA-standard rule processing with an AI-powered generative model to pre-screen transactions, present risk briefs to human reviewers, and continuously learn from human decisions to raise the auto-approval rate over time.', { size: 22 })),
  sp(),
  h2('1.1 What the System Does'),
  bulletBold('Ingests transactions ', 'individually or in bulk (CSV, JSON, NACHA .ach files).'),
  bulletBold('Scores every transaction ', 'against 25+ NACHA-compliant risk rules producing a 0–100 risk score and a Level 1/2/3 classification.'),
  bulletBold('Generates AI briefs ', 'using a large language model (Gemini) that summarizes risks in plain English for human reviewers.'),
  bulletBold('Auto-approves Level 1 ', 'transactions with zero human intervention and generates compliance notes for the audit record.'),
  bulletBold('Queues Level 2/3 ', 'transactions for human review with a pre-populated decision form covering identity, fraud indicators, business purpose, and return codes.'),
  bulletBold('Learns from decisions ', 'building a weighted pattern library; patterns that reach 85% approval confidence with 5+ decisions are auto-promoted to Level 1.'),
  bulletBold('Manages Positive Pay ', 'including a check register, payee matching, exception dashboard with countdown timers, and per-account ACH filter modes.'),
  sp(),
  h2('1.2 System Flow Diagram'),
  p(t('The diagram below illustrates the end-to-end transaction lifecycle from ingestion through final disposition:', { size: 22 })),
  sp(),
);

// Flow diagram (transaction lifecycle)
const flowW = [1400, 240, 1400, 240, 1400, 240, 1400, 240, 1400];
children.push(
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: flowW,
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideH: noBorder(), insideV: noBorder() },
    rows: [
      new TableRow({
        children: [
          flowBox('Transaction Ingested', C.blueLight, C.blueBtn),
          arrow(),
          flowBox('Risk Engine Scores (25 Rules)', C.yellow, C.yellowBtn),
          arrow(),
          flowBox('Level Assigned (1/2/3)', C.purple, C.purpleBtn),
          arrow(),
          flowBox('AI Brief Generated', C.cyan, C.cyanBtn),
          arrow(),
          flowBox('Auto-Approved or Queued', C.green, C.greenBtn),
        ]
      }),
    ],
  }),
  sp(),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1400, 240, 1400, 240, 1400, 240, 1400, 240, 1400],
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideH: noBorder(), insideV: noBorder() },
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: 1400, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ children: [t('')], spacing: { after: 0 } })] }),
          new TableCell({ width: { size: 240, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ children: [t('')], spacing: { after: 0 } })] }),
          new TableCell({ width: { size: 1400, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ children: [t('')], spacing: { after: 0 } })] }),
          new TableCell({ width: { size: 240, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ children: [t('')], spacing: { after: 0 } })] }),
          new TableCell({ width: { size: 1400, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t('\u2193', { bold: true, size: 26, color: C.gray600 })], spacing: { after: 0 } })] }),
          new TableCell({ width: { size: 240, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ children: [t('')], spacing: { after: 0 } })] }),
          new TableCell({ width: { size: 1400, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ children: [t('')], spacing: { after: 0 } })] }),
          new TableCell({ width: { size: 240, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ children: [t('')], spacing: { after: 0 } })] }),
          new TableCell({ width: { size: 1400, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ children: [t('')], spacing: { after: 0 } })] }),
        ]
      }),
    ],
  }),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: flowW,
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideH: noBorder(), insideV: noBorder() },
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: 1400, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ children: [t('')], spacing: { after: 0 } })] }),
          new TableCell({ width: { size: 240, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ children: [t('')], spacing: { after: 0 } })] }),
          new TableCell({ width: { size: 1400, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ children: [t('')], spacing: { after: 0 } })] }),
          new TableCell({ width: { size: 240, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ children: [t('')], spacing: { after: 0 } })] }),
          flowBox('Human Reviews Level 2/3', C.red, C.redBtn),
          arrow(),
          flowBox('Decision + Notes Captured', C.cyan, C.cyanBtn),
          arrow(),
          flowBox('AI Learning Pattern Updated', C.purple, C.purpleBtn),
        ]
      }),
    ],
  }),
  sp(),
  h2('1.3 Key Concepts'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2200, 7160],
    rows: [
      hrow(['Term', 'Explanation'], [2200, 7160]),
      row([cell([new Paragraph({ children: [tb('Level 1', { size: 22, color: C.green })], spacing: { after: 0 } })], 2200), cell([p(t('Low risk. Risk score < 30 and no flag above Level 1. AI auto-approves and generates compliance notes. Zero human touch required.', { size: 22 }))], 7160)]),
      row([cell([new Paragraph({ children: [tb('Level 2', { size: 22, color: C.yellow })], spacing: { after: 0 } })], 2200), cell([p(t('Medium risk. Risk score 30–69 or one Level-2 flag triggered. Queued for human review with full AI brief.', { size: 22 }))], 7160)]),
      row([cell([new Paragraph({ children: [tb('Level 3', { size: 22, color: C.red })], spacing: { after: 0 } })], 2200), cell([p(t('High risk. Risk score >= 70 or any Level-3 flag (OFAC hit, invalid routing, AML). Mandatory human review.', { size: 22 }))], 7160)]),
      row([cell([p(tb('NACHA', { size: 22 }))], 2200), cell([p(t('National Automated Clearing House Association \u2014 the rule-making body governing all ACH transactions in the United States.', { size: 22 }))], 7160)]),
      row([cell([p(tb('SEC Code', { size: 22 }))], 2200), cell([p(t('Standard Entry Class Code. Identifies the type of ACH transaction: PPD (consumer), CCD (corporate), WEB (internet), IAT (international), TEL (telephone), etc.', { size: 22 }))], 7160)]),
      row([cell([p(tb('Positive Pay', { size: 22 }))], 2200), cell([p(t('A fraud-prevention service where the bank cross-references each presented check or ACH debit against a pre-issued register. Mismatches are flagged as exceptions.', { size: 22 }))], 7160)]),
      row([cell([p(tb('OFAC', { size: 22 }))], 2200), cell([p(t('Office of Foreign Assets Control. Maintains the Specially Designated Nationals (SDN) list. All IAT and high-value transactions must be screened.', { size: 22 }))], 7160)]),
      row([cell([p(tb('Pattern Promotion', { size: 22 }))], 2200), cell([p(t('When the AI learning engine sees a transaction pattern 5+ times with >= 85% approval, it promotes that pattern to Level 1, removing it from the human queue.', { size: 22 }))], 7160)]),
    ],
  }),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 2 — ARCHITECTURE
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('2. Architecture & Technology Stack'),
  h2('2.1 High-Level Architecture Diagram'),
  sp(),
);

// Architecture diagram
const archW = [2800, 320, 2800, 320, 2800];
children.push(
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: archW,
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideH: noBorder(), insideV: noBorder() },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 2800, type: WidthType.DXA },
            borders: borders(C.blueLight),
            shading: { fill: C.blueBtn, type: ShadingType.CLEAR },
            margins: { top: 140, bottom: 140, left: 160, right: 160 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [tb('\uD83D\uDDA5\uFE0F FRONTEND', { color: C.blue, size: 22 })], spacing: { after: 60 } }),
              new Paragraph({ children: [t('React 18 + Vite', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('React Router v6', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('Axios HTTP Client', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('Context API (Auth)', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('ReactMarkdown', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('CSS Custom Properties', { size: 20 })], spacing: { after: 0 } }),
            ],
          }),
          new TableCell({ width: { size: 320, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t('\u21C4', { bold: true, size: 28, color: C.gray600 })], spacing: { after: 0 } })] }),
          new TableCell({
            width: { size: 2800, type: WidthType.DXA },
            borders: borders(C.green),
            shading: { fill: C.greenBtn, type: ShadingType.CLEAR },
            margins: { top: 140, bottom: 140, left: 160, right: 160 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [tb('\u2699\uFE0F BACKEND (Node.js)', { color: '0A5C36', size: 22 })], spacing: { after: 60 } }),
              new Paragraph({ children: [t('Express.js REST API', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('JWT Authentication', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('bcryptjs Password Hashing', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('CORS Middleware', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('JSON File Database (db.js)', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('uuid v4 ID Generation', { size: 20 })], spacing: { after: 0 } }),
            ],
          }),
          new TableCell({ width: { size: 320, type: WidthType.DXA }, borders: noBorders(), children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t('\u21C4', { bold: true, size: 28, color: C.gray600 })], spacing: { after: 0 } })] }),
          new TableCell({
            width: { size: 2800, type: WidthType.DXA },
            borders: borders(C.purple),
            shading: { fill: C.purpleBtn, type: ShadingType.CLEAR },
            margins: { top: 140, bottom: 140, left: 160, right: 160 },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, children: [tb('\uD83E\uDD16 AI SERVICES', { color: C.purple, size: 22 })], spacing: { after: 60 } }),
              new Paragraph({ children: [t('Google Gemini LLM', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('Risk Engine (25 Rules)', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('Learning Pipeline', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('NACHA Parser', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('AI Triage (Brief Gen)', { size: 20 })], spacing: { after: 40 } }),
              new Paragraph({ children: [t('Pattern Promotion Engine', { size: 20 })], spacing: { after: 0 } }),
            ],
          }),
        ]
      }),
    ],
  }),
  sp(),
  h2('2.2 Backend API Endpoints'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1600, 2800, 4960],
    rows: [
      hrow(['Method', 'Endpoint', 'Purpose'], [1600, 2800, 4960]),
      ...[
        ['POST', '/api/auth/login', 'Authenticate user, returns JWT token'],
        ['POST', '/api/auth/create-user', 'Admin: create new user account'],
        ['GET', '/api/auth/users', 'Admin: list all users'],
        ['PATCH', '/api/auth/users/:id', 'Admin: update user role/status'],
        ['DELETE', '/api/auth/users/:id', 'Admin: permanently delete user'],
        ['POST', '/api/auth/change-password', 'Any user: change own password'],
        ['GET', '/api/transactions', 'List transactions with optional filters'],
        ['GET', '/api/transactions/:id', 'Get single transaction with full detail'],
        ['POST', '/api/transactions', 'Submit new transaction for AI triage'],
        ['POST', '/api/transactions/:id/decision', 'Submit human approve/decline decision'],
        ['GET', '/api/transactions/meta/return-codes', 'Get R-code lookup table'],
        ['POST', '/api/bulk/upload', 'Upload CSV/JSON/NACHA batch'],
        ['GET', '/api/bulk/jobs/:id', 'Poll batch job status'],
        ['GET', '/api/analytics/dashboard', 'Dashboard KPI data'],
        ['GET', '/api/analytics/trends', 'Day-by-day transaction trends'],
        ['GET', '/api/analytics/rules', 'Risk rule trigger counts'],
        ['GET', '/api/analytics/patterns', 'AI learning patterns'],
        ['GET', '/api/analytics/audit', 'Audit log with pagination'],
        ['GET', '/api/accounts', 'List accounts with filter configs'],
        ['PUT', '/api/accounts/:id', 'Update account ACH filter mode'],
        ['POST', '/api/accounts/:id/whitelist', 'Add company to account allow list'],
        ['GET', '/api/exceptions', 'All pending pay/return exceptions'],
        ['POST', '/api/exceptions/:id/decide', 'Submit pay or return decision'],
        ['POST', '/api/exceptions/apply-defaults', 'Apply defaults to past-due exceptions'],
        ['GET', '/api/check-register/:accountId', 'Get issued check register'],
        ['POST', '/api/check-register/:accountId', 'Add single issued check'],
        ['POST', '/api/check-register/:accountId/bulk', 'Bulk upload check register CSV'],
        ['POST', '/api/check-register/:accountId/match', 'Match presented check vs register'],
        ['POST', '/api/chatbot/message', 'Send natural language message to AI'],
        ['POST', '/api/chatbot/decision', 'Direct approve/decline via chatbot'],
        ['POST', '/api/chatbot/crud', 'Admin CRUD operations via chatbot'],
        ['GET', '/api/health', 'Health check endpoint'],
      ].map(([method, ep, desc]) => row([
        cell([new Paragraph({ alignment: AlignmentType.CENTER, children: [badge(method, method === 'GET' ? C.green : method === 'POST' ? C.blueLight : method === 'PUT' || method === 'PATCH' ? C.yellow : C.red)], spacing: { after: 0 } })], 1600),
        cell([new Paragraph({ children: [code(ep)], spacing: { after: 0 } })], 2800),
        cell([p(t(desc, { size: 20 }))], 4960),
      ])),
    ],
  }),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 3 — GETTING STARTED
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('3. Getting Started \u2014 First-Time Setup'),
  h2('3.1 Prerequisites'),
  bulletBold('Node.js v18+ ', '(required for both frontend and backend)'),
  bulletBold('npm v9+ ', '(comes with Node.js)'),
  bulletBold('Git ', '(to clone the repository)'),
  bulletBold('Gemini API Key ', '(optional \u2014 without it the system runs in AI simulation mode)'),
  sp(),
  h2('3.2 Installation & Launch'),
  new Paragraph({
    children: [tb('Step 1: Install backend dependencies', { color: C.blue, size: 22 })],
    spacing: { before: 120, after: 60 },
    shading: { fill: C.gray100, type: ShadingType.CLEAR },
    indent: { left: 360 },
  }),
  new Paragraph({ children: [code('cd backend && npm install')], spacing: { after: 120 }, indent: { left: 720 } }),
  new Paragraph({
    children: [tb('Step 2: Configure environment', { color: C.blue, size: 22 })],
    spacing: { before: 120, after: 60 },
    shading: { fill: C.gray100, type: ShadingType.CLEAR },
    indent: { left: 360 },
  }),
  p(t('Create a file named ', { size: 22 }), code('.env'), t(' in the backend/ folder:', { size: 22 })),
  new Paragraph({ children: [code('GEMINI_API_KEY=your-key-here')], spacing: { after: 60 }, indent: { left: 720 } }),
  new Paragraph({ children: [code('JWT_SECRET=your-long-random-string')], spacing: { after: 120 }, indent: { left: 720 } }),
  new Paragraph({
    children: [tb('Step 3: Start the backend server', { color: C.blue, size: 22 })],
    spacing: { before: 120, after: 60 },
    shading: { fill: C.gray100, type: ShadingType.CLEAR },
    indent: { left: 360 },
  }),
  new Paragraph({ children: [code('node backend/server.js')], spacing: { after: 120 }, indent: { left: 720 } }),
  p(t('The server starts on port 3001. First run auto-seeds 25 NACHA risk rules and 33 ACH return codes.', { size: 22 })),
  new Paragraph({
    children: [tb('Step 4: Install and start the frontend', { color: C.blue, size: 22 })],
    spacing: { before: 120, after: 60 },
    shading: { fill: C.gray100, type: ShadingType.CLEAR },
    indent: { left: 360 },
  }),
  new Paragraph({ children: [code('cd frontend && npm install && npm run dev')], spacing: { after: 120 }, indent: { left: 720 } }),
  p(t('The React app opens at http://localhost:5173', { size: 22 })),
  new Paragraph({
    children: [tb('Step 5: Create the first admin user', { color: C.blue, size: 22 })],
    spacing: { before: 120, after: 60 },
    shading: { fill: C.gray100, type: ShadingType.CLEAR },
    indent: { left: 360 },
  }),
  p(t('The first user must be created by posting directly to the API (before any user exists, the auth check is bypassed for this one call). Use the command below, then use those credentials to log in and create additional users from the User Management page.', { size: 22 })),
  new Paragraph({ children: [code('curl -X POST http://localhost:3001/api/auth/create-user \\')], spacing: { after: 0 }, indent: { left: 720 } }),
  new Paragraph({ children: [code('  -H "Content-Type: application/json" \\')], spacing: { after: 0 }, indent: { left: 720 } }),
  new Paragraph({ children: [code('  -d \'{"username":"admin","full_name":"Admin","email":"admin@bank.com","role":"admin"}\'')], spacing: { after: 120 }, indent: { left: 720 } }),
  sp(),
  boxPara('NOTE: The system auto-seeds 4 demo accounts (Operating, Payroll, Tax Reserve, Vendor Payments) on the first API call to /api/accounts.', C.blueBtn, C.blue),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 4 — AUTH & ROLES
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('4. Authentication & User Roles'),
  h2('4.1 Login'),
  p(t('Navigate to http://localhost:5173/login. Enter your username and password. On success a JWT token is stored in localStorage and you are redirected to the Dashboard. Sessions expire after 12 hours; you will be redirected to the login page automatically.', { size: 22 })),
  sp(),
  h2('4.2 Role Definitions'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1600, 1800, 5960],
    rows: [
      hrow(['Role', 'Access Level', 'Capabilities'], [1600, 1800, 5960]),
      row([
        cell([new Paragraph({ children: [badge('REVIEWER', C.blueLight)], spacing: { after: 0 } })], 1600),
        cell([p(tb('Standard', { size: 22 }))], 1800),
        cell([p(t('View dashboard, submit transactions, review and approve/decline Level 2 and 3 transactions in the Review Queue, manage exceptions, and use the chatbot.', { size: 22 }))], 5960),
      ]),
      row([
        cell([new Paragraph({ children: [badge('ANALYST', '0891B2')], spacing: { after: 0 } })], 1600),
        cell([p(tb('Read + Review', { size: 22 }))], 1800),
        cell([p(t('All Reviewer capabilities plus full access to Analytics, Audit Log, and bulk upload workflows.', { size: 22 }))], 5960),
      ]),
      row([
        cell([new Paragraph({ children: [badge('SUPERVISOR', C.purple)], spacing: { after: 0 } })], 1600),
        cell([p(tb('Elevated', { size: 22 }))], 1800),
        cell([p(t('All Analyst capabilities. Can override AI risk levels and apply exception defaults.', { size: 22 }))], 5960),
      ]),
      row([
        cell([new Paragraph({ children: [badge('ADMIN', C.red)], spacing: { after: 0 } })], 1600),
        cell([p(tb('Full System', { size: 22 }))], 1800),
        cell([p(t('All capabilities. Exclusive access to User Management. Can create, edit, deactivate, and delete users. Can also use chatbot CRUD to create/update/delete transactions directly.', { size: 22 }))], 5960),
      ]),
    ],
  }),
  sp(),
  h2('4.3 JWT Token Security'),
  bulletBold('Token format: ', 'Bearer JWT stored in browser localStorage.'),
  bulletBold('Expiry: ', '12 hours. Re-login required after expiry.'),
  bulletBold('Payload: ', 'Contains user_id, username, full_name, role, email.'),
  bulletBold('Secret: ', 'Configured via the JWT_SECRET environment variable. Default is insecure \u2014 always set a strong secret in production.'),
  sp(),
  h2('4.4 Password Management'),
  bullet('Passwords are hashed with bcryptjs (12 salt rounds) before storage.'),
  bullet('Admins generate a random secure password when creating new users.'),
  bullet('If SMTP is configured, credentials are emailed to the user. Otherwise they appear in the server console.'),
  bullet('Any user can change their own password from the sidebar after login.'),
  bullet('Admins can force-reset any user\'s password from the User Management page.'),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 5 — DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('5. Dashboard \u2014 Home Page'),
  p(t('The Dashboard is the first page you see after login. It refreshes automatically every 20 seconds with live data from the backend.', { size: 22 })),
  sp(),
  h2('5.1 KPI Stat Cards'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3120, 3120, 3120],
    rows: [
      hrow(['Card', 'Metric', 'What to Watch'], [3120, 3120, 3120]),
      row([cell([p(tb('Total Transactions', { size: 22 }))], 3120), cell([p(t('Count + total dollar value', { size: 22 }))], 3120), cell([p(t('Growing daily volume indicates system health.', { size: 22 }))], 3120)]),
      row([cell([p(tb('Auto-Approved (AI)', { size: 22 }))], 3120), cell([p(t('Count + zero-touch rate %', { size: 22 }))], 3120), cell([p(t('Higher % = AI is learning well. Target >70%.', { size: 22 }))], 3120)]),
      row([cell([p(tb('Pending Review', { size: 22 }))], 3120), cell([p(t('Count of under_review transactions', { size: 22 }))], 3120), cell([p(t('Should trend down as AI learns. Spikes = new risk patterns.', { size: 22 }))], 3120)]),
      row([cell([p(tb('Declined', { size: 22 }))], 3120), cell([p(t('Count of human-declined', { size: 22 }))], 3120), cell([p(t('Track fraud catch rate over time.', { size: 22 }))], 3120)]),
      row([cell([p(tb('Avg Risk Score', { size: 22 }))], 3120), cell([p(t('Mean score 0\u2013100 across all transactions', { size: 22 }))], 3120), cell([p(t('Should be stable. Sharp increase = fraud wave.', { size: 22 }))], 3120)]),
      row([cell([p(tb('Patterns Promoted', { size: 22 }))], 3120), cell([p(t('AI patterns now at auto-approve', { size: 22 }))], 3120), cell([p(t('Grows as reviewers make decisions. Drives automation.', { size: 22 }))], 3120)]),
    ],
  }),
  sp(),
  h2('5.2 Risk Donut Chart'),
  p(t('The donut chart shows what percentage of all transactions fall into each risk level. Green = Level 1 (auto), Amber = Level 2 (medium), Red = Level 3 (high). A healthy system has a large green slice.', { size: 22 })),
  sp(),
  h2('5.3 AI Learning Status'),
  p(t('Shows the total patterns learned, how many have been promoted to auto-approve, total human decisions used for training, and the promotion rate. The system requires a minimum of 5 decisions per pattern and 85% weighted approval confidence before promotion.', { size: 22 })),
  sp(),
  h2('5.4 Recent Activity Feed'),
  p(t("Shows the 10 most recent audit events in real time. Each entry shows the event type, the actor (AI or a named reviewer), the company, and the dollar amount. Click 'Refresh' to force an immediate reload.", { size: 22 })),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 6 — TRANSACTION INTAKE
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('6. Transaction Intake \u2014 Single Entry'),
  p(t("The Transaction Intake page allows you to submit a single ACH transaction for immediate AI triage. It supports the full set of NACHA record fields spread across five tabbed sections. This is ideal for testing, manual override, or submitting one-off transactions.", { size: 22 })),
  sp(),
  h2('6.1 Quick Fill Scenarios'),
  p(t('Five pre-built scenarios load realistic data instantly for testing or demo purposes:', { size: 22 })),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2400, 1800, 5160],
    rows: [
      hrow(['Scenario', 'Expected Level', 'Why'], [2400, 1800, 5160]),
      row([cell([p(tb('\u2705 PPD Payroll Credit', { size: 22 }))], 2400), cell([new Paragraph({ children: [badge('Level 1', '059669')], spacing: { after: 0 } })], 1800), cell([p(t('Standard payroll credit with valid routing, known company, moderate amount.', { size: 22 }))], 5160)]),
      row([cell([p(tb('\uD83D\uDFE1 CCD Vendor Debit', { size: 22 }))], 2400), cell([new Paragraph({ children: [badge('Level 2', C.yellow, C.gray800)], spacing: { after: 0 } })], 1800), cell([p(t('$22,000 CCD debit triggers AMT_002 (high value $10K\u2013$50K) and possibly AMT_003 (round dollar).', { size: 22 }))], 5160)]),
      row([cell([p(tb('\uD83D\uDFE1 WEB Online Purchase', { size: 22 }))], 2400), cell([new Paragraph({ children: [badge('Level 2', C.yellow, C.gray800)], spacing: { after: 0 } })], 1800), cell([p(t('$15,000 WEB debit triggers SEC_003 (WEB annual audit requirement) and high-value flag.', { size: 22 }))], 5160)]),
      row([cell([p(tb('\uD83D\uDD34 IAT International', { size: 22 }))], 2400), cell([new Paragraph({ children: [badge('Level 3', C.red)], spacing: { after: 0 } })], 1800), cell([p(t('IAT code triggers SEC_001, OFC_001 (OFAC screening required), TMG checks \u2014 always Level 3.', { size: 22 }))], 5160)]),
      row([cell([p(tb('\uD83D\uDD34 High-Value Round $', { size: 22 }))], 2400), cell([new Paragraph({ children: [badge('Level 3', C.red)], spacing: { after: 0 } })], 1800), cell([p(t('$50,000 exact round amount triggers AMT_001 + AMT_003 combination pushing score above 70.', { size: 22 }))], 5160)]),
    ],
  }),
  sp(),
  h2('6.2 Form Sections'),
  h3('Tab 1: Batch Header (NACHA Record Type 5)'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2800, 2000, 4560],
    rows: [
      hrow(['Field', 'Required', 'Notes'], [2800, 2000, 4560]),
      ...([
        ['Company Name', 'YES', 'Originator name, 16 characters maximum per NACHA spec.'],
        ['Company ID', 'YES', '10-character originator ID, typically tax EIN with leading zero.'],
        ['SEC Entry Class Code', 'YES', 'Dropdown: PPD, CCD, WEB, TEL, IAT, CTX, POS, ARC, BOC, CIE.'],
        ['Service Class Code', 'NO', '200=Mixed, 220=Credits only, 225=Debits only.'],
        ['Company Entry Description', 'NO', '10-character purpose label (PAYROLL, VENDORPMT, etc.).'],
        ['Effective Entry Date', 'YES', 'YYYY-MM-DD. Must be within 5 banking days. Past dates fail.'],
        ['ODFI Routing Number', 'NO', '8-digit originating bank routing.'],
        ['Batch Number', 'NO', 'Sequential batch identifier.'],
      ].map(([f, req, note]) => row([
        cell([p(code(f))], 2800),
        cell([new Paragraph({ alignment: AlignmentType.CENTER, children: [req === 'YES' ? badge('YES', C.green) : badge('NO', C.gray400)], spacing: { after: 0 } })], 2000),
        cell([p(t(note, { size: 21 }))], 4560),
      ]))),
    ],
  }),
  sp(),
  h3('Tab 2: Entry Detail (NACHA Record Type 6)'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2800, 2000, 4560],
    rows: [
      hrow(['Field', 'Required', 'Notes'], [2800, 2000, 4560]),
      ...([
        ['Transaction Code', 'YES', '22=Checking credit, 27=Checking debit, 32=Savings credit, 37=Savings debit, 42=GL credit, 47=GL debit, 52=Loan credit, 55=Loan debit.'],
        ['Transaction Type', 'YES', 'Auto-set from TC. Credit = push funds, Debit = pull funds.'],
        ['Account Type', 'YES', 'Checking / Savings / GL / Loan. Auto-set from TC.'],
        ['Amount (USD)', 'YES', 'Decimal value. >$10K triggers L2, >$50K triggers L3, round $100 multiples trigger fraud flag.'],
        ['RDFI Routing Number', 'YES', '9-digit ABA number. Validated with Mod-10 checksum. Invalid routing = Level 3 flag.'],
        ['Account Number', 'YES', 'Receiving account, up to 17 characters.'],
        ['Individual Name', 'NO', 'Receiver name, 22 characters max.'],
        ['Trace Number', 'NO', 'ODFI routing prefix + 7-digit sequence. Duplicate detection checks last 5 days.'],
        ['Addenda Record Indicator', 'NO', '0=No addenda, 1=Addenda record follows (complete in IAT tab).'],
      ].map(([f, req, note]) => row([
        cell([p(code(f))], 2800),
        cell([new Paragraph({ alignment: AlignmentType.CENTER, children: [req === 'YES' ? badge('YES', C.green) : badge('NO', C.gray400)], spacing: { after: 0 } })], 2000),
        cell([p(t(note, { size: 21 }))], 4560),
      ]))),
    ],
  }),
  sp(),
  h3('Tab 3: Compliance'),
  bulletBold('Authorization Type: ', 'Dropdown: PPD_WRITTEN, WEB_CLICK, TEL_VERBAL, CCD_SIGNED, CTX_EDI. Missing authorization triggers CMP_002 flag.'),
  bulletBold('OFAC Screened: ', 'Checkbox. If unchecked for IAT or high-value transactions, OFC_001 flag fires.'),
  bulletBold('AML / BSA Flag: ', 'Checkbox. Manually mark a transaction for Anti-Money Laundering review. Immediately sets Level 3.'),
  bulletBold('Pre-Notification Entry: ', 'Checkbox for zero-dollar pre-notes. These precede the first live entry by at least 3 banking days.'),
  sp(),
  h3('Tab 4: Positive Pay'),
  bulletBold('Enable Positive Pay: ', 'Reveals fields for Check Serial Number, Payee Name, Issued Check Amount, Issued Check Date, and ACH Filter Type.'),
  bulletBold('Issued Check Amount mismatch: ', 'If presented amount differs from issued amount by more than $0.01, the PP_001 flag fires.'),
  bulletBold('Stale-dated (>90 days): ', 'If the issue date is more than 90 days in the past, PP_003 flag fires.'),
  sp(),
  h3('Tab 5: IAT / Addenda'),
  bulletBold('ISO Destination Country Code: ', '2-character ISO (GB, IN, MX, etc.). Required for IAT.'),
  bulletBold('Originator / Receiver Address: ', 'Street, city, state, postal, country. NACHA requires all 7 addenda for IAT.'),
  bulletBold('Addenda Type Code: ', '05=Remittance (CCD+/PPD+), 10-13=IAT mandatory addenda.'),
  bulletBold('Payment Related Information: ', 'Free text, max 80 characters. Used for remittance detail.'),
  sp(),
  h2('6.3 Submission & Result'),
  p(t('After clicking "Submit for AI Triage" the backend processes the transaction synchronously. Within a few seconds the result card appears showing:', { size: 22 })),
  bullet('Transaction ID (TXN-XXXXXXXX format)'),
  bullet('Risk Level badge (Level 1 / 2 / 3)'),
  bullet('Risk Score (0\u2013100)'),
  bullet('Status (auto_approved or under_review)'),
  bullet('All triggered risk flag pills with their severity'),
  bullet('A link to the Review Queue if the transaction needs human action'),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 7 — BULK UPLOAD
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('7. Bulk Upload \u2014 CSV, JSON & NACHA Files'),
  p(t('The Bulk Upload page processes large batches of transactions asynchronously. It supports three input formats and processes entries in configurable batch sizes (5, 10, 25, or 50) with a small delay between batches to avoid overloading the AI service.', { size: 22 })),
  sp(),
  h2('7.1 Format Reference'),
  h3('CSV Format'),
  p(t('The CSV must have a header row. Required columns:', { size: 22 })),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2400, 1400, 5560],
    rows: [
      hrow(['Column Name', 'Required', 'Description'], [2400, 1400, 5560]),
      ...([
        ['company_name', 'YES', 'Originator / company name'],
        ['company_id', 'YES', '10-character originator ID'],
        ['amount', 'YES', 'Dollar amount (decimal)'],
        ['routing_number', 'YES', '9-digit ABA routing number'],
        ['account_number', 'YES', 'Destination account number'],
        ['sec_code', 'NO', 'Default: PPD'],
        ['transaction_type', 'NO', 'credit or debit (default: debit)'],
        ['transaction_code', 'NO', '22/27/32/37 etc.'],
        ['account_type', 'NO', 'checking/savings/gl/loan'],
        ['effective_date', 'NO', 'YYYY-MM-DD (default: today)'],
        ['entry_description', 'NO', 'Up to 10 characters'],
        ['individual_name', 'NO', 'Receiver name'],
        ['authorization_type', 'NO', 'PPD_WRITTEN, WEB_CLICK, etc.'],
        ['ofac_screened', 'NO', 'true or false'],
        ['aml_flag', 'NO', 'true or false'],
        ['positive_pay', 'NO', 'true or false'],
        ['check_serial_number', 'NO', 'For positive pay entries'],
        ['trace_number', 'NO', '15-character trace'],
      ].map(([col, req, desc]) => row([
        cell([p(code(col))], 2400),
        cell([new Paragraph({ alignment: AlignmentType.CENTER, children: [req === 'YES' ? badge('YES', C.green) : badge('NO', C.gray400)], spacing: { after: 0 } })], 1400),
        cell([p(t(desc, { size: 21 }))], 5560),
      ]))),
    ],
  }),
  sp(),
  h3('JSON Format'),
  p(t('An array of transaction objects. Same field names as the NACHA single-entry form. Example:', { size: 22 })),
  new Paragraph({ children: [code('[{"sec_code":"PPD","company_name":"Acme","amount":3250,"routing_number":"021000021","account_number":"1234567890"}]')], spacing: { after: 120 }, indent: { left: 360 } }),
  sp(),
  h3('NACHA Fixed-Width Format (.ach)'),
  p(t('Paste the full NACHA file text (94-character-per-line format). The parser handles:', { size: 22 })),
  bullet('Record Type 1: File Header \u2014 extracts immediate origin, destination, file creation date'),
  bullet('Record Type 5: Batch Header \u2014 extracts company name, ID, SEC code, effective date'),
  bullet('Record Type 6: Entry Detail \u2014 full field extraction including routing, account, amount, trace'),
  bullet('Record Type 7: Addenda \u2014 attached to the preceding entry'),
  bullet('Record Type 8: Batch Control \u2014 validates debit/credit totals against parsed entries'),
  bullet('Record Type 9: File Control \u2014 skipped (informational only)'),
  sp(),
  h2('7.2 Job Lifecycle'),
  sp(),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1600, 240, 1600, 240, 1600, 240, 1600, 240, 1600],
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideH: noBorder(), insideV: noBorder() },
    rows: [
      new TableRow({
        children: [
          flowBox('File Uploaded', C.blueLight, C.blueBtn),
          arrow(),
          flowBox('Job Created (queued)', C.yellow, C.yellowBtn),
          arrow(),
          flowBox('Batches Processed', C.cyan, C.cyanBtn),
          arrow(),
          flowBox('Results Saved', C.green, C.greenBtn),
          arrow(),
          flowBox('Job Completed', C.green, C.greenBtn),
        ]
      }),
    ],
  }),
  sp(),
  p(t('The job card on the page shows a live progress bar, counts of auto-approved vs flagged vs errored transactions, and an expandable results table with all transaction IDs and their disposition. Use the Refresh button to poll a running job.', { size: 22 })),
  sp(),
  h2('7.3 Parse Errors vs. Processing Errors'),
  bulletBold('Parse errors: ', 'Reported before processing starts. Indicate CSV format problems (missing required columns, bad number format). The job may still run with the valid rows.'),
  bulletBold('Parse warnings: ', 'Non-fatal issues (invalid routing number format in NACHA file). Entries are still submitted but flagged.'),
  bulletBold('Processing errors: ', 'Per-row errors during risk scoring or AI processing. The row is counted as an error but processing continues for other rows.'),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 8 — RISK ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('8. Risk Engine \u2014 How AI Scores Transactions'),
  p(t('Every transaction is evaluated by the Risk Engine before the AI brief is generated. The engine runs all 25+ active NACHA rules and accumulates a weighted score. The final risk level controls whether the transaction is auto-approved or sent to the human review queue.', { size: 22 })),
  sp(),
  h2('8.1 Scoring Formula'),
  boxPara('Risk Score = SUM( rule.weight x (flag_level x 15) ) for all triggered rules, capped at 100.', C.blueBtn, C.blue),
  sp(),
  p(t('Level assignment from final score:', { size: 22 })),
  bullet('Level 1 (auto-approve): score < 30 AND no flag above Level 1'),
  bullet('Level 2 (human review): score 30\u201369 OR any Level-2 flag triggered'),
  bullet('Level 3 (urgent review): score >= 70 OR any Level-3 flag triggered'),
  sp(),
  h2('8.2 Complete Risk Rules Reference'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1200, 2200, 1200, 720, 4040],
    rows: [
      hrow(['Code', 'Rule Name', 'Category', 'Level', 'Description'], [1200, 2200, 1200, 720, 4040]),
      ...([
        ['AMT_001', 'Exceeds $50K', 'amount', '3', 'Transaction >$50,000 requires Level 3 enhanced scrutiny per NACHA WEB/CCD rules.'],
        ['AMT_002', 'High-Value $10K\u2013$50K', 'amount', '2', 'Transaction between $10,000 and $50,000 triggers standard Level 2 review.'],
        ['AMT_003', 'Round Dollar Amount', 'amount', '2', 'Exact round $100 multiples are a known fraud structuring indicator.'],
        ['AMT_004', 'Micro-Transaction (<$1)', 'amount', '1', 'Sub-dollar amounts may indicate account probing or pre-notification test.'],
        ['SEC_001', 'IAT International ACH', 'compliance', '3', 'IAT requires OFAC screening, 7 mandatory addenda, and Bank Secrecy Act compliance.'],
        ['SEC_002', 'TEL Phone-Initiated', 'compliance', '2', 'TEL requires recorded verbal authorization or written notice before debit.'],
        ['SEC_003', 'WEB Internet-Initiated', 'compliance', '2', 'WEB requires annual audit, commercially reasonable fraud detection, and account validation.'],
        ['SEC_004', 'CTX Corporate Trade', 'compliance', '2', 'CTX entries carry addenda and require ANSI ASC X12 or UN/EDIFACT format.'],
        ['TXC_001', 'GL Account Debit (TC 47)', 'account', '2', 'General Ledger debit requires internal authorization.'],
        ['TXC_002', 'Loan Account Credit (TC 52)', 'account', '2', 'Loan account credit requires lender confirmation.'],
        ['TXC_003', 'Pre-Notification Entry', 'compliance', '1', 'Zero-dollar pre-note must precede first live entry by 3+ banking days.'],
        ['RTN_001', 'Invalid Routing (Mod-10)', 'account', '3', 'Routing number fails ABA Mod-10 checksum \u2014 entry must be rejected.'],
        ['RTN_002', 'RDFI Routing Mismatch', 'account', '3', 'RDFI routing in trace number does not match receiving DFI routing.'],
        ['OFC_001', 'OFAC Screening Required', 'sanctions', '3', 'IAT or high-value transaction requires OFAC SDN list screening.'],
        ['OFC_002', 'OFAC Potential Hit', 'sanctions', '3', 'Transaction counterparty may match OFAC SDN list.'],
        ['TMG_001', 'Off-Hours Submission', 'pattern', '2', 'Submission outside 08:00\u201320:00 local time \u2014 potential anomaly.'],
        ['TMG_002', 'Future-Dated >5 Days', 'compliance', '2', 'Effective date >5 banking days ahead \u2014 NACHA limits advance effective dating.'],
        ['TMG_003', 'Past Effective Date', 'compliance', '3', 'Effective date is in the past \u2014 entry will be rejected by ACH Operator.'],
        ['VEL_001', 'Daily Volume >5 Entries', 'velocity', '2', 'Company submitted >5 ACH entries today \u2014 velocity monitoring triggered.'],
        ['VEL_002', 'Duplicate Trace Number', 'velocity', '3', 'Trace number matches an entry submitted in the past 5 business days.'],
        ['PP_001', 'Check Positive Pay Mismatch', 'positive_pay', '3', 'Presented check amount differs from issued check register amount.'],
        ['PP_002', 'ACH Debit Block Active', 'positive_pay', '3', 'Account has ACH debit block \u2014 this company ID is not on the allow list.'],
        ['PP_003', 'Stale-Dated Check (>90d)', 'positive_pay', '2', 'Check issue date is more than 90 days ago.'],
        ['CMP_001', 'AML / BSA Flag', 'compliance', '3', 'Transaction characteristics match Anti-Money Laundering pattern.'],
        ['CMP_002', 'Missing Authorization', 'compliance', '2', 'No authorization type recorded \u2014 NACHA requires documented authorization for all debits.'],
        ['CMP_003', 'New Originator', 'compliance', '2', 'First ACH entry from this Company ID \u2014 requires enhanced due diligence.'],
      ].map(([code2, name, cat, lvl, desc]) => row([
        cell([p(code(code2))], 1200),
        cell([p(tb(name, { size: 20 }))], 2200),
        cell([p(t(cat, { size: 20, color: C.gray600 }))], 1200),
        cell([new Paragraph({ alignment: AlignmentType.CENTER, children: [badge('L' + lvl, lvl === '3' ? C.red : lvl === '2' ? C.yellow : C.green, lvl === '2' ? C.gray800 : undefined)], spacing: { after: 0 } })], 720),
        cell([p(t(desc, { size: 19 }))], 4040),
      ]))),
    ],
  }),
  sp(),
  h2('8.3 ABA Mod-10 Routing Validation'),
  p(t('Every routing number is validated using the ABA Mod-10 checksum algorithm before risk scoring. The algorithm multiplies each of the nine digits by the weights 3, 7, 1, 3, 7, 1, 3, 7, 1 respectively. If the sum is not divisible by 10, the routing number is invalid and RTN_001 fires at Level 3 immediately.', { size: 22 })),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 9 — REVIEW QUEUE
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('9. Review Queue \u2014 Human Decision Workflow'),
  p(t('The Review Queue is where human reviewers approve or decline Level 2 and Level 3 transactions. Every transaction arrives pre-processed by the AI with a full brief and a recommendation, so the reviewer only needs to validate and decide.', { size: 22 })),
  sp(),
  h2('9.1 Queue Filters'),
  bulletBold('\u23F3 Pending: ', 'Transactions with status under_review. These need action.'),
  bulletBold('\u2705 Approved: ', 'Transactions approved by a human reviewer.'),
  bulletBold('\uD83D\uDEAB Declined: ', 'Transactions declined (human or default action).'),
  bulletBold('\uD83E\uDD16 Auto-Approved: ', 'Transactions the AI auto-approved at Level 1.'),
  bulletBold('SEC Code filter: ', 'Narrow down to PPD, CCD, WEB, IAT, TEL, CTX, ARC, BOC.'),
  sp(),
  h2('9.2 Transaction Table Columns'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2000, 7360],
    rows: [
      hrow(['Column', 'Meaning'], [2000, 7360]),
      ...([
        ['Transaction ID', 'Unique TXN-XXXXXXXX identifier. Click any row to open the full review modal.'],
        ['Company', 'Originator company name.'],
        ['SEC', 'Standard Entry Class Code (PPD, CCD, WEB, etc.).'],
        ['TC', 'Transaction Code (22, 27, 32, etc.). Indicates account type and direction.'],
        ['Amount', 'Red = debit (money leaving account), Green = credit (money arriving).'],
        ['RDFI Routing', 'Receiving DFI routing number.'],
        ['Level', 'Risk level badge: L1 (green), L2 (amber), L3 (red).'],
        ['Score', 'Numeric risk score 0\u2013100.'],
        ['Auth', 'Authorization type or warning if missing.'],
        ['Flags', 'First 2 flag pills shown; hover for description. Click row for all flags.'],
        ['Status', 'Current disposition badge.'],
        ['Reviewed By', 'Name of the human reviewer or "AI" for auto-approved.'],
        ['Date', 'Submission date.'],
      ].map(([col, meaning]) => row([
        cell([p(tb(col, { size: 21 }))], 2000),
        cell([p(t(meaning, { size: 21 }))], 7360),
      ]))),
    ],
  }),
  sp(),
  h2('9.3 Review Modal \u2014 Decision Workflow'),
  p(t('Clicking any row in the queue opens the Review Modal. It has five tabs. Reviewers can navigate all tabs before submitting a final decision.', { size: 22 })),
  sp(),
  h3('Modal Header Strip'),
  p(t('Shows the risk level badge, status badge, SEC code, company name, transaction ID, amount, and the routing/account numbers. Provides instant context without opening any tab.', { size: 22 })),
  sp(),
  h3('Tab 1: AI Brief'),
  p(t('The AI-generated brief rendered as formatted markdown. Contains:', { size: 22 })),
  bullet('Executive summary with risk profile'),
  bullet('Per-flag plain-English explanations'),
  bullet('Historical pattern context (approval rate for similar transactions)'),
  bullet('Pre-populated compliance checklist'),
  bullet('AI recommendation (Approve or Decline) with confidence percentage'),
  sp(),
  h3('Tab 2: Identity'),
  p(t('The reviewer records identity and counterparty verification:', { size: 22 })),
  bulletBold('Identity Verified checkbox: ', 'Mark if KYC has been completed.'),
  bulletBold('Verification Method: ', 'ID Document, KYC Database, Manual Call, Micro-deposit, Plaid/Open Banking.'),
  bulletBold('Counterparty Type: ', 'Unknown / New / Existing Known Good / Known Fraudster / Watchlist Match.'),
  bulletBold('Account Ownership Confirmed: ', 'Checkbox confirming the account holder was verified.'),
  sp(),
  h3('Tab 3: Fraud Check'),
  p(t('Select all applicable fraud indicators. These feed directly into the AI learning pipeline to improve future detection:', { size: 22 })),
  new Paragraph({
    children: [
      code('VELOCITY_SPIKE'), t('  ', { size: 20 }), code('ROUND_AMOUNT'), t('  ', { size: 20 }),
      code('UNUSUAL_HOUR'), t('  ', { size: 20 }), code('NEW_COUNTERPARTY'), t('  ', { size: 20 }),
      code('BLACKLIST_MATCH'), t('  ', { size: 20 }), code('DEVICE_MISMATCH'),
    ],
    spacing: { after: 80 }, indent: { left: 360 },
  }),
  new Paragraph({
    children: [
      code('IP_ANOMALY'), t('  ', { size: 20 }), code('AMOUNT_MISMATCH'), t('  ', { size: 20 }),
      code('DUPLICATE_PATTERN'), t('  ', { size: 20 }), code('STRUCTURING'), t('  ', { size: 20 }),
      code('SANCTIONS_CONCERN'), t('  ', { size: 20 }), code('ACCOUNT_PROBE'),
    ],
    spacing: { after: 120 }, indent: { left: 360 },
  }),
  bulletBold('Risk Override Reason: ', 'If you are overriding the AI recommendation, explain why.'),
  bulletBold('Escalation Level: ', 'None / Supervisor / Compliance Department / Legal & BSA Officer.'),
  sp(),
  h3('Tab 4: Business'),
  bulletBold('Business Purpose: ', 'Payroll / Vendor Payment / Tax / Loan / Insurance / Investment / Utility / Personal / Unknown.'),
  bulletBold('Reviewer Confidence: ', 'HIGH (weight 1.0) / MEDIUM (weight 0.7) / LOW (weight 0.4). Affects how strongly this decision influences AI learning.'),
  bulletBold('Authorization Record Reviewed: ', 'Confirms the original authorization document was pulled.'),
  bulletBold('Authorization Type Confirmed: ', 'PPD Written / WEB Click-through / TEL Verbal / CCD Signed.'),
  bulletBold('Customer Contacted: ', 'If yes, select outcome: Confirmed / Denied / No Answer / Dispute Filed.'),
  bulletBold('Additional Notes: ', 'Free text that goes into the audit log.'),
  sp(),
  h3('Tab 5: Return Code'),
  p(t('If declining, select the appropriate NACHA return code. The system shows the 10 most common return codes:', { size: 22 })),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [800, 2800, 5760],
    rows: [
      hrow(['Code', 'Title', 'Key Info'], [800, 2800, 5760]),
      ...([
        ['R02', 'Account Closed', 'Account previously active, now closed. Not retryable.'],
        ['R03', 'No Account / Unable to Locate', 'Account number invalid. Not retryable.'],
        ['R04', 'Invalid Account Number', 'Account structure not valid. Not retryable.'],
        ['R05', 'Unauthorized Debit (Consumer)', '60-day return window. Consumer says not authorized. Not retryable.'],
        ['R07', 'Authorization Revoked', 'Consumer revoked prior authorization. 60-day window.'],
        ['R08', 'Payment Stopped', 'Stop payment placed by receiver.'],
        ['R10', 'Customer Advises Not Authorized', 'Receiver advises RDFI originator was not authorized.'],
        ['R13', 'Invalid ACH Routing Number', 'Routing not valid ACH participant.'],
        ['R16', 'Account Frozen', 'Account frozen due to legal action.'],
        ['R29', 'Corporate Advises Not Authorized', 'Corporate receiver says not authorized.'],
      ].map(([c, title, info]) => row([
        cell([p(code(c))], 800),
        cell([p(tb(title, { size: 20 }))], 2800),
        cell([p(t(info, { size: 20 }))], 5760),
      ]))),
    ],
  }),
  sp(),
  h2('9.4 Submitting a Decision'),
  p(t('At the bottom of the modal, click one of two buttons:', { size: 22 })),
  bulletBold('\u2705 Approve: ', 'Sets status to "approved". Records the full review data in the review_decisions table. Triggers AI learning pipeline update.'),
  bulletBold('\uD83D\uDEAB Decline: ', 'Sets status to "declined". Associates the selected return code. Triggers AI learning pipeline update.'),
  p(t('A brief confirmation animation plays and the modal closes after 2 seconds. The transaction moves out of the pending filter.', { size: 22 })),
  sp(),
  h2('9.5 Reviewer Identity in Records'),
  p(t('Every decision permanently records: reviewer_id, reviewer_name, reviewer_username, reviewer_role, and decision_at timestamp. This appears in the Audit Log and in the transaction detail as "Reviewed By: [Full Name]".', { size: 22 })),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 10 — EXCEPTION DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('10. Exception Dashboard \u2014 Positive Pay Deadlines'),
  p(t('The Exception Dashboard shows all transactions currently under review alongside a live countdown to each account\'s cutoff time. If no human decision is made before the deadline, the account\'s configured Default Action (Pay or Return) is applied automatically.', { size: 22 })),
  sp(),
  h2('10.1 How Exception Timing Works'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2200, 7160],
    rows: [
      hrow(['Concept', 'Explanation'], [2200, 7160]),
      row([cell([p(tb('Cutoff Time', { size: 22 }))], 2200), cell([p(t('Each account has a configured cutoff time (e.g., 14:00). This is the daily deadline for pay/return decisions. Defaults to 14:00 but configurable per account.', { size: 22 }))], 7160)]),
      row([cell([p(tb('Countdown Timer', { size: 22 }))], 2200), cell([p(t('Live countdown in HH:MM:SS format. Green when >1 hour remains, amber when <1 hour, red when past due.', { size: 22 }))], 7160)]),
      row([cell([p(tb('Default Action', { size: 22 }))], 2200), cell([p(t('Each account is configured to either PAY or RETURN exceptions after the cutoff. Return is recommended for most accounts. Pay is typical for Reverse Positive Pay accounts.', { size: 22 }))], 7160)]),
      row([cell([p(tb('Apply Defaults Button', { size: 22 }))], 2200), cell([p(t('The red button at the top applies the default action to all past-due exceptions simultaneously. Use when you have missed the cutoff and want to process all outstanding items.', { size: 22 }))], 7160)]),
    ],
  }),
  sp(),
  h2('10.2 Exception Priority Sections'),
  bulletBold('\uD83D\uDD34 PAST DUE: ', 'Red background. Cutoff has already passed. "Apply Defaults" button appears. These are urgent.'),
  bulletBold('\u26A0\uFE0F URGENT (<1hr): ', 'Amber row. Less than 60 minutes remain. Review immediately.'),
  bulletBold('\u2705 PENDING (>1hr): ', 'Normal rows. Time available for standard review.'),
  sp(),
  h2('10.3 Pay vs Return Decision'),
  p(t('Each exception row has two action buttons:', { size: 22 })),
  bulletBold('\u2705 Pay: ', 'Allows the transaction to proceed. Sets status to "approved". Used when you have verified the transaction is legitimate.'),
  bulletBold('\u21A9 Return: ', 'Rejects the transaction. Sets status to "declined". The bank must return the entry to the originating DFI.'),
  sp(),
  h2('10.4 Auto-Refresh'),
  p(t('The dashboard auto-refreshes every 30 seconds to update countdown timers and catch newly incoming exceptions. The "Last Updated" timestamp shows the most recent refresh. Manual refresh available via the Refresh button.', { size: 22 })),
  sp(),
  boxPara('IMPORTANT: For Reverse Positive Pay accounts, ALL incoming ACH debits appear in the exception dashboard (not just flagged ones), because the account is configured for manual review of every item.', C.yellowBtn, C.yellow),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 11 — ACCOUNT MANAGER
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('11. Account ACH Filter Settings'),
  p(t('Each bank account can be independently configured with a fraud protection mode, a cutoff time, a default action, a daily debit limit, and an allow list of authorized Company IDs.', { size: 22 })),
  sp(),
  h2('11.1 Filter Modes'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2400, 6960],
    rows: [
      hrow(['Mode', 'Behaviour'], [2400, 6960]),
      row([cell([new Paragraph({ children: [badge('\u2705 Positive Pay', C.blueLight)], spacing: { after: 0 } })], 2400), cell([p(t('Standard Positive Pay. Incoming transactions are cross-referenced against your issued check register and pre-configured company allow list. Mismatches (amount, payee, serial number) are flagged as exceptions. Best for accounts with some normal variability.', { size: 22 }))], 6960)]),
      row([cell([new Paragraph({ children: [badge('\uD83D\uDD12 ACH Allow List', C.green)], spacing: { after: 0 } })], 2400), cell([p(t('Block ALL ACH debits except from companies explicitly on the allow list. Any Company ID not in the authorized_company_ids list triggers PP_002 (ACH Debit Block) at Level 3. Best for payroll accounts and predictable payment accounts.', { size: 22 }))], 6960)]),
      row([cell([new Paragraph({ children: [badge('\uD83D\uDEAB ACH Debit Block', C.red)], spacing: { after: 0 } })], 2400), cell([p(t('Reject ALL incoming ACH debits without exception. No allow list entries are checked. Used for reserve accounts, escrow accounts, or tax holding accounts that should never accept ACH debits.', { size: 22 }))], 6960)]),
      row([cell([new Paragraph({ children: [badge('\u21A9 Reverse Positive Pay', C.purple)], spacing: { after: 0 } })], 2400), cell([p(t('Every incoming ACH debit is presented to the business for manual review in the Exception Dashboard. The bank does not decide \u2014 the account holder must explicitly Pay or Return each item before the cutoff. Highest level of control. Default action is "pay" so nothing auto-returns.', { size: 22 }))], 6960)]),
    ],
  }),
  sp(),
  h2('11.2 Configuring an Account'),
  numbered('Click "Configure" on the desired account card.'),
  numbered('Select the Filter Mode from the dropdown.'),
  numbered('Set the Cutoff Time (24-hour format, e.g., 14:00).'),
  numbered('Set the Default Action (Return or Pay) for expired exceptions.'),
  numbered('Set the Max Daily Debit limit in dollars.'),
  numbered('Click "Save Config".'),
  sp(),
  h2('11.3 Managing the Allow List'),
  p(t('Visible when mode is "ACH Allow List" or "Positive Pay". Each entry has:', { size: 22 })),
  bulletBold('Company ID (required): ', '10-character originator ID exactly as it appears in ACH transactions.'),
  bulletBold('Company Name (optional): ', 'Human-readable label for the allow list.'),
  bulletBold('Max $ Amount (optional): ', 'Transaction-level dollar cap. Entries exceeding this are still flagged even if the company is on the list.'),
  p(t('To remove a company, click the red X next to their ID tag.', { size: 22 })),
  sp(),
  h2('11.4 Demo Accounts'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1600, 3000, 1800, 1600, 1360],
    rows: [
      hrow(['Account ID', 'Name', 'Mode', 'Default Action', 'Max Daily Debit'], [1600, 3000, 1800, 1600, 1360]),
      row([cell([p(code('ACC-001'))], 1600), cell([p(t('Operating Checking', { size: 21 }))], 3000), cell([p(t('Positive Pay', { size: 21 }))], 1800), cell([p(t('Return', { size: 21 }))], 1600), cell([p(t('$100,000', { size: 21 }))], 1360)]),
      row([cell([p(code('ACC-002'))], 1600), cell([p(t('Payroll Account', { size: 21 }))], 3000), cell([p(t('Allow List', { size: 21 }))], 1800), cell([p(t('Return', { size: 21 }))], 1600), cell([p(t('$500,000', { size: 21 }))], 1360)]),
      row([cell([p(code('ACC-003'))], 1600), cell([p(t('Tax Reserve Account', { size: 21 }))], 3000), cell([p(t('Block All', { size: 21 }))], 1800), cell([p(t('Return', { size: 21 }))], 1600), cell([p(t('$0', { size: 21 }))], 1360)]),
      row([cell([p(code('ACC-004'))], 1600), cell([p(t('Vendor Payments', { size: 21 }))], 3000), cell([p(t('Reverse Pos. Pay', { size: 21 }))], 1800), cell([p(t('Pay', { size: 21 }))], 1600), cell([p(t('$250,000', { size: 21 }))], 1360)]),
    ],
  }),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 12 — CHECK REGISTER
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('12. Issued Check Register \u2014 Check Positive Pay'),
  p(t('The Issued Check Register is a digital ledger of all checks your organization has issued. When a check is presented for payment, the system compares it against this register and flags discrepancies as exceptions.', { size: 22 })),
  sp(),
  h2('12.1 Register Tabs'),
  bulletBold('\uD83D\uDCCB Register: ', 'View all issued checks with their match status, presented amounts, and presented payees. Color-coded by match result.'),
  bulletBold('\u2795 Add Check: ', 'Add a single check manually by entering serial number, amount, payee name, issue date, and memo.'),
  bulletBold('\uD83D\uDCC2 Bulk Upload (CSV): ', 'Upload your entire check register from accounting software as a CSV file.'),
  bulletBold('\uD83D\uDD0D Match Check: ', 'Test matching tool. Simulate presenting a check to see the match result before production use.'),
  sp(),
  h2('12.2 Match Results'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2400, 720, 6240],
    rows: [
      hrow(['Result', 'Icon', 'Meaning'], [2400, 720, 6240]),
      row([cell([new Paragraph({ children: [badge('FULL MATCH', C.green)], spacing: { after: 0 } })], 2400), cell([pCenter(t('\u2705', { size: 22 }))], 720), cell([p(t('All checked fields match exactly. Serial number found, amount within $0.01, payee name matches (case-insensitive), and check not older than 90 days.', { size: 22 }))], 6240)]),
      row([cell([new Paragraph({ children: [badge('AMOUNT MISMATCH', C.red)], spacing: { after: 0 } })], 2400), cell([pCenter(t('\uD83D\uDCB0', { size: 22 }))], 720), cell([p(t('Serial found but presented amount differs from issued amount by more than $0.01. Possible check alteration.', { size: 22 }))], 6240)]),
      row([cell([new Paragraph({ children: [badge('PAYEE MISMATCH', C.red)], spacing: { after: 0 } })], 2400), cell([pCenter(t('\uD83D\uDC64', { size: 22 }))], 720), cell([p(t('Serial found but presented payee name does not match issued payee (after normalizing case and whitespace). Possible payee alteration.', { size: 22 }))], 6240)]),
      row([cell([new Paragraph({ children: [badge('STALE DATED', C.yellow, C.gray800)], spacing: { after: 0 } })], 2400), cell([pCenter(t('\uD83D\uDCC5', { size: 22 }))], 720), cell([p(t('Serial found and amounts/payee match, but the check was issued more than 90 days ago. Many banks will refuse stale-dated checks.', { size: 22 }))], 6240)]),
      row([cell([new Paragraph({ children: [badge('SERIAL NOT FOUND', C.red)], spacing: { after: 0 } })], 2400), cell([pCenter(t('\u2753', { size: 22 }))], 720), cell([p(t('Check serial number does not exist in the issued register for this account. Possibly a counterfeit check.', { size: 22 }))], 6240)]),
    ],
  }),
  sp(),
  h2('12.3 CSV Upload Format'),
  bulletBold('Required columns: ', 'check_serial_number, issued_amount'),
  bulletBold('Optional columns: ', 'payee_name, issue_date (YYYY-MM-DD), memo'),
  p(t('Column name aliases are supported: check_number, serial_number, check_no for the serial; amount, dollar_amount for the amount; payee, vendor for payee_name.', { size: 22 })),
  sp(),
  h2('12.4 Voiding a Check'),
  p(t('From the Register tab, click "Void" on any issued check. Enter a reason. Voided checks cannot be matched and are excluded from positive pay exception detection.', { size: 22 })),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 13 — AI CHATBOT
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('13. AI Chatbot \u2014 Natural Language Interface'),
  p(t('The AI Chatbot is a floating assistant powered by the same Gemini language model used for transaction briefs. It has live read access to all system data and can perform approve/decline decisions on behalf of logged-in users. Admin users can also use it to create, update, and delete transactions.', { size: 22 })),
  sp(),
  h2('13.1 Opening the Chatbot'),
  p(t('Click the blue robot button (\uD83E\uDD16) in the bottom-right corner of any page. A chat window opens with a welcome message and quick-action buttons. The FAB button shows an unread badge when the bot has replied while the window was closed.', { size: 22 })),
  sp(),
  h2('13.2 Quick Questions'),
  p(t('Eight predefined question buttons are shown on first open to help you get started:', { size: 22 })),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3120, 6240],
    rows: [
      hrow(['Button', 'What it asks'], [3120, 6240]),
      ...([
        ['\uD83D\uDCCA Transaction Summary', 'Full status counts across the system'],
        ['\u23F3 Pending Reviews', 'List and details of all under_review transactions'],
        ['\uD83D\uDD34 High-Risk Transactions', 'Analysis of all Level 3 entries'],
        ['\u2705 Auto-Approval Rate', 'Current rate and trend context'],
        ['\uD83D\uDCB0 Total Volume', 'Dollar volume processed'],
        ['\uD83E\uDDE0 AI Learning Insights', 'Pattern stats and fraud detection trends'],
        ['\uD83D\uDCCB Recent Audit Activity', 'Last 10 audit events explained'],
        ['\u26A1 Risk Analysis', 'Portfolio-level risk assessment'],
      ].map(([btn, what]) => row([
        cell([p(tb(btn, { size: 21 }))], 3120),
        cell([p(t(what, { size: 21 }))], 6240),
      ]))),
    ],
  }),
  sp(),
  h2('13.3 Natural Language Examples'),
  p(t('The chatbot understands natural conversation. Examples:', { size: 22 })),
  bulletBold('"How many transactions came in today?" ', '\u2014 Shows today\'s count from live data.'),
  bulletBold('"Tell me about TXN-0B671CD6" ', '\u2014 Full transaction detail including flags, audit trail, and AI brief.'),
  bulletBold('"What is the current auto-resolution rate?" ', '\u2014 Calculates and explains the percentage.'),
  bulletBold('"Explain what an IAT transaction is" ', '\u2014 NACHA compliance explanation.'),
  bulletBold('"Approve TXN-0B671CD6" ', '\u2014 Approves the transaction directly (login required).'),
  bulletBold('"Reject TXN-0B671CD6 \u2014 suspicious amount" ', '\u2014 Declines with a note.'),
  bulletBold('"Which transactions are pending?" ', '\u2014 Lists all under_review transactions.'),
  sp(),
  h2('13.4 Transaction Actions via Chat'),
  p(t('Any logged-in user can approve or decline transactions by typing:', { size: 22 })),
  new Paragraph({ children: [code('approve TXN-XXXXXXXX')], spacing: { after: 60 }, indent: { left: 360 } }),
  new Paragraph({ children: [code('reject TXN-XXXXXXXX')], spacing: { after: 120 }, indent: { left: 360 } }),
  p(t('If you type "approve" without a transaction ID, the bot shows a list of pending transactions and asks which one you mean.', { size: 22 })),
  sp(),
  h2('13.5 Quick Action Buttons'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2000, 2000, 5360],
    rows: [
      hrow(['Button', 'Role Required', 'Action'], [2000, 2000, 5360]),
      row([cell([p(tb('\u2705 Approve Transaction', { size: 21 }))], 2000), cell([p(t('Any (logged in)', { size: 21 }))], 2000), cell([p(t('Opens a form to enter TXN ID + optional notes, then calls the decision API.', { size: 21 }))], 5360)]),
      row([cell([p(tb('\u274C Reject Transaction', { size: 21 }))], 2000), cell([p(t('Any (logged in)', { size: 21 }))], 2000), cell([p(t('Opens a form to enter TXN ID + optional rejection reason.', { size: 21 }))], 5360)]),
      row([cell([p(tb('\u2795 Create Transaction', { size: 21 }))], 2000), cell([p(t('Admin only', { size: 21 }))], 2000), cell([p(t('Opens CRUD form to create a new transaction directly through the chatbot.', { size: 21 }))], 5360)]),
      row([cell([p(tb('\u270F\uFE0F Update Transaction', { size: 21 }))], 2000), cell([p(t('Admin only', { size: 21 }))], 2000), cell([p(t('Opens CRUD form to update specific fields on an existing transaction.', { size: 21 }))], 5360)]),
      row([cell([p(tb('\uD83D\uDDD1\uFE0F Delete Transaction', { size: 21 }))], 2000), cell([p(t('Admin only', { size: 21 }))], 2000), cell([p(t('Opens CRUD form to permanently delete a non-approved transaction.', { size: 21 }))], 5360)]),
      row([cell([p(tb('\uD83D\uDD0D Read Transaction', { size: 21 }))], 2000), cell([p(t('Any user', { size: 21 }))], 2000), cell([p(t('Opens CRUD form to fetch and display full transaction details.', { size: 21 }))], 5360)]),
    ],
  }),
  sp(),
  h2('13.6 Live System Context'),
  p(t('Every chatbot message automatically includes:', { size: 22 })),
  bullet('Full transaction index (ID, company, amount, status, risk, score, SEC code, date)'),
  bullet('AI learning statistics'),
  bullet('Account filter configurations'),
  bullet('Last 10 audit events'),
  bullet('All Level 3 transactions'),
  bullet('All pending transactions'),
  bullet('If a TXN ID is mentioned: full detail record including risk flags and audit trail'),
  p(t('This means the chatbot never needs to ask you for information \u2014 it already has all current data.', { size: 22 })),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 14 — ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('14. Analytics & Reporting'),
  p(t('The Analytics page provides visual insights into system performance, AI learning progress, and risk rule effectiveness.', { size: 22 })),
  sp(),
  h2('14.1 KPI Cards'),
  bulletBold('Auto-Resolution Rate: ', 'Percentage of all transactions handled without human intervention. A healthy system achieves >70%.'),
  bulletBold('Human Reviews Required: ', 'Total count of Level 2 and Level 3 transactions processed.'),
  bulletBold('AI Patterns Learned: ', 'Total distinct risk patterns in the learning database.'),
  bulletBold('Patterns Promoted: ', 'Patterns that have reached auto-approve status.'),
  sp(),
  h2('14.2 Decision Breakdown Chart'),
  p(t('Horizontal bar chart showing counts for Auto-Approved, Approved (human), Declined, and Pending. Clicking any bar is not interactive but the numbers update in real time.', { size: 22 })),
  sp(),
  h2('14.3 Most Triggered Risk Rules Chart'),
  p(t('Horizontal bar chart of the top 6 rules by trigger count. Shows which risk rules are most active in your transaction stream. High AMT_001 counts indicate frequent high-value activity. High SEC_001 counts indicate frequent international transfers.', { size: 22 })),
  sp(),
  h2('14.4 AI Learning Curve'),
  p(t('Each pattern shows:', { size: 22 })),
  bulletBold('Pattern description: ', 'SEC code + transaction type + amount bucket + risk flags.'),
  bulletBold('Split bar: ', 'Green (approved count) vs Red (declined count).'),
  bulletBold('Confidence %: ', 'Green if >= 85% (promoted), Amber if 50\u201384%, Red if <50%.'),
  bulletBold('Decisions needed: ', 'How many more decisions until this pattern can be promoted.'),
  bulletBold('ROCKET badge: ', 'Pattern is promoted and is now auto-approving transactions.'),
  sp(),
  h2('14.5 Risk Rules Registry Table'),
  p(t('Full table of all 25+ risk rules with: rule code, name, category, flag level badge, weight multiplier, trigger count, and active/inactive status.', { size: 22 })),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 15 — AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('15. Audit Log'),
  p(t('The Audit Log is an immutable, append-only record of every significant system event. It is required for NACHA compliance and provides a complete trail for regulatory examination.', { size: 22 })),
  sp(),
  h2('15.1 Event Types'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2800, 1000, 5560],
    rows: [
      hrow(['Event Type', 'Actor', 'When Generated'], [2800, 1000, 5560]),
      ...([
        ['transaction_created', 'SYSTEM', 'Every new transaction ingested via API or bulk upload'],
        ['auto_approved', 'AI', 'Level 1 transaction cleared with zero human touch'],
        ['ai_processed', 'AI', 'AI brief generated for Level 2 or 3 transaction'],
        ['human_approved', 'HUMAN', 'Reviewer clicks Approve in Review Queue or chatbot'],
        ['human_declined', 'HUMAN', 'Reviewer clicks Decline or Reject'],
        ['human_reviewed', 'HUMAN', 'Generic human review event with full decision data'],
        ['pattern_promoted', 'AI', 'Learning pipeline promotes pattern to Level 1'],
        ['pattern_demoted', 'AI', 'Pattern\'s approval rate drops below 70%, demoted'],
        ['risk_flagged', 'AI', 'Risk rule triggers during scoring'],
        ['rule_updated', 'HUMAN', 'Account filter configuration changed'],
        ['user_login', 'HUMAN', 'Successful user authentication'],
        ['user_created', 'HUMAN', 'Admin creates new user account'],
        ['user_updated', 'HUMAN', 'Admin changes user role or status'],
        ['user_deleted', 'HUMAN', 'Admin permanently deletes user'],
      ].map(([evt, actor, when]) => row([
        cell([p(code(evt))], 2800),
        cell([new Paragraph({ alignment: AlignmentType.CENTER, children: [actor === 'AI' ? badge(actor, C.purple) : actor === 'SYSTEM' ? badge(actor, C.cyan) : badge(actor, C.blueLight)], spacing: { after: 0 } })], 1000),
        cell([p(t(when, { size: 21 }))], 5560),
      ]))),
    ],
  }),
  sp(),
  h2('15.2 Filter & Pagination'),
  p(t('Filter buttons at the top let you filter by any event type. Pagination shows 20 events per page. Events are sorted newest first.', { size: 22 })),
  sp(),
  h2('15.3 Severity Levels'),
  bulletBold('info: ', 'Normal operation events (transaction created, approved, auto-approved).'),
  bulletBold('warning: ', 'Events needing attention (risk flagged, declined, off-hours, pattern demoted, account updated).'),
  bulletBold('critical: ', 'High-severity events (user deleted, OFAC match, AML flag, duplicate trace number).'),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 16 — USER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('16. User Management (Admin Only)'),
  p(t('The User Management page is only accessible to Admin-role users. It provides full lifecycle management of all user accounts in the system.', { size: 22 })),
  sp(),
  h2('16.1 Creating a New User'),
  numbered('Click the "Create New User" button (top right).'),
  numbered('Enter Full Name, Username (lowercase, no spaces), and Email Address.'),
  numbered('Select a Role by clicking one of the four role cards.'),
  numbered('Click "Create User Account".'),
  numbered('The system generates a secure random 12-character password.'),
  numbered('If SMTP is configured, credentials are emailed automatically. Otherwise, the temporary password is shown in the success modal \u2014 copy it and share with the user securely.'),
  sp(),
  h2('16.2 Editing a User'),
  bullet('Click the pencil (Edit) icon on any user row.'),
  bullet('Change Role by clicking a role card.'),
  bullet('Toggle Active/Inactive with the toggle switch. Inactive users cannot log in.'),
  bullet('Reset Password toggle generates a new password and sends it to the user\'s email.'),
  bullet('You cannot deactivate your own account.'),
  sp(),
  h2('16.3 Deleting a User'),
  bullet('Click the trash icon on any user row (not available for your own account).'),
  bullet('Confirm the deletion in the browser dialog.'),
  bullet('Deletion is permanent and cannot be undone. A critical audit log entry is created.'),
  sp(),
  h2('16.4 Stats Panel'),
  p(t('The page shows live stats: total user count, active users, and per-role breakdown.', { size: 22 })),
  sp(),
  h2('16.5 Search & Filter'),
  p(t('The search box filters by full name, username, or email. The role dropdown filters by a specific role. Both can be combined.', { size: 22 })),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 17 — AI LEARNING ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('17. AI Learning Engine \u2014 Pattern Promotion'),
  p(t('The AI Learning Engine transforms the system from a static rule engine into one that continuously improves. It observes human decisions, builds a feature vector library, and automatically promotes high-confidence patterns to Level 1 auto-approval.', { size: 22 })),
  sp(),
  h2('17.1 How a Pattern is Defined'),
  p(t('A pattern is a unique combination of five transaction attributes:', { size: 22 })),
  bulletBold('SEC Code: ', 'PPD, CCD, WEB, IAT, etc.'),
  bulletBold('Transaction Type: ', 'credit or debit'),
  bulletBold('Amount Bucket: ', 'micro (<$500), small ($500\u2013$5K), medium ($5K\u2013$25K), large ($25K\u2013$100K), xlarge (>$100K)'),
  bulletBold('Account Type: ', 'checking, savings, GL, loan'),
  bulletBold('Flag Codes: ', 'Sorted list of risk rule codes that were triggered'),
  p(t('These five attributes are SHA-256 hashed to create a unique pattern_hash. Every decision against a matching hash updates the same pattern record.', { size: 22 })),
  sp(),
  h2('17.2 Pattern Lifecycle Diagram'),
  sp(),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [1600, 240, 1600, 240, 1600, 240, 1600, 240, 1600],
    borders: { top: noBorder(), bottom: noBorder(), left: noBorder(), right: noBorder(), insideH: noBorder(), insideV: noBorder() },
    rows: [
      new TableRow({
        children: [
          flowBox('New Transaction', C.blueLight, C.blueBtn),
          arrow(),
          flowBox('Hash Computed', C.cyan, C.cyanBtn),
          arrow(),
          flowBox('Pattern Created / Updated', C.yellow, C.yellowBtn),
          arrow(),
          flowBox('Confidence >= 85% & n >= 5?', C.purple, C.purpleBtn),
          arrow(),
          flowBox('Pattern Promoted to L1!', C.green, C.greenBtn),
        ]
      }),
    ],
  }),
  sp(),
  h2('17.3 Confidence Weight System'),
  p(t('Not all human decisions carry equal weight. Reviewer confidence affects the pattern:', { size: 22 })),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2200, 1400, 5760],
    rows: [
      hrow(['Confidence Level', 'Weight', 'Use When'], [2200, 1400, 5760]),
      row([cell([new Paragraph({ children: [badge('HIGH', C.green)], spacing: { after: 0 } })], 2200), cell([pCenter(tb('1.0', { size: 24, color: C.green }))], 1400), cell([p(t('You have fully verified the transaction and are certain of your decision. Strong KYC, confirmed business purpose.', { size: 22 }))], 5760)]),
      row([cell([new Paragraph({ children: [badge('MEDIUM', C.yellow, C.gray800)], spacing: { after: 0 } })], 2200), cell([pCenter(tb('0.7', { size: 24, color: C.yellow }))], 1400), cell([p(t('Standard review. No strong indicators either way. Reasonably confident based on available information.', { size: 22 }))], 5760)]),
      row([cell([new Paragraph({ children: [badge('LOW', C.red)], spacing: { after: 0 } })], 2200), cell([pCenter(tb('0.4', { size: 24, color: C.red }))], 1400), cell([p(t('Uncertain. You are approving/declining based on incomplete information or under time pressure. Decision should be re-verified.', { size: 22 }))], 5760)]),
    ],
  }),
  sp(),
  h2('17.4 Promotion Criteria'),
  bulletBold('Minimum decisions: ', '5 total human decisions on this pattern (configurable per pattern).'),
  bulletBold('Confidence threshold: ', 'Weighted approval score must be >= 85% (configurable per pattern).'),
  bulletBold('Not frozen: ', 'Admin has not set is_frozen=true to prevent promotion.'),
  sp(),
  h2('17.5 Demotion'),
  p(t('A promoted pattern is automatically demoted back to Level 2 if the weighted approval confidence drops below 70%. This happens when reviewers start declining transactions that were previously auto-approved (e.g., after a fraud wave on a previously clean counterparty). The demotion count is tracked; high demotion counts indicate volatile patterns.', { size: 22 })),
  sp(),
  h2('17.6 Rich Feature Vector'),
  p(t('Beyond the five hash attributes, each decision captures a much richer feature vector for analysis:', { size: 22 })),
  bulletBold('Fraud indicators selected by reviewer', ''),
  bulletBold('Identity verification method used', ''),
  bulletBold('Counterparty type (new vs existing vs watchlist)', ''),
  bulletBold('Business purpose', ''),
  bulletBold('Customer contact outcome', ''),
  bulletBold('Authorization type confirmed', ''),
  bulletBold('Escalation level', ''),
  bulletBold('Average time-to-decide (seconds)', ''),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 18 — RETURN CODES
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('18. ACH Return Codes Reference'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [640, 2800, 1200, 800, 3920],
    rows: [
      hrow(['Code', 'Title', 'Category', 'Retry?', 'Key Notes'], [640, 2800, 1200, 800, 3920]),
      ...([
        ['R01', 'Insufficient Funds', 'account', 'Yes', 'Balance too low. May retry after funds are available.'],
        ['R02', 'Account Closed', 'account', 'No', 'Stop all future entries to this account.'],
        ['R03', 'No Account', 'account', 'No', 'Account number does not correspond to valid account.'],
        ['R04', 'Invalid Account Number', 'account', 'No', 'Account number structure invalid.'],
        ['R05', 'Unauthorized Debit Consumer', 'fraud', 'No', '60-day return window. Consumer dispute.'],
        ['R06', 'Returned per ODFI Request', 'admin', 'Yes', 'ODFI requested return. Rare.'],
        ['R07', 'Authorization Revoked', 'fraud', 'No', 'Consumer revoked prior authorization.'],
        ['R08', 'Payment Stopped', 'account', 'No', 'Stop payment placed.'],
        ['R09', 'Uncollected Funds', 'account', 'Yes', 'Balance present but not yet collected.'],
        ['R10', 'Not Authorized', 'fraud', 'No', '60-day window. Originator not authorized.'],
        ['R11', 'Not in Accordance with Terms', 'fraud', 'No', 'Does not comply with authorization terms.'],
        ['R13', 'Invalid Routing Number', 'technical', 'No', 'Routing not valid ACH participant.'],
        ['R16', 'Account Frozen', 'account', 'No', 'Legal hold or bank freeze.'],
        ['R17', 'Invalid DFI Account Number', 'technical', 'No', 'RDFI cannot process \u2014 invalid format.'],
        ['R24', 'Duplicate Entry', 'technical', 'No', 'Apparent duplicate detected by RDFI.'],
        ['R29', 'Corporate Not Authorized', 'fraud', 'No', 'Corporate receiver says not authorized.'],
        ['R80', 'IAT Coding Error', 'technical', 'No', 'IAT coded but does not meet IAT requirements.'],
        ['R81', 'Non-Participant IAT', 'compliance', 'No', 'Foreign RDFI not in IAT program.'],
        ['R84', 'Not Processed by Gateway', 'compliance', 'No', 'IAT gateway operator did not process.'],
      ].map(([code2, title, cat, retry, notes]) => row([
        cell([p(code(code2))], 640),
        cell([p(tb(title, { size: 20 }))], 2800),
        cell([p(t(cat, { size: 20, color: C.gray600 }))], 1200),
        cell([new Paragraph({ alignment: AlignmentType.CENTER, children: [retry === 'Yes' ? badge(retry, C.green) : badge(retry, C.red)], spacing: { after: 0 } })], 800),
        cell([p(t(notes, { size: 20 }))], 3920),
      ]))),
    ],
  }),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 19 — NACHA FIELD REFERENCE
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('19. NACHA Field Reference'),
  h2('19.1 Record Type Structure'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [800, 1600, 6960],
    rows: [
      hrow(['Type', 'Name', 'Contents'], [800, 1600, 6960]),
      row([cell([pCenter(badge('1', C.blue))], 800), cell([p(tb('File Header', { size: 21 }))], 1600), cell([p(t('Immediate destination routing, immediate origin routing, file creation date/time, file ID modifier.', { size: 21 }))], 6960)]),
      row([cell([pCenter(badge('5', C.purple))], 800), cell([p(tb('Batch Header', { size: 21 }))], 1600), cell([p(t('Service class code, company name, company ID, SEC code, company entry description, effective date, ODFI routing, batch number.', { size: 21 }))], 6960)]),
      row([cell([pCenter(badge('6', C.blueLight))], 800), cell([p(tb('Entry Detail', { size: 21 }))], 1600), cell([p(t('Transaction code, RDFI routing + check digit, account number, amount, individual ID, individual name, addenda indicator, trace number.', { size: 21 }))], 6960)]),
      row([cell([pCenter(badge('7', C.cyan))], 800), cell([p(tb('Addenda', { size: 21 }))], 1600), cell([p(t('Addenda type code, payment related information (up to 80 chars), addenda sequence number, entry detail sequence number.', { size: 21 }))], 6960)]),
      row([cell([pCenter(badge('8', C.yellow, C.gray800))], 800), cell([p(tb('Batch Control', { size: 21 }))], 1600), cell([p(t('Service class code, entry/addenda count, entry hash (sum of RDFI routings), total debit amount, total credit amount, company ID, ODFI routing, batch number.', { size: 21 }))], 6960)]),
      row([cell([pCenter(badge('9', C.gray400))], 800), cell([p(tb('File Control', { size: 21 }))], 1600), cell([p(t('Batch count, block count, entry/addenda count, total debit/credit amounts for the entire file.', { size: 21 }))], 6960)]),
    ],
  }),
  sp(),
  h2('19.2 SEC Code Reference'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [800, 3200, 1600, 3760],
    rows: [
      hrow(['Code', 'Full Name', 'Risk Level', 'Key Requirements'], [800, 3200, 1600, 3760]),
      ...([
        ['PPD', 'Prearranged Payment & Deposit', 'Low', 'Written authorization. Consumer accounts only.'],
        ['CCD', 'Corporate Credit or Debit', 'Low-Med', 'Signed agreement. Business accounts.'],
        ['WEB', 'Internet-Initiated', 'Medium', 'Annual audit, fraud detection, account validation (micro-deposits or Plaid).'],
        ['TEL', 'Telephone-Initiated', 'Medium', 'Recorded verbal authorization or prior written notice.'],
        ['IAT', 'International ACH', 'HIGH', 'OFAC screening, 7 mandatory addenda, BSA Travel Rule compliance.'],
        ['CTX', 'Corporate Trade Exchange', 'Medium', 'ANSI ASC X12 or UN/EDIFACT EDI addenda required.'],
        ['POS', 'Point-of-Sale Entry', 'Low', 'Consumer-initiated at POS terminal.'],
        ['ARC', 'Accounts Receivable Entry', 'Low', 'Paper check conversion. Single use only.'],
        ['BOC', 'Back Office Conversion', 'Low', 'Paper check conversion at back office. No consumer present.'],
        ['CIE', 'Customer Initiated Entry', 'Low', 'Consumer initiates credit to their own accounts.'],
      ].map(([code2, name, risk, reqs]) => row([
        cell([new Paragraph({ alignment: AlignmentType.CENTER, children: [badge(code2, risk === 'HIGH' ? C.red : risk === 'Medium' ? C.yellow : risk === 'Low-Med' ? C.cyan : C.green, risk === 'Medium' || risk === 'Low-Med' ? C.gray800 : undefined)], spacing: { after: 0 } })], 800),
        cell([p(tb(name, { size: 20 }))], 3200),
        cell([p(t(risk, { size: 20, color: risk === 'HIGH' ? C.red : risk.includes('Med') ? C.yellow : C.green }))], 1600),
        cell([p(t(reqs, { size: 20 }))], 3760),
      ]))),
    ],
  }),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 20 — TROUBLESHOOTING
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('20. Troubleshooting & FAQ'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [3600, 5760],
    rows: [
      hrow(['Problem / Question', 'Solution'], [3600, 5760]),
      ...([
        ['Login fails with "Invalid username or password"', 'Check username is lowercase and matches exactly. Passwords are case-sensitive. If you just created the account, ensure you are using the temporary password from the server console (SMTP may not be configured).'],
        ['"Session expired" after navigation', 'JWT tokens expire after 12 hours. Log out and log back in. This is expected and normal.'],
        ['Chatbot says "Gemini init failed"', 'Your GEMINI_API_KEY is missing or invalid in the .env file. The chatbot falls back to a rule-based simulation mode that still answers many questions correctly.'],
        ['Bulk upload job stays in "queued" status', 'The background processor runs asynchronously. Use the Refresh button on the job card. If it stays queued for more than 30 seconds, check the backend console for error output.'],
        ['All transactions come back as Level 3', 'Check if OFAC_SCREENED is false on your test transactions. Also verify routing numbers are valid 9-digit ABA numbers \u2014 invalid routing = Level 3 immediately.'],
        ['CSV bulk upload fails with parse errors', 'Ensure your CSV has a header row. Required columns are company_name, company_id, amount, routing_number, account_number. Amounts must be numeric (no $ sign or commas).'],
        ['Exception dashboard shows no exceptions', 'Only transactions with status "under_review" appear here. If transactions are being auto-approved (Level 1), they do not appear as exceptions.'],
        ['Pattern was promoted but still reviewing', 'Promotion only reduces the risk level if the incoming transaction exactly matches the pattern hash. A new flag or different amount bucket creates a new pattern.'],
        ['Check register match shows SERIAL_NOT_FOUND', 'The check serial number on the presented item does not exist in your issued register for that account. Upload or manually add the check to the register, or investigate as a potentially counterfeit check.'],
        ['Creating a user but email not sent', 'SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM in the .env file. Without SMTP, the temporary password is printed to the backend server console.'],
        ['Transactions from NACHA file have wrong company name', 'The parser uses the Batch Header (Record Type 5) company_name field. If that field is blank in the NACHA file, it falls back to the Individual Name from the Entry Detail record.'],
      ].map(([prob, sol]) => row([
        cell([p(tb(prob, { size: 20 }))], 3600),
        cell([p(t(sol, { size: 20 }))], 5760),
      ]))),
    ],
  }),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 21 — SECURITY & COMPLIANCE
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('21. Security & Compliance Notes'),
  h2('21.1 Production Security Checklist'),
  bulletBold('JWT Secret: ', 'Replace the default "ach-triage-super-secret-key-2024" value in your .env with a cryptographically random string of at least 64 characters.'),
  bulletBold('HTTPS: ', 'Deploy the backend behind a reverse proxy (nginx/Caddy) with TLS. Do not run HTTP in production.'),
  bulletBold('CORS: ', 'The backend currently allows localhost:5173 and localhost:3000. Update the CORS origins list in server.js to your production domain only.'),
  bulletBold('File-Based Database: ', 'The current data store is a JSON file (ach_db.json). For production, migrate to PostgreSQL or MongoDB with proper access controls and encrypted backups.'),
  bulletBold('Admin Account: ', 'Change the admin password immediately after first login. Use a unique, strong password.'),
  bulletBold('SMTP Credentials: ', 'Store SMTP credentials in environment variables only \u2014 never in source code.'),
  sp(),
  h2('21.2 NACHA Compliance Considerations'),
  bulletBold('OFAC Screening: ', 'The system flags unscreened IAT entries but does NOT perform live OFAC SDN list lookups. You must integrate a licensed OFAC screening service (e.g., ACAMS, Comply Advantage) for production use.'),
  bulletBold('Same-Day ACH: ', 'The system does not currently differentiate same-day ACH (effective date = today with same-day batch window). Implement your ODFI\'s same-day cutoff rules separately.'),
  bulletBold('NOC Notifications: ', 'Notifications of Change (NOC) codes C01\u2013C09 are not currently handled. Add a return_codes table entry and handler if your institution processes NOCs.'),
  bulletBold('Return Time Windows: ', 'R05, R07, R10 have a 60-day return window. R01, R09 have a 2-banking-day window. The system does not currently enforce return deadlines \u2014 track externally.'),
  bulletBold('Audit Retention: ', 'NACHA requires ACH records to be retained for at least 6 years. Ensure your database backup strategy meets this requirement.'),
  sp(),
  h2('21.3 Data Privacy'),
  bullet('Account numbers and routing numbers are stored in plain text in the database. Encrypt sensitive fields using AES-256 before storing in production.'),
  bullet('The audit log captures full transaction data including account numbers. Restrict audit log access to compliance officers and admins.'),
  bullet('User passwords are hashed with bcrypt (12 rounds) and are never stored in plain text.'),
  pb(),
);

// ═══════════════════════════════════════════════════════════════════════════════
// CHAPTER 22 — GLOSSARY
// ═══════════════════════════════════════════════════════════════════════════════
children.push(
  h1('22. Glossary'),
  new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [2400, 6960],
    rows: [
      hrow(['Term', 'Definition'], [2400, 6960]),
      ...([
        ['ACH', 'Automated Clearing House. A US electronic payment network for credit and debit transfers between financial institutions.'],
        ['ABA Routing Number', '9-digit number identifying a US financial institution. Validated using the Mod-10 checksum algorithm.'],
        ['AML', 'Anti-Money Laundering. Regulatory framework requiring financial institutions to detect and report suspicious transactions.'],
        ['BSA', 'Bank Secrecy Act. US law requiring financial institutions to assist in detecting money laundering and other financial crimes.'],
        ['Batch Header', 'NACHA record type 5. Contains company-level information for a group of ACH entries.'],
        ['CTR', 'Currency Transaction Report. Required for cash transactions exceeding $10,000.'],
        ['DFI', 'Depository Financial Institution. Any bank or credit union that holds customer deposits.'],
        ['Entry Detail', 'NACHA record type 6. Contains individual transaction data (account, amount, trace number).'],
        ['IAT', 'International ACH Transaction. SEC code for ACH entries that are part of a payment clearing arrangement involving a financial agency outside the US.'],
        ['JWT', 'JSON Web Token. A self-contained, signed token used for authentication. Contains user claims in a base64-encoded payload.'],
        ['KYC', 'Know Your Customer. Due diligence process for verifying the identity of customers.'],
        ['Mod-10 Checksum', 'Validation algorithm for ABA routing numbers. Multiplies digits by weights 3,7,1 and sums; result must be divisible by 10.'],
        ['NACHA', 'National Automated Clearing House Association. The governing body that writes and enforces the Operating Rules for ACH transactions.'],
        ['NOC', 'Notification of Change. ACH entry returned by the RDFI to notify the ODFI of incorrect data (account number, routing number, etc.).'],
        ['ODFI', 'Originating Depository Financial Institution. The bank that initiates ACH entries on behalf of its originator clients.'],
        ['OFAC', 'Office of Foreign Assets Control. US Treasury agency that administers economic sanctions and the SDN list.'],
        ['Pre-Note', 'Zero-dollar ACH entry sent before the first live entry to validate account information. Must precede the live entry by 3 banking days.'],
        ['RDFI', 'Receiving Depository Financial Institution. The bank that receives ACH entries and posts them to account holders.'],
        ['SDN List', "Specially Designated Nationals list maintained by OFAC. Transactions with listed individuals or entities are prohibited."],
        ['SEC Code', 'Standard Entry Class Code. 3-character code identifying the type of ACH transaction.'],
        ['Trace Number', '15-character identifier assigned by the ODFI to each ACH entry. Unique within a 5-business-day period.'],
        ['Zero-Touch', 'Transactions approved by the AI at Level 1 with no human intervention required.'],
      ].map(([term, def]) => row([
        cell([p(tb(term, { size: 21 }))], 2400),
        cell([p(t(def, { size: 21 }))], 6960),
      ]))),
    ],
  }),
  sp(),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [t('\u2014 End of User Manual \u2014', { font: 'Arial', size: 22, color: C.gray400, italics: true })],
    spacing: { before: 480, after: 240 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [t('ACH Payment & Positive Pay AI Triage System v3.0', { font: 'Arial', size: 20, color: C.gray400 })],
    spacing: { after: 120 },
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [t('Full NACHA \u00B7 Bulk Processing \u00B7 Rich Learning \u00B7 Positive Pay Register \u00B7 Exception Dashboard', { font: 'Arial', size: 18, color: C.gray400 })],
    spacing: { after: 0 },
  }),
);

// =============================================================================
// ASSEMBLE DOCUMENT
// =============================================================================

const doc = new Document({
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: '\u2022',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 260 } } },
        }],
      },
      {
        reference: 'numbers',
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: '%1.',
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 540, hanging: 260 } } },
        }],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: 'Arial', size: 22 } },
    },
    paragraphStyles: [
      {
        id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 40, bold: true, font: 'Arial', color: C.blue },
        paragraph: {
          spacing: { before: 480, after: 200 }, outlineLevel: 0,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.blueLight, space: 4 } }
        },
      },
      {
        id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: C.blue },
        paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 },
      },
      {
        id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: C.blueLight },
        paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 },
      },
      {
        id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 22, bold: true, font: 'Arial', color: C.gray800 },
        paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 3 },
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            children: [
              t('\uD83C\uDFE6 ACH Triage AI System v3.0 \u2014 User Manual', { font: 'Arial', size: 18, color: C.gray400 }),
              new TextRun({ text: '\t', font: 'Arial', size: 18 }),
              t('Page ', { font: 'Arial', size: 18, color: C.gray400 }),
              new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 18, color: C.gray400 }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: C.gray200 } },
            spacing: { after: 80 },
          }),
        ],
      }),
    },
    children,
  }],
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('ACH_Triage_AI_User_Manual.docx', buffer);
  console.log('SUCCESS: Manual written to outputs.');
}).catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});