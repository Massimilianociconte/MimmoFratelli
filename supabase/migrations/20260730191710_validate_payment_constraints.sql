-- Validate the payment integrity constraints only after proving that legacy
-- rows are clean. The exception contains aggregate counts only: no customer,
-- order, gift-card or payment identifiers can leak into deployment logs.

DO $$
DECLARE
  v_bad_user_credits BIGINT;
  v_bad_gift_cards BIGINT;
  v_bad_promotions BIGINT;
  v_bad_referrals BIGINT;
  v_bad_pending_sessions BIGINT;
BEGIN
  SELECT COUNT(*)
  INTO v_bad_user_credits
  FROM public.user_credits
  WHERE total_earned < 0
    OR total_spent < 0;

  SELECT COUNT(*)
  INTO v_bad_gift_cards
  FROM public.gift_cards
  WHERE remaining_balance < 0
    OR remaining_balance > amount
    OR balance < 0
    OR balance > amount;

  SELECT COUNT(*)
  INTO v_bad_promotions
  FROM public.promotions
  WHERE discount_value <= 0
    OR (discount_type = 'percentage' AND discount_value > 100)
    OR (max_discount IS NOT NULL AND max_discount <= 0)
    OR (usage_limit IS NOT NULL AND usage_limit <= 0)
    OR usage_count < 0
    OR (usage_limit IS NOT NULL AND usage_count > usage_limit);

  SELECT COUNT(*)
  INTO v_bad_referrals
  FROM public.referrals
  WHERE reward_amount <= 0;

  SELECT COUNT(*)
  INTO v_bad_pending_sessions
  FROM public.pending_checkout_sessions
  WHERE ABS(
    total - (
      subtotal + shipping_cost
      - discount_amount
      - gift_card_amount
      - user_credit_amount
    )
  ) > 0.01;

  IF v_bad_user_credits > 0
    OR v_bad_gift_cards > 0
    OR v_bad_promotions > 0
    OR v_bad_referrals > 0
    OR v_bad_pending_sessions > 0
  THEN
    RAISE EXCEPTION
      'Payment constraint validation blocked: user_credits=%, gift_cards=%, promotions=%, referrals=%, pending_sessions=%',
      v_bad_user_credits,
      v_bad_gift_cards,
      v_bad_promotions,
      v_bad_referrals,
      v_bad_pending_sessions
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE public.user_credits
  VALIDATE CONSTRAINT user_credits_totals_nonnegative;
ALTER TABLE public.gift_cards
  VALIDATE CONSTRAINT gift_cards_remaining_balance_range;
ALTER TABLE public.promotions
  VALIDATE CONSTRAINT promotions_value_range;
ALTER TABLE public.referrals
  VALIDATE CONSTRAINT referrals_reward_positive;
ALTER TABLE public.pending_checkout_sessions
  VALIDATE CONSTRAINT pending_checkout_amounts_reconcile;
