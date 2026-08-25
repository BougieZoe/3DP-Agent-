/**
 * Stripe Payment Integration
 *
 * Handles Pro plan subscriptions:
 * - POST /api/stripe/checkout → Create Stripe Checkout session
 * - POST /api/stripe/webhook → Handle Stripe webhooks (subscription events)
 * - GET /api/stripe/portal → Create Stripe Customer Portal session
 *
 * Environment variables required:
 * - STRIPE_SECRET_KEY
 * - STRIPE_WEBHOOK_SECRET
 * - STRIPE_PRICE_ID (Pro plan monthly price)
 */

import { Router } from 'express';
import { logger } from './logger';
import { sb } from './supabase';

// ── Stripe config ──────────────────────────────────────────────────────────

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID;
const PRO_MONTHLY_LIMIT = Number(process.env.PRO_MONTHLY_LIMIT || 1000);

// Lazy-load stripe to avoid startup crash if key is missing
let _stripe: InstanceType<typeof import('stripe').Stripe> | null = null;
async function getStripe() {
  if (!STRIPE_SECRET_KEY) return null;
  if (!_stripe) {
    const StripeModule = await import('stripe');
    const Stripe = StripeModule.default;
    _stripe = new Stripe(STRIPE_SECRET_KEY);
  }
  return _stripe;
}

// ── Router ─────────────────────────────────────────────────────────────────

export function createStripeRouter(): Router {
  const router = Router();

  /**
   * Create a Stripe Checkout session for Pro plan upgrade.
   * Requires authenticated user (bearer token).
   */
  router.post('/checkout', async (req, res) => {
    try {
      const stripe = await getStripe();
      if (!stripe) {
        res.status(503).json({ error: 'Stripe not configured' });
        return;
      }

      // Get user from bearer token
      const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!bearer) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { verifyUser } = await import('./supabase');
      const user = await verifyUser(bearer);
      if (!user) {
        res.status(401).json({ error: 'Invalid session' });
        return;
      }

      if (!STRIPE_PRICE_ID) {
        res.status(503).json({ error: 'Stripe price not configured' });
        return;
      }

      // Create or retrieve Stripe customer
      const { data: profile } = await sb!.from('profiles').select('stripe_customer_id, email').eq('id', user.id).single();
      let customerId = profile?.stripe_customer_id;

      if (!customerId) {
        const customer = await stripe.customers.create({
          metadata: { supabase_user_id: user.id },
        });
        customerId = customer.id;
        await sb!.from('profiles').update({ stripe_customer_id: customerId }).eq('id', user.id);
      }

      // Create Checkout Session
      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
        success_url: `${req.headers.origin || 'https://3dp-agent.vercel.app'}/?upgraded=true`,
        cancel_url: `${req.headers.origin || 'https://3dp-agent.vercel.app'}/?cancelled=true`,
        metadata: { supabase_user_id: user.id },
      });

      res.json({ url: session.url });
    } catch (err) {
      logger.error('Stripe checkout failed', {
        context: 'stripe',
        error: err instanceof Error ? err : new Error(String(err)),
      });
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  });

  /**
   * Stripe Webhook handler — processes subscription lifecycle events.
   * Must be registered with express.raw() for signature verification.
   */
  router.post('/webhook', async (req, res) => {
    try {
      const stripe = await getStripe();
      if (!stripe || !STRIPE_WEBHOOK_SECRET) {
        res.status(503).json({ error: 'Stripe not configured' });
        return;
      }

      const sig = req.headers['stripe-signature'];
      if (!sig || typeof sig !== 'string') {
        res.status(400).json({ error: 'Missing signature' });
        return;
      }

      // Verify webhook signature
      const event = stripe.webhooks.constructEvent(
        req.body, // raw body from express.raw()
        sig,
        STRIPE_WEBHOOK_SECRET,
      );

      logger.info(`Stripe webhook: ${event.type}`, { context: 'stripe' });

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const userId = session.metadata?.supabase_user_id;
          if (userId) {
            await sb!.from('profiles').update({
              plan: 'pro',
              stripe_subscription_id: session.subscription as string,
            }).eq('id', userId);
            logger.info(`User ${userId} upgraded to Pro`, { context: 'stripe' });
          }
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object;
          // Find user by subscription ID
          const { data: profiles } = await sb!.from('profiles').select('id').eq('stripe_subscription_id', subscription.id);
          if (profiles && profiles.length > 0) {
            await sb!.from('profiles').update({
              plan: 'free',
              stripe_subscription_id: null,
            }).eq('id', profiles[0].id);
            logger.info(`User ${profiles[0].id} downgraded to Free`, { context: 'stripe' });
          }
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as { subscription?: string | null };
          const subscriptionId = invoice.subscription;
          if (subscriptionId) {
            const { data: profiles } = await sb!.from('profiles').select('id').eq('stripe_subscription_id', subscriptionId);
            if (profiles && profiles.length > 0) {
              logger.warn(`Payment failed for user ${profiles[0].id}`, { context: 'stripe' });
            }
          }
          break;
        }
      }

      res.json({ received: true });
    } catch (err) {
      logger.error('Stripe webhook error', {
        context: 'stripe',
        error: err instanceof Error ? err : new Error(String(err)),
      });
      res.status(400).json({ error: 'Webhook handler failed' });
    }
  });

  /**
   * Create a Stripe Customer Portal session for managing subscription.
   */
  router.get('/portal', async (req, res) => {
    try {
      const stripe = await getStripe();
      if (!stripe) {
        res.status(503).json({ error: 'Stripe not configured' });
        return;
      }

      const authHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
      const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!bearer) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const { verifyUser } = await import('./supabase');
      const user = await verifyUser(bearer);
      if (!user) {
        res.status(401).json({ error: 'Invalid session' });
        return;
      }

      const { data: profile } = await sb!.from('profiles').select('stripe_customer_id').eq('id', user.id).single();
      if (!profile?.stripe_customer_id) {
        res.status(400).json({ error: 'No Stripe customer found' });
        return;
      }

      const session = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: `${req.headers.origin || 'https://3dp-agent.vercel.app'}/`,
      });

      res.json({ url: session.url });
    } catch (err) {
      logger.error('Stripe portal failed', {
        context: 'stripe',
        error: err instanceof Error ? err : new Error(String(err)),
      });
      res.status(500).json({ error: 'Failed to create portal session' });
    }
  });

  return router;
}
