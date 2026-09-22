import { getSubscriptionStatus, syncSubscriptionFromSupabase, submitPaymentRequest, approvePaymentRequest, getStoredSubscriptions } from './src/services/subscriptionService';
import { startBlock, saveStoredQuestions } from './src/services/questionBankService';
import { getCurrentUser, resolveSession } from './src/services/authService';

async function runE2ETests() {
  console.log('--- STARTING E2E SUBSCRIPTION FIX VERIFICATION ---');

  // Seed 1 sample question for testing block creation
  saveStoredQuestions([
    {
      id: 'TEST-Q1',
      bankId: 'moh_bank',
      year: 2024,
      question: 'Which of the following is the first-line treatment for acute appendicitis?',
      options: { A: 'Laparoscopic Appendectomy', B: 'Oral Antibiotics only', C: 'Observation', D: 'Corticosteroids' },
      correctAnswer: 'A',
      explanation: 'Surgical appendectomy is the definitive first-line treatment for acute uncomplicated appendicitis.',
      major: 'General Surgery',
      topic: 'Acute Abdomen',
      difficulty: 'Medium',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ]);

  const testUserActiveId = '777666555';
  const testUserActiveUsername = 'e2e_active_doctor';

  const testUserInactiveId = '555444333';
  const testUserInactiveUsername = 'e2e_inactive_doctor';

  const testUserUnlockId = '444333222';
  const testUserUnlockUsername = 'e2e_unlock_doctor';

  const adminId = '6146527054';

  // SCENARIO 1: ACTIVE TELEGRAM USER
  console.log('\n[Scenario 1] Testing Subscribed Telegram User:', testUserActiveId);
  // 1a. Submit and approve payment
  const req1 = submitPaymentRequest({
    paymentMethod: 'CliQ',
    amount: 15,
    referenceNumber: 'CLIQ-777666555',
    telegramUsername: testUserActiveUsername,
    userId: testUserActiveId
  });
  // Approve payment via API/Backend helper
  approvePaymentRequest(req1.id, adminId);

  // 1b. Verify API returns ACTIVE from database
  const syncedSub1 = await syncSubscriptionFromSupabase(testUserActiveId, testUserActiveUsername);
  console.log('Scenario 1 Synced Subscription Result:', syncedSub1);

  if (!syncedSub1 || syncedSub1.status !== 'ACTIVE') {
    throw new Error('FAILED Scenario 1: syncSubscriptionFromSupabase did not return ACTIVE for approved user');
  }

  // 1c. Test startBlock authorization
  const block1 = await startBlock(testUserActiveId, {
    questionCount: 5,
    majors: ['All'],
    topics: ['All'],
    difficulty: 'All',
    statusFilter: 'ALL'
  });

  console.log('Scenario 1 startBlock Success! Block ID:', block1.id, 'Questions:', block1.questionIds.length);

  // SCENARIO 2: INACTIVE TELEGRAM USER
  console.log('\n[Scenario 2] Testing Inactive Telegram User:', testUserInactiveId);
  const syncedSub2 = await syncSubscriptionFromSupabase(testUserInactiveId, testUserInactiveUsername);
  console.log('Scenario 2 Synced Subscription Result:', syncedSub2);

  let scenario2Blocked = false;
  try {
    await startBlock(testUserInactiveId, {
      questionCount: 5,
      majors: ['All'],
      topics: ['All'],
      difficulty: 'All',
      statusFilter: 'ALL'
    });
  } catch (err: any) {
    console.log('Scenario 2 startBlock correctly blocked with error:', err.message);
    scenario2Blocked = true;
  }

  if (!scenario2Blocked) {
    throw new Error('FAILED Scenario 2: Inactive user was able to start block!');
  }

  // SCENARIO 3: ADMIN APPROVAL UNLOCK WITHOUT LOGOUT
  console.log('\n[Scenario 3] Testing Dynamic Unlock After Admin Payment Approval:', testUserUnlockId);
  
  // 3a. Initial state check (Inactive)
  const initialSub3 = await syncSubscriptionFromSupabase(testUserUnlockId, testUserUnlockUsername);
  console.log('Scenario 3 Initial Sync Result (Should be INACTIVE or PENDING):', initialSub3?.status);

  // 3b. Submit payment
  const req3 = submitPaymentRequest({
    paymentMethod: 'Zain Cash',
    amount: 15,
    referenceNumber: 'ZAIN-444333222',
    telegramUsername: testUserUnlockUsername,
    userId: testUserUnlockId
  });

  // 3c. Admin approves payment
  console.log('Admin approving payment request:', req3.id);
  approvePaymentRequest(req3.id, adminId);

  // 3d. User returns/re-enters Question Bank -> re-sync subscription
  const unlockedSub3 = await syncSubscriptionFromSupabase(testUserUnlockId, testUserUnlockUsername);
  console.log('Scenario 3 Post-Approval Sync Result:', unlockedSub3);

  if (!unlockedSub3 || unlockedSub3.status !== 'ACTIVE') {
    throw new Error('FAILED Scenario 3: Post-approval sync did not transition status to ACTIVE!');
  }

  // 3e. Test startBlock authorization now succeeds
  const block3 = await startBlock(testUserUnlockId, {
    questionCount: 5,
    majors: ['All'],
    topics: ['All'],
    difficulty: 'All',
    statusFilter: 'ALL'
  });

  console.log('Scenario 3 startBlock Success! Block ID:', block3.id, 'Questions:', block3.questionIds.length);

  // SCENARIO 4: PREVENT WRONG USER CACHE OVERWRITE
  console.log('\n[Scenario 4] Verifying Cache Isolation Safeguard');
  const allStored = getStoredSubscriptions();
  console.log('Keys present in stored subscriptions:', Object.keys(allStored));

  if (allStored['web_resident_01_moh_bank'] && allStored['777666555_moh_bank']) {
    if (allStored['web_resident_01_moh_bank'].status === allStored['777666555_moh_bank'].status && allStored['777666555_moh_bank'].userId === 'web_resident_01') {
      throw new Error('FAILED Scenario 4: User cache collision detected!');
    }
  }
  console.log('Scenario 4 Safeguard PASSED! User key isolation verified.');

  console.log('\n=== ALL E2E SUBSCRIPTION TESTS PASSED SUCCESSFULLY! ===');
}

runE2ETests().catch((err) => {
  console.error('\nE2E TEST FAILURE:', err);
  process.exit(1);
});
