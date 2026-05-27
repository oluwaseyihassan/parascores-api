import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';

/**
 * Low-level HTTP wrapper around the Paystack REST API.
 * Uses native fetch — no extra dependencies needed.
 */
@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly baseUrl = 'https://api.paystack.co';
  private readonly secretKey: string;

  constructor() {
    this.secretKey = process.env.PAYSTACK_SECRET_KEY || '';
    if (!this.secretKey) {
      this.logger.warn(
        'PAYSTACK_SECRET_KEY is not set — Paystack API calls will fail',
      );
    }
  }

  // ─── Helpers ─────────────────────────────────────────────

  private get headers() {
    return {
      Authorization: `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  private async request<T = any>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, any>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    this.logger.debug(`Paystack ${method} ${path}`);

    const res = await fetch(url, {
      method,
      headers: this.headers,
      ...(body && { body: JSON.stringify(body) }),
    });

    const data = await res.json();

    if (!res.ok || data.status === false) {
      this.logger.error(
        `Paystack error: ${data.message || res.statusText}`,
        JSON.stringify(data),
      );
      throw new Error(data.message || `Paystack API error: ${res.status}`);
    }

    return data as T;
  }

  // ─── Transactions ────────────────────────────────────────

  /**
   * Initialize a transaction (one-time or subscription).
   * If `plan` is provided, Paystack creates a subscription on successful payment.
   */
  async initializeTransaction(params: {
    email: string;
    amount?: number; // In kobo/cents — omit when using a plan
    plan?: string; // Plan code (e.g. PLN_xxx) — overrides amount
    metadata?: Record<string, any>;
    callback_url?: string;
  }) {
    return this.request<{
      status: boolean;
      message: string;
      data: {
        authorization_url: string;
        access_code: string;
        reference: string;
      };
    }>('POST', '/transaction/initialize', params);
  }

  /**
   * Verify a transaction by its reference.
   */
  async verifyTransaction(reference: string) {
    return this.request<{
      status: boolean;
      message: string;
      data: {
        id: number;
        status: string; // 'success' | 'failed' | 'abandoned'
        reference: string;
        amount: number;
        currency: string;
        customer: {
          id: number;
          email: string;
          customer_code: string;
        };
        plan_object?: {
          id: number;
          plan_code: string;
          name: string;
          amount: number;
          interval: string;
        };
        plan?: string;
        metadata?: any;
      };
    }>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  }

  // ─── Customers ───────────────────────────────────────────

  async createCustomer(params: {
    email: string;
    first_name?: string;
    last_name?: string;
  }) {
    return this.request<{
      status: boolean;
      data: {
        id: number;
        customer_code: string;
        email: string;
      };
    }>('POST', '/customer', params);
  }

  // ─── Subscriptions ──────────────────────────────────────

  async createSubscription(params: {
    customer: string; // customer_code or email
    plan: string; // plan_code
  }) {
    return this.request<{
      status: boolean;
      data: {
        subscription_code: string;
        email_token: string;
        status: string;
      };
    }>('POST', '/subscription', params);
  }

  async fetchSubscription(subscriptionCodeOrId: string) {
    return this.request<{
      status: boolean;
      data: {
        id: number;
        subscription_code: string;
        plan: {
          plan_code: string;
          name: string;
          amount: number;
          interval: string;
        };
        status: string;
        next_payment_date: string;
        email_token: string;
        customer: {
          customer_code: string;
          email: string;
        };
      };
    }>('GET', `/subscription/${encodeURIComponent(subscriptionCodeOrId)}`);
  }

  async disableSubscription(params: {
    code: string; // subscription_code
    token: string; // email_token
  }) {
    return this.request('POST', '/subscription/disable', params);
  }

  // ─── Refunds ─────────────────────────────────────────────

  /**
   * Refund a transaction by its reference or ID.
   */
  async refundTransaction(params: {
    transaction: string;
    amount?: number; // In kobo
    merchant_note?: string;
    customer_note?: string;
  }) {
    return this.request<{
      status: boolean;
      message: string;
      data: any;
    }>('POST', '/refund', params);
  }

  // ─── Webhooks ────────────────────────────────────────────

  /**
   * Verify that a webhook payload genuinely came from Paystack.
   * Uses HMAC-SHA512 with your secret key.
   */
  verifyWebhookSignature(rawBody: string | Buffer, signature: string): boolean {
    const hash = createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');
    return hash === signature;
  }
}
