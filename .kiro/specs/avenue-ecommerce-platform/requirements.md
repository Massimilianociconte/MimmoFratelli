# Requirements Document

## Introduction

Questo documento definisce i requisiti per la trasformazione del sito Avenue Gallarate da sito vetrina a piattaforma e-commerce completa e scalabile. Il progetto prevede l'integrazione con Supabase come backend primario, sistemi di pagamento multipli (Stripe, PayPal, Klarna), un CMS headless per la gestione dei contenuti, e un'esperienza utente rinnovata con nuove funzionalità come Gift Card interattive e sezione promozioni.

## Glossary

- **Avenue_System**: La piattaforma e-commerce Avenue M. nel suo complesso
- **Supabase_Backend**: Il servizio Supabase utilizzato come database PostgreSQL, autenticazione e API backend
- **Cart_Service**: Il servizio che gestisce il carrello acquisti degli utenti
- **Wishlist_Service**: Il servizio che gestisce la lista dei desideri/preferiti
- **Payment_Gateway**: L'insieme dei servizi di pagamento integrati (Stripe, PayPal, Klarna)
- **CMS_Panel**: Il pannello di amministrazione per la gestione dei contenuti
- **Product_Catalog**: L'insieme dei prodotti disponibili nel database
- **Order_Management**: Il sistema di gestione ordini e spedizioni
- **Guest_User**: Utente non autenticato che naviga il sito
- **Authenticated_User**: Utente che ha effettuato login o registrazione
- **localStorage**: Storage locale del browser per dati temporanei
- **RLS (Row Level Security)**: Politiche di sicurezza a livello di riga in PostgreSQL/Supabase
- **PCI-DSS**: Standard di sicurezza per il trattamento dei dati delle carte di pagamento
- **Courier_API**: API del corriere designato per la gestione delle spedizioni (es. BRT, DHL, GLS)
- **Webhook**: Callback HTTP automatico per notifiche in tempo reale tra sistemi

## Requirements

### Requirement 1: User Authentication

**User Story:** As a customer, I want to create an account and login, so that I can complete purchases and track my orders.

#### Acceptance Criteria

1. WHEN a guest user clicks on the registration button THEN the Avenue_System SHALL display a registration form requesting email, password, first name, and last name
2. WHEN a user submits valid registration data THEN the Supabase_Backend SHALL create a new user account and send a confirmation email
3. WHEN a user submits a login request with valid credentials THEN the Supabase_Backend SHALL authenticate the user and establish a session
4. WHEN a user submits invalid credentials THEN the Avenue_System SHALL display a generic error message "Email o password non corretti" without revealing which specific field is incorrect
5. WHEN an authenticated user requests logout THEN the Avenue_System SHALL terminate the session and redirect to the homepage
6. WHEN a user session expires THEN the Avenue_System SHALL redirect to login page preserving the intended destination URL
7. WHEN multiple failed login attempts occur from the same IP THEN the Avenue_System SHALL implement rate limiting after 5 attempts within 15 minutes

### Requirement 2: Hybrid Wishlist System

**User Story:** As a customer, I want to save products to my wishlist, so that I can easily find and purchase them later.

#### Acceptance Criteria

1. WHEN a guest user adds a product to wishlist THEN the Wishlist_Service SHALL store the product ID in localStorage
2. WHEN an authenticated user adds a product to wishlist THEN the Wishlist_Service SHALL store the product reference in Supabase_Backend
3. WHEN a guest user with localStorage wishlist items completes registration THEN the Wishlist_Service SHALL migrate all localStorage items to the user's Supabase_Backend wishlist
4. WHEN a guest user with localStorage wishlist items logs in THEN the Wishlist_Service SHALL merge localStorage items with existing Supabase_Backend wishlist items avoiding duplicates
5. WHEN a user removes a product from wishlist THEN the Wishlist_Service SHALL delete the product reference from the appropriate storage
6. WHEN merging wishlists THEN the Wishlist_Service SHALL perform a union of localStorage and Supabase items where duplicate product IDs result in a single entry

### Requirement 3: Shopping Cart

**User Story:** As a customer, I want to add products to my cart, so that I can purchase multiple items in a single transaction.

