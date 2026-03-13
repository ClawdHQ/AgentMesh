import { ok, err, Result } from 'neverthrow';
import { NetworkError, PaymentError, generateNonce } from '@agentmesh/shared';
import { Wallet } from 'ethers';
import type { PaymentProof } from '../types';

// x402 payment protocol client
// Implements the x402 HTTP payment challenge-response flow
export class x402Client {
  private readonly wallet: Wallet;
  private readonly chainId: number;
  private readonly usdcAddress: string;

  constructor(privateKey: string, chainId: number = 84532, usdcAddress: string) {
    this.wallet = new Wallet(privateKey);
    this.chainId = chainId;
    this.usdcAddress = usdcAddress;
  }

  // Execute a payment for a service endpoint
  // Implements: HTTP 402 challenge → sign payment → retry with payment header
  async pay(
    endpoint: string,
    amount: bigint,
    token: string,
    payload?: unknown
  ): Promise<Result<{ response: unknown; proof: PaymentProof }, PaymentError>> {
    try {
      // Step 1: Make initial request
      const initialResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      });

      // Step 2: Check for 402 Payment Required
      if (initialResponse.status === 402) {
        const challenge = (await initialResponse.json()) as {
          recipient: string;
          nonce: string;
          amount: string;
          token: string;
        };

        // Step 3: Create and sign payment proof
        const proofResult = await this.createPaymentProof(
          amount,
          token,
          challenge.recipient,
          challenge.nonce
        );

        if (proofResult.isErr()) {
          return err(proofResult.error);
        }

        const proof = proofResult.value;

        // Step 4: Retry with payment header
        const paidResponse = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Payment': JSON.stringify(proof),
          },
          body: JSON.stringify(payload ?? {}),
        });

        if (!paidResponse.ok) {
          return err(new PaymentError(`Payment accepted but request failed: ${paidResponse.status}`));
        }

        const responseData = await paidResponse.json();
        return ok({ response: responseData, proof });
      }

      // No payment required, return response
      const data = await initialResponse.json();
      const freeProof: PaymentProof = {
        token,
        amount: '0',
        recipient: '',
        signature: '',
        nonce: generateNonce(),
        chainId: this.chainId,
        timestamp: Date.now(),
      };
      return ok({ response: data, proof: freeProof });
    } catch (error) {
      return err(new PaymentError(`x402 payment failed: ${String(error)}`));
    }
  }

  // Create a signed payment proof
  async createPaymentProof(
    amount: bigint,
    token: string,
    recipient: string,
    nonce?: string
  ): Promise<Result<PaymentProof, PaymentError>> {
    try {
      const paymentNonce = nonce ?? generateNonce();
      const paymentData = {
        token,
        amount: amount.toString(),
        recipient,
        nonce: paymentNonce,
        chainId: this.chainId,
        timestamp: Date.now(),
      };

      const message = JSON.stringify(paymentData);
      const signature = await this.wallet.signMessage(message);

      const proof: PaymentProof = {
        ...paymentData,
        signature,
      };

      return ok(proof);
    } catch (error) {
      return err(new PaymentError(`Failed to create payment proof: ${String(error)}`));
    }
  }

  // Create a payment server middleware that requires x402 payment
  createPaymentChallenge(
    pricePerCall: bigint,
    recipient: string
  ): {
    nonce: string;
    recipient: string;
    amount: string;
    token: string;
    chainId: number;
  } {
    return {
      nonce: generateNonce(),
      recipient,
      amount: pricePerCall.toString(),
      token: this.usdcAddress,
      chainId: this.chainId,
    };
  }

  // Verify a payment proof signature
  async verifyPayment(proof: PaymentProof): Promise<Result<boolean, PaymentError>> {
    try {
      const { ethers } = await import('ethers');
      const paymentData = {
        token: proof.token,
        amount: proof.amount,
        recipient: proof.recipient,
        nonce: proof.nonce,
        chainId: proof.chainId,
        timestamp: proof.timestamp,
      };

      const message = JSON.stringify(paymentData);
      // ethers.verifyMessage recovers the address that signed the message
      const signerAddress = ethers.verifyMessage(message, proof.signature);

      // Verify the recovered signer is a valid non-zero address
      const isValid = ethers.isAddress(signerAddress) && signerAddress !== ethers.ZeroAddress;
      return ok(isValid);
    } catch (error) {
      return err(new PaymentError(`Payment verification failed: ${String(error)}`));
    }
  }

  getAddress(): string {
    return this.wallet.address;
  }
}
