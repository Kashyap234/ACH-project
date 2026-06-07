const pptxgen = require('pptxgenjs');

let pptx = new pptxgen();

// Layout and formatting
pptx.layout = 'LAYOUT_16x9';

// Slide 1: Title
let slide1 = pptx.addSlide();
slide1.addText('🏦 ACH Payment & Positive Pay AI Triage System v3.0', { x: 1, y: 1.5, w: 8, h: 1, fontSize: 36, bold: true, color: '003366', align: 'center' });
slide1.addText('Comprehensive System Overview & Architecture', { x: 1, y: 2.5, w: 8, h: 1, fontSize: 24, color: '666666', align: 'center' });

// Slide 2: System Overview & Architecture
let slide2 = pptx.addSlide();
slide2.addText('1. System Overview & Architecture', { x: 0.5, y: 0.5, w: 9, h: 0.5, fontSize: 28, bold: true, color: '003366' });
slide2.addText(
  'Theory:\nThe ACH AI Triage System v3.0 is a comprehensive, NACHA-compliant processing engine designed to modernize payment operations. It leverages deterministic rules (Risk Engine) combined with Generative AI (Gemini) and continuous Rich Learning to automate payment approvals, flag anomalies, and provide exception management. The system supports full NACHA parsing, Positive Pay matching, and bulk file uploads.',
  { x: 0.5, y: 1.5, w: 9, h: 1.5, fontSize: 16, color: '333333' }
);
slide2.addText(
  'Architecture Flow:\nClient UI / Bulk Upload -> API Gateway -> NACHA/CSV Parser -> Risk Engine\nRisk Level 1 -> AI Triage (Auto Approve) -> DB\nRisk Level 2/3 -> AI Triage (Review Brief) -> DB -> Exception Dashboard -> Human Decision -> Rich Learning Pipeline',
  { x: 0.5, y: 3.2, w: 9, h: 1.5, fontSize: 14, color: '000000', fill: 'EFEFEF', shape: pptx.ShapeType.rect, align: 'left' }
);

// Slide 3: NACHA & CSV Parsing Engine
let slide3 = pptx.addSlide();
slide3.addText('2. NACHA & CSV Parsing Engine', { x: 0.5, y: 0.5, w: 9, h: 0.5, fontSize: 28, bold: true, color: '003366' });
slide3.addText(
  'Functionality:\nThe system ingests standardized payment files formats (.nacha, .csv) and normalizes them into structured transaction objects.\n\nTheory:\nNACHA files are fixed-width text files (94 characters per line). The parser extracts File Headers (1), Batch Headers (5), Entry Details (6), Addenda (7), and Batch Controls (8). It validates Mod-10 routing numbers and ensures batch credit/debit totals match the declared sums.',
  { x: 0.5, y: 1.5, w: 9, h: 2.5, fontSize: 16, color: '333333' }
);

// Slide 4: Deterministic Risk Engine
let slide4 = pptx.addSlide();
slide4.addText('3. Deterministic Risk Engine', { x: 0.5, y: 0.5, w: 9, h: 0.5, fontSize: 28, bold: true, color: '003366' });
slide4.addText(
  'Functionality:\nEvery parsed transaction is run against a suite of highly customizable risk rules (e.g., amount thresholds, new originators, invalid RTNs, OFAC lists).\n\nTheory:\nThe Risk Engine evaluates transaction properties against a set of rules. Each triggered rule has a defined weight and flag level.\n• Level 1: Zero-touch automation (Score < 30)\n• Level 2: Medium risk, requires careful review (Score 30-69)\n• Level 3: Critical risk, mandatory oversight (Score 70+)',
  { x: 0.5, y: 1.5, w: 9, h: 3, fontSize: 16, color: '333333' }
);

// Slide 5: AI Triage & Gemini Integration
let slide5 = pptx.addSlide();
slide5.addText('4. AI Triage & Gemini Integration', { x: 0.5, y: 0.5, w: 9, h: 0.5, fontSize: 28, bold: true, color: '003366' });
slide5.addText(
  'Functionality:\nGenerates intelligent narratives to support human reviewers or provide an immutable audit trail for auto-approvals.\n\nTheory:\nIf a transaction is Level 1, the AI Engine uses an LLM (Gemini) to generate Compliance Notes—a documented audit trail proving Reg E and NACHA compliance. For Levels 2 & 3, it generates a Review Brief, summarizing flagged rules in plain English, analyzing historical patterns, and offering a pre-populated compliance checklist for the human analyst.',
  { x: 0.5, y: 1.5, w: 9, h: 3, fontSize: 16, color: '333333' }
);

// Slide 6: Rich Learning Pipeline
let slide6 = pptx.addSlide();
slide6.addText('5. Rich Learning Pipeline', { x: 0.5, y: 0.5, w: 9, h: 0.5, fontSize: 28, bold: true, color: '003366' });
slide6.addText(
  'Functionality:\nContinuous improvement of the Risk Engine based on Human Decisions. High-confidence patterns are automatically promoted to Level 1.\n\nTheory:\nWhen a reviewer makes a decision via the Exception Dashboard, they provide rich context (fraud indicators, business purpose, verification methods). The system hashes the transaction parameters (SEC code, amount bucket, flag codes) to create a pattern hash. Repeated, confident approvals of the same hash increase its confidence score. Once a pattern meets MIN_DECISIONS and CONF_THRESHOLD (85%), it is auto-promoted to Level 1.',
  { x: 0.5, y: 1.5, w: 9, h: 3, fontSize: 16, color: '333333' }
);

// Slide 7: Exception Dashboard & Cutoff Deadlines
let slide7 = pptx.addSlide();
slide7.addText('6. Exception Dashboard & Cutoff Deadlines', { x: 0.5, y: 0.5, w: 9, h: 0.5, fontSize: 28, bold: true, color: '003366' });
slide7.addText(
  'Functionality:\nA specialized queue for Operations teams to process flagged transactions before daily ACH clearing cutoff windows.\n\nTheory:\nAccounts have defined cutoff_time values (e.g., 14:00). The dashboard calculates the exact countdown timer (ms_remaining) for each exception. If a decision is not made before the deadline, the system automatically applies the account default action (Pay or Return), ensuring regulatory compliance and preventing late returns.',
  { x: 0.5, y: 1.5, w: 9, h: 3, fontSize: 16, color: '333333' }
);

// Slide 8: Bulk Processing & Background Jobs
let slide8 = pptx.addSlide();
slide8.addText('7. Bulk Processing & Background Jobs', { x: 0.5, y: 0.5, w: 9, h: 0.5, fontSize: 28, bold: true, color: '003366' });
slide8.addText(
  'Functionality:\nAsynchronous processing of large volumes of transactions without blocking the API.\n\nTheory:\nWhen thousands of transactions are uploaded, the Bulk Route creates a batch_job with a unique ID and queues it. An asynchronous background process splits the payload into smaller batches (e.g., 50 at a time), processing them sequentially to prevent memory exhaustion and LLM rate limits. Clients poll the /api/bulk/jobs endpoint to get live progress updates.',
  { x: 0.5, y: 1.5, w: 9, h: 3, fontSize: 16, color: '333333' }
);

pptx.writeFile({ fileName: 'ACH_AI_Triage_System_Presentation.pptx' }).then(fileName => {
  console.log(`Successfully generated PowerPoint: ${fileName}`);
});