#### Acceptance Criteria

1. WHEN a user adds a product to cart THEN the Cart_Service SHALL store the product with selected size, color, and quantity
2. WHEN a user modifies cart item quantity THEN the Cart_Service SHALL update the quantity and recalculate the total
3. WHEN a user removes an item from cart THEN the Cart_Service SHALL delete the item and recalculate the total
4. WHEN an authenticated user navigates between devices THEN the Cart_Service SHALL synchronize cart contents via Supabase_Backend
5. WHEN a user proceeds to checkout without authentication THEN the Avenue_System SHALL require login or registration before payment

### Requirement 4: Payment Integration

**User Story:** As a customer, I want to pay using my preferred payment method, so that I can complete my purchase conveniently.

#### Acceptance Criteria

1. WHEN a user selects credit card payment THEN the Payment_Gateway SHALL process the transaction through Stripe
2. WHEN a user selects PayPal payment THEN the Payment_Gateway SHALL redirect to PayPal for authorization
3. WHEN a user selects Klarna installment payment THEN the Payment_Gateway SHALL offer quarterly installment options at zero interest
4. WHEN a payment transaction succeeds THEN the Order_Management SHALL create an order record with status "confirmed"
5. WHEN a payment transaction fails THEN the Avenue_System SHALL display the error reason and allow retry
6. WHEN processing payment data THEN the Payment_Gateway SHALL delegate all card data handling to Stripe/PayPal/Klarna without storing sensitive payment information in Supabase_Backend (PCI-DSS compliance)
7. WHEN a payment session is created THEN the Avenue_System SHALL use Stripe Checkout or Payment Elements to ensure card data never touches the application server

### Requirement 5: Order Management and Shipping

**User Story:** As a customer, I want to track my orders, so that I know when my purchases will arrive.

#### Acceptance Criteria

1. WHEN an order is confirmed THEN the Order_Management SHALL transmit order details to the Courier_API for shipment creation and pickup scheduling
2. WHEN the Courier_API responds with shipment confirmation THEN the Order_Management SHALL store the tracking number and carrier tracking URL in the order record
3. WHEN the Courier_API returns an error THEN the Order_Management SHALL mark the order for manual review and notify the administrator
4. WHEN an authenticated user accesses order history THEN the Avenue_System SHALL display all past orders with status and tracking information
5. WHEN an order status changes THEN the Avenue_System SHALL send an email notification to the customer
6. WHEN integrating with Courier_API THEN the Order_Management SHALL support configurable courier selection (BRT, DHL, GLS) via environment variables

### Requirement 6: CMS and Product Management

**User Story:** As a store administrator, I want to manage products without coding, so that I can keep the catalog updated efficiently.

#### Acceptance Criteria

1. WHEN an administrator accesses the CMS_Panel THEN the Avenue_System SHALL require authentication with admin privileges verified via Supabase RLS policies
2. WHEN an administrator creates a new product THEN the CMS_Panel SHALL store the product data in Supabase_Backend with name, description, price, images, category, and inventory
3. WHEN an administrator updates product information THEN the CMS_Panel SHALL persist changes to Supabase_Backend and reflect updates on the storefront immediately
4. WHEN an administrator deletes a product THEN the CMS_Panel SHALL perform a soft-delete marking the product as inactive while preserving historical order references
5. WHEN an administrator uploads product images THEN the CMS_Panel SHALL store images in Supabase Storage and generate optimized variants
6. WHEN a non-admin user attempts CMS operations THEN the Supabase_Backend RLS policies SHALL reject the request and return an authorization error

### Requirement 7: Advanced Product Filtering

**User Story:** As a customer, I want to filter products by various criteria, so that I can find exactly what I'm looking for quickly.

#### Acceptance Criteria

1. WHEN a user applies a price range filter THEN the Avenue_System SHALL display only products within the specified price range
2. WHEN a user applies a category filter THEN the Avenue_System SHALL display only products matching the selected category
3. WHEN a user applies multiple filters simultaneously THEN the Avenue_System SHALL display products matching all selected criteria
4. WHEN a user clears all filters THEN the Avenue_System SHALL display the complete Product_Catalog
5. WHEN filter results are empty THEN the Avenue_System SHALL display a message suggesting alternative filters or popular products

