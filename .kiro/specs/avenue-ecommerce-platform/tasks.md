# Implementation Plan

## Phase 1: Project Setup and Database Foundation

- [x] 1. Initialize project structure and dependencies






  - [x] 1.1 Create folder structure for js modules (js/services/, js/utils/, js/components/)


  - [x] 1.2 Set up Vitest and fast-check for testing
    - Install vitest, @vitest/ui, fast-check as dev dependencies
    - Create vitest.config.js with 100 minimum iterations for property tests
    - _Requirements: Testing Strategy_

  - [x] 1.3 Create Supabase client configuration
    - Create js/supabase.js with client initialization
    - Set up environment variables for SUPABASE_URL and SUPABASE_ANON_KEY
    - _Requirements: 12.1_

- [x] 2. Set up Supabase database schema

  - [x] 2.1 Create database migration for core tables
    - Create profiles, user_roles, categories, products tables
    - Add indexes on category_id, price, gender, is_active
    - _Requirements: 12.1, 12.2, 12.6_
  - [x] 2.2 Create database migration for e-commerce tables
    - Create wishlist_items, cart_items, orders, order_items tables
    - Add foreign key constraints for referential integrity
    - _Requirements: 12.1, 12.3_
  - [x] 2.3 Create database migration for promotions and gift cards
    - Create promotions, gift_cards, audit_log tables
    - _Requirements: 12.1_
  - [x] 2.4 Implement Row Level Security policies
    - Create RLS policies for all tables as defined in design
    - Test admin vs customer access patterns
    - _Requirements: 12.4, 12.5, 6.1, 6.6_
  - [x] 2.5 Write property test for database referential integrity
    - **Property 23: Order referential integrity**
    - **Validates: Requirements 12.3**




  - [x] 2.6 Write property test for user data isolation
    - **Property 24: User data isolation**
    - **Validates: Requirements 12.4**


- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.



## Phase 2: Authentication System

- [x] 4. Implement authentication service


  - [x] 4.1 Create AuthService module (js/services/auth.js)

    - Implement signUp with email, password, and user metadata
    - Implement signIn with email and password

    - Implement signOut and session management
    - Implement onAuthStateChange listener

    - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - [x] 4.2 Implement rate limiting for login attempts
    - Track failed attempts by IP in localStorage or Supabase
    - Block after 5 failed attempts within 15 minutes
    - _Requirements: 1.7_
  - [x] 4.3 Create authentication UI components
    - Create login modal/page with form validation


    - Create registration modal/page with form validation

    - Display generic error message for invalid credentials
    - _Requirements: 1.1, 1.4_
  - [x] 4.4 Write property test for login error consistency

    - **Property 1: Login error message consistency**
    - **Validates: Requirements 1.4**
  - [x] 4.5 Write property test for session validity
    - **Property 2: Session validity after login**
    - **Validates: Requirements 1.3**
  - [x] 4.6 Write property test for session invalidation
    - **Property 3: Session invalidation on logout**
    - **Validates: Requirements 1.5**
  - [x] 4.7 Write property test for rate limiting
    - **Property 4: Rate limiting enforcement**
    - **Validates: Requirements 1.7**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.



## Phase 3: Product Catalog and Filtering

- [x] 6. Implement product service
  - [x] 6.1 Create ProductService module (js/services/products.js)
    - Implement getProducts with filter support
    - Implement getProductById


    - Implement getCategories
    - Implement searchProducts
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [x] 6.2 Update collection.html to fetch products from Supabase
    - Replace hardcoded products array with Supabase queries
    - Implement dynamic product card rendering
    - _Requirements: 7.1_
  - [x] 6.3 Implement advanced filter UI
    - Add price range slider/inputs
    - Add category dropdown/checkboxes
    - Add gender filter buttons
    - Add sort options (price, newest, popular)
    - _Requirements: 7.1, 7.2, 7.3, 7.5_
  - [x] 6.4 Update product.html to fetch from Supabase
    - Load product details dynamically
    - Display size and color options

    - _Requirements: 7.1_
  - [x] 6.5 Write property test for filter correctness

    - **Property 18: Filter correctness**
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**


- [x] 7. Checkpoint - Ensure all tests pass


  - Ensure all tests pass, ask the user if questions arise.

## Phase 4: Wishlist System (Hybrid)

