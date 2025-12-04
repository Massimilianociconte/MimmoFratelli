# Implementation Plan

- [x] 1. Database Schema Setup




  - [x] 1.1 Create migration for `referrals` table with indexes and constraints
    - Include `referrer_id`, `referee_id`, `status`, `reward_amount`, `ip_address` columns
    - Add unique constraint on `referee_id` and check constraint for no self-referral
    - _Requirements: 3.2, 5.1_
  - [x] 1.2 Create migration for `user_referral_codes` table

    - Include `user_id`, `code`, `is_active`, statistics columns
    - Add unique constraint on `code`

    - _Requirements: 2.1_


  - [x] 1.3 Create migration for `system_config` table with default values




    - Insert default config for discount percentages, reward amount, limits
    - _Requirements: 6.3_

  - [x] 1.4 Add `is_first_order_code` and `referral_bonus` columns to `promotions` table
    - _Requirements: 1.1, 3.3_
  - [x] 1.5 Write property test for referral code uniqueness

    - **Property 5: Referral Code Format**
    - **Validates: Requirements 2.1**


- [x] 2. Referral Code Generation and Storage Service

  - [x] 2.1 Create `js/services/referral.js` with code generation logic
    - Implement `generateReferralCode()` - 8 alphanumeric characters
    - Implement `getMyReferralCode()` - fetch from `user_referral_codes`
    - _Requirements: 2.1, 2.2_




  - [x] 2.2 Implement referral URL capture and localStorage persistence
    - `captureReferralFromUrl()` - parse `?ref=` parameter
    - `getStoredReferralCode()` / `clearStoredReferralCode()`
    - _Requirements: 3.1_
  - [x] 2.3 Write property test for referral code persistence
    - **Property 7: Referral Code Persistence**
    - **Validates: Requirements 3.1**
  - [x] 2.4 Implement share link generation
    - `generateShareLink()` - returns URL with `?ref=CODE`
    - _Requirements: 2.4_
  - [x] 2.5 Write property test for share link format
    - **Property 6: Referral Link Format**
    - **Validates: Requirements 2.4**
  - [x] 2.6 Implement share actions (WhatsApp, Email, Copy)
    - `shareViaWhatsApp()`, `shareViaEmail()`, `copyToClipboard()`
    - _Requirements: 2.3_


- [x] 3. First Order Code Generation
  - [x] 3.1 Create Supabase Edge Function `handle-signup`
    - Trigger on auth.users insert via database webhook or Supabase Auth hook
    - Generate BENVENUTO-XXXXXX code with 10% discount, 30-day validity
    - Generate permanent 8-char referral code
    - _Requirements: 1.1, 1.2, 2.1_
  - [x] 3.2 Write property test for first order code generation
    - **Property 1: First Order Code Generation**
    - **Validates: Requirements 1.1**
  - [x] 3.3 Write property test for first order code configuration
    - **Property 2: First Order Code Configuration**
    - **Validates: Requirements 1.2, 3.3**
  - [x] 3.4 Implement referral relationship creation in `handle-signup`
    - Check if stored referral code is valid
    - Create row in `referrals` table
    - Upgrade discount to 15% if valid referral
    - _Requirements: 3.2, 3.3_
  - [x] 3.5 Write property test for referral relationship creation
    - **Property 8: Referral Relationship Creation**
    - **Validates: Requirements 3.2**
  - [x] 3.6 Implement self-referral prevention
    - Check if referral code belongs to registering user (by email match)
    - Skip referral creation if self-referral detected
    - _Requirements: 5.1_
  - [x] 3.7 Write property test for self-referral prevention
    - **Property 13: Self-Referral Prevention**
    - **Validates: Requirements 5.1**
  - [x] 3.8 Implement invalid referral fallback
    - Proceed with standard 10% code if referral code invalid
    - _Requirements: 3.4_
  - [x] 3.9 Write property test for invalid referral fallback

    - **Property 9: Invalid Referral Fallback**
    - **Validates: Requirements 3.4**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. First Order Code Application in Checkout
  - [x] 5.1 Extend `promotions.js` with `getFirstOrderCode(userId)`
    - Query promotions where `is_first_order_code = true` and `user_id` matches
    - Return code details if unused and not expired
    - _Requirements: 1.3_
  - [x] 5.2 Implement `hasCompletedOrder(userId)` check
    - Query orders table for completed payments
    - _Requirements: 1.4_
  - [x] 5.3 Implement first-order code validation in `isFirstOrderCodeValid()`
    - Check user has no completed orders
    - Check code not expired and not used
    - _Requirements: 1.4_
  - [x] 5.4 Write property test for first order code restriction
    - **Property 3: First Order Code Restriction**
    - **Validates: Requirements 1.4**
  - [x] 5.5 Update discount calculation to exclude shipping
    - Modify `calculateDiscount()` to apply percentage only to subtotal
    - _Requirements: 1.5_
  - [x] 5.6 Write property test for discount calculation
    - **Property 4: Discount Calculation Excludes Shipping**
    - **Validates: Requirements 1.5**
  - [x] 5.7 Update checkout UI to auto-display first-order code
    - Show banner/badge if user has unused first-order code
    - _Requirements: 1.3_

