import fetch from 'node-fetch';

async function testStartQuestionFlow() {
  const baseUrl = 'http://localhost:3000';
  const testUserId = '999888111';
  const testUsername = 'e2e_test_doctor';
  const adminId = '6146527054';

  console.log('=== E2E RUNTIME INVESTIGATION FOR START QUESTION FLOW ===\n');

  // Step 1: User Sync / Login
  console.log('1. Syncing test Telegram user...');
  const syncRes = await fetch(`${baseUrl}/api/users/sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-user-id': testUserId,
      'x-telegram-username': testUsername
    },
    body: JSON.stringify({
      telegramId: testUserId,
      username: testUsername,
      firstName: 'E2E',
      lastName: 'Tester'
    })
  });
  const syncData = await syncRes.json();
  console.log('User Sync Response:', syncData);

  // Step 2: Submit Payment Request
  console.log('\n2. Submitting payment request...');
  const payRes = await fetch(`${baseUrl}/api/payments/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-user-id': testUserId,
      'x-telegram-username': testUsername
    },
    body: JSON.stringify({
      paymentMethod: 'Zain Cash',
      amount: 25,
      referenceNumber: `REF_${Date.now()}`
    })
  });
  const payData: any = await payRes.json();
  console.log('Payment Submit Response:', payData);

  const paymentId = payData.payment_id || payData.paymentId || payData.payment?.id || payData.paymentRequest?.id;

  // Step 3: Admin Approves Payment
  console.log('\n3. Admin approving payment request:', paymentId);
  const approveRes = await fetch(`${baseUrl}/api/admin/payments/${paymentId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-user-id': adminId
    }
  });
  const approveData = await approveRes.json();
  console.log('Approve Response:', approveData);

  // Step 4: Check Subscription Status Endpoint
  console.log('\n4. Checking /api/subscriptions/status...');
  const subStatusRes = await fetch(`${baseUrl}/api/subscriptions/status?telegramUserId=${testUserId}&username=${testUsername}`, {
    headers: {
      'x-telegram-user-id': testUserId,
      'x-telegram-username': testUsername
    }
  });
  const subStatusData = await subStatusRes.json();
  console.log('Subscription Status Endpoint Response:', subStatusData);

  // Step 5: User calls /api/blocks (POST) to save/sync question block
  console.log('\n5. Creating / syncing Question Block (/api/blocks)...');
  const blockRes = await fetch(`${baseUrl}/api/blocks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-telegram-user-id': testUserId,
      'x-telegram-username': testUsername
    },
    body: JSON.stringify({
      block: {
        id: `block_${Date.now()}`,
        userId: testUserId,
        bankId: 'moh_bank',
        status: 'IN_PROGRESS',
        filters: { major: 'All', questionCount: 10 },
        questionIds: ['q1', 'q2', 'q3'],
        currentIndex: 0,
        answers: {},
        annotations: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    })
  });
  const blockData = await blockRes.json();
  console.log('POST /api/blocks Response (Status:', blockRes.status, '):', blockData);

  // Step 6: User calls /api/blocks (GET)
  console.log('\n6. Retrieving Question Blocks (/api/blocks GET)...');
  const getBlocksRes = await fetch(`${baseUrl}/api/blocks`, {
    headers: {
      'x-telegram-user-id': testUserId,
      'x-telegram-username': testUsername
    }
  });
  const getBlocksData = await getBlocksRes.json();
  console.log('GET /api/blocks Response (Status:', getBlocksRes.status, '):', getBlocksData);

  console.log('\n=== INVESTIGATION COMPLETE ===');
}

testStartQuestionFlow().catch(console.error);
