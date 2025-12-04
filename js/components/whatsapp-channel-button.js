/**
 * WhatsApp Channel Floating Button
 * Pulsante elegante e minimale per seguire il canale WhatsApp
 */

class WhatsAppChannelButton {
    constructor() {
        // CONFIGURA QUI IL LINK DEL TUO CANALE WHATSAPP
        this.channelUrl = 'https://whatsapp.com/channel/INSERISCI_IL_TUO_ID';
        this.isVisible = true;
    }

    init() {
        this.createButton();
        this.addStyles();
        this.setupScrollBehavior();
    }

    createButton() {
        const button = document.createElement('a');
        button.href = this.channelUrl;
        button.target = '_blank';
        button.rel = 'noopener noreferrer';
        button.className = 'whatsapp-channel-btn';
        button.setAttribute('aria-label', 'Unisciti al nostro canale WhatsApp');
        button.innerHTML = `
            <div class="whatsapp-icon-wrapper">
                <svg viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                </svg>
                <span class="whatsapp-badge">📢</span>
            </div>
            <div class="whatsapp-tooltip">
                <strong>Canale WhatsApp</strong>
                <span>Unisciti per offerte e novità!</span>
            </div>
        `;
        
        document.body.appendChild(button);
        this.button = button;
    }

    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .whatsapp-channel-btn {
                position: fixed;
                bottom: 24px;
                left: 24px;
                width: 52px;
                height: 52px;
                background: linear-gradient(135deg, #25D366 0%, #128C7E 100%);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                color: #fff;
                box-shadow: 0 4px 16px rgba(37, 211, 102, 0.4);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                z-index: 90;
                text-decoration: none;
                opacity: 0;
                transform: scale(0.8) translateY(20px);
                animation: whatsappFadeIn 0.5s ease 1s forwards;
            }

            @keyframes whatsappFadeIn {
                to {
                    opacity: 1;
                    transform: scale(1) translateY(0);
                }
            }

            .whatsapp-icon-wrapper {
                position: relative;
                display: flex;
                align-items: center;
                justify-content: center;
            }

            .whatsapp-channel-btn svg {
                width: 26px;
                height: 26px;
                transition: transform 0.3s ease;
            }

            .whatsapp-badge {
                position: absolute;
                top: -16px;
                right: -16px;
                font-size: 14px;
                background: white;
                border-radius: 50%;
                width: 22px;
                height: 22px;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                animation: badgeBounce 2s ease-in-out infinite;
            }

            @keyframes badgeBounce {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.15); }
            }

            .whatsapp-channel-btn:hover {
                transform: scale(1.1);
                box-shadow: 0 8px 24px rgba(37, 211, 102, 0.5);
            }

            .whatsapp-channel-btn:hover svg {
                transform: scale(1.1);
            }

            .whatsapp-channel-btn:active {
                transform: scale(0.95);
            }

            /* Tooltip - Enhanced */
            .whatsapp-tooltip {
                position: absolute;
                left: calc(100% + 14px);
                background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
                color: #fff;
                padding: 10px 16px;
                border-radius: 12px;
                opacity: 0;
                visibility: hidden;
                transform: translateX(-10px);
                transition: all 0.3s ease;
                pointer-events: none;
                font-family: var(--font-sans, -apple-system, sans-serif);
                display: flex;
                flex-direction: column;
                gap: 2px;
                white-space: nowrap;
                box-shadow: 0 4px 20px rgba(0,0,0,0.2);
            }

            .whatsapp-tooltip strong {
                font-size: 0.85rem;
                font-weight: 600;
                color: #25D366;
            }

            .whatsapp-tooltip span {
                font-size: 0.75rem;
                color: rgba(255,255,255,0.8);
            }

            .whatsapp-tooltip::before {
                content: '';
                position: absolute;
                left: -8px;
                top: 50%;
                transform: translateY(-50%);
                border: 8px solid transparent;
                border-right-color: #1a1a1a;
            }

            .whatsapp-channel-btn:hover .whatsapp-tooltip {
                opacity: 1;
                visibility: visible;
                transform: translateX(0);
            }

            /* Hide when scrolling down fast */
            .whatsapp-channel-btn.hidden {
                opacity: 0;
                transform: scale(0.8) translateY(20px);
                pointer-events: none;
            }

            /* Mobile adjustments */
            @media (max-width: 768px) {
                .whatsapp-channel-btn {
                    bottom: 20px;
                    left: 20px;
                    width: 48px;
                    height: 48px;
                }

                .whatsapp-channel-btn svg {
                    width: 24px;
                    height: 24px;
                }

                .whatsapp-badge {
                    font-size: 12px;
                    top: -14px;
                    right: -14px;
                    width: 20px;
                    height: 20px;
                }

                /* Show mini tooltip on mobile */
                .whatsapp-tooltip {
                    left: calc(100% + 10px);
                    padding: 8px 12px;
                }

                .whatsapp-tooltip strong {
                    font-size: 0.8rem;
                }

                .whatsapp-tooltip span {
                    font-size: 0.7rem;
                }
            }

            /* Pulse animation on first load */
            .whatsapp-channel-btn::after {
                content: '';
                position: absolute;
                inset: 0;
                border-radius: 50%;
                background: #25D366;
                z-index: -1;
                animation: whatsappPulse 2s ease-out 1.5s;
            }

            @keyframes whatsappPulse {
                0% {
                    transform: scale(1);
                    opacity: 0.5;
                }
                100% {
                    transform: scale(2);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    setupScrollBehavior() {
        let lastScrollY = window.scrollY;
        let ticking = false;

        window.addEventListener('scroll', () => {
            if (!ticking) {
                window.requestAnimationFrame(() => {
                    const currentScrollY = window.scrollY;
                    const scrollDiff = currentScrollY - lastScrollY;
                    
                    // Hide when scrolling down fast, show when scrolling up or at top
                    if (scrollDiff > 50 && currentScrollY > 200) {
                        this.button.classList.add('hidden');
                    } else if (scrollDiff < -20 || currentScrollY < 100) {
                        this.button.classList.remove('hidden');
                    }
                    
                    lastScrollY = currentScrollY;
                    ticking = false;
                });
                ticking = true;
            }
        });
    }

    // Metodo per aggiornare l'URL del canale
    setChannelUrl(url) {
        this.channelUrl = url;
        if (this.button) {
            this.button.href = url;
        }
    }
}

// Export e auto-init
export const whatsappChannelButton = new WhatsAppChannelButton();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => whatsappChannelButton.init());
} else {
    whatsappChannelButton.init();
}