- [x] 8. Implement wishlist service
  - [x] 8.1 Create WishlistService module (js/services/wishlist.js)
    - Implement localStorage operations for guests
    - Implement Supabase operations for authenticated users
    - Implement merge logic with deduplication
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6_
  - [x] 8.2 Implement wishlist migration on registration
    - Migrate localStorage items to Supabase after signUp
    - Clear localStorage after successful migration
    - _Requirements: 2.3_
  - [x] 8.3 Implement wishlist merge on login
    - Fetch existing Supabase wishlist
    - Merge with localStorage items (union, no duplicates)
    - Update Supabase and clear localStorage
    - _Requirements: 2.4, 2.6_
  - [x] 8.4 Update collection.html wishlist UI
    - Integrate WishlistService with existing heart button
    - Show wishlist count in header
    - _Requirements: 2.1, 2.2_
  - [x] 8.5 Write property test for guest wishlist persistence
    - **Property 5: Guest wishlist localStorage persistence**
    - **Validates: Requirements 2.1**
  - [x] 8.6 Write property test for authenticated wishlist persistence
    - **Property 6: Authenticated wishlist Supabase persistence**
    - **Validates: Requirements 2.2**
  - [x] 8.7 Write property test for wishlist migration
    - **Property 7: Wishlist migration completeness**
    - **Validates: Requirements 2.3**
  - [x] 8.8 Write property test for wishlist merge deduplication
    - **Property 8: Wishlist merge deduplication**
    - **Validates: Requirements 2.4, 2.6**

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 5: Shopping Cart

- [x] 10. Implement cart service
  - [x] 10.1 Create CartService module (js/services/cart.js)
    - Implement addToCart with size, color, quantity
    - Implement updateQuantity
    - Implement removeFromCart
    - Implement getCartTotal with discount calculation
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 10.2 Implement cart synchronization for authenticated users
    - Sync cart to Supabase on changes
    - Load cart from Supabase on login
    - _Requirements: 3.4_
  - [x] 10.3 Create cart UI component
    - Create cart drawer/modal with item list
    - Display item details (image, name, size, color, quantity, price)
    - Add quantity controls and remove button
    - Display subtotal, discount, shipping, total
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 10.4 Update product.html with add to cart functionality
    - Add size selector
    - Add color selector
    - Add quantity input
    - Connect to CartService
    - _Requirements: 3.1_
  - [x] 10.5 Write property test for cart item storage
    - **Property 9: Cart item storage integrity**
    - **Validates: Requirements 3.1**
  - [x] 10.6 Write property test for cart total invariant
    - **Property 10: Cart total invariant**
    - **Validates: Requirements 3.2, 3.3**
  - [x] 10.7 Write property test for cart sync
    - **Property 11: Cart cross-device synchronization**
    - **Validates: Requirements 3.4**

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 6: Payment Integration

- [x] 12. Implement payment gateway
  - [x] 12.1 Create PaymentGateway module (js/services/payment.js)
    - Implement createStripeSession using Stripe Checkout
    - Implement createPayPalOrder
    - Implement createKlarnaSession for installments
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7_
  - [x] 12.2 Create Supabase Edge Function for Stripe webhook
    - Handle checkout.session.completed event
    - Create order record on successful payment
    - _Requirements: 4.4_
  - [x] 12.3 Create checkout page (checkout.html)
    - Display order summary
    - Require authentication before payment
    - Show payment method options (Stripe, PayPal, Klarna)
    - _Requirements: 3.5, 4.1, 4.2, 4.3_
  - [x] 12.4 Implement payment success/failure handling
    - Create success page with order confirmation
    - Create failure page with retry option
    - _Requirements: 4.4, 4.5_
  - [x] 12.5 Write property test for order creation on payment
    - **Property 12: Order creation on payment success**
    - **Validates: Requirements 4.4**
  - [x] 12.6 Write property test for no sensitive data storage
    - **Property 13: No sensitive payment data storage**
    - **Validates: Requirements 4.6**

- [x] 13. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 7: Order Management and Shipping

- [x] 14. Implement order service
  - [x] 14.1 Create OrderService module (js/services/orders.js)
    - Implement createOrder from payment result
    - Implement getOrderHistory
    - Implement getOrderById
    - _Requirements: 5.4_
  - [x] 14.2 Create Supabase Edge Function for courier integration
    - Implement submitToCourier with configurable courier (BRT, DHL, GLS)
    - Handle courier API response (success/error)
    - Update order with tracking info or flag for manual review
    - _Requirements: 5.1, 5.2, 5.3, 5.6_
  - [x] 14.3 Create order history page (orders.html)
    - Display list of user's orders
    - Show order status, items, total, tracking link
    - _Requirements: 5.4_
  - [x] 14.4 Implement order status email notifications
    - Create Edge Function for email sending
    - Trigger on order status changes
    - _Requirements: 5.5_
  - [x] 14.5 Write property test for courier integration
    - **Property 14: Courier API integration**
    - **Validates: Requirements 5.1, 5.2, 5.3**
  - [x] 14.6 Write property test for order history
    - **Property 15: Order history completeness**
    - **Validates: Requirements 5.4**

- [x] 15. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 8: CMS Panel

- [x] 16. Implement CMS service and admin panel
  - [x] 16.1 Create CMSService module (js/services/cms.js)
    - Implement product CRUD operations
    - Implement category management
    - Implement image upload to Supabase Storage
    - _Requirements: 6.2, 6.3, 6.4, 6.5_
  - [x] 16.2 Create admin authentication check
    - Verify user has admin role before CMS access
    - Redirect non-admins to homepage
    - _Requirements: 6.1_
  - [x] 16.3 Create admin dashboard (admin/index.html)
    - Display product list with edit/delete actions
    - Add new product form
    - Category management section
    - _Requirements: 6.2, 6.3, 6.4_
  - [x] 16.4 Implement product image upload
    - Multi-image upload with preview
    - Store in Supabase Storage
    - Generate optimized variants
    - _Requirements: 6.5_
  - [x] 16.5 Write property test for admin access control
    - **Property 16: Admin-only CMS access**
    - **Validates: Requirements 6.1, 6.6**
  - [x] 16.6 Write property test for soft delete
    - **Property 17: Product soft-delete preservation**
    - **Validates: Requirements 6.4**

