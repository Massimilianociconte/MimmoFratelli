/**
 * Referral Landing Handler
 * Mimmo Fratelli E-commerce Platform
 * 
 * Detects referral codes in URL and opens registration modal automatically
 */

import { authModal } from '../components/auth-modal.js';
import { referralService } from '../services/referral.js';
import { authService } from '../services/auth.js';

/**
 * Initialize referral landing detection
 * Call this on page load to check for referral codes
 */
export async function initReferralLanding() {
  // Check if there's a ref parameter in the URL
  const urlParams = new URLSearchParams(window.location.search);
  const refCode = urlParams.get('ref');
  
  if (!refCode) return;
  
  // Validate the referral code format
  const validPattern = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
  if (!validPattern.test(refCode.toUpperCase())) {
    console.log('Invalid referral code format:', refCode);
    return;
  }
  
  // Store the referral code in localStorage
  referralService.captureReferralFromUrl();
  
  // Check if user is already logged in
  const isLoggedIn = await authService.isAuthenticated();
  
  if (isLoggedIn) {
    // User is already logged in, just show a message
    console.log('User already logged in, referral code stored for future use');
    return;
  }
  
  // Initialize auth modal if not already done
  authModal.init();
  
  // Small delay to ensure page is loaded
  setTimeout(() => {
    // Open registration modal with referral code
    authModal.show('register', {
      referralCode: refCode.toUpperCase(),
      onSuccess: () => {
        // Clean URL after successful registration
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
      }
    });
  }, 500);
}

export default initReferralLanding;
