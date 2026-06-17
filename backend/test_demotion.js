require('dotenv').config();
const { recordDecision, checkPatternMatch, getLearningStats } = require('./services/learningPipeline');
const { queryOne, remove } = require('./database/db');

async function testDemotion() {
  console.log("Starting demotion scenario test...\n");

  // Create a unique mock transaction to ensure a fresh pattern
  const uniqueSecCode = 'TEST_DEMOTE_' + Math.floor(Math.random() * 1000);
  const mockTxn = {
    transaction_id: 'txn_' + Date.now(),
    sec_code: uniqueSecCode,
    transaction_type: 'debit',
    amount: 1500, // small bucket
    account_type: 'checking'
  };

  const riskResult = {
    riskLevel: 2,
    riskScore: 50,
    riskFlags: [{ rule_code: 'TEST_FLAG', category: 'anomaly', rule_name: 'Test Flag', flag_level: 1 }]
  };

  const reviewDataApprove = {
    reviewer_confidence: 'HIGH',
    decision_reason: 'Looks good',
    time_to_decide_seconds: 10
  };

  const reviewDataDecline = {
    reviewer_confidence: 'HIGH',
    decision_reason: 'Suspicious now',
    time_to_decide_seconds: 5
  };

  console.log(`Mock Transaction SEC Code: ${uniqueSecCode}`);

  // 1. Promote Pattern
  console.log("\n--- Phase 1: Promoting the Pattern ---");
  for (let i = 1; i <= 5; i++) {
    mockTxn.transaction_id = 'txn_app_' + i + '_' + Date.now();
    await recordDecision(mockTxn, 'approve', reviewDataApprove, riskResult);
    console.log(`Decision ${i}: Approved with HIGH confidence.`);
  }

  // Verify Promotion
  let pattern = await checkPatternMatch(mockTxn, riskResult.riskFlags);
  if (pattern && pattern.promoted_to_level1) {
    console.log(`\n✅ Verification: Pattern successfully promoted to Level 1!`);
    console.log(`Confidence Score: ${(pattern.confidence_score * 100).toFixed(2)}%, Total Decisions: ${pattern.total_decisions}`);
  } else {
    console.error(`\n❌ Verification Failed: Pattern was not promoted.`);
    return;
  }

  // 2. Demote Pattern
  console.log("\n--- Phase 2: Demoting the Pattern ---");
  // We need to drop confidence below 0.70. 
  // Approvals weight: 5 * 1.0 = 5.0
  // Declines needed to drop below 0.70: 5.0 / (5.0 + x) < 0.70  => 5.0 < 3.5 + 0.7x => 1.5 < 0.7x => x > 2.14
  // So 3 declines with HIGH confidence (weight 3.0) should drop the score to 5.0 / 8.0 = 62.5%

  for (let i = 1; i <= 3; i++) {
    mockTxn.transaction_id = 'txn_dec_' + i + '_' + Date.now();
    await recordDecision(mockTxn, 'decline', reviewDataDecline, riskResult);
    console.log(`Decision ${i + 5}: Declined with HIGH confidence.`);
  }

  // Verify Demotion
  // checkPatternMatch only returns promoted patterns, so we need to query db directly
  const { generatePatternHash } = require('./services/learningPipeline'); // We can't access it if not exported, let's query learning_patterns
  // learningPipeline.js doesn't export generatePatternHash, but we can query by sec_codes array if we search through all
  const { queryAll } = require('./database/db');
  const allPatterns = await queryAll('learning_patterns');
  pattern = allPatterns.find(p => p.sec_codes && p.sec_codes.includes(uniqueSecCode));

  if (pattern) {
    if (!pattern.promoted_to_level1 && pattern.demotion_count > 0) {
      console.log(`\n✅ Verification: Pattern successfully DEMOTED from Level 1!`);
      console.log(`Confidence Score: ${(pattern.confidence_score * 100).toFixed(2)}%, Total Decisions: ${pattern.total_decisions}, Demotion Count: ${pattern.demotion_count}`);
    } else {
      console.error(`\n❌ Verification Failed: Pattern was not demoted. Promoted status: ${pattern.promoted_to_level1}, Score: ${pattern.confidence_score}`);
    }
  } else {
    console.error(`\n❌ Verification Failed: Pattern not found in DB.`);
  }

  console.log("\nCleaning up mock data...");
  if (pattern) {
    await remove('learning_patterns', p => p.pattern_hash === pattern.pattern_hash);
  }
  await remove('review_decisions', r => r.transaction_id.startsWith('txn_app_') || r.transaction_id.startsWith('txn_dec_'));
  await remove('human_decisions', r => r.transaction_id.startsWith('txn_app_') || r.transaction_id.startsWith('txn_dec_'));
  await remove('audit_logs', a => a.event_data && a.event_data.pattern_hash === pattern.pattern_hash);
  console.log("Cleanup complete.");
  console.log("\nTest Finished!");
  process.exit(0);
}

testDemotion().catch(err => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