- [x] 17. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 9: Promotions System

- [x] 18. Implement promotions service
  - [x] 18.1 Create PromotionService module (js/services/promotions.js)
    - Implement getActivePromotions (filter by date and is_active)
    - Implement applyPromotion to cart
    - Implement calculateDiscount (percentage or fixed)
    - _Requirements: 10.1, 10.2, 10.3_
  - [x] 18.2 Create promotions page (promos.html)
    - Display active promotions with images and details
    - Show discount percentage and validity dates
    - Link to promotional products
    - _Requirements: 10.1_
  - [x] 18.3 Integrate promotions with cart
    - Auto-apply promotions to eligible products
    - Display discount in cart summary
    - _Requirements: 10.3_
  - [x] 18.4 Add promotion management to CMS
    - Create/edit/deactivate promotions
    - Set discount type, value, dates
    - _Requirements: 10.1, 10.2_
  - [x] 18.5 Write property test for promotion visibility
    - **Property 19: Promotion visibility by date**
    - **Validates: Requirements 10.1, 10.2**
  - [x] 18.6 Write property test for discount calculation
    - **Property 20: Promotion discount calculation**
    - **Validates: Requirements 10.3**

- [x] 19. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 10: Gift Card System

- [x] 20. Implement gift card service
  - [x] 20.1 Create GiftCardService module (js/services/giftcard.js)
    - Implement createGiftCard preview
    - Implement purchaseGiftCard with unique code generation
    - Implement validateCode
    - Implement redeemGiftCard with balance calculation
    - _Requirements: 11.1, 11.3, 11.4, 11.5_
  - [x] 20.2 Create gift card creator page (giftcard.html)
    - Template selection with visual previews
    - Amount selection (preset or custom)
    - Recipient/sender name inputs
    - Personal message textarea
    - Real-time preview with animations
    - _Requirements: 11.1, 11.2_
  - [x] 20.3 Integrate gift card with checkout
    - Add gift card code input field
    - Validate and apply balance to order total
    - _Requirements: 11.5_
  - [x] 20.4 Create Edge Function for gift card email delivery
    - Send gift card code to recipient email
    - Include personalized message and design
    - _Requirements: 11.4_
  - [x] 20.5 Write property test for code uniqueness
    - **Property 21: Gift card code uniqueness**
    - **Validates: Requirements 11.4**
  - [x] 20.6 Write property test for redemption balance
    - **Property 22: Gift card redemption balance**
    - **Validates: Requirements 11.5**

- [x] 21. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Phase 11: UI/UX Enhancements

- [x] 22. Implement UI updates
  - [x] 22.1 Update branding to "Avenue M."
    - Update logo text in all pages
    - Increase logo font size
    - Update page titles and meta tags
    - _Requirements: 8.1_
  - [x] 22.2 Optimize product grid density
    - Reduce card size for 5-6 cards per row on desktop
    - Adjust responsive breakpoints for 2 cards on mobile
    - _Requirements: 8.2, 8.4_
  - [x] 22.3 Enhance quick-view functionality
    - Improve quick-view modal design
    - Add size/color selection in quick-view
    - Add to cart directly from quick-view
    - _Requirements: 8.3_

- [x] 23. Create About Us page
  - [x] 23.1 Create about.html page
    - Company history section with timeline
    - Mission statement
    - Team section with photos
    - Visual elements and imagery
    - _Requirements: 9.1, 9.2_

## Phase 12: Security and Error Handling

- [x] 24. Implement security measures
  - [x] 24.1 Create input validation utilities (js/utils/validation.js)
    - Schema validation for all API inputs
    - Sanitize user inputs
    - _Requirements: 13.1_
  - [x] 24.2 Implement error handling utilities (js/utils/errors.js)
    - Centralized error handler
    - User-friendly error messages
    - Server-side error logging
    - _Requirements: 13.2_
  - [x] 24.3 Implement audit logging
    - Create audit log entries for sensitive operations
    - Log user_id, action, timestamp
    - _Requirements: 13.3_
  - [x] 24.4 Configure CORS and security headers
    - Set up allowed origins
    - Add security headers to responses
    - _Requirements: 13.4_
  - [x] 24.5 Write property test for input validation
    - **Property 25: Input validation**
    - **Validates: Requirements 13.1**
  - [x] 24.6 Write property test for error sanitization
    - **Property 26: Error message sanitization**
    - **Validates: Requirements 13.2**
  - [x] 24.7 Write property test for audit logging
    - **Property 27: Audit trail completeness**
    - **Validates: Requirements 13.3**

- [x] 25. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