### Requirement 8: UI/UX Enhancements

**User Story:** As a customer, I want a visually appealing and efficient browsing experience, so that I can enjoy shopping on the platform.

#### Acceptance Criteria

1. WHEN the homepage loads THEN the Avenue_System SHALL display the brand name as "Avenue M." with increased font size
2. WHEN the product grid loads THEN the Avenue_System SHALL display 5 or 6 product cards per row on desktop screens
3. WHEN a user hovers over a product card THEN the Avenue_System SHALL display quick-view options without page navigation
4. WHEN the page loads on mobile devices THEN the Avenue_System SHALL adapt the layout to display 2 product cards per row

### Requirement 9: About Us Page

**User Story:** As a visitor, I want to learn about the company history and values, so that I can trust the brand before purchasing.

#### Acceptance Criteria

1. WHEN a user navigates to the About Us page THEN the Avenue_System SHALL display company history, mission statement, and team information
2. WHEN the About Us page loads THEN the Avenue_System SHALL include visual elements such as images and timeline graphics

### Requirement 10: Promotions Section

**User Story:** As a customer, I want to see current promotions, so that I can take advantage of special offers.

#### Acceptance Criteria

1. WHEN a user navigates to the Promotions section THEN the Avenue_System SHALL display all active promotional offers with discount percentages and validity dates
2. WHEN a promotion expires THEN the Avenue_System SHALL automatically remove the promotion from display
3. WHEN a user applies a promotional product to cart THEN the Cart_Service SHALL calculate the discounted price automatically

### Requirement 11: Interactive Gift Card Creator

**User Story:** As a customer, I want to create personalized gift cards, so that I can give meaningful presents to friends and family.

#### Acceptance Criteria

1. WHEN a user accesses the Gift Card creator THEN the Avenue_System SHALL display customization options including design templates, recipient name, sender name, message, and amount
2. WHEN a user modifies gift card options THEN the Avenue_System SHALL render a real-time preview with animations showing the changes
3. WHEN a user completes gift card customization THEN the Avenue_System SHALL allow adding the gift card to cart for purchase
4. WHEN a gift card is purchased THEN the Avenue_System SHALL generate a unique redemption code and send it to the specified recipient email
5. WHEN a user applies a gift card code at checkout THEN the Payment_Gateway SHALL validate the code and apply the balance to the order total

### Requirement 12: Database Schema Design

**User Story:** As a developer, I want a well-structured database schema, so that the application data is organized and queryable efficiently.

#### Acceptance Criteria

1. WHEN the Supabase_Backend is initialized THEN the database SHALL contain tables for users, products, categories, orders, order_items, cart_items, wishlist_items, gift_cards, and promotions
2. WHEN product data is queried THEN the database SHALL support filtering by category, price range, and availability through indexed columns on category_id, price, and is_active fields
3. WHEN order data is created THEN the database SHALL enforce referential integrity between orders, order_items, and products via foreign key constraints
4. WHEN user data is accessed THEN the database SHALL enforce Row Level Security policies ensuring users can only access their own data
5. WHEN admin operations are performed THEN the database RLS policies SHALL verify the user role from a user_roles table before allowing write operations on products, categories, and promotions
6. WHEN high-traffic queries execute THEN the database SHALL utilize composite indexes on frequently filtered column combinations (category_id, price, gender)


### Requirement 13: Security and Error Handling

**User Story:** As a system administrator, I want robust security measures and graceful error handling, so that user data is protected and the system remains stable.

#### Acceptance Criteria

1. WHEN any API request is made THEN the Avenue_System SHALL validate input data against expected schemas before processing
2. WHEN a database query fails THEN the Avenue_System SHALL log the error details server-side and display a user-friendly message without exposing technical details
3. WHEN sensitive operations occur THEN the Supabase_Backend SHALL log audit trails including user ID, action type, and timestamp
4. WHEN CORS requests are received THEN the Avenue_System SHALL only accept requests from whitelisted origins
5. WHEN user passwords are stored THEN the Supabase_Backend SHALL use bcrypt hashing with appropriate salt rounds (handled by Supabase Auth)
