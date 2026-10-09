import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { AxiomaMCPServer } from '../src/mcp/server';
import { evaluateVerdict } from '../src/gateway/server';

describe('Axioma Showcase - Scenarios & Governance Verification', () => {
  const mcp = new AxiomaMCPServer();
  const scenariosDir = path.join(process.cwd(), 'showcase/scenarios');

  test('Fixture 01: Illegal discount on empty cart is strictly REJECTED', () => {
    const fixturePath = path.join(scenariosDir, '01-illegal-discount-on-empty-cart.json');
    assert.ok(fs.existsSync(fixturePath), 'Fixture 01 must exist');

    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    assert.strictEqual(fixture.expectedVerdict, 'REJECTED');
    assert.strictEqual(fixture.currentState, 'empty_cart');

    const args = fixture.rpcRequest.params.arguments;
    const result = mcp.proposeResolver(args);

    assert.strictEqual(result.status, 'REJECTED');
    assert.ok(result.violations?.includes('ILLEGAL_STATE_TRANSITION'));
    assert.ok(result.feedback.includes('mathematically impossible'));

    // Gateway evaluation check
    const mockMcpResponse = {
      result: {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(result) }],
      },
    };
    const verdict = evaluateVerdict(200, mockMcpResponse);
    assert.strictEqual(verdict, 'REJECTED');
  });

  test('Fixture 02: Valid checkout and idempotent payment is APPROVED', () => {
    const fixturePath = path.join(scenariosDir, '02-valid-checkout-and-payment.json');
    assert.ok(fs.existsSync(fixturePath), 'Fixture 02 must exist');

    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    assert.strictEqual(fixture.expectedVerdict, 'APPROVED');
    assert.strictEqual(fixture.currentState, 'pending_payment');

    const args = fixture.rpcRequest.params.arguments;
    const result = mcp.proposeResolver(args);

    assert.strictEqual(result.status, 'APPROVED');
    assert.strictEqual(result.targetState, 'payment_processing');
    assert.ok(result.validatedGuards?.includes('hasIdempotencyKey'));
    assert.ok(result.validatedGuards?.includes('validPositiveAmount'));

    // Gateway evaluation check
    const mockMcpResponse = {
      result: {
        isError: false,
        content: [{ type: 'text', text: JSON.stringify(result) }],
      },
    };
    const verdict = evaluateVerdict(200, mockMcpResponse);
    assert.strictEqual(verdict, 'APPROVED');
  });

  test('Fixture 03: Missing idempotency key is REJECTED by guard', () => {
    const fixturePath = path.join(scenariosDir, '03-missing-idempotency-key.json');
    assert.ok(fs.existsSync(fixturePath), 'Fixture 03 must exist');

    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
    assert.strictEqual(fixture.expectedVerdict, 'REJECTED');
    assert.strictEqual(fixture.currentState, 'pending_payment');

    const args = fixture.rpcRequest.params.arguments;
    const result = mcp.proposeResolver(args);

    assert.strictEqual(result.status, 'REJECTED');
    assert.ok(result.violations?.some((v) => v.includes('MISSING_IDEMPOTENCY_KEY')));

    // Gateway evaluation check
    const mockMcpResponse = {
      result: {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify(result) }],
      },
    };
    const verdict = evaluateVerdict(200, mockMcpResponse);
    assert.strictEqual(verdict, 'REJECTED');
  });

  test('Showcase README exists and documents thesis and ports', () => {
    const readmePath = path.join(process.cwd(), 'showcase/README.md');
    assert.ok(fs.existsSync(readmePath), 'showcase/README.md must exist');
    const content = fs.readFileSync(readmePath, 'utf-8');
    assert.ok(content.includes('3001'));
    assert.ok(content.includes('3000'));
    assert.ok(content.includes('empty_cart'));
    assert.ok(content.includes('pending_payment'));
    assert.ok(content.includes('agent_audit_logs'));
  });
});