- [x] 6. Referral Reward Processing
  - [x] 6.1 Extend `stripe-webhook` to detect referee's first order
    - Check if user has referral relationship with status 'pending'
    - _Requirements: 4.1, 4.2_
  - [x] 6.2 Implement referrer credit addition
    - Add reward amount to `user_credits.balance`
    - Create transaction record in `credit_transactions`
    - _Requirements: 4.1_
  - [x] 6.3 Write property test for referral reward credit
    - **Property 10: Referral Reward Credit**
    - **Validates: Requirements 4.1**
  - [x] 6.4 Update referral status to 'converted'
    - Set `status = 'converted'`, `reward_credited = true`, `converted_at = NOW()`
    - _Requirements: 4.2_
  - [x] 6.5 Write property test for referral conversion status
    - **Property 11: Referral Conversion Status**
    - **Validates: Requirements 4.2**
  - [x] 6.6 Implement IP rate limiting for rewards
    - Track IP in referrals table
    - Skip reward if >3 conversions from same IP in 24h
    - _Requirements: 5.2_
  - [x] 6.7 Write property test for IP rate limiting
    - **Property 14: IP Rate Limiting**
    - **Validates: Requirements 5.2**
  - [x] 6.8 Send notification to referrer (push/email)
    - Use existing Firebase notification service
    - _Requirements: 4.3_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Refund Handling
  - [x] 8.1 Create or extend refund webhook handler
    - Detect refunds within 14-day window
    - Check if order was a referral conversion
    - _Requirements: 5.3_
  - [x] 8.2 Implement credit revocation logic
    - Decrement referrer's `user_credits.balance`
    - Create negative transaction record
    - Update referral status to 'revoked'
    - _Requirements: 5.3_
  - [x] 8.3 Write property test for refund credit revocation
    - **Property 15: Refund Credit Revocation**
    - **Validates: Requirements 5.3**

- [x] 9. Referral Statistics and Profile UI
  - [x] 9.1 Implement `getReferralStats()` in referral service
    - Count total referrals, conversions, pending, total earned
    - _Requirements: 4.4_
  - [x] 9.2 Write property test for statistics accuracy
    - **Property 12: Referral Statistics Accuracy**
    - **Validates: Requirements 4.4**
  - [x] 9.3 Implement `getReferralHistory()` for detailed list
    - Return list of referrals with status and dates
    - _Requirements: 4.4_
  - [x] 9.4 Create referral section UI in profile/settings page
    - Display referral code with copy button
    - Share buttons (WhatsApp, Email)
    - Statistics dashboard
    - Referral history list
    - _Requirements: 2.2, 2.3, 4.4_

- [x] 10. Admin Panel Extensions
  - [x] 10.1 Add first-order codes statistics to admin dashboard
    - Total generated, used, conversion rate, average order value
    - _Requirements: 6.1_
  - [x] 10.2 Add referral statistics to admin dashboard
    - Top referrers, total conversions, credits issued, trends
    - _Requirements: 6.2_
  - [x] 10.3 Implement system config editor for admin
    - Edit discount percentages, reward amount, validity days
    - Changes apply only to new codes
    - _Requirements: 6.3_
  - [x] 10.4 Write property test for configuration immutability
    - **Property 16: Configuration Immutability for Existing Codes**
    - **Validates: Requirements 6.3**
  - [x] 10.5 Implement user suspension for abuse
    - Invalidate all referral codes for suspended user
    - Block future rewards
    - _Requirements: 6.4_
  - [x] 10.6 Write property test for user suspension
    - **Property 17: User Suspension Invalidation**
    - **Validates: Requirements 6.4**
  - [x] 10.7 Add alert for referrers reaching 50 conversions
    - Notify admin for manual review
    - _Requirements: 5.4_

- [x] 11. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
